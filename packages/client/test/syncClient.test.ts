import { HlcClock, applyOrgEvent, deriveTakeStatus, emptyOrgState, foldOrg, REDUCER_VERSION, type OrgState, type ProjectState } from '@langquest-next/core';
import { MemoryStore } from '../src/memoryStore';
import { SyncClient } from '../src/syncClient';
import { FakeServer } from './fakeServer';
import { rejectCodeOf } from '../src/types';

function device(server: FakeServer, deviceId: string, actorId: string, wall: { t: number }) {
  const store = new MemoryStore();
  let n = 0;
  const client = new SyncClient({
    orgId: 'org1',
    projectId: 'p1',
    actorId,
    deviceId,
    store,
    transport: server.transportFor(),
    clock: new HlcClock(deviceId, () => (wall.t += 1)),
    newId: () => `${deviceId}-${++n}`
  });
  return { client, store };
}

describe('SyncClient', () => {
  it('own appends are visible before any sync (PLAN.md section 3)', async () => {
    const server = new FakeServer();
    const { client } = device(server, 'dA', 'lead', { t: 0 });
    await client.load();
    await client.append('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
    expect(client.getState().project?.value.name).toBe('Luke');
    expect(await client.pendingCount()).toBe(1);
  });

  it('two devices offline for a while converge after sync, in either order', async () => {
    // Why: this is the month-in-the-village case. Both record, both review,
    // nobody merges anything by hand.
    const server = new FakeServer();
    const wall = { t: 0 };
    const a = device(server, 'dA', 'lead', wall);
    const b = device(server, 'dB', 't1', wall);
    await a.client.load();
    await b.client.load();

    await a.client.append('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
    await a.client.append('v1.MemberAdded', { profileId: 'lead', role: 'owner' });
    await a.client.append('v1.MemberAdded', { profileId: 't1', role: 'translator' });
    await a.client.append('v1.LaneAdded', { laneId: 'L1', languoidId: 'xyz' });
    await a.client.sync();
    await b.client.sync();

    server.offline = true;
    await b.client.append('v1.TakeComposed', {
      takeId: 'tB',
      unitId: 'u1',
      laneId: 'L1',
      cardHashes: ['c1'],
      parentTakeId: null
    });
    await a.client.append('v1.TakeComposed', {
      takeId: 'tA',
      unitId: 'u1',
      laneId: 'L1',
      cardHashes: ['c2'],
      parentTakeId: null
    });
    expect((await b.client.sync()).pushed).toBe(0); // still queued
    expect(await b.client.pendingCount()).toBe(1);

    server.offline = false;
    await b.client.sync();
    await a.client.sync();
    await b.client.sync(); // b pulls a's take

    const sa = a.client.getState();
    const sb = b.client.getState();
    expect(Object.keys(sa.takes).sort()).toEqual(['tA', 'tB']);
    expect({ ...sa, appliedEventIds: {} }).toEqual({ ...sb, appliedEventIds: {} });
    expect(await a.client.pendingCount()).toBe(0);
    expect(await b.client.pendingCount()).toBe(0);
  });

  it('a rejected event stays in the log, marked, and leaves the fold (invariant 1)', async () => {
    const server = new FakeServer();
    server.authorize = (e) => (e.type === 'v1.ProjectConfigChanged' ? 'role translator may not emit' : null);
    const { client, store } = device(server, 'dB', 't1', { t: 0 });
    await client.load();
    await client.append('v1.ProjectCreated', { name: 'x', sourceLanguoidId: 'eng' });
    const bad = await client.append('v1.ProjectConfigChanged', {
      config: { unitKinds: [], workflow: [] }
    });
    expect(client.getState().config).not.toBeNull();

    const { rejected } = await client.sync();
    expect(rejected).toBe(1);
    expect(client.getState().config).toBeNull();
    const kept = await store.rejected();
    expect(kept.map((k) => k.event.id)).toEqual([bad.id]);
    expect(kept[0]!.rejectReason).toMatch(/may not emit/);
    expect(await client.pendingCount()).toBe(0);
  });

  it('re-pushing after a lost ack is harmless (idempotent server, invariant 3)', async () => {
    const server = new FakeServer();
    const { client, store } = device(server, 'dA', 'lead', { t: 0 });
    await client.load();
    const e = await client.append('v1.ProjectCreated', { name: 'x', sourceLanguoidId: 'eng' });
    await client.push();
    // Simulate the ack never reaching the device.
    await store.put({ event: e, status: 'pending' });
    const r = await client.push();
    expect(r.accepted).toBe(1);
    expect(server.log.length).toBe(1);
    expect((await store.get(e.id))?.event.serverSeq).toBe(1);
  });

  it('pull pages through the tail and advances the cursor', async () => {
    const server = new FakeServer();
    const wall = { t: 0 };
    const a = device(server, 'dA', 'lead', wall);
    await a.client.load();
    for (let i = 0; i < 7; i++) {
      await a.client.append('v1.UnitAdded', {
        unitId: `u${i}`,
        parentUnitId: null,
        kind: 'passage',
        label: `P${i}`,
        order: `a${i}`
      });
    }
    await a.client.push();

    const store = new MemoryStore();
    const b = new SyncClient({
      orgId: 'org1',
      projectId: 'p1',
      actorId: 'r1',
      deviceId: 'dB',
      store,
      transport: server.transportFor(),
      pullPageSize: 3
    });
    await b.load();
    expect(await b.pull()).toBe(7);
    expect(await store.cursor('org1', 'p1')).toBe(7);
    expect(Object.keys(b.getState().units).length).toBe(7);
    expect(await b.pull()).toBe(0);
  });

  it('derived status agrees across devices once synced', async () => {
    const server = new FakeServer();
    const wall = { t: 0 };
    const a = device(server, 'dA', 'lead', wall);
    const r = device(server, 'dR', 'r1', wall);
    await a.client.load();
    await r.client.load();
    await a.client.append('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
    await a.client.append('v1.MemberAdded', { profileId: 'lead', role: 'owner' });
    await a.client.append('v1.MemberAdded', { profileId: 'r1', role: 'reviewer' });
    await a.client.append('v1.TakeComposed', {
      takeId: 't1',
      unitId: 'u1',
      laneId: 'L1',
      cardHashes: ['c1'],
      parentTakeId: null
    });
    await a.client.append('v1.TakeSubmitted', { takeId: 't1' });
    await a.client.sync();
    await r.client.sync();
    await r.client.append('v1.ReviewSubmitted', { takeId: 't1', stepId: 'community', decision: 'approve' });
    await r.client.sync();
    await a.client.sync();
    expect(deriveTakeStatus(a.client.getState(), 't1').outcome).toBe('approved');
    expect(deriveTakeStatus(r.client.getState(), 't1').outcome).toBe('approved');
  });

  it("does not push another user's queued events from a shared device", async () => {
    // Why: dev persona switching and real shared phones. Events queued by A
    // must wait for A's session, not be pushed (and rejected) under B.
    const server = new FakeServer();
    const store = new MemoryStore();
    const wall = { t: 0 };
    const mk = (actorId: string) =>
      new SyncClient({
        orgId: 'org1',
        projectId: 'p1',
        actorId,
        deviceId: 'shared',
        store,
        transport: server.transportFor(),
        clock: new HlcClock('shared', () => (wall.t += 1)),
        newId: () => `${actorId}-${wall.t}`
      });
    const a = mk('a');
    await a.load();
    await a.append('v1.ProjectCreated', { name: 'x', sourceLanguoidId: 'eng' });
    const b = mk('b');
    await b.load();
    expect((await b.push()).accepted).toBe(0);
    expect(server.log.length).toBe(0);
    expect((await a.push()).accepted).toBe(1);
  });
});

describe('SyncClient push batching (PLAN.md section 2: small deltas succeed)', () => {
  async function backlog(server: FakeServer, n: number, pushBatchSize: number, extra: { pushBatchesPerRun?: number; pullBudgetMs?: number; now?: () => number } = {}) {
    const store = new MemoryStore();
    const wall = { t: 0 };
    let k = 0;
    const client = new SyncClient({
      orgId: 'org1',
      projectId: 'p1',
      actorId: 'lead',
      deviceId: 'dA',
      store,
      transport: server.transportFor(),
      clock: new HlcClock('dA', () => (wall.t += 1)),
      newId: () => `e${++k}`,
      pushBatchSize,
      ...extra
    });
    await client.load();
    for (let i = 0; i < n; i++) {
      await client.append('v1.UnitAdded', { unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${i}` });
    }
    return { client, store };
  }

  it('a month of backlog is pushed in bounded batches, never one giant request', async () => {
    // Why: v2's worst incident was one oversized upload timing out and
    // retrying forever. A server that refuses big batches must still drain.
    const server = new FakeServer();
    server.maxBatch = 200;
    const { client } = await backlog(server, 450, 200);
    const r = await client.push();
    expect(r.accepted).toBe(450);
    expect(server.log.length).toBe(450);
    expect(server.appendCalls).toBe(3);
    expect(await client.pendingCount()).toBe(0);
  });

  it('one sync pushes a bounded number of batches, reports more, and still pulls', async () => {
    // Why: a device back from a month offline must not spend its whole sync
    // uploading before it sees anything new. Each slice pushes a little,
    // pulls a little, and the scheduler runs the next slice.
    const server = new FakeServer();
    const { client } = await backlog(server, 450, 100, { pushBatchesPerRun: 2 });
    const r1 = await client.sync();
    expect(r1.pushed).toBe(200);
    expect(r1.more).toBe(true);
    expect(await client.pendingCount()).toBe(250);
    const r2 = await client.sync();
    expect(r2.pushed).toBe(200);
    expect(r2.more).toBe(true);
    const r3 = await client.sync();
    expect(r3.pushed).toBe(50);
    expect(r3.more).toBe(false);
    expect(await client.pendingCount()).toBe(0);
  });

  it('a pull that runs out of time budget yields with more, and the next sync finishes it', async () => {
    const server = new FakeServer();
    const { client: a } = await backlog(server, 450, 200);
    await a.push();
    let t = 0;
    const store = new MemoryStore();
    const b = new SyncClient({
      orgId: 'org1', projectId: 'p1', actorId: 't1', deviceId: 'dB', store,
      transport: server.transportFor(),
      pullPageSize: 100, pullBudgetMs: 10, now: () => t,
      // Every page costs 6 ms of wall time; two pages exceed the budget.
      yieldBetweenPages: async () => { t += 0; }
    });
    await b.load();
    const orig = server.transportFor();
    (b as unknown as { opts: { transport: typeof orig } }).opts.transport = {
      ...orig,
      pull: async (...args: Parameters<typeof orig.pull>) => { t += 6; return orig.pull(...args); }
    };
    const r1 = await b.sync();
    expect(r1.more).toBe(true);
    expect(r1.pulled).toBeLessThan(450);
    expect(r1.pulled).toBeGreaterThan(0);
    let total = r1.pulled;
    for (let i = 0; i < 10 && total < 450; i++) total += (await b.sync()).pulled;
    expect(total).toBe(450);
    expect((await b.sync()).more).toBe(false);
    expect(Object.keys(b.getState().units)).toHaveLength(450);
  });

  it('appendMany honours caller-supplied ids, so a retried command upserts instead of duplicating', async () => {
    const server = new FakeServer();
    const { client, store } = await backlog(server, 0, 200);
    const spec = { id: 'cmd1:0', type: 'v1.UnitAdded' as const, payload: { unitId: 'u', parentUnitId: null, kind: 'passage', label: 'P', order: 'a' } };
    await client.appendMany([spec]);
    await client.appendMany([spec]);
    expect(await store.pendingCount('org1', 'p1')).toBe(1);
    expect((await client.push()).accepted).toBe(1);
    expect(server.log.map((e) => e.id)).toEqual(['cmd1:0']);
  });

  it('progress survives a link that drops mid-backlog', async () => {
    // Why: on a weak link the second batch may fail. The first must stay
    // confirmed so the next attempt starts from where it left off.
    const server = new FakeServer();
    const { client } = await backlog(server, 450, 200);
    server.failAfterCalls = 1;
    await expect(client.push()).rejects.toThrow();
    expect(server.log.length).toBe(200);
    expect(await client.pendingCount()).toBe(250);
    server.failAfterCalls = Infinity;
    const r = await client.push();
    expect(r.accepted).toBe(250);
    expect(await client.pendingCount()).toBe(0);
  });
});

describe('SyncClient redaction', () => {
  it('a redaction pulled after the target was folded removes it from state', async () => {
    const server = new FakeServer();
    const wall = { t: 0 };
    const a = device(server, 'dA', 'lead', wall);
    const b = device(server, 'dB', 't1', wall);
    await a.client.load();
    await b.client.load();
    const rec = await b.client.append('v1.RecordingAdded', {
      recordingId: 'r1', unitId: 'u1', laneId: 'L1', kind: 'target', cards: [{ hash: 'c1', durationMs: 1 }]
    });
    await b.client.sync();
    await a.client.sync();
    expect(a.client.getState().recordings['r1']).toBeDefined();
    await a.client.append('v1.Redacted', { eventId: rec.id, reason: 'wrong passage' });
    await a.client.sync();
    expect(a.client.getState().recordings['r1']).toBeUndefined();
    await b.client.sync();
    expect(b.client.getState().recordings['r1']).toBeUndefined();
  });
});

describe('SyncClient snapshots (PLAN.md invariant 10, cutover gate 4)', () => {
  async function seeded(server: FakeServer, n: number) {
    const wall = { t: 0 };
    const a = device(server, 'dA', 'lead', wall);
    await a.client.load();
    for (let i = 0; i < n; i++) {
      await a.client.append('v1.UnitAdded', { unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${i}` });
    }
    await a.client.sync();
    return a;
  }

  it('a new device cold-starts from the server snapshot and pulls only the tail', async () => {
    // Why: a phone joining a project with years of history must not replay
    // every event. Snapshot plus tail, one page, done.
    const server = new FakeServer();
    const a = await seeded(server, 7);
    server.makeSnapshot('org1', 'p1');
    await a.client.append('v1.LaneAdded', { laneId: 'L1', languoidId: 'x' });
    await a.client.sync();

    const b = device(server, 'dB', 'r1', { t: 0 });
    await b.client.load();
    const pulled = await b.client.pull();
    expect(pulled).toBe(1); // only the LaneAdded after the snapshot
    expect(Object.keys(b.client.getState().units).length).toBe(7);
    expect(await b.store.cursor('org1', 'p1')).toBe(8);
    expect((await b.store.all('org1', 'p1')).length).toBe(1);

    // Relaunch on the same device: the local checkpoint carries the state.
    const b2 = new SyncClient({
      orgId: 'org1', projectId: 'p1', actorId: 'r1', deviceId: 'dB', store: b.store, transport: server.transportFor()
    });
    const pullsBefore = server.pullCalls;
    await b2.load();
    expect(Object.keys(b2.getState().units).length).toBe(7);
    expect(server.pullCalls).toBe(pullsBefore);
  });

  it('a device checkpoints locally after enough confirmed events and prunes its log', async () => {
    // Why: replay on launch must be bounded by history since the last
    // checkpoint, not by the age of the project.
    const server = new FakeServer();
    const store = new MemoryStore();
    const wall = { t: 0 };
    let k = 0;
    const mk = () =>
      new SyncClient({
        orgId: 'org1', projectId: 'p1', actorId: 'lead', deviceId: 'dA', store,
        transport: server.transportFor(), clock: new HlcClock('dA', () => (wall.t += 1)),
        newId: () => `e${++k}`, checkpointEvery: 5
      });
    const c = mk();
    await c.load();
    for (let i = 0; i < 12; i++) {
      await c.append('v1.UnitAdded', { unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${i}` });
    }
    await c.sync();
    expect((await store.all('org1', 'p1')).length).toBeLessThan(12);
    const again = mk();
    await again.load();
    expect(Object.keys(again.getState().units).length).toBe(12);
    expect(await again.pendingCount()).toBe(0);
  });

  it('a device catching up on a big project checkpoints once, when caught up, and the checkpoint equals the full fold', async () => {
    // Why: every checkpoint serializes the whole state. Taking one per 2000
    // events while a new device pulls a 268k-event project ran it out of
    // memory at 512 MB and made the pull quadratic. Checkpoints are only a
    // cache, so the catch-up can skip them; the one it writes must still be
    // exactly what folding the raw log gives.
    const server = new FakeServer();
    const writer = new SyncClient({
      orgId: 'org1', projectId: 'p1', actorId: 'lead', deviceId: 'dW', store: new MemoryStore(),
      transport: server.transportFor(), newId: (() => { let k = 0; return () => `w${++k}`; })()
    });
    await writer.load();
    for (let i = 0; i < 30; i++) {
      await writer.append('v1.UnitAdded', { unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${i}` });
    }
    await writer.sync();

    const store = new MemoryStore();
    const saves: string[] = [];
    const commit = store.commit.bind(store);
    store.commit = async (batch) => {
      const snap = batch.meta?.['snapshot:org1/p1'];
      if (snap) saves.push(snap);
      return commit(batch);
    };
    const reader = new SyncClient({
      orgId: 'org1', projectId: 'p1', actorId: 'lead', deviceId: 'dR', store,
      transport: server.transportFor(), checkpointEvery: 5, pullPageSize: 5
    });
    await reader.load();
    let slices = 0;
    for (;;) {
      slices += 1;
      const r = await reader.pullSlice(0); // the budget ends each slice after one page
      if (!r.more) break;
    }
    expect(slices).toBeGreaterThan(2);
    expect(saves.length).toBe(1);

    const again = new SyncClient({
      orgId: 'org1', projectId: 'p1', actorId: 'lead', deviceId: 'dR', store,
      transport: server.transportFor()
    });
    await again.load();
    // The checkpoint pruned the local log here, so compare with the device that wrote it all.
    expect(again.getState().units).toEqual(writer.getState().units);
    expect(Object.keys(again.getState().units).length).toBe(30);
    // The live state keeps its duplicate guard; only the saved copy is compacted.
    expect(Object.keys((reader.getState() as ProjectState).appliedEventIds).length).toBe(30);
  });

  it('redacting an event that lives inside the snapshot refetches from the server', async () => {
    const server = new FakeServer();
    const a = await seeded(server, 3);
    server.makeSnapshot('org1', 'p1');
    const b = device(server, 'dB', 'r1', { t: 0 });
    await b.client.load();
    await b.client.pull();
    expect(b.client.getState().units['u1']).toBeDefined();

    const target = server.log.find((e) => e.type === 'v1.UnitAdded' && e.payload.unitId === 'u1')!;
    await a.client.append('v1.Redacted', { eventId: target.id });
    await a.client.sync();
    server.makeSnapshot('org1', 'p1'); // the worker catches up
    await b.client.pull();
    expect(b.client.getState().units['u1']).toBeUndefined();
    expect(Object.keys(b.client.getState().units).sort()).toEqual(['u0', 'u2']);
  });
});

describe('SyncClient minimum client version (cutover gate 5)', () => {
  it('a client the server no longer accepts is told so, and nothing is marked or lost', async () => {
    // Why: v2 hard-blocked sync on a version handshake; ignoring unknown
    // events is quieter but lets an old app act on stale state. The server
    // must be able to say "upgrade", and the app must show it.
    const server = new FakeServer();
    const { client } = device(server, 'dA', 'lead', { t: 0 });
    await client.load();
    await client.append('v1.ProjectCreated', { name: 'x', sourceLanguoidId: 'eng' });
    server.minClientVersion = 99;
    const r = await client.sync();
    expect(r.tooOld).toBe(true);
    expect(r.pushed).toBe(0);
    expect(await client.pendingCount()).toBe(1);
    server.minClientVersion = 0;
    expect((await client.sync()).tooOld).toBe(false);
    expect(await client.pendingCount()).toBe(0);
  });
});

describe('SyncClient snapshot download in chunks (weak links make progress)', () => {
  async function bigProject(server: FakeServer) {
    const wall = { t: 0 };
    const a = device(server, 'dA', 'lead', wall);
    await a.client.load();
    for (let i = 0; i < 300; i++) {
      await a.client.append('v1.UnitAdded', { unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `Passage number ${i}`, order: `a${i}` });
    }
    await a.client.sync();
    server.makeSnapshot('org1', 'p1');
    return a;
  }

  it('fetches a large snapshot in bounded pieces rather than one body', async () => {
    // Why: a 12 MB snapshot as one response fails on the links our users
    // have. Pieces of a few hundred KB each succeed or fail alone.
    const server = new FakeServer();
    await bigProject(server);
    server.chunkChars = 4000;
    const b = device(server, 'dB', 'r1', { t: 0 });
    await b.client.load();
    await b.client.pull();
    expect(server.chunkCalls).toBeGreaterThan(3);
    expect(Object.keys(b.client.getState().units).length).toBe(300);
  });

  it('a link that drops mid-snapshot resumes from the pieces already saved', async () => {
    const server = new FakeServer();
    await bigProject(server);
    server.chunkChars = 4000;
    server.failChunkAfter = 2;
    const b = device(server, 'dB', 'r1', { t: 0 });
    await b.client.load();
    expect((await b.client.sync()).pulled).toBe(0); // offline result, nothing lost
    const fetchedBeforeDrop = server.chunkCalls;
    server.failChunkAfter = Infinity;
    await b.client.pull();
    expect(Object.keys(b.client.getState().units).length).toBe(300);
    // Only the remaining pieces were fetched, not the whole snapshot again.
    const total = Math.ceil(JSON.stringify(server.snapshots.get('org1/p1')!.state).length / 4000);
    expect(server.chunkCalls - fetchedBeforeDrop).toBe(total - 2);
  });
});

describe('SyncClient after a long offline stretch (audit L1, L2, L3)', () => {
  async function seeded(server: FakeServer, n: number) {
    const a = device(server, 'dA', 'lead', { t: 0 });
    await a.client.load();
    for (let i = 0; i < n; i++) {
      await a.client.append('v1.UnitAdded', { unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${i}` });
    }
    await a.client.sync();
    return a;
  }

  it('work refused for membership reasons is re-queued when the actor is re-admitted', async () => {
    // Why: a translator removed while offline for a month pushes a month of
    // work and gets it all refused. The log keeps it (invariant 1); when a
    // coordinator adds them back, the next sync must carry it, not a support call.
    const server = new FakeServer();
    const members = new Set(['lead', 't1']);
    server.authorize = (e) => (members.has(e.actorId) || e.type === 'v1.ProjectCreated' ? null : 'not a member');
    const wall = { t: 0 };
    const a = device(server, 'dA', 'lead', wall);
    const b = device(server, 'dB', 't1', wall);
    await a.client.load();
    await b.client.load();
    await a.client.append('v1.ProjectCreated', { name: 'x', sourceLanguoidId: 'eng' });
    await a.client.append('v1.MemberAdded', { profileId: 'lead', role: 'owner' });
    await a.client.append('v1.MemberAdded', { profileId: 't1', role: 'translator' });
    await a.client.sync();
    await b.client.sync();

    members.delete('t1');
    await a.client.append('v1.MemberRemoved', { profileId: 't1' });
    await a.client.sync();
    await b.client.append('v1.TakeComposed', { takeId: 'tB', unitId: 'u1', laneId: 'L1', cardHashes: ['c'], parentTakeId: null });
    const first = await b.client.sync();
    expect(first.rejected).toBe(1);
    expect((await b.store.rejected('org1', 'p1')).map((l) => rejectCodeOf(l.rejectReason))).toEqual(['NOT_MEMBER']);
    expect(b.client.getState().takes['tB']).toBeUndefined();

    members.add('t1');
    await a.client.append('v1.MemberAdded', { profileId: 't1', role: 'translator' });
    await a.client.sync();
    await b.client.sync(); // pulls the re-admission, re-queues
    expect(await b.client.pendingCount()).toBe(1);
    const second = await b.client.sync();
    expect(second.pushed).toBe(1);
    expect(second.rejected).toBe(0);
    expect(b.client.getState().takes['tB']).toBeDefined();
    expect(server.log.some((e) => e.id === 'dB-1')).toBe(true);
  });

  it('a device whose clock runs ahead is re-stamped from server time and pushed again with the same ids', async () => {
    // Why: one phone set to 2031 would win every last-writer register
    // forever. The server refuses, the device adopts the offset, and the
    // intents go out again under honest clocks. Ids never change, so the
    // server's idempotency still holds.
    const server = new FakeServer();
    const SERVER_NOW = 1_700_000_000_000;
    server.authorize = (e) => {
      const wallMs = Number(e.hlc.split(':')[0]);
      return wallMs > SERVER_NOW + 5 * 60_000 ? `clock ahead: server time ${SERVER_NOW}` : null;
    };
    const store = new MemoryStore();
    let n = 0;
    const YEAR = 365 * 24 * 3600 * 1000;
    const client = new SyncClient({
      orgId: 'org1', projectId: 'p1', actorId: 'lead', deviceId: 'dA', store, transport: server.transportFor(),
      now: () => SERVER_NOW + 5 * YEAR, newId: () => `dA-${++n}`
    });
    await client.load();
    const e1 = await client.append('v1.ProjectCreated', { name: 'x', sourceLanguoidId: 'eng' });
    const e2 = await client.append('v1.MemberAdded', { profileId: 'lead', role: 'owner' });
    const first = await client.sync();
    expect(first.pushed).toBe(0);
    expect(first.rejected).toBe(0); // a clock refusal is not a refusal of the intent
    expect(await client.pendingCount()).toBe(2);
    const restamped = await store.pending('org1', 'p1');
    expect(restamped.map((l) => l.event.id)).toEqual([e1.id, e2.id]);
    for (const l of restamped) expect(Number(l.event.hlc.split(':')[0])).toBeLessThanOrEqual(SERVER_NOW + 1000);
    expect(restamped[0]!.event.hlc < restamped[1]!.event.hlc).toBe(true);

    const second = await client.sync();
    expect(second.pushed).toBe(2);
    expect(server.log.map((e) => e.id)).toEqual([e1.id, e2.id]);
    // The offset survives a relaunch, so new events are honest from the start.
    const again = new SyncClient({
      orgId: 'org1', projectId: 'p1', actorId: 'lead', deviceId: 'dA', store, transport: server.transportFor(),
      now: () => SERVER_NOW + 5 * YEAR, newId: () => `dA-${++n}`
    });
    await again.load();
    const e3 = await again.append('v1.LaneAdded', { laneId: 'L1', languoidId: 'x' });
    expect(Number(e3.hlc.split(':')[0])).toBeLessThanOrEqual(SERVER_NOW + 1000);
  });

  it('a redaction inside the checkpoint waits for a fresh snapshot instead of re-pulling the whole log', async () => {
    // Why: dropping the checkpoint re-downloads every event, 24 MB per 100k,
    // on the link that made the team offline. A snapshot that already
    // excludes the target is a fraction of that; wait for it, bounded.
    const server = new FakeServer();
    const a = await seeded(server, 3);
    server.makeSnapshot('org1', 'p1');
    const store = new MemoryStore();
    const clock = { t: 1_000 };
    const b = new SyncClient({
      orgId: 'org1', projectId: 'p1', actorId: 'r1', deviceId: 'dB', store, transport: server.transportFor(),
      now: () => clock.t
    });
    await b.load();
    await b.pull();
    const target = server.log.find((e) => e.type === 'v1.UnitAdded' && e.payload.unitId === 'u1')!;
    await a.client.append('v1.Redacted', { eventId: target.id });
    await a.client.sync();

    const pullsBefore = server.pullCalls;
    await b.pull(); // no fresh snapshot yet: keep the checkpoint, keep waiting
    expect(server.pullCalls - pullsBefore).toBeLessThanOrEqual(2);
    expect(b.getState().units['u1']).toBeDefined();
    expect(await store.cursor('org1', 'p1')).toBeGreaterThan(0);

    server.makeSnapshot('org1', 'p1'); // the worker catches up
    await b.pull();
    expect(b.getState().units['u1']).toBeUndefined();
    expect(Object.keys(b.getState().units).sort()).toEqual(['u0', 'u2']);
  });

  it('after the wait window with no snapshot, the device falls back to the full log', async () => {
    const server = new FakeServer();
    const a = await seeded(server, 3);
    server.makeSnapshot('org1', 'p1');
    const store = new MemoryStore();
    const clock = { t: 1_000 };
    const b = new SyncClient({
      orgId: 'org1', projectId: 'p1', actorId: 'r1', deviceId: 'dB', store, transport: server.transportFor(),
      now: () => clock.t
    });
    await b.load();
    await b.pull();
    const target = server.log.find((e) => e.type === 'v1.UnitAdded' && e.payload.unitId === 'u1')!;
    await a.client.append('v1.Redacted', { eventId: target.id });
    await a.client.sync();
    await b.pull();
    expect(b.getState().units['u1']).toBeDefined();
    clock.t += SyncClient.REDACTION_SNAPSHOT_WAIT_MS + 1;
    await b.pull();
    expect(b.getState().units['u1']).toBeUndefined();
    expect(Object.keys(b.getState().units).sort()).toEqual(['u0', 'u2']);
  });
});

describe('SyncClient with the org materializer (core org.ts)', () => {
  it('folds the org partition on two devices to the same roles and memberships', async () => {
    // Why: one sync path, two folds. The org partition must converge with
    // exactly the machinery the project partition uses.
    const m = { empty: emptyOrgState, apply: applyOrgEvent, fold: foldOrg, compact: (s: OrgState) => { s.appliedEventIds = {}; }, version: REDUCER_VERSION };
    const server = new FakeServer();
    const wall = { t: 0 };
    const mk = (deviceId: string, actorId: string) => {
      let n = 0;
      return new SyncClient<OrgState>({
        materializer: m, orgId: 'org1', projectId: '_org', actorId, deviceId, store: new MemoryStore(),
        transport: server.transportFor(), clock: new HlcClock(deviceId, () => (wall.t += 1)), newId: () => `${deviceId}-${++n}`
      });
    };
    const a = mk('dA', 'lead');
    const b = mk('dB', 'coord');
    await a.load();
    await b.load();
    await a.append('v1.OrgCreated', { name: 'Wycliffe' });
    await a.append('v1.RoleDefined', { roleId: 'org_admin', name: 'Organization Admin', privileges: ['manage_roles', 'invite_members'] });
    await a.append('v1.OrgMemberAdded', { profileId: 'lead', roleId: 'org_admin', scope: { level: 'org' } });
    await a.sync();
    await b.sync();
    server.offline = true;
    await b.append('v1.ProjectRegistered', { projectId: 'p9', name: 'Ruth' });
    await a.append('v1.RoleDefined', { roleId: 'org_admin', name: 'Organization Admin', privileges: ['manage_roles', 'invite_members', 'view_status'] });
    server.offline = false;
    await b.sync();
    await a.sync();
    await b.sync();
    const sa = a.getState();
    const sb = b.getState();
    expect(sa.org?.value.name).toBe('Wycliffe');
    expect(sa.roles['org_admin']?.privileges.value).toEqual(['invite_members', 'manage_roles', 'view_status']);
    expect(Object.keys(sb.projects)).toEqual(['p9']);
    expect({ ...sa, appliedEventIds: {} }).toEqual({ ...sb, appliedEventIds: {} });
  });
});

describe('SyncClient when the server refuses this actor', () => {
  it('reports a refusal as refused, not offline, and keeps the work queued', async () => {
    // Why: pointing a signed-in account at a project it has no membership row
    // for makes pull_events raise `not a member` (errcode 42501). Reporting
    // that as offline is what stranded users: the app hid a fixable
    // authorization problem behind a cloud-off icon and blocked the escapes
    // that are only meant to be blocked while a send is still possible.
    const server = new FakeServer();
    const { client } = device(server, 'dA', 'outsider', { t: 0 });
    await client.load();
    await client.append('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
    server.refuse = 'not a member';

    const r = await client.sync();

    expect(r.refused).toBe('not a member');
    expect(r.offline).toBe(false);
    expect(r.tooOld).toBe(false);
    expect({ pushed: r.pushed, pulled: r.pulled, rejected: r.rejected }).toEqual({ pushed: 0, pulled: 0, rejected: 0 });
    // Invariant 1: nothing is lost because the server said no.
    expect(await client.pendingCount()).toBe(1);
  });

  it('still reports an unreachable server as offline', async () => {
    // Why: the two must stay distinguishable in both directions. A transport
    // failure is not an authorization problem either.
    const server = new FakeServer();
    const { client } = device(server, 'dA', 'lead', { t: 0 });
    await client.load();
    await client.append('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
    server.offline = true;

    const r = await client.sync();

    expect(r.offline).toBe(true);
    expect(r.refused).toBe(null);
    expect(await client.pendingCount()).toBe(1);
  });

  it('syncs normally once the refusal is lifted', async () => {
    // Why: a refusal must leave the client able to recover without a
    // reinstall; the queued events go out on the next sync.
    const server = new FakeServer();
    const { client } = device(server, 'dA', 'lead', { t: 0 });
    await client.load();
    await client.append('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
    server.refuse = 'not a member';
    await client.sync();
    server.refuse = null;

    const r = await client.sync();

    expect(r.refused).toBe(null);
    expect(r.pushed).toBe(1);
    expect(await client.pendingCount()).toBe(0);
  });
});
