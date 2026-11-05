import { HlcClock, REDUCER_VERSION, type LanguageState } from '@langquest-next/core';
import { Diagnostics, MemoryDiagStore, type DiagRecord } from '../src/diagnostics';
import { MemoryStore } from '../src/memoryStore';
import { LANGUAGE_MATERIALIZER, SyncClient, type Materializer, type SyncClientOptions } from '../src/syncClient';
import { FakeServer } from '../src/testing/fakeServer';
import { ServerError, UnrenewedError, type Transport, type WriteBatch } from '../src/types';

const unit = (i: number, label = `P${i}`) => ({ unitId: `u${i}`, parentUnitId: null, kind: 'passage', label, order: `a${i}` });

/** One phone's client with its own diagnostics, on simulated time. */
function phone(server: FakeServer, over: Partial<SyncClientOptions> = {}, store = new MemoryStore()) {
  const wall = { t: 1_000 };
  const records = new MemoryDiagStore();
  let n = 0;
  const diag = new Diagnostics({ store: records, newId: () => `d${++n}`, now: () => wall.t, maxRecords: Infinity });
  let e = 0;
  const client = new SyncClient({
    orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dA', store, transport: server.transportFor(),
    clock: new HlcClock('dA', () => (wall.t += 1)), now: () => wall.t, newId: () => `e${++e}`, diag, ...over
  });
  const of = async (kind: DiagRecord['kind']) => { await diag.settle(); return records.records.filter((r) => r.kind === kind); };
  return { client, store, wall, of };
}

describe('sync record', () => {
  it('splits refusals by reason, and counts work queued again after a membership change', async () => {
    // Why: "rejected 4" said nothing support could act on. A role missing a
    // privilege, a membership not there yet and a bad payload need three
    // different answers.
    const server = new FakeServer();
    const reasons: Record<string, string> = { A: 'not a member', B: 'may not emit v1.UnitAdded', C: 'invalid payload', D: 'something new' };
    server.authorize = (e) => reasons[(e.payload as { label?: string }).label ?? ''] ?? null;
    const { client, of } = phone(server);
    await client.load();
    for (const [i, label] of ['A', 'B', 'C', 'D'].entries()) await client.append('v1.UnitAdded', unit(i, label));
    await client.sync();
    const [first] = await of('sync');
    expect(first!.n).toMatchObject({ rejected: 4, rejNotMember: 1, rejNotAllowed: 1, rejInvalid: 1, rejOther: 1, requeued: 0, more: 0 });
    expect((await of('load')).map((r) => r.t.reason)).toEqual(['open', 'rejected']);

    server.authorize = () => null;
    expect(await client.retryRejected(['NOT_MEMBER', 'NOT_ALLOWED'], 'membership')).toBe(2);
    await client.sync();
    const syncs = await of('sync');
    expect(syncs[1]!.n).toMatchObject({ pushed: 2, requeued: 2, rejected: 0 });
    expect((await of('load')).at(-1)!.t.reason).toBe('membership');
  });

  it('counts a clock refusal on its own, apart from what was refused for good', async () => {
    const server = new FakeServer();
    let once = true;
    server.authorize = () => (once ? ((once = false), 'clock ahead: server time 500') : null);
    const { client, of } = phone(server);
    await client.load();
    await client.append('v1.UnitAdded', unit(1));
    await client.sync();
    expect((await of('sync'))[0]!.n).toMatchObject({ rejected: 0, rejClockAhead: 1 });
  });

  it('says when a run stopped with more to send', async () => {
    const server = new FakeServer();
    const { client, of } = phone(server, { pushBatchSize: 1, pushBatchesPerRun: 1 });
    await client.load();
    await client.append('v1.UnitAdded', unit(1));
    await client.append('v1.UnitAdded', unit(2));
    await client.sync();
    await client.sync();
    expect((await of('sync')).map((r) => r.n.more)).toEqual([1, 0]);
  });

  it('a server failure keeps its code and where it happened, never its message', async () => {
    // Why: every server failure read as "Error", the same for a statement
    // timeout as for a missing function.
    const server = new FakeServer();
    const real = server.transportFor();
    const transport: Transport = { ...real, pull: async () => { throw new ServerError('57014: canceling statement due to statement timeout', '57014'); } };
    const { client, of } = phone(server, { transport });
    await client.load();
    await expect(client.sync()).rejects.toBeInstanceOf(ServerError);
    const [r] = await of('sync');
    expect(r!.t).toEqual({ outcome: 'error', error: 'ServerError', code: '57014', phase: 'pull' });
    expect(JSON.stringify(r)).not.toMatch(/canceling/);
  });

  it('a failed write on the phone is the store, whichever step asked for it', async () => {
    class FullDisk extends MemoryStore {
      override async commit(batch: WriteBatch): Promise<void> {
        if (batch.cursor) throw new Error('database or disk is full');
        return super.commit(batch);
      }
    }
    const server = new FakeServer();
    const { client, of } = phone(server, {}, new FullDisk());
    await client.load();
    await expect(client.sync()).rejects.toThrow();
    expect((await of('sync'))[0]!.t).toMatchObject({ outcome: 'error', phase: 'store' });
  });

  it('a sign-in that could not be renewed is offline for the app and unrenewed for support', async () => {
    // Why: a rate limit or a captive portal answering the renewal read as
    // "offline" while the phone had signal, and support chased the network.
    const server = new FakeServer();
    const real = server.transportFor();
    let renewed = false;
    const fail = () => { if (!renewed) throw new UnrenewedError('Network request failed: the sign-in could not be renewed yet'); };
    const transport: Transport = {
      ...real,
      append: async (e) => { fail(); return real.append(e); },
      pull: async (...a) => { fail(); return real.pull(...a); }
    };
    const { client, wall, of } = phone(server, { transport });
    await client.load();
    await client.append('v1.UnitAdded', unit(1));
    const r = await client.sync();
    expect(r.offline).toBe(true);
    expect(await client.pendingCount()).toBe(1);
    renewed = true;
    wall.t += 10 * 60_000;
    await client.sync();
    const syncs = await of('sync');
    expect(syncs.map((s) => s.t.outcome)).toEqual(['unrenewed', 'ok']);
    expect(syncs[1]!.n.offlineMs).toBeGreaterThanOrEqual(10 * 60_000);
  });
});

describe('load, checkpoint and snapshot records', () => {
  it('a checkpoint says what it cost, and the next load starts from it', async () => {
    // Why: serializing a big language is a phone's longest single task, and
    // nothing recorded it; a slow open could not be told from a slow checkpoint.
    const server = new FakeServer();
    const store = new MemoryStore();
    const a = phone(server, { checkpointEvery: 3 }, store);
    await a.client.load();
    for (let i = 1; i <= 4; i++) await a.client.append('v1.UnitAdded', unit(i));
    await a.client.sync();
    const [cp] = await a.of('checkpoint');
    expect(cp).toMatchObject({ orgId: 'org1', streamId: 'p1', t: { path: 'fast' }, n: { seq: 4, pruned: 4 } });
    expect(cp!.n.kb).toBeGreaterThanOrEqual(0);
    expect(cp!.n.ms).toBeGreaterThanOrEqual(0);
    const [first] = await a.of('load');
    expect(first!.t).toEqual({ reason: 'open', checkpoint: 'none' });
    expect(first!.n).toMatchObject({ readMs: expect.any(Number), foldMs: expect.any(Number) });

    const b = phone(server, {}, store);
    await b.client.load();
    expect((await b.of('load'))[0]!.t).toEqual({ reason: 'open', checkpoint: 'ok' });
  });

  it('after a reducer update: the old checkpoint is named, and the snapshot that follows says why', async () => {
    // Why: after #134 a phone drops a checkpoint the new reducer cannot read
    // and fetches the stream again; that must not look like a cold install.
    const server = new FakeServer();
    const store = new MemoryStore();
    const before = phone(server, { checkpointEvery: 2 }, store);
    await before.client.load();
    for (let i = 1; i <= 3; i++) await before.client.append('v1.UnitAdded', unit(i));
    await before.client.sync();
    expect(await before.of('checkpoint')).toHaveLength(1);

    server.reducerVersion = REDUCER_VERSION + 1;
    server.makeSnapshot('org1', 'p1');
    const materializer: Materializer<LanguageState> = { ...LANGUAGE_MATERIALIZER, version: REDUCER_VERSION + 1 };
    const after = phone(server, { materializer }, store);
    await after.client.load();
    const [load] = await after.of('load');
    expect(load!.t).toEqual({ reason: 'open', checkpoint: 'old_reducer' });
    expect(load!.n.staleCheckpointSeq).toBe(3);
    await after.client.sync();
    expect((await after.of('snapshot')).map((r) => r.t)).toEqual([{ outcome: 'ok', why: 'reducer' }]);
    expect((await after.of('load')).map((r) => r.t.reason)).toEqual(['open', 'snapshot']);
  });

  it('a first install asks for a snapshot as a cold start', async () => {
    const server = new FakeServer();
    const writer = phone(server);
    await writer.client.load();
    await writer.client.append('v1.UnitAdded', unit(1));
    await writer.client.sync();
    server.makeSnapshot('org1', 'p1');
    const fresh = phone(server, { deviceId: 'dB' });
    await fresh.client.trackOpen();
    await fresh.client.load();
    await fresh.client.sync();
    expect((await fresh.of('snapshot')).map((r) => r.t)).toEqual([{ outcome: 'ok', why: 'cold' }]);
    const [open] = await fresh.of('open');
    expect(open).toMatchObject({ t: { cold: 'yes' }, n: { syncs: 1 } });
    expect(open!.n.snapshotMs).toBeGreaterThanOrEqual(0);
    expect(open!.n.loadMs).toBeGreaterThanOrEqual(0);
  });
});
