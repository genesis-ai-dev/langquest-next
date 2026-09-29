import { commands, deriveBlockers, derivePassage, HlcClock, instantiateFlowV2, type EventSpec, type AnyEvent } from '@langquest-next/core';
import { MemoryStore } from '../../../packages/client/src/memoryStore';
import { SyncClient } from '../../../packages/client/src/syncClient';
import { FakeServer } from '../../../packages/client/test/fakeServer';
import { EDGES, TAB_SCREENS, type ScreenId } from '../src/flow';
import { deriveSession, edgeAllowed, homeScreenFor } from '../src/session';
import { screenMayEmit } from '../src/screenContracts';

/**
 * Two phones, a translator and a reviewer, wander the flow machine with the
 * connection dropping at random. The translator records and publishes from
 * the workspace; the reviewer reviews from Review it. Every event each emits
 * must be one its screen's contract allows, nothing may block, and once
 * reconnected both replicas must agree and show the passage done.
 */
it('walks two devices through recording and review with randomized connection loss', async () => {
  for (let seed = 1; seed <= 12; seed++) {
    let randomState = seed;
    const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const server = new FakeServer();
    let now = 1_700_000_000_000;
    const device = (actorId: string) => {
      let id = 0;
      return new SyncClient({ orgId: 'walk', projectId: 'p', actorId, deviceId: actorId,
        store: new MemoryStore(), transport: server.transportFor(),
        clock: new HlcClock(actorId, () => ++now), newId: () => `${seed}:${actorId}:${++id}` });
    };
    const translator = device('translator'), reviewer = device('reviewer');
    await translator.load(); await reviewer.load();
    await translator.append('v1.ProjectCreated', { name: 'Walk', sourceLanguoidId: 'eng' });
    await translator.append('v1.ProjectConfigChanged', { config: { unitKinds: [{ id: 'passage', label: 'Passage', childKinds: [] }], workflow: [] } });
    await translator.append('v1.MemberAdded', { profileId: 'translator', role: 'translator' });
    await translator.append('v1.MemberAdded', { profileId: 'reviewer', role: 'reviewer' });
    await translator.append('v1.LaneAdded', { laneId: 'L', languoidId: 'xyz' });
    await translator.append('v1.UnitAdded', { unitId: 'u', parentUnitId: null, kind: 'passage', label: 'Passage', order: 'a' });
    // Quick Check: Peer Review, then Final Approval.
    await translator.append('v1.LaneFlowSelected', { laneId: 'L', flowId: 'quick_check', catalogVersion: 2 });
    for (const step of instantiateFlowV2('quick_check', 'L')) await translator.append('v2.WorkflowStepSet', step);
    await translator.sync(); await reviewer.sync();
    const devices = [{ client: translator, actor: 'translator', screen: 'my_work' as ScreenId },
      { client: reviewer, actor: 'reviewer', screen: 'my_work' as ScreenId }];
    let commandId = 0;
    async function act(d: typeof devices[number], specs: EventSpec[]) {
      const session = deriveSession(d.actor, null, d.client.getState(), true);
      for (const spec of specs) {
        expect(screenMayEmit(d.screen, session, spec as AnyEvent), `${d.actor}@${d.screen}:${spec.type}:${[...session.privileges]}`).toBe(true);
        await d.client.append(spec.type, spec.payload);
      }
    }
    async function recordAndPublish() {
      const d = devices[0]!;
      d.screen = 'workspace';
      const id = `command-${seed}-${++commandId}`;
      await act(d, commands(d.client.getState()).addRecording({ commandId: id,
        recordingId: id, unitId: 'u', laneId: 'L', kind: 'target', card: { hash: id, durationMs: 100 } }));
      const latest = derivePassage(d.client.getState(), 'u', 'L').latest;
      await act(d, commands(d.client.getState()).publishVersion({ commandId: `pub-${id}`, unitId: 'u', laneId: 'L',
        cardHashes: [...(latest?.cardHashes ?? []), id], ...(latest ? { note: 'Re-recorded after feedback.' } : {}) }));
    }
    await recordAndPublish();
    for (let step = 0; step < 140; step++) {
      const d = devices[random() < 0.5 ? 0 : 1]!;
      server.offline = random() < 0.55;
      const state = d.client.getState();
      const session = deriveSession(d.actor, null, state, true);
      // Back edges document the stack pop; tapping forward follows the rest.
      const edges = EDGES.filter((edge) => edge.from === d.screen && edge.mode !== 'back' && edgeAllowed(edge, session));
      if (random() < 0.15 || !edges.length) d.screen = TAB_SCREENS[Math.floor(random() * TAB_SCREENS.length)]!;
      else {
        const edge = edges[Math.floor(random() * edges.length)]!;
        d.screen = edge.to === 'home_hub' ? homeScreenFor(session) : edge.to;
      }
      const passage = derivePassage(state, 'u', 'L');
      if (d.screen === 'workspace' && d.actor === 'translator' && random() < 0.35) await recordAndPublish();
      if (d.screen === 'review_capture' && passage.latest) {
        const outcome = random() < 0.4 ? 'needs_changes' : 'looks_good';
        await act(d, commands(state).recordReview({ commandId: `review-${seed}-${++commandId}`, takeIds: [passage.latest.takeId],
          kindId: random() < 0.5 ? 'peer' : 'final', outcome, via: 'app', ...(outcome === 'needs_changes' ? { comment: 'Verse 2 is fast.' } : {}) }));
      }
      if (random() < 0.4) await d.client.sync();
      expect(deriveBlockers(d.client.getState())).toEqual([]);
    }
    // Reconnect, and the reviewer approves both kinds on the latest version.
    server.offline = false;
    await translator.sync(); await reviewer.sync(); await translator.sync(); await reviewer.sync();
    const latest = derivePassage(reviewer.getState(), 'u', 'L').latest!;
    devices[1]!.screen = 'review_capture';
    for (const kindId of ['peer', 'final']) {
      await act(devices[1]!, commands(reviewer.getState()).recordReview({ commandId: `approve-${seed}-${kindId}`, takeIds: [latest.takeId], kindId, outcome: 'looks_good', via: 'app' }));
    }
    await reviewer.sync(); await translator.sync(); await reviewer.sync();
    expect(derivePassage(translator.getState(), 'u', 'L').done).toBe(true);
    expect(translator.getState()).toEqual(reviewer.getState());
    expect(await translator.pendingCount()).toBe(0);
    expect(await reviewer.pendingCount()).toBe(0);
  }
});
