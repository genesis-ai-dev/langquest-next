import {
  commands, derivePassage, foldOrg, HlcClock, instantiateFlow, ORG_STREAM, SEED_ROLES,
  type AnyEvent, type EventPayloads, type EventSpec, type EventType
} from '@langquest-next/core';
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
 * must be one its screen's contract allows, every event must fold, and
 * once reconnected both replicas must agree and show the passage done.
 * Who may do what comes from the organization stream; the work is in the
 * language's stream.
 */
it('walks two devices through recording and review with randomized connection loss', async () => {
  for (let seed = 1; seed <= 12; seed++) {
    let randomState = seed;
    const random = () => ((randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    const server = new FakeServer();
    let now = 1_700_000_000_000;
    const orgEvents: AnyEvent[] = [];
    const orgEvent = <T extends EventType>(type: T, payload: EventPayloads[T]) => {
      orgEvents.push({ id: `org-${orgEvents.length}`, type, orgId: 'walk', streamId: ORG_STREAM, actorId: 'admin', deviceId: 'admin',
        hlc: `${String(orgEvents.length + 1).padStart(15, '0')}:000000:admin`, payload } as AnyEvent);
    };
    orgEvent('v1.OrgCreated', { name: 'Walk' });
    for (const r of SEED_ROLES) orgEvent('v1.RoleDefined', { roleId: r.roleId, name: r.name, privileges: r.privileges });
    orgEvent('v1.LanguageAdded', { languageId: 'L', name: 'Walk', code: 'xyz', sourceCode: 'eng' });
    orgEvent('v1.MemberAdded', { profileId: 'translator', roleId: 'translator', scope: { level: 'language', languageId: 'L' } });
    orgEvent('v1.MemberAdded', { profileId: 'reviewer', roleId: 'reviewer', scope: { level: 'language', languageId: 'L' } });
    const org = foldOrg(orgEvents);
    const device = (actorId: string) => {
      let id = 0;
      return new SyncClient({ orgId: 'walk', streamId: 'L', actorId, deviceId: actorId,
        store: new MemoryStore(), transport: server.transportFor(),
        clock: new HlcClock(actorId, () => ++now), newId: () => `${seed}:${actorId}:${++id}` });
    };
    const translator = device('translator'), reviewer = device('reviewer');
    await translator.load(); await reviewer.load();
    await translator.append('v1.UnitAdded', { unitId: 'u', parentUnitId: null, kind: 'passage', label: 'Passage', order: 'a' });
    // Quick Check: Peer Review, then Final Approval.
    await translator.append('v1.FlowSelected', { flowId: 'quick_check' });
    for (const step of instantiateFlow('quick_check')) await translator.append('v1.FlowStepSet', step);
    await translator.sync(); await reviewer.sync();
    const devices = [{ client: translator, actor: 'translator', screen: 'my_work' as ScreenId },
      { client: reviewer, actor: 'reviewer', screen: 'my_work' as ScreenId }];
    let commandId = 0;
    async function act(d: typeof devices[number], specs: EventSpec[]) {
      const session = deriveSession(d.actor, null, true, org, 'L');
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
        recordingId: id, unitId: 'u', kind: 'target', card: { hash: id, durationMs: 100 } }));
      const latest = derivePassage(d.client.getState(), 'u').latest;
      await act(d, commands(d.client.getState()).publishVersion({ commandId: `pub-${id}`, unitId: 'u',
        cardHashes: [...(latest?.cardHashes ?? []), id], ...(latest ? { note: 'Re-recorded after feedback.' } : {}) }));
    }
    await recordAndPublish();
    for (let step = 0; step < 140; step++) {
      const d = devices[random() < 0.5 ? 0 : 1]!;
      server.offline = random() < 0.55;
      const state = d.client.getState();
      const session = deriveSession(d.actor, null, true, org, 'L');
      // Back edges document the stack pop; tapping forward follows the rest.
      const edges = EDGES.filter((edge) => edge.from === d.screen && edge.mode !== 'back' && edgeAllowed(edge, session));
      if (random() < 0.15 || !edges.length) d.screen = TAB_SCREENS[Math.floor(random() * TAB_SCREENS.length)]!;
      else {
        const edge = edges[Math.floor(random() * edges.length)]!;
        d.screen = edge.to === 'home_hub' ? homeScreenFor(session) : edge.to;
      }
      const passage = derivePassage(state, 'u');
      if (d.screen === 'workspace' && d.actor === 'translator' && random() < 0.35) await recordAndPublish();
      if (d.screen === 'review_capture' && passage.latest) {
        const outcome = random() < 0.4 ? 'needs_changes' : 'looks_good';
        await act(d, commands(state).recordReview({ commandId: `review-${seed}-${++commandId}`, takeIds: [passage.latest.takeId],
          kindId: random() < 0.5 ? 'peer' : 'final', outcome, via: 'app', ...(outcome === 'needs_changes' ? { comment: 'Verse 2 is fast.' } : {}) }));
      }
      if (random() < 0.4) await d.client.sync();
      expect(d.client.getState().invalidEvents).toEqual({});
    }
    // Reconnect, and the reviewer approves both kinds on the latest version.
    server.offline = false;
    await translator.sync(); await reviewer.sync(); await translator.sync(); await reviewer.sync();
    const latest = derivePassage(reviewer.getState(), 'u').latest!;
    devices[1]!.screen = 'review_capture';
    for (const kindId of ['peer', 'final']) {
      await act(devices[1]!, commands(reviewer.getState()).recordReview({ commandId: `approve-${seed}-${kindId}`, takeIds: [latest.takeId], kindId, outcome: 'looks_good', via: 'app' }));
    }
    await reviewer.sync(); await translator.sync(); await reviewer.sync();
    expect(derivePassage(translator.getState(), 'u').done).toBe(true);
    expect(translator.getState()).toEqual(reviewer.getState());
    expect(await translator.pendingCount()).toBe(0);
    expect(await reviewer.pendingCount()).toBe(0);
  }
});
