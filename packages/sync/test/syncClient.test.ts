import { HlcClock, ORG_STREAM, REDUCER_VERSION, derivePassage, type LanguageState, type OrgState } from '@langquest-next/core';
import { Diagnostics, MemoryDiagStore } from '../src/diagnostics';
import { MemoryStore } from '../src/memoryStore';
import { LANGUAGE_MATERIALIZER, SyncClient, type Materializer } from '../src/syncClient';
import { ORG_MATERIALIZER } from '../src/orgSession';
import { FakeServer } from '../src/testing/fakeServer';
import { rejectCodeOf, type Transport } from '../src/types';

/** The organization stream's fold, as the app wires it (apps/mobile useOrg). */
const unit = (i: number | string, label = `P${i}`) =>
  ({ unitId: `u${i}`, parentUnitId: null, kind: 'passage', label, order: `a${i}` });

function device(server: FakeServer, deviceId: string, actorId: string, wall: { t: number }) {
  const store = new MemoryStore();
  let n = 0;
  const client = new SyncClient({
    orgId: 'org1',
    streamId: 'p1',
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
    await client.append('v1.UnitAdded', unit(1, 'Luke 1'));
    expect(client.getState().units['u1']?.label).toBe('Luke 1');
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

    await a.client.append('v1.UnitAdded', unit(1));
    await a.client.append('v1.FlowSelected', { flowId: 'custom' });
    await a.client.sync();
    await b.client.sync();

    server.offline = true;
    await b.client.append('v1.TakeComposed', {
      takeId: 'tB',
      unitId: 'u1',
      cardHashes: ['c1'],
      parentTakeId: null
    });
    await a.client.append('v1.TakeComposed', {
      takeId: 'tA',
      unitId: 'u1',
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
    server.authorize = (e) => (e.type === 'v1.TemplateSelected' ? 'role translator may not emit' : null);
    const { client, store } = device(server, 'dB', 't1', { t: 0 });
    await client.load();
    await client.append('v1.UnitAdded', unit(1));
    const bad = await client.append('v1.TemplateSelected', { itemId: 'tpl', docHash: 'a'.repeat(64), unitPrefix: 'tpl' });
    expect(client.getState().template).not.toBeNull();

    const { rejected } = await client.sync();
    expect(rejected).toBe(1);
    expect(client.getState().template).toBeNull();
    expect(client.getState().units['u1']).toBeDefined();
    const kept = await store.rejected();
    expect(kept.map((k) => k.event.id)).toEqual([bad.id]);
    expect(kept[0]!.rejectReason).toMatch(/may not emit/);
    expect(await client.pendingCount()).toBe(0);
    // What the screens count to say some work was refused (My Work, Me).
    expect(await client.refusedCount()).toBe(1);
  });

  it('re-pushing after a lost ack is harmless (idempotent server, invariant 3)', async () => {
    const server = new FakeServer();
    const { client, store } = device(server, 'dA', 'lead', { t: 0 });
    await client.load();
    const e = await client.append('v1.UnitAdded', unit(1));
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
      await a.client.append('v1.UnitAdded', unit(i));
    }
    await a.client.push();

    const store = new MemoryStore();
    const b = new SyncClient({
      orgId: 'org1',
      streamId: 'p1',
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
    await a.client.append('v1.UnitAdded', unit(1));
    await a.client.append('v1.FlowSelected', { flowId: 'custom' });
    await a.client.append('v1.FlowStepSet', { stepId: 'custom/community', order: 's00', kindIds: ['community'], checkpoint: false });
    await a.client.append('v1.TakeComposed', {
      takeId: 't1',
      unitId: 'u1',
      cardHashes: ['c1'],
      parentTakeId: null
    });
    await a.client.append('v1.TakeSubmitted', { takeId: 't1' });
    await a.client.sync();
    await r.client.sync();
    expect(derivePassage(r.client.getState(), 'u1').done).toBe(false);
    await r.client.append('v1.ReviewRecorded', { reviewId: 'rv1', takeId: 't1', kindId: 'community', outcome: 'looks_good', via: 'app' });
    await r.client.sync();
    await a.client.sync();
    const pa = derivePassage(a.client.getState(), 'u1');
    expect(pa.reviews.map((x) => x.outcome)).toEqual(['looks_good']);
    expect(pa.done).toBe(true);
    expect(derivePassage(r.client.getState(), 'u1')).toEqual(pa);
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
        streamId: 'p1',
        actorId,
        deviceId: 'shared',
        store,
        transport: server.transportFor(),
        clock: new HlcClock('shared', () => (wall.t += 1)),
        newId: () => `${actorId}-${wall.t}`
      });
    const a = mk('a');
    await a.load();
    await a.append('v1.UnitAdded', unit(1));
    const b = mk('b');
    await b.load();
    expect((await b.push()).accepted).toBe(0);
    expect(server.log.length).toBe(0);
    // A's queued event is not B's to send, so B has nothing waiting: B's
    // sign-out must not be held up by it, and A still sees it as unsent.
    expect(await b.pendingCount()).toBe(0);
    expect(await a.pendingCount()).toBe(1);
    expect((await a.push()).accepted).toBe(1);
    expect(await a.pendingCount()).toBe(0);
  });
});

describe('SyncClient push batching (PLAN.md section 2: small deltas succeed)', () => {
  async function backlog(server: FakeServer, n: number, pushBatchSize: number, extra: { pushBatchesPerRun?: number; pullBudgetMs?: number; now?: () => number } = {}) {
    const store = new MemoryStore();
    const wall = { t: 0 };
    let k = 0;
    const client = new SyncClient({
      orgId: 'org1',
      streamId: 'p1',
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
      await client.append('v1.UnitAdded', unit(i));
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
      orgId: 'org1', streamId: 'p1', actorId: 't1', deviceId: 'dB', store,
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
      recordingId: 'r1', unitId: 'u1', kind: 'target', cards: [{ hash: 'c1', durationMs: 1 }]
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
      await a.client.append('v1.UnitAdded', unit(i));
    }
    await a.client.sync();
    return a;
  }

  it('a new device cold-starts from the server snapshot and pulls only the tail', async () => {
    // Why: a phone opening a language with years of history must not replay
    // every event. Snapshot plus tail, one page, done.
    const server = new FakeServer();
    const a = await seeded(server, 7);
    server.makeSnapshot('org1', 'p1');
    await a.client.append('v1.UnitHidden', { unitId: 'u0', hidden: true });
    await a.client.sync();

    const b = device(server, 'dB', 'r1', { t: 0 });
    await b.client.load();
    const pulled = await b.client.pull();
    expect(pulled).toBe(1); // only the UnitHidden after the snapshot
    expect(Object.keys(b.client.getState().units).length).toBe(7);
    expect(b.client.getState().hiddenUnits['u0']?.value).toBe(true);
    expect(await b.store.cursor('org1', 'p1')).toBe(8);
    expect((await b.store.all('org1', 'p1')).length).toBe(1);

    // Relaunch on the same device: the local checkpoint carries the state.
    const b2 = new SyncClient({
      orgId: 'org1', streamId: 'p1', actorId: 'r1', deviceId: 'dB', store: b.store, transport: server.transportFor()
    });
    const pullsBefore = server.pullCalls;
    await b2.load();
    expect(Object.keys(b2.getState().units).length).toBe(7);
    expect(server.pullCalls).toBe(pullsBefore);
  });

  it('a language not listed yet stops the push at its first refused batch, so sync does not run again at once', async () => {
    // Why: with more than five batches queued, every refused round reported
    // more work and the scheduler ran again at once: five refused appends
    // and a full refold each time, 73,555 refolds in ten hours for one
    // phone in the fleet (performance-audit.md item 7). The server refuses
    // the whole stream until it is listed, so one batch is enough to ask.
    const server = new FakeServer();
    let listed = false;
    server.authorize = () => (listed ? null : 'language not listed yet');
    const { client } = device(server, 'dA', 'lead', { t: 0 });
    await client.load();
    await client.appendMany(Array.from({ length: 1200 }, (_, i) => ({ type: 'v1.UnitAdded' as const, payload: unit(i) })));
    const refused = await client.sync();
    expect(server.appendCalls).toBe(1);
    expect(refused.more).toBe(false);
    expect(refused.rejected).toBe(200);
    // Still re-queued on every push (decision 24): the next sync asks again.
    await client.sync();
    expect(server.appendCalls).toBe(2);
    listed = true;
    for (let i = 0; i < 5 && (await client.pendingCount()) > 0; i++) await client.sync();
    expect(await client.pendingCount()).toBe(0);
    expect(server.log).toHaveLength(1200);
    expect(Object.keys(client.getState().units)).toHaveLength(1200);
  });

  it('a device checkpoints locally after enough confirmed events and prunes its log', async () => {
    // Why: replay on launch must be bounded by history since the last
    // checkpoint, not by the age of the stream.
    const server = new FakeServer();
    const store = new MemoryStore();
    const wall = { t: 0 };
    let k = 0;
    const mk = () =>
      new SyncClient({
        orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dA', store,
        transport: server.transportFor(), clock: new HlcClock('dA', () => (wall.t += 1)),
        newId: () => `e${++k}`, checkpointEvery: 5
      });
    const c = mk();
    await c.load();
    for (let i = 0; i < 12; i++) {
      await c.append('v1.UnitAdded', unit(i));
    }
    await c.sync();
    expect((await store.all('org1', 'p1')).length).toBeLessThan(12);
    const again = mk();
    await again.load();
    expect(Object.keys(again.getState().units).length).toBe(12);
    expect(await again.pendingCount()).toBe(0);
  });

  describe('after an update to the reducer, on a phone whose log is pruned behind its checkpoint', () => {
    // Why: the old checkpoint cannot be read by the new reducer, and the
    // events it covers are no longer in the log. Folding what is left showed
    // a language with most of its work gone, and the next checkpoint saved
    // that under the new version, so it stayed gone (2026-10-15). Only the
    // server still has the whole language.
    const V = REDUCER_VERSION;
    const bumped: Materializer<LanguageState> = { ...LANGUAGE_MATERIALIZER, version: V + 1 };

    function phone(server: FakeServer) {
      const store = new MemoryStore();
      const diag = new MemoryDiagStore();
      const wall = { t: 0 };
      let k = 0;
      const mk = (materializer = LANGUAGE_MATERIALIZER) => new SyncClient({
        orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dA', store, materializer,
        transport: server.transportFor(), clock: new HlcClock('dA', () => (wall.t += 1)),
        newId: () => `e${++k}`, checkpointEvery: 5,
        diag: new Diagnostics({ store: diag, newId: () => `d${++k}`, maxRecords: Infinity })
      });
      return { store, diag, mk };
    }

    /** 12 units under a checkpoint at 12 (log pruned), 2 confirmed after it, 1 still pending. */
    async function beforeTheUpdate(server: FakeServer, p: ReturnType<typeof phone>) {
      const c = p.mk();
      await c.load();
      for (let i = 0; i < 12; i++) await c.append('v1.UnitAdded', unit(i));
      await c.sync();
      for (let i = 12; i < 14; i++) await c.append('v1.UnitAdded', unit(i));
      await c.sync();
      server.offline = true;
      await c.append('v1.UnitAdded', unit(14));
      expect(await c.inspect()).toMatchObject({ checkpointSeq: 12, total: 3 });
    }

    it('takes the server snapshot for the new reducer, keeps its own unsent work, and never saves the partial tail', async () => {
      const server = new FakeServer();
      const p = phone(server);
      await beforeTheUpdate(server, p);
      server.reducerVersion = V + 1; // the server's snapshot worker is on the new reducer too
      server.makeSnapshot('org1', 'p1');

      const recordsBefore = p.diag.records.length;
      const updated = p.mk(bumped);
      await updated.load();
      expect(updated.getState().units['u14']).toBeDefined(); // what the person did offline is still on screen
      server.offline = false;
      await updated.sync();
      expect(Object.keys(updated.getState().units)).toHaveLength(15);
      expect(p.diag.records.slice(recordsBefore).filter((r) => r.kind === 'snapshot').map((r) => r.t.outcome)).toEqual(['ok']);

      const relaunched = p.mk(bumped);
      await relaunched.load();
      expect(Object.keys(relaunched.getState().units)).toHaveLength(15);
      expect(await relaunched.inspect()).toMatchObject({ pending: [], checkpointSeq: 14 });
    });

    it('with no server snapshot for the new reducer, pulls the stream again from the start, however often it is opened offline first', async () => {
      // The organization stream never has a server snapshot (decisions.md
      // 44), and a language has none until the snapshot worker runs on the
      // new reducer.
      const server = new FakeServer();
      const p = phone(server);
      await beforeTheUpdate(server, p);
      server.snapshots.clear();

      const offline = p.mk(bumped);
      await offline.load();
      await offline.sync();
      const again = p.mk(bumped);
      await again.load();
      server.offline = false;
      for (let i = 0; i < 3 && (await again.sync()).more; i++);
      expect(Object.keys(again.getState().units)).toHaveLength(15);

      const relaunched = p.mk(bumped);
      await relaunched.load();
      expect(Object.keys(relaunched.getState().units)).toHaveLength(15);
      expect(await p.store.cursor('org1', 'p1')).toBe(15);
    });

    it('says so in the load record: the old checkpoint was dropped, and the seq it covered', async () => {
      // Why: "the language went empty after the update" must be answerable
      // from diagnostics (docs/diagnostics.md) without asking the person.
      const server = new FakeServer();
      const p = phone(server);
      await beforeTheUpdate(server, p);
      const loadsBefore = p.diag.records.filter((r) => r.kind === 'load').length;
      await p.mk(bumped).load();
      await p.mk(bumped).load();
      const loads = p.diag.records.filter((r) => r.kind === 'load').slice(loadsBefore);
      expect(loads.map((r) => r.n.staleCheckpointSeq)).toEqual([12, undefined]);
    });
  });

  it('a sync reads the checkpoint seq beside the checkpoint, never the checkpoint itself', async () => {
    // Why: the checkpoint is the whole language. Parsing it on every sync
    // just to learn its seq was 81% of a 45-phone fleet run
    // (docs/fleet-simulation.md, performance-audit.md item 3).
    const server = new FakeServer();
    const store = new MemoryStore();
    const reads = { checkpoint: 0 };
    const meta = store.meta.bind(store);
    store.meta = async (key) => {
      if (key === 'snapshot:org1/p1') reads.checkpoint += 1;
      return meta(key);
    };
    const wall = { t: 0 };
    let k = 0;
    const c = new SyncClient({
      orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dA', store,
      transport: server.transportFor(), clock: new HlcClock('dA', () => (wall.t += 1)),
      newId: () => `e${++k}`, checkpointEvery: 5
    });
    await c.load();
    for (let i = 0; i < 12; i++) await c.append('v1.UnitAdded', unit(i));
    await c.sync();
    const checkpointSeq = (await c.inspect()).checkpointSeq;
    expect(checkpointSeq).toBe(12);
    reads.checkpoint = 0;
    for (let i = 12; i < 15; i++) {
      await c.append('v1.UnitAdded', unit(i));
      await c.sync();
    }
    expect(reads.checkpoint).toBe(0);
    expect((await c.inspect()).checkpointSeq).toBe(12);
  });

  it('a checkpoint saved before its seq was kept beside it is read once, and the seq is kept from then on', async () => {
    // Why: a phone updated from an older app has a checkpoint and no seq.
    const server = new FakeServer();
    const store = new MemoryStore();
    const wall = { t: 0 };
    let k = 0;
    const mk = () => new SyncClient({
      orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dA', store,
      transport: server.transportFor(), clock: new HlcClock('dA', () => (wall.t += 1)),
      newId: () => `e${++k}`, checkpointEvery: 5
    });
    const first = mk();
    await first.load();
    for (let i = 0; i < 12; i++) await first.append('v1.UnitAdded', unit(i));
    await first.sync();
    // As the older app left it: the checkpoint, and no seq beside it.
    const meta = store.meta.bind(store);
    let upgraded = false;
    let reads = 0;
    const commit = store.commit.bind(store);
    store.commit = async (batch) => {
      if (batch.meta && 'snapshotSeq:org1/p1' in batch.meta) upgraded = true;
      return commit(batch);
    };
    store.meta = async (key) => {
      if (key === 'snapshotSeq:org1/p1' && !upgraded) return undefined;
      if (key === 'snapshot:org1/p1') reads += 1;
      return meta(key);
    };
    const later = mk();
    await later.load();
    reads = 0;
    await later.sync();
    await later.sync();
    expect(upgraded).toBe(true);
    expect(reads).toBe(1);
    expect((await later.inspect()).checkpointSeq).toBe(12);
    expect(Object.keys(later.getState().units)).toHaveLength(12);
  });

  it('a device catching up on a big language checkpoints once, when caught up, and the checkpoint equals the full fold', async () => {
    // Why: every checkpoint serializes the whole state. Taking one per 2000
    // events while a new device pulls a 268k-event stream ran it out of
    // memory at 512 MB and made the pull quadratic. Checkpoints are only a
    // cache, so the catch-up can skip them; the one it writes must still be
    // exactly what folding the raw log gives.
    const server = new FakeServer();
    const writer = new SyncClient({
      orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dW', store: new MemoryStore(),
      transport: server.transportFor(), newId: (() => { let k = 0; return () => `w${++k}`; })()
    });
    await writer.load();
    for (let i = 0; i < 30; i++) {
      await writer.append('v1.UnitAdded', unit(i));
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
      orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dR', store,
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
      orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dR', store,
      transport: server.transportFor()
    });
    await again.load();
    // The checkpoint pruned the local log here, so compare with the device that wrote it all.
    expect(again.getState().units).toEqual(writer.getState().units);
    expect(Object.keys(again.getState().units).length).toBe(30);
    // The live state keeps its duplicate guard; only the saved copy is compacted.
    expect(Object.keys((reader.getState() as LanguageState).appliedEventIds).length).toBe(30);
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
    await client.append('v1.UnitAdded', unit(1));
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
  async function bigLanguage(server: FakeServer) {
    const wall = { t: 0 };
    const a = device(server, 'dA', 'lead', wall);
    await a.client.load();
    for (let i = 0; i < 300; i++) {
      await a.client.append('v1.UnitAdded', unit(i, `Passage number ${i}`));
    }
    await a.client.sync();
    server.makeSnapshot('org1', 'p1');
    return a;
  }

  it('fetches a large snapshot in bounded pieces rather than one body', async () => {
    // Why: a 12 MB snapshot as one response fails on the links our users
    // have. Pieces of a few hundred KB each succeed or fail alone.
    const server = new FakeServer();
    await bigLanguage(server);
    server.chunkChars = 4000;
    const b = device(server, 'dB', 'r1', { t: 0 });
    await b.client.load();
    await b.client.pull();
    expect(server.chunkCalls).toBeGreaterThan(3);
    expect(Object.keys(b.client.getState().units).length).toBe(300);
  });

  it('a link that drops mid-snapshot resumes from the pieces already saved', async () => {
    const server = new FakeServer();
    await bigLanguage(server);
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

  it('an app update part-way through a download does not join the old reducer\'s pieces to the new one\'s', async () => {
    // Why: a quiet language has the same seq under both reducers. Pieces kept
    // by seq alone were reused, and the snapshot came out half one reducer's
    // state and half the other's: a parse error, or worse, a wrong state.
    const server = new FakeServer();
    await bigLanguage(server);
    const old = server.snapshots.get('org1/p1')!;
    // The old reducer's state had another shape, so its text lines up differently.
    server.snapshots.set('org1/p1', { ...old, state: { formerShape: 'x'.repeat(1500), ...old.state } as typeof old.state });
    server.chunkChars = 4000;
    server.failChunkAfter = 2;
    const store = new MemoryStore();
    const client = (version: number) => new SyncClient({
      orgId: 'org1', streamId: 'p1', actorId: 'r1', deviceId: 'dB', store, transport: server.transportFor(),
      clock: new HlcClock('dB', () => 1), materializer: { ...LANGUAGE_MATERIALIZER, version }
    });
    const before = client(REDUCER_VERSION);
    await before.load();
    expect((await before.sync()).pulled).toBe(0);
    server.failChunkAfter = Infinity;
    server.reducerVersion = REDUCER_VERSION + 1;
    const snap = server.makeSnapshot('org1', 'p1');
    expect(snap.serverSeq).toBe(old.serverSeq);
    const after = client(REDUCER_VERSION + 1);
    await after.load();
    await after.pull();
    expect(after.getState().units).toEqual(snap.state.units);
    expect(Object.keys(after.getState().units).length).toBe(300);
  });

  it('pieces saved by a build that kept no reducer version are refetched, not trusted', async () => {
    // Why: that build's index says only the seq, so its pieces may be another reducer's.
    const server = new FakeServer();
    await bigLanguage(server);
    server.chunkChars = 4000;
    const snap = server.snapshots.get('org1/p1')!;
    const store = new MemoryStore();
    await store.commit({ meta: {
      'snapchunks:org1/p1': JSON.stringify({ seq: snap.serverSeq, chunks: 2 }),
      [`snapchunks:org1/p1:${snap.serverSeq}:0`]: `{"formerShape":"${'x'.repeat(3986)}`,
      [`snapchunks:org1/p1:${snap.serverSeq}:1`]: 'x'.repeat(4000)
    } });
    const b = new SyncClient({ orgId: 'org1', streamId: 'p1', actorId: 'r1', deviceId: 'dB', store, transport: server.transportFor(), clock: new HlcClock('dB', () => 1) });
    await b.load();
    await b.pull();
    expect(b.getState().units).toEqual(snap.state.units);
  });

  it('saving the pieces does not redraw the screen once per piece', async () => {
    // Why: every piece saved through the writer told screens twice that a
    // save started and ended. On a 2 GB phone those redraws were three
    // quarters of a 46-second first open of a 40 MB language (152 pieces).
    const server = new FakeServer();
    await bigLanguage(server);
    server.chunkChars = 1000;
    const b = device(server, 'dB', 'r1', { t: 0 });
    await b.client.load();
    let publishes = 0;
    b.client.subscribe(() => { publishes += 1; });
    await b.client.pull();
    expect(server.chunkCalls).toBeGreaterThan(20);
    expect(Object.keys(b.client.getState().units).length).toBe(300);
    expect(publishes).toBeLessThan(10);
  });

  it('asks for a few pieces at a time, so a far server is not waited on once per piece', async () => {
    const server = new FakeServer();
    await bigLanguage(server);
    server.chunkChars = 4000;
    const inner = server.transportFor();
    let inFlight = 0;
    let most = 0;
    const transport: typeof inner = {
      ...inner,
      snapshotChunk: async (...args) => {
        inFlight += 1;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        try { return await inner.snapshotChunk(...args); } finally { inFlight -= 1; }
      }
    };
    const b = new SyncClient({ orgId: 'org1', streamId: 'p1', actorId: 'r1', deviceId: 'dB', store: new MemoryStore(), transport, clock: new HlcClock('dB', () => 1) });
    await b.load();
    await b.pull();
    expect(Object.keys(b.getState().units).length).toBe(300);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(3);
  });
});

describe('SyncClient after a long offline stretch (audit L1, L2, L3)', () => {
  async function seeded(server: FakeServer, n: number) {
    const a = device(server, 'dA', 'lead', { t: 0 });
    await a.client.load();
    for (let i = 0; i < n; i++) {
      await a.client.append('v1.UnitAdded', unit(i));
    }
    await a.client.sync();
    return a;
  }

  it('work refused for membership reasons is re-queued when the organization re-admits the actor', async () => {
    // Why: a translator removed while offline for a month pushes a month of
    // work and gets it all refused. The log keeps it (invariant 1); when a
    // coordinator adds them back, the next sync must carry it, not a support
    // call. Memberships live in the organization stream, so the org client
    // notices and the app re-queues its language clients' refused work.
    const server = new FakeServer();
    const members = new Set(['lead', 't1']);
    server.authorize = (e) => (e.streamId === ORG_STREAM || members.has(e.actorId) ? null : 'not a member');
    const wall = { t: 0 };
    const orgClient = (deviceId: string, actorId: string, store: MemoryStore, onMembershipChanged?: () => void) => {
      let n = 0;
      return new SyncClient<OrgState>({
        materializer: ORG_MATERIALIZER, orgId: 'org1', streamId: ORG_STREAM, actorId, deviceId, store,
        transport: server.transportFor(), clock: new HlcClock(deviceId, () => (wall.t += 1)),
        newId: () => `${deviceId}-org-${++n}`, ...(onMembershipChanged ? { onMembershipChanged } : {})
      });
    };
    const lead = orgClient('dA', 'lead', new MemoryStore());
    const b = device(server, 'dB', 't1', wall);
    const requeues: Promise<number>[] = [];
    const orgB = orgClient('dB', 't1', b.store, () => requeues.push(b.client.retryRejected(['NOT_MEMBER', 'NOT_ALLOWED'])));
    await lead.load();
    await orgB.load();
    await b.client.load();
    const inLanguage = { level: 'language', languageId: 'p1' } as const;
    await lead.append('v1.OrgCreated', { name: 'Org' });
    await lead.append('v1.LanguageAdded', { languageId: 'p1', name: 'Dinka', code: 'din', sourceCode: 'eng' });
    await lead.append('v1.MemberAdded', { profileId: 't1', roleId: 'translator', scope: inLanguage });
    await lead.sync();
    await orgB.sync();
    expect(requeues).toHaveLength(1); // added: nothing refused yet, nothing to re-queue
    expect(await requeues[0]).toBe(0);

    // Someone else's membership is not news for this actor.
    await lead.append('v1.MemberAdded', { profileId: 'r1', roleId: 'reviewer', scope: inLanguage });
    await lead.sync();
    await orgB.sync();
    expect(requeues).toHaveLength(1);

    members.delete('t1');
    await lead.append('v1.MemberRemoved', { profileId: 't1', scope: inLanguage });
    await lead.sync();
    await orgB.sync();
    expect(requeues).toHaveLength(2);
    await b.client.append('v1.TakeComposed', { takeId: 'tB', unitId: 'u1', cardHashes: ['c'], parentTakeId: null });
    const first = await b.client.sync();
    expect(first.rejected).toBe(1);
    expect((await b.store.rejected('org1', 'p1')).map((l) => rejectCodeOf(l.rejectReason))).toEqual(['NOT_MEMBER']);
    expect(b.client.getState().takes['tB']).toBeUndefined();

    members.add('t1');
    await lead.append('v1.MemberAdded', { profileId: 't1', roleId: 'translator', scope: inLanguage });
    await lead.sync();
    await orgB.sync(); // pulls the re-admission; the app re-queues the language's refused work
    expect(requeues).toHaveLength(3);
    expect(await requeues[2]).toBe(1);
    expect(await b.client.pendingCount()).toBe(1);
    expect(b.client.getState().takes['tB']).toBeDefined();
    const second = await b.client.sync();
    expect(second.pushed).toBe(1);
    expect(second.rejected).toBe(0);
    expect(server.log.some((e) => e.id === 'dB-1')).toBe(true);
  });

  it('the organization stream re-queues its own refused events when the actor is re-admitted', async () => {
    // Why: org-stream work (a language added by a language admin) is refused
    // for membership the same way, and the same pull that shows the
    // re-admission must re-queue it without the app's help.
    const server = new FakeServer();
    const admins = new Set(['lead']);
    server.authorize = (e) => (admins.has(e.actorId) || e.type === 'v1.MemberAdded' ? null : 'not a member');
    const wall = { t: 0 };
    const mk = (deviceId: string, actorId: string) => {
      let n = 0;
      return new SyncClient<OrgState>({
        materializer: ORG_MATERIALIZER, orgId: 'org1', streamId: ORG_STREAM, actorId, deviceId, store: new MemoryStore(),
        transport: server.transportFor(), clock: new HlcClock(deviceId, () => (wall.t += 1)), newId: () => `${deviceId}-${++n}`
      });
    };
    const lead = mk('dA', 'lead');
    const coord = mk('dB', 'coord');
    await lead.load();
    await coord.load();
    await coord.append('v1.LanguageAdded', { languageId: 'p9', name: 'Ruth', code: 'rut', sourceCode: 'eng' });
    expect((await coord.sync()).rejected).toBe(1);
    admins.add('coord');
    await lead.append('v1.MemberAdded', { profileId: 'coord', roleId: 'coordinator', scope: { level: 'org' } });
    await lead.sync();
    await coord.sync(); // pulls the membership and re-queues
    expect(await coord.pendingCount()).toBe(1);
    expect((await coord.sync()).pushed).toBe(1);
    expect(Object.keys(coord.getState().languages)).toEqual(['p9']);
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
      orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dA', store, transport: server.transportFor(),
      now: () => SERVER_NOW + 5 * YEAR, newId: () => `dA-${++n}`
    });
    await client.load();
    const e1 = await client.append('v1.UnitAdded', unit(1));
    const e2 = await client.append('v1.UnitAdded', unit(2));
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
      orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dA', store, transport: server.transportFor(),
      now: () => SERVER_NOW + 5 * YEAR, newId: () => `dA-${++n}`
    });
    await again.load();
    const e3 = await again.append('v1.UnitAdded', unit(3));
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
      orgId: 'org1', streamId: 'p1', actorId: 'r1', deviceId: 'dB', store, transport: server.transportFor(),
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

  it('while it waits for a snapshot past a redaction, it does not download one that is too old', async () => {
    // Why: every sync in the 30-minute wait downloaded and parsed the whole
    // server snapshot only to find it older than the redaction: 830 MB in
    // the fleet's refoldTriggers run (performance-audit.md item 7). The
    // snapshot's seq is in its meta; check it first.
    const server = new FakeServer();
    const a = await seeded(server, 3);
    server.makeSnapshot('org1', 'p1');
    const clock = { t: 1_000 };
    const b = new SyncClient({
      orgId: 'org1', streamId: 'p1', actorId: 'r1', deviceId: 'dB', store: new MemoryStore(), transport: server.transportFor(),
      now: () => clock.t
    });
    await b.load();
    await b.pull();
    const target = server.log.find((e) => e.type === 'v1.UnitAdded' && e.payload.unitId === 'u1')!;
    await a.client.append('v1.Redacted', { eventId: target.id });
    await a.client.sync();
    const chunksBefore = server.chunkCalls;
    for (let i = 0; i < 3; i++) {
      clock.t += 60_000;
      await b.pull();
    }
    expect(server.chunkCalls - chunksBefore).toBe(0);
    server.makeSnapshot('org1', 'p1');
    await b.pull();
    expect(server.chunkCalls - chunksBefore).toBeGreaterThan(0);
    expect(b.getState().units['u1']).toBeUndefined();
  });

  it('a snapshot past the redaction will do, even if the pull went further than the snapshot', async () => {
    // Why: the phone asked for a snapshot past the end of what it had
    // pulled, not past the redaction; one taken right after the redaction
    // was refused as stale, and with snapshots an hour apart (decision 88)
    // the phone fell back to the whole log after 30 minutes.
    const server = new FakeServer();
    const a = await seeded(server, 3);
    server.makeSnapshot('org1', 'p1');
    const clock = { t: 1_000 };
    const b = new SyncClient({
      orgId: 'org1', streamId: 'p1', actorId: 'r1', deviceId: 'dB', store: new MemoryStore(), transport: server.transportFor(),
      now: () => clock.t
    });
    await b.load();
    await b.pull();
    const target = server.log.find((e) => e.type === 'v1.UnitAdded' && e.payload.unitId === 'u1')!;
    await a.client.append('v1.Redacted', { eventId: target.id });
    await a.client.sync();
    server.makeSnapshot('org1', 'p1'); // the worker writes one at once after a redaction
    await a.client.append('v1.UnitAdded', unit(9));
    await a.client.sync();
    await b.pull(); // the redaction and the unit after the snapshot, in one slice
    expect(b.getState().units['u1']).toBeUndefined();
    expect(b.getState().units['u9']).toBeDefined();
    expect(await b.inspect()).toMatchObject({ checkpointSeq: server.snapshots.get('org1/p1')!.serverSeq });
  });

  it('after the wait window with no snapshot, the device falls back to the full log', async () => {
    const server = new FakeServer();
    const a = await seeded(server, 3);
    server.makeSnapshot('org1', 'p1');
    const store = new MemoryStore();
    const clock = { t: 1_000 };
    const b = new SyncClient({
      orgId: 'org1', streamId: 'p1', actorId: 'r1', deviceId: 'dB', store, transport: server.transportFor(),
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
  it('folds the organization stream on two devices to the same roles, memberships and languages', async () => {
    // Why: one sync path, two folds. The organization stream must converge
    // with exactly the machinery a language stream uses.
    const server = new FakeServer();
    const wall = { t: 0 };
    const mk = (deviceId: string, actorId: string) => {
      let n = 0;
      return new SyncClient<OrgState>({
        materializer: ORG_MATERIALIZER, orgId: 'org1', streamId: ORG_STREAM, actorId, deviceId, store: new MemoryStore(),
        transport: server.transportFor(), clock: new HlcClock(deviceId, () => (wall.t += 1)), newId: () => `${deviceId}-${++n}`
      });
    };
    const a = mk('dA', 'lead');
    const b = mk('dB', 'coord');
    await a.load();
    await b.load();
    await a.append('v1.OrgCreated', { name: 'Wycliffe' });
    await a.append('v1.RoleDefined', { roleId: 'org_admin', name: 'Organization Admin', privileges: ['manage_roles', 'invite_members'] });
    await a.append('v1.MemberAdded', { profileId: 'lead', roleId: 'org_admin', scope: { level: 'org' } });
    await a.sync();
    await b.sync();
    server.offline = true;
    await b.append('v1.LanguageAdded', { languageId: 'p9', name: 'Ruth', code: 'rut', sourceCode: 'eng' });
    await a.append('v1.RoleDefined', { roleId: 'org_admin', name: 'Organization Admin', privileges: ['manage_roles', 'invite_members', 'view_status'] });
    server.offline = false;
    await b.sync();
    await a.sync();
    await b.sync();
    const sa = a.getState();
    const sb = b.getState();
    expect(sa.org?.value.name).toBe('Wycliffe');
    expect(sa.roles['org_admin']?.privileges.value).toEqual(['invite_members', 'manage_roles', 'view_status']);
    expect(Object.keys(sb.languages)).toEqual(['p9']);
    expect(sb.languages['p9']?.added?.name).toBe('Ruth');
    expect({ ...sa, appliedEventIds: {} }).toEqual({ ...sb, appliedEventIds: {} });
  });

  it('after an update to the reducer, a pruned organization stream is pulled again from the start', async () => {
    // Why: the organization stream has no server snapshot (decisions.md 44),
    // so a phone whose checkpoint the new reducer cannot read has only the
    // log to rebuild from. Folding the pruned tail lost the phone its
    // languages and its own membership.
    const server = new FakeServer();
    const store = new MemoryStore();
    const wall = { t: 0 };
    let n = 0;
    const mk = (materializer: Materializer<OrgState>) => new SyncClient<OrgState>({
      materializer, orgId: 'org1', streamId: ORG_STREAM, actorId: 'lead', deviceId: 'dA', store, checkpointEvery: 5,
      transport: server.transportFor(), clock: new HlcClock('dA', () => (wall.t += 1)), newId: () => `dA-${++n}`
    });
    const before = mk(ORG_MATERIALIZER);
    await before.load();
    await before.append('v1.OrgCreated', { name: 'Wycliffe' });
    await before.append('v1.RoleDefined', { roleId: 'org_admin', name: 'Organization Admin', privileges: ['manage_roles'] });
    await before.append('v1.MemberAdded', { profileId: 'lead', roleId: 'org_admin', scope: { level: 'org' } });
    for (let i = 0; i < 4; i++) await before.append('v1.LanguageAdded', { languageId: `p${i}`, name: `L${i}`, code: 'rut', sourceCode: 'eng' });
    await before.sync();
    expect(await store.all('org1', ORG_STREAM)).toHaveLength(0);

    const after = mk({ ...ORG_MATERIALIZER, version: ORG_MATERIALIZER.version + 1 });
    await after.load();
    await after.sync();
    expect(after.getState()).toEqual({ ...before.getState(), appliedEventIds: after.getState().appliedEventIds });
    expect(Object.keys(after.getState().languages)).toHaveLength(4);
  });
});

describe('SyncClient when the server refuses this actor', () => {
  it('reports a refusal as refused, not offline, and keeps the work queued', async () => {
    // Why: pointing a signed-in account at a stream it has no membership row
    // for makes pull_events raise `not a member` (errcode 42501). Reporting
    // that as offline is what stranded users: the app hid a fixable
    // authorization problem behind a cloud-off icon and blocked the escapes
    // that are only meant to be blocked while a send is still possible.
    const server = new FakeServer();
    const { client } = device(server, 'dA', 'outsider', { t: 0 });
    await client.load();
    await client.append('v1.UnitAdded', unit(1));
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
    await client.append('v1.UnitAdded', unit(1));
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
    await client.append('v1.UnitAdded', unit(1));
    server.refuse = 'not a member';
    await client.sync();
    server.refuse = null;

    const r = await client.sync();

    expect(r.refused).toBe(null);
    expect(r.pushed).toBe(1);
    expect(await client.pendingCount()).toBe(0);
  });
});

describe('SyncClient single writer', () => {
  it('publishes a revision before the disk write and reports saving until the commit lands', async () => {
    // Why: the screen must move on the tap (next frame) and must be able to
    // say "saved locally" only when that is true.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const store = new MemoryStore();
    const slow = Object.assign(store, { commit: async (b: Parameters<MemoryStore['commit']>[0]) => { await gate; await MemoryStore.prototype.commit.call(store, b); } });
    const client = new SyncClient({ orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dA', store: slow, transport: new FakeServer().transportFor() });
    const seen: { revision: number; saving: number; label: string | undefined }[] = [];
    client.subscribe((s) => seen.push({ revision: s.revision, saving: s.saving, label: s.state.units['u1']?.label }));
    const loadDone = client.load();
    release();
    await loadDone;
    seen.length = 0;
    const written = client.append('v1.UnitAdded', unit(1, 'Luke 1'));
    expect(client.getState().units['u1']?.label).toBe('Luke 1');
    expect(client.saving).toBe(1);
    expect(seen[0]).toMatchObject({ label: 'Luke 1', saving: 1 });
    await written;
    expect(client.saving).toBe(0);
    expect(seen.at(-1)).toMatchObject({ label: 'Luke 1', saving: 0 });
    expect((await store.pending('org1', 'p1')).length).toBe(1);
  });

  it('local writes are serialized: two overlapping appends commit in order', async () => {
    const order: string[] = [];
    const store = new MemoryStore();
    const base = MemoryStore.prototype.commit;
    store.commit = async (b) => {
      order.push(`start:${b.events?.[0]?.event.id ?? 'meta'}`);
      await new Promise((r) => setTimeout(r, b.events?.[0]?.event.id === 'dA-1' ? 5 : 0));
      await base.call(store, b);
      order.push(`end:${b.events?.[0]?.event.id ?? 'meta'}`);
    };
    let n = 0;
    const client = new SyncClient({ orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dA', store, transport: new FakeServer().transportFor(), newId: () => `dA-${++n}` });
    await client.load();
    order.length = 0;
    await Promise.all([
      client.append('v1.UnitAdded', unit(1)),
      client.append('v1.UnitAdded', unit(2))
    ]);
    expect(order).toEqual(['start:dA-1', 'end:dA-1', 'start:dA-2', 'end:dA-2']);
  });

  it('two syncs asked for at once send a published take once, and it stays in the fold (REC-016)', async () => {
    // Why: the scheduler's sync and a "sync now" overlapped. Both pushed the
    // same pending take. append_events took the first copy; the second had
    // passed the id check before the first committed, then found the take id
    // already used under the stream lock and was refused. The client marked
    // the take refused and folded it out, though the server had it: Version 2
    // vanished from Versions seconds after "Version 2 published".
    const server = new FakeServer();
    const real = server.transportFor();
    const inFlight = new Map<string, Promise<unknown>>();
    const transport: Transport = {
      ...real,
      append: async (events) => {
        const racing = events.find((e) => inFlight.has(e.id));
        if (racing) {
          await inFlight.get(racing.id);
          await new Promise((r) => setTimeout(r, 1));
          return events.map((e) => ({ id: e.id, accepted: false, serverSeq: null, reason: `invalid payload: take id ${e.id} is already used` }));
        }
        const sent = new Promise((r) => setTimeout(r, 5)).then(() => real.append(events));
        for (const e of events) inFlight.set(e.id, sent);
        try { return await sent; } finally { for (const e of events) inFlight.delete(e.id); }
      }
    };
    let n = 0;
    const store = new MemoryStore();
    const client = new SyncClient({ orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dA', store, transport, newId: () => `dA-${++n}` });
    await client.load();
    await client.append('v1.UnitAdded', unit(1));
    await client.sync();
    await client.append('v1.TakeComposed', { takeId: 'v2', unitId: 'u1', cardHashes: ['c1'], parentTakeId: null });

    await Promise.all([client.sync(), client.sync()]);

    expect(server.log.filter((e) => e.type === 'v1.TakeComposed')).toHaveLength(1);
    expect(await client.refusedCount()).toBe(0);
    expect(client.getState().takes['v2']).toBeDefined();
  });

  it('a redaction whose refold never ran still holds after a restart, because the fold is rebuilt from the log', async () => {
    // Why: the process can stop between committing a redaction and refolding.
    // Nothing derived is persisted beside the log, so a restart cannot show
    // the redacted take.
    const server = new FakeServer();
    const a = device(server, 'dA', 'lead', { t: 0 });
    await a.client.load();
    await a.client.append('v1.UnitAdded', unit(1));
    const composed = await a.client.append('v1.TakeComposed', { takeId: 'removed', unitId: 'u1', cardHashes: ['h'], parentTakeId: null });
    const load = a.client.load.bind(a.client);
    a.client.load = async () => { throw new Error('process stopped before refold'); };
    await expect(a.client.append('v1.Redacted', { eventId: composed.id })).rejects.toThrow();
    a.client.load = load;
    const restarted = new SyncClient({ orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dA', store: a.store, transport: server.transportFor() });
    await restarted.load();
    expect(restarted.getState().takes['removed']).toBeUndefined();
    expect(derivePassage(restarted.getState(), 'u1').drafting).toBe(false);
  });
});
