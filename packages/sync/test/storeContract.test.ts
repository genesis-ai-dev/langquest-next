import { DatabaseSync } from 'node:sqlite';
import type { AnyEvent } from '@langquest-next/core';
import { MemoryStore } from '../src/memoryStore';
import { SqliteStore, type SqlDriver } from '../src/sqliteStore';
import type { EventStore, LocalEvent, NearbyAttestRow, NearbyBatchRow } from '../src/types';

/** node:sqlite driver, the test twin of the expo-sqlite driver in apps/mobile. */
function nodeDriver(): SqlDriver {
  const db = new DatabaseSync(':memory:');
  const driver: SqlDriver = {
    run: async (sql, params = []) => {
      db.prepare(sql).run(...(params as never[]));
    },
    all: async <T,>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...(params as never[])) as T[],
    transaction: async (fn) => {
      db.exec('begin');
      try { await fn(driver); db.exec('commit'); } catch (e) { db.exec('rollback'); throw e; }
    }
  };
  return driver;
}

function ev(id: string, hlc: string, serverSeq?: number): AnyEvent {
  return {
    id,
    type: 'v1.UnitAdded',
    orgId: 'o',
    streamId: 'p',
    actorId: 'a',
    deviceId: 'd',
    hlc,
    payload: { unitId: id, parentUnitId: null, kind: 'passage', label: id, order: hlc },
    ...(serverSeq !== undefined ? { serverSeq } : {})
  };
}

/**
 * Same contract for both stores, so the app's SQLite store cannot drift from
 * what SyncClient assumes.
 */
const impls: [string, () => Promise<EventStore>][] = [
  ['MemoryStore', async () => new MemoryStore()],
  ['SqliteStore', () => SqliteStore.open(nodeDriver())]
];

describe.each(impls)('%s contract', (_name, make) => {
  it('page reads the log in id order after a cursor, by type when asked, never a rejected event (decisions.md 143)', async () => {
    const s = await make();
    await s.put({ event: ev('c', '1', 1), status: 'confirmed' });
    await s.put({ event: ev('a', '2'), status: 'pending' });
    await s.put({ event: { ...ev('b', '3'), type: 'v1.Redacted', payload: { eventId: 'a', reason: 'x' } } as AnyEvent, status: 'pending' });
    await s.put({ event: ev('d', '4'), status: 'rejected', rejectReason: 'no' });
    await s.put({ event: { ...ev('e', '5'), streamId: 'q' }, status: 'pending' });
    const ids = (p: { event: AnyEvent }[]) => p.map((l) => l.event.id);
    expect(ids(await s.page('o', 'p', null, 2))).toEqual(['a', 'b']);
    expect(ids(await s.page('o', 'p', 'b', 2))).toEqual(['c']);
    expect(ids(await s.page('o', 'p', 'c', 2))).toEqual([]);
    expect(ids(await s.page('o', 'p', null, 10, 'v1.Redacted'))).toEqual(['b']);
    expect(ids(await s.page('o', 'p', 'b', 10, 'v1.Redacted'))).toEqual([]);
    // Status and serverSeq come back with each event.
    expect((await s.page('o', 'p', 'b', 1))[0]).toMatchObject({ status: 'confirmed', event: { serverSeq: 1 } });
  });

  it('pendingCountBy counts one person\'s unsent events only (a shared phone)', async () => {
    const s = await make();
    await s.put({ event: ev('a1', '1'), status: 'pending' });
    await s.put({ event: { ...ev('b1', '2'), actorId: 'b' }, status: 'pending' });
    await s.put({ event: { ...ev('b2', '3', 1), actorId: 'b' }, status: 'confirmed' });
    await s.put({ event: { ...ev('b3', '4'), actorId: 'b' }, status: 'rejected', rejectReason: 'no' });
    expect(await s.pendingCount('o', 'p')).toBe(2);
    expect(await s.pendingCountBy('o', 'p', 'a')).toBe(1);
    expect(await s.pendingCountBy('o', 'p', 'b')).toBe(1);
    expect(await s.pendingCountBy('o', 'p', 'c')).toBe(0);
    await s.put({ event: { ...ev('b4', '5'), actorId: 'b', streamId: 'q' }, status: 'pending' });
    expect(await s.pendingStreamsBy('b')).toEqual([{ orgId: 'o', streamId: 'p' }, { orgId: 'o', streamId: 'q' }]);
    expect(await s.pendingStreamsBy('c')).toEqual([]);
  });

  it('pending returns only pending, oldest first; all excludes rejected', async () => {
    const s = await make();
    await s.put({ event: ev('b', '2'), status: 'pending' });
    await s.put({ event: ev('a', '1'), status: 'pending' });
    await s.put({ event: ev('c', '3', 1), status: 'confirmed' });
    await s.put({ event: ev('x', '4'), status: 'rejected', rejectReason: 'no' });
    expect((await s.pending('o', 'p')).map((e) => e.event.id)).toEqual(['a', 'b']);
    expect((await s.all('o', 'p')).map((e) => e.event.id).sort()).toEqual(['a', 'b', 'c']);
    expect((await s.get('x'))?.rejectReason).toBe('no');
    // The sync status screen shows this total; it must agree with all()
    // without loading a 250k-event log into memory to count it.
    expect(await s.count('o', 'p')).toBe(3);
  });

  it('pendingPage walks the outbox in hlc order without materializing it', async () => {
    // Why: push reads pages so a large offline backlog never has to be loaded
    // whole; the pages must tile the outbox exactly, no gaps and no repeats.
    const s = await make();
    for (const id of ['e', 'c', 'a', 'd', 'b']) await s.put({ event: ev(id, id), status: 'pending' });
    await s.put({ event: ev('z', 'z', 1), status: 'confirmed' });
    const seen: string[] = [];
    let after: string | null = null;
    for (;;) {
      const page = await s.pendingPage('o', 'p', after, 2);
      if (page.length === 0) break;
      seen.push(...page.map((e) => e.event.id));
      after = page[page.length - 1]!.event.hlc;
    }
    expect(seen).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(await s.pendingPage('o', 'p', 'e', 2)).toEqual([]);
  });

  it('commit writes events, cursor, meta and prune together', async () => {
    // Why: the single writer's promise is that one batch is one durable
    // step. A pull page's events and the cursor past them land together.
    const s = await make();
    await s.put({ event: ev('old', '0', 1), status: 'confirmed' });
    await s.commit({
      events: [{ event: ev('a', '1'), status: 'pending' }, { event: ev('b', '2', 2), status: 'confirmed' }],
      cursor: { orgId: 'o', streamId: 'p', seq: 9 },
      meta: { k: 'v' },
      prune: { orgId: 'o', streamId: 'p', uptoSeq: 1 }
    });
    expect((await s.pending('o', 'p')).map((e) => e.event.id)).toEqual(['a']);
    expect((await s.all('o', 'p')).map((e) => e.event.id).sort()).toEqual(['a', 'b']);
    expect(await s.cursor('o', 'p')).toBe(9);
    expect(await s.cursor('o', 'q')).toBe(0);
    expect(await s.meta('k')).toBe('v');
  });

  it('put is an upsert by id, so a confirm replaces the pending row', async () => {
    const s = await make();
    await s.put({ event: ev('a', '1'), status: 'pending' });
    await s.put({ event: ev('a', '1', 7), status: 'confirmed' });
    expect((await s.pending('o', 'p')).length).toBe(0);
    expect((await s.get('a'))?.event.serverSeq).toBe(7);
  });

  it('cursor defaults to 0 and persists per stream', async () => {
    const s = await make();
    expect(await s.cursor('o', 'p')).toBe(0);
    await s.setCursor('o', 'p', 42);
    await s.setCursor('o', 'q', 5);
    expect(await s.cursor('o', 'p')).toBe(42);
    expect(await s.cursor('o', 'q')).toBe(5);
  });

  it('streams do not leak into each other', async () => {
    const s = await make();
    await s.put({ event: { ...ev('a', '1'), streamId: 'other' }, status: 'pending' });
    expect(await s.pending('o', 'p')).toEqual([]);
  });
});

describe.each(impls)('%s meta contract', (_name, make) => {
  it('meta is a persisted key/value map, undefined when unset', async () => {
    const s = await make();
    expect(await s.meta('deviceId')).toBeUndefined();
    await s.setMeta('deviceId', 'd1');
    await s.setMeta('deviceId', 'd2');
    expect(await s.meta('deviceId')).toBe('d2');
  });
});

describe.each(impls)('%s prune contract', (_name, make) => {
  it('prune drops confirmed events at or below a sequence and keeps the rest', async () => {
    const s = await make();
    await s.put({ event: ev('a', '1', 1), status: 'confirmed' });
    await s.put({ event: ev('b', '2', 2), status: 'confirmed' });
    await s.put({ event: ev('c', '3', 3), status: 'confirmed' });
    await s.put({ event: ev('p', '4'), status: 'pending' });
    await s.put({ event: ev('x', '5'), status: 'rejected', rejectReason: 'no' });
    await s.prune('o', 'p', 2);
    expect((await s.all('o', 'p')).map((e) => e.event.id).sort()).toEqual(['c', 'p']);
    expect((await s.get('x'))?.status).toBe('rejected');
  });
});

describe.each(impls)('%s nearby contract', (_name, make) => {
  const via = { batch: 3, key: 'K' };
  const nearby = (id: string, hlc: string, over: Partial<AnyEvent> = {}): LocalEvent => ({ event: { ...ev(id, hlc), ...over } as AnyEvent, status: 'nearby', via });
  const ids = (rows: readonly LocalEvent[]) => rows.map((l) => l.event.id);

  it('a nearby row is in no pending query, whoever wrote it', async () => {
    // Why: `pendingStreamsBy` and the courier would send it as its author when that person signs in here, which launders a forged event.
    const s = await make();
    await s.commit({ receive: [nearby('n', '1')] });
    expect(await s.pending('o', 'p')).toEqual([]);
    expect(await s.pendingPage('o', 'p', null, 10)).toEqual([]);
    expect(await s.pendingCount('o', 'p')).toBe(0);
    expect(await s.pendingCountBy('o', 'p', 'a')).toBe(0);
    expect(await s.pendingStreamsBy('a')).toEqual([]);
    expect(await s.unsignedPage('o', 'p', null, 10)).toEqual([]);
    expect(await s.confirmedAfter('o', 'p', 0, 10)).toEqual([]);
    expect(await s.rejected('o', 'p')).toEqual([]);
  });

  it('a nearby row is in the fold, and in the count', async () => {
    const s = await make();
    await s.put({ event: ev('c', '1', 1), status: 'confirmed' });
    await s.commit({ receive: [nearby('n', '2')] });
    expect(ids(await s.page('o', 'p', null, 10))).toEqual(['c', 'n']);
    expect(ids(await s.all('o', 'p')).sort()).toEqual(['c', 'n']);
    expect(await s.count('o', 'p')).toBe(2);
  });

  it('it comes back as it went in: no serverSeq property, and its via', async () => {
    const s = await make();
    await s.commit({ receive: [{ event: { ...ev('n', '1'), serverSeq: undefined } as unknown as AnyEvent, status: 'nearby', via }] });
    const row = (await s.get('n'))!;
    expect(row.event).not.toHaveProperty('serverSeq');
    expect(row).toMatchObject({ status: 'nearby', via });
    expect(row).not.toHaveProperty('rejectReason');
    const claimed = { claim: { key: 'K2', seq: 7 } };
    await s.commit({ receive: [{ event: ev('m', '2'), status: 'nearby', via: claimed }] });
    expect((await s.get('m'))?.via).toEqual(claimed);
    // Written with no via, a row reads with no via property, however it was given.
    await s.put({ event: ev('p1', '3'), status: 'pending' });
    expect(await s.get('p1')).not.toHaveProperty('via');
  });

  it('prune never removes a nearby row, even one carrying a sequence', async () => {
    const s = await make();
    await s.put({ event: ev('c', '1', 1), status: 'confirmed' });
    await s.commit({ receive: [nearby('n', '2'), { event: ev('seq', '3', 1), status: 'nearby', via }] });
    await s.prune('o', 'p', 100);
    expect(ids(await s.all('o', 'p')).sort()).toEqual(['n', 'seq']);
    expect(await s.nearbyCount('o', 'p')).toBe(2);
  });

  it.each([
    ['confirmed', { event: ev('x', '1', 5), status: 'confirmed' as const }],
    ['pending', { event: ev('x', '1'), status: 'pending' as const }],
    ['rejected', { event: ev('x', '1'), status: 'rejected' as const, rejectReason: 'no' }],
    ['nearby', { event: ev('x', '1'), status: 'nearby' as const, via: { batch: 1, key: 'FIRST' } }]
  ])('receive never overwrites a %s row', async (_status, first: LocalEvent) => {
    // Why: the upsert would overwrite its status, so a teammate's copy could downgrade what this phone already knows.
    const s = await make();
    await s.put(first);
    await s.commit({ receive: [{ event: { ...ev('x', '9'), actorId: 'someone-else' }, status: 'nearby', via }] });
    const row = (await s.get('x'))!;
    expect(row.status).toBe(first.status);
    expect(row.event.hlc).toBe('1');
    expect(row.event.actorId).toBe('a');
    expect(row.via).toEqual(first.via);
    expect(row.rejectReason).toBe(first.rejectReason);
    expect(row.event.serverSeq).toBe(first.event.serverSeq);
  });

  it('within one commit, what `events` wrote stays, and the first of two receives stays', async () => {
    const s = await make();
    await s.commit({ events: [{ event: ev('x', '1', 5), status: 'confirmed' }], receive: [nearby('x', '9'), nearby('y', '2'), nearby('y', '8')] });
    expect(await s.get('x')).toMatchObject({ status: 'confirmed', event: { hlc: '1' } });
    expect((await s.get('y'))?.event.hlc).toBe('2');
  });

  it('dropNearby removes only nearby rows, of that stream, and leaves the rest', async () => {
    const s = await make();
    await s.put({ event: ev('c', '1', 1), status: 'confirmed' });
    await s.put({ event: ev('pn', '2'), status: 'pending' });
    await s.put({ event: ev('r', '3'), status: 'rejected', rejectReason: 'no' });
    await s.commit({ receive: [nearby('n1', '4'), nearby('n2', '5'), nearby('other', '6', { streamId: 'q' })] });
    await s.commit({ dropNearby: { orgId: 'o', streamId: 'p', ids: ['c', 'pn', 'r', 'n1', 'other', 'never-here'] } });
    expect(await s.get('n1')).toBeUndefined();
    expect((await s.get('n2'))?.status).toBe('nearby');
    expect((await s.get('c'))?.status).toBe('confirmed');
    expect((await s.get('pn'))?.status).toBe('pending');
    expect((await s.get('r'))?.status).toBe('rejected');
    expect((await s.get('other'))?.event.streamId).toBe('q');
    await s.commit({ dropNearby: { orgId: 'wrong', streamId: 'p', ids: ['n2'] } });
    expect(await s.get('n2')).toBeDefined();
  });

  it('a confirm, a restamp and a refusal each clear via', async () => {
    // Why: the old digest no longer speaks for a restamped row, and `requeue` leaves out rows with a via.
    const s = await make();
    await s.commit({ receive: [nearby('a1', '1'), nearby('a2', '2'), nearby('a3', '3')] });
    await s.put({ event: ev('a1', '1', 5), status: 'confirmed' });
    await s.put({ event: ev('a2', '7'), status: 'pending' });
    await s.put({ event: ev('a3', '3'), status: 'rejected', rejectReason: 'no' });
    for (const id of ['a1', 'a2', 'a3']) expect(await s.get(id), id).not.toHaveProperty('via');
    expect(await s.nearbyCount('o', 'p')).toBe(0);
  });

  it('an upsert that carries a via keeps it, and an author\'s row can hold one and stay pending', async () => {
    const s = await make();
    await s.put({ event: ev('mine', '1'), status: 'pending' });
    expect(ids(await s.unsignedPage('o', 'p', null, 10))).toEqual(['mine']);
    await s.commit({ events: [{ event: ev('mine', '1'), status: 'pending', via }] });
    expect((await s.get('mine'))?.via).toEqual(via);
    expect(await s.unsignedPage('o', 'p', null, 10)).toEqual([]);
    expect(ids(await s.pending('o', 'p'))).toEqual(['mine']);
  });

  it('the same id on another stream: nothing lands, nothing leaks, nothing goes', async () => {
    // Why: `events.id` is unique across streams, so a copy under an id held elsewhere must not move or shadow that row.
    const s = await make();
    await s.put({ event: ev('shared', '1', 4), status: 'confirmed' });
    await s.commit({ receive: [nearby('shared', '9', { streamId: 'q' })] });
    const row = (await s.get('shared'))!;
    expect(row).toMatchObject({ status: 'confirmed', event: { streamId: 'p', hlc: '1' } });
    expect(await s.count('o', 'q')).toBe(0);
    expect(await s.nearbyCount('o', 'q')).toBe(0);
    expect(await s.unconfirmedCount('o', 'q')).toBe(0);
    expect(await s.nearbyPage('o', 'q', null, 10)).toEqual([]);

    await s.commit({ receive: [nearby('here', '2')] });
    await s.commit({ dropNearby: { orgId: 'o', streamId: 'q', ids: ['here'] } });
    expect((await s.get('here'))?.event.streamId).toBe('p');
    expect(await s.nearbyCount('o', 'p')).toBe(1);
    // The one read not asked by stream, because a pull page and a manifest ask by id.
    expect(ids(await s.getMany(['shared', 'here'])).sort()).toEqual(['here', 'shared']);
  });

  it('an upsert under an id held in another stream moves the row there whole, as the server holds it', async () => {
    // Why: a nearby row in `p` and the server's event under that id in `q`. Left in `p` with `q`'s JSON and seq,
    // `q` would never see the event, and `p` would fold `q`'s event as confirmed, past the door, into its checkpoint.
    const s = await make();
    await s.commit({ receive: [nearby('moved', '1')] });
    await s.put({ event: { ...ev('moved', '7', 5), streamId: 'q', orgId: 'o2' }, status: 'confirmed' });
    expect(await s.get('moved')).toMatchObject({ status: 'confirmed', event: { orgId: 'o2', streamId: 'q', serverSeq: 5 } });
    expect(await s.nearbyCount('o', 'p')).toBe(0);
    expect(await s.count('o', 'p')).toBe(0);
    expect(ids(await s.page('o', 'p', null, 10))).toEqual([]);
    expect(ids(await s.page('o2', 'q', null, 10))).toEqual(['moved']);
    expect(ids(await s.confirmedAfter('o2', 'q', 0, 10))).toEqual(['moved']);
  });

  it('unconfirmedCount is pending and nearby, per stream, for the checkpoint gates', async () => {
    const s = await make();
    expect(await s.unconfirmedCount('o', 'p')).toBe(0);
    await s.put({ event: ev('c', '1', 1), status: 'confirmed' });
    await s.put({ event: ev('r', '2'), status: 'rejected', rejectReason: 'no' });
    expect(await s.unconfirmedCount('o', 'p')).toBe(0);
    await s.put({ event: ev('pn', '3'), status: 'pending' });
    expect(await s.unconfirmedCount('o', 'p')).toBe(1);
    await s.commit({ receive: [nearby('n', '4'), nearby('nq', '5', { streamId: 'q' })] });
    expect(await s.unconfirmedCount('o', 'p')).toBe(2);
    expect(await s.nearbyCount('o', 'p')).toBe(1);
    expect(await s.unconfirmedCount('o', 'q')).toBe(1);
  });

  it('nearbyPage walks nearby rows by id, however they are clocked', async () => {
    const s = await make();
    await s.commit({ receive: [nearby('c', '1'), nearby('a', '3'), nearby('b', '3'), nearby('other', '1', { streamId: 'q' })] });
    await s.put({ event: ev('aa', '1'), status: 'pending' });
    expect(ids(await s.nearbyPage('o', 'p', null, 2))).toEqual(['a', 'b']);
    expect(ids(await s.nearbyPage('o', 'p', 'b', 2))).toEqual(['c']);
    expect(await s.nearbyPage('o', 'p', 'c', 2)).toEqual([]);
  });

  it('getMany answers for what is here, of any status, each id once, across slices', async () => {
    const s = await make();
    await s.put({ event: ev('c', '1', 1), status: 'confirmed' });
    await s.put({ event: ev('pn', '2'), status: 'pending' });
    await s.put({ event: ev('r', '3'), status: 'rejected', rejectReason: 'no' });
    await s.commit({ receive: [nearby('n', '4')] });
    expect(await s.getMany([])).toEqual([]);
    expect(ids(await s.getMany(['c', 'pn', 'r', 'n', 'n', 'gone'])).sort()).toEqual(['c', 'n', 'pn', 'r']);
    expect((await s.getMany(['n']))[0]).toMatchObject({ status: 'nearby', via });
    const many = Array.from({ length: 2500 }, (_, i) => `m${i}`);
    await s.commit({ receive: many.map((id, i) => nearby(id, String(i))) });
    expect((await s.getMany(many)).length).toBe(2500);
    await s.commit({ dropNearby: { orgId: 'o', streamId: 'p', ids: many } });
    expect(await s.getMany(many)).toEqual([]);
  });

  it('unsignedPage walks pending rows with no via, oldest first, of this stream', async () => {
    const s = await make();
    for (const id of ['c', 'a', 'b']) await s.put({ event: ev(id, id), status: 'pending' });
    await s.put({ event: ev('signed', 'aa'), status: 'pending', via });
    await s.put({ event: { ...ev('elsewhere', 'a'), streamId: 'q' }, status: 'pending' });
    await s.commit({ receive: [nearby('n', 'ab')] });
    await s.put({ event: ev('done', 'ac', 1), status: 'confirmed' });
    expect(ids(await s.unsignedPage('o', 'p', null, 2))).toEqual(['a', 'b']);
    expect(ids(await s.unsignedPage('o', 'p', 'b', 2))).toEqual(['c']);
    expect(await s.unsignedPage('o', 'p', 'c', 2)).toEqual([]);
  });

  it('confirmedAfter walks confirmed rows by server_seq, of this stream', async () => {
    const s = await make();
    for (const [id, seq] of [['c3', 3], ['c1', 1], ['c2', 2]] as const) await s.put({ event: ev(id, 'z', seq), status: 'confirmed' });
    await s.put({ event: { ...ev('elsewhere', 'z', 9), streamId: 'q' }, status: 'confirmed' });
    await s.put({ event: ev('pn', 'z'), status: 'pending' });
    expect(ids(await s.confirmedAfter('o', 'p', 0, 2))).toEqual(['c1', 'c2']);
    expect(ids(await s.confirmedAfter('o', 'p', 2, 2))).toEqual(['c3']);
    expect(await s.confirmedAfter('o', 'p', 3, 2)).toEqual([]);
  });

  const batch = (key: string, n: number, over: Partial<NearbyBatchRow> = {}): NearbyBatchRow => ({
    orgId: 'o', streamId: 'p', key, n, deviceId: 'd', actorId: 'a', firstHlc: `h${n}`, manifest: `m${n}`, sig: `s${n}`, chain: '[]', ...over
  });

  it('a batch keeps the first signature for a number, and its text byte for byte', async () => {
    // Why: the manifest is the string as signed, so nobody has to reproduce it, and a later copy must not replace a good signature.
    const s = await make();
    const signed = '{"events":[["id","ab"]],"name":"Yé 👋 \\"q\\"\\n\\\\","n":1}';
    await s.commit({ batches: [batch('K', 1, { manifest: signed, firstHlc: null, chain: '[{"kind":"worker@1"}]' })] });
    await s.commit({ batches: [batch('K', 1, { manifest: 'forged', sig: 'other', actorId: 'b' })] });
    const [row] = await s.batchesAfter('o', 'p', 'K', 0, 10);
    expect(row).toEqual(batch('K', 1, { manifest: signed, firstHlc: null, chain: '[{"kind":"worker@1"}]' }));
  });

  it('batchKeys lists every batch without its manifest, by signer and number, per stream', async () => {
    const s = await make();
    await s.commit({ batches: [batch('B', 2), batch('A', 10), batch('A', 9), batch('A', 1, { streamId: 'q' }), batch('C', 1, { orgId: 'o2' })] });
    expect(await s.batchKeys('o', 'p')).toEqual([
      { key: 'A', n: 9, actorId: 'a', firstHlc: 'h9' }, { key: 'A', n: 10, actorId: 'a', firstHlc: 'h10' }, { key: 'B', n: 2, actorId: 'a', firstHlc: 'h2' }
    ]);
    expect(await s.batchKeys('o', 'none')).toEqual([]);
  });

  it('batchesAfter walks one signer in number order', async () => {
    const s = await make();
    await s.commit({ batches: [batch('A', 3), batch('A', 1), batch('A', 2), batch('B', 2), batch('A', 4, { streamId: 'q' })] });
    expect((await s.batchesAfter('o', 'p', 'A', 0, 2)).map((b) => b.n)).toEqual([1, 2]);
    expect((await s.batchesAfter('o', 'p', 'A', 2, 2)).map((b) => b.n)).toEqual([3]);
    expect(await s.batchesAfter('o', 'p', 'A', 3, 2)).toEqual([]);
  });

  it('dropBatches removes exactly those numbers of that signer and stream', async () => {
    const s = await make();
    await s.commit({ batches: [batch('A', 1), batch('A', 2), batch('B', 1), batch('A', 1, { streamId: 'q' })] });
    await s.commit({ dropBatches: { orgId: 'o', streamId: 'p', keys: [{ key: 'A', n: 1 }, { key: 'B', n: 9 }] } });
    expect((await s.batchKeys('o', 'p')).map((b) => `${b.key}${b.n}`)).toEqual(['A2', 'B1']);
    expect((await s.batchKeys('o', 'q')).map((b) => `${b.key}${b.n}`)).toEqual(['A1']);
    await s.commit({ dropBatches: { orgId: 'o', streamId: 'p', keys: [] } });
    expect((await s.batchKeys('o', 'p')).length).toBe(2);
  });

  it('an attestation is insert only, and goes as prune passes it', async () => {
    const s = await make();
    const attest = (lastSeq: number, over: Partial<NearbyAttestRow> = {}): NearbyAttestRow => ({ orgId: 'o', streamId: 'p', lastSeq, text: `t${lastSeq}`, kid: 'k1', sig: `s${lastSeq}`, ...over });
    await s.commit({ attests: [attest(20), attest(10), attest(5, { streamId: 'q' })] });
    await s.commit({ attests: [attest(10, { text: 'forged', sig: 'other' })] });
    expect(await s.attestedUpTo('o', 'p')).toEqual([attest(10), attest(20)]);
    await s.commit({ dropAttests: { orgId: 'o', streamId: 'p', upToSeq: 10 } });
    expect(await s.attestedUpTo('o', 'p')).toEqual([attest(20)]);
    expect(await s.attestedUpTo('o', 'q')).toEqual([attest(5, { streamId: 'q' })]);
  });

  it('clearMeta removes one prefix, exactly, and an empty prefix removes nothing', async () => {
    const s = await make();
    for (const k of ['nearbyPeers:o/p', 'nearbyPeers:o/q', 'NEARBYPEERS:o/r', 'nearbyPeersOther', 'nearby_Peers:x', 'deviceId']) await s.setMeta(k, 'v');
    await s.clearMeta('nearbyPeers:');
    expect(await s.meta('nearbyPeers:o/p')).toBeUndefined();
    expect(await s.meta('nearbyPeers:o/q')).toBeUndefined();
    for (const k of ['NEARBYPEERS:o/r', 'nearbyPeersOther', 'nearby_Peers:x', 'deviceId']) expect(await s.meta(k), k).toBe('v');
    // Neither `_` nor `%` is a wildcard here.
    await s.clearMeta('nearby%');
    await s.clearMeta('nearbyXPeers');
    expect(await s.meta('nearby_Peers:x')).toBe('v');
    await s.clearMeta('nearby_');
    expect(await s.meta('nearby_Peers:x')).toBeUndefined();
    expect(await s.meta('nearbyPeersOther')).toBe('v');
    await s.clearMeta('');
    expect(await s.meta('deviceId')).toBe('v');
    await s.clearMeta('nothing-holds-this');
  });

  it('commit with empty fields changes nothing', async () => {
    const s = await make();
    await s.commit({ receive: [nearby('n', '1')], batches: [batch('A', 1)] });
    await s.commit({ receive: [], batches: [], attests: [], dropNearby: { orgId: 'o', streamId: 'p', ids: [] }, dropBatches: { orgId: 'o', streamId: 'p', keys: [] } });
    expect(await s.nearbyCount('o', 'p')).toBe(1);
    expect((await s.batchKeys('o', 'p')).length).toBe(1);
  });

  it('counts what nearby rows cost by whose budget they spend: a claim its claimer\'s, a batch row its author\'s', async () => {
    const store = await make();
    const batchRow = nearby('b1', '000000000000001:000000:d1', { actorId: 'sam' });
    const claimRow: LocalEvent = { ...nearby('c1', '000000000000002:000000:d1', { actorId: 'sam' }), via: { claim: { key: 'K2', seq: 4 } } };
    const pendingRow: LocalEvent = { event: { ...ev('p1', '000000000000003:000000:d1'), actorId: 'sam' } as AnyEvent, status: 'pending' };
    await store.commit({ receive: [batchRow, claimRow, nearby('b2', '000000000000004:000000:d1', { actorId: 'sam' })], events: [pendingRow] });
    await store.commit({ receive: [nearby('z1', '000000000000005:000000:d1', { streamId: 'elsewhere' })] });
    const use = await store.nearbyUse('o', 'p');
    const sized = (...events: LocalEvent[]) => events.reduce((n, l) => n + JSON.stringify(l.event).length, 0);
    expect([...use].sort((a, b) => (a.who < b.who ? -1 : 1))).toEqual([
      { who: 'actor:sam', rows: 2, bytes: sized(batchRow, nearby('b2', '000000000000004:000000:d1', { actorId: 'sam' })), manifestBytes: 0 },
      { who: 'claim:K2', rows: 1, bytes: sized(claimRow), manifestBytes: 0 }
    ]);
  });

  it('counts stored manifest text by the manifest\'s actor, with or without rows, and on this stream only', async () => {
    const store = await make();
    const batch = (streamId: string, key: string, n: number, actorId: string, manifest: string) => ({ orgId: 'o', streamId, key, n, deviceId: 'd1', actorId, firstHlc: null, manifest, sig: 's', chain: '[]' });
    await store.commit({ receive: [nearby('b1', '000000000000001:000000:d1', { actorId: 'sam' })] });
    await store.commit({ batches: [batch('p', 'K1', 1, 'sam', 'x'.repeat(10)), batch('p', 'K2', 1, 'sam', 'y'.repeat(5)), batch('p', 'K3', 1, 'ana', 'z'.repeat(7)), batch('elsewhere', 'K1', 1, 'sam', 'w'.repeat(100))] });
    const use = await store.nearbyUse('o', 'p');
    expect(use.find((u) => u.who === 'actor:sam')).toMatchObject({ rows: 1, manifestBytes: 15 });
    expect(use.find((u) => u.who === 'actor:ana')).toEqual({ who: 'actor:ana', rows: 0, bytes: 0, manifestBytes: 7 });
  });
});

describe('SqliteStore nearby', () => {
  it('a log from before nearby sync gains `via`, keeps its rows, and opens again', async () => {
    const driver = nodeDriver();
    await driver.run(`create table events (id text primary key, org_id text not null, stream_id text not null, status text not null,
      reject_reason text, hlc text not null, server_seq integer, json text not null)`);
    await driver.run(`insert into events values ('old', 'o', 'p', 'pending', null, '1', null, ?)`, [JSON.stringify(ev('old', '1'))]);
    const s = await SqliteStore.open(driver);
    const row = await s.get('old');
    expect(row?.status).toBe('pending');
    expect(row).not.toHaveProperty('via');
    expect((await s.unsignedPage('o', 'p', null, 10)).length).toBe(1);
    await s.commit({ receive: [{ event: ev('n', '2'), status: 'nearby', via: { batch: 1, key: 'K' } }] });
    const again = await SqliteStore.open(driver);
    expect((await again.get('n'))?.via).toEqual({ batch: 1, key: 'K' });
    expect((await again.get('old'))?.status).toBe('pending');
  });

  it('a phone from before streams starts empty with the new column, and no alter runs on it', async () => {
    const driver = nodeDriver();
    await driver.run(`create table events (id text primary key, org_id text not null, project_id text not null,
      status text not null, reject_reason text, hlc text not null, server_seq integer, json text not null)`);
    const s = await SqliteStore.open(driver);
    await s.commit({ receive: [{ event: ev('n', '1'), status: 'nearby', via: { batch: 1, key: 'K' } }] });
    expect((await s.get('n'))?.via).toEqual({ batch: 1, key: 'K' });
  });

  it('adds no index over `via` or for nearby rows: it would run over everyone\'s log', async () => {
    const driver = nodeDriver();
    await SqliteStore.open(driver);
    const indexes = await driver.all<{ name: string }>(`select name from sqlite_master where type = 'index' and tbl_name = 'events' and sql is not null`);
    expect(indexes.map((i) => i.name).sort()).toEqual(['events_stream_id', 'events_stream_status']);
  });

  it('a failed commit takes its receive, its drop and its batch with it', async () => {
    const s = await SqliteStore.open(nodeDriver());
    const row = { orgId: 'o', streamId: 'p', key: 'K', n: 1, deviceId: 'd', actorId: 'a', firstHlc: null, manifest: 'm', sig: 's', chain: '[]' };
    await s.commit({ receive: [{ event: ev('keep', '1'), status: 'nearby', via: { batch: 1, key: 'K' } }] });
    await expect(s.commit({
      receive: [{ event: ev('new', '2'), status: 'nearby', via: { batch: 1, key: 'K' } }],
      dropNearby: { orgId: 'o', streamId: 'p', ids: ['keep'] },
      batches: [{ ...row, manifest: null as unknown as string }]
    })).rejects.toThrow();
    expect(await s.get('new')).toBeUndefined();
    expect((await s.get('keep'))?.status).toBe('nearby');
    expect(await s.batchKeys('o', 'p')).toEqual([]);
  });
});

describe('SqliteStore durability', () => {
  it('opens in WAL mode with synchronous=NORMAL so a crash mid-write cannot corrupt the log', async () => {
    // Why: phones die mid-write. WAL keeps the main file consistent and
    // NORMAL still fsyncs at checkpoint; defaults leave this to the platform.
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const db = new DatabaseSync(join(mkdtempSync(join(tmpdir(), 'lq-')), 'log.db'));
    const driver: SqlDriver = {
      run: async (sql, params = []) => { db.prepare(sql).run(...(params as never[])); },
      all: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as T[]
    };
    await SqliteStore.open(driver);
    expect((db.prepare('pragma journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal');
    expect((db.prepare('pragma synchronous').get() as { synchronous: number }).synchronous).toBe(1);
  });

  it.each(['project_id', 'partition_id'])('starts empty on a phone whose events table has %s and no stream_id', async (column) => {
    // Why: the server was reset with the move to streams (decisions.md 63),
    // so an older log, its cursors and device id mean nothing to it, and the
    // old columns would fail every query.
    const driver = nodeDriver();
    await driver.run(`create table events (id text primary key, org_id text not null, ${column} text not null,
      status text not null, reject_reason text, hlc text not null, server_seq integer, json text not null)`);
    await driver.run(`insert into events values ('old', 'o', 'p', 'pending', null, '1', null, '{}')`);
    await driver.run(`create table cursors (org_id text not null, ${column} text not null, seq integer not null, primary key (org_id, ${column}))`);
    await driver.run(`insert into cursors values ('o', 'p', 42)`);
    await driver.run(`create table meta (key text primary key, value text not null)`);
    await driver.run(`insert into meta values ('deviceId', 'old-device')`);
    await driver.run(`create table passage_rows (org_id text not null, ${column} text not null, unit_id text not null, json text not null)`);
    const s = await SqliteStore.open(driver);
    expect(await s.count('o', 'p')).toBe(0);
    expect(await s.cursor('o', 'p')).toBe(0);
    expect(await s.meta('deviceId')).toBeUndefined();
    expect(await driver.all(`select name from sqlite_master where name = 'passage_rows'`)).toEqual([]);
    await s.put({ event: ev('a', '1'), status: 'pending' });
    await s.setCursor('o', 'p', 3);
    expect((await s.all('o', 'p')).map((e) => e.event.id)).toEqual(['a']);
    expect(await s.cursor('o', 'p')).toBe(3);
  });

  it('keeps a log that already has stream_id across reopening', async () => {
    const driver = nodeDriver();
    const first = await SqliteStore.open(driver);
    await first.put({ event: ev('a', '1'), status: 'pending' });
    await first.setMeta('deviceId', 'd1');
    const again = await SqliteStore.open(driver);
    expect((await again.all('o', 'p')).map((e) => e.event.id)).toEqual(['a']);
    expect(await again.meta('deviceId')).toBe('d1');
  });
});

describe('SqliteStore footprint', () => {
  it('counts streams, events and bytes for the device record', async () => {
    // Why: support could not tell a phone holding one small language from
    // one holding forty, and a slow open often is just a big database.
    const s = await SqliteStore.open(nodeDriver());
    expect(await s.footprint()).toMatchObject({ streams: 0, events: 0 });
    await s.put({ event: ev('a', '1'), status: 'pending' });
    await s.put({ event: { ...ev('b', '2'), streamId: 'q' }, status: 'rejected', rejectReason: 'no' });
    await s.setCursor('o', 'r', 4);
    const f = await s.footprint();
    expect(f).toMatchObject({ streams: 3, events: 2 });
    expect(f.bytes).toBeGreaterThan(0);
  });
});

describe.each(impls)('%s batch and rejected contract', (_name, make) => {
  it('putMany upserts every row and rejected() lists refusals oldest first per stream', async () => {
    // Why: after a month offline a device pulls tens of thousands of events;
    // one statement each would be one fsync each. And the UI must be able to
    // show what was refused without scanning the whole log.
    const s = await make();
    await s.put({ event: ev('a', '1'), status: 'pending' });
    await s.putMany([
      { event: ev('a', '1', 1), status: 'confirmed' },
      { event: ev('b', '2', 2), status: 'confirmed' },
      { event: ev('y', '4'), status: 'rejected', rejectReason: 'not a member' },
      { event: ev('x', '3'), status: 'rejected', rejectReason: 'invalid payload: x' },
      { event: { ...ev('z', '5'), streamId: 'other' }, status: 'rejected', rejectReason: 'no' }
    ]);
    await s.putMany([]);
    expect((await s.get('a'))?.status).toBe('confirmed');
    // One commit, one id twice: the last wins, as one statement per event did.
    await s.commit({ events: [{ event: { ...ev('w', '6'), streamId: 'r' }, status: 'pending' }, { event: { ...ev('w', '6', 6), streamId: 'r' }, status: 'confirmed' }] });
    expect(await s.get('w')).toMatchObject({ status: 'confirmed', event: { serverSeq: 6 } });
    expect((await s.all('o', 'p')).map((e) => e.event.id).sort()).toEqual(['a', 'b']);
    expect((await s.rejected('o', 'p')).map((e) => e.event.id)).toEqual(['x', 'y']);
    // Counted and filtered by reason without reading every refusal (performance-audit-2026-10-26.md item 7).
    expect(await s.rejectedCount?.('o', 'p')).toBe(2);
    expect((await s.rejectedWith?.('o', 'p', 'NOT A MEMBER'))?.map((e) => e.event.id)).toEqual(['y']);
    expect(await s.rejectedWith?.('o', 'other', 'not a member')).toEqual([]);
  });

  it('keeps a language\'s records out of memory, found by passage, id, second key or kind (decisions.md 143)', async () => {
    const s = await make();
    const rec = (id: string, unitId: string, ref = 'a', kind = 'recording') => ({ kind, id, unitId, ref, json: `{"id":"${id}"}` });
    await s.commit({ kept: { orgId: 'o', streamId: 'p', upsert: [rec('r1', 'u1'), rec('r2', 'u2', 'b'), rec('t1', 'u4', 'b', 'take'), { kind: 'file', id: 'h1', unitId: '', ref: '', json: '{"size":1}' }] } });
    await s.commit({ kept: { orgId: 'o', streamId: 'q', upsert: [rec('r9', 'u1')] } });
    expect((await s.keptByUnit('o', 'p', ['recording'], ['u1'])).map((r) => r.id)).toEqual(['r1']);
    expect((await s.keptByUnit('o', 'p', ['recording', 'take'], ['u1', 'u4'])).map((r) => r.id).sort()).toEqual(['r1', 't1']);
    // Asked about a batch of passages, never the whole kind (performance-audit-2026-10-26.md item 6).
    expect((await s.keptUnitsAmong('o', 'p', ['recording'], ['u1', 'u4', 'u9'])).sort()).toEqual(['u1']);
    expect((await s.keptUnitsAmong('o', 'p', ['recording', 'take'], ['u1', 'u2', 'u4'])).sort()).toEqual(['u1', 'u2', 'u4']);
    expect(await s.keptUnitsAmong('o', 'p', [], ['u1'])).toEqual([]);
    expect((await s.keptById('o', 'p', 'file', ['h1', 'nope', 'h1'])).map((r) => r.json)).toEqual(['{"size":1}']);
    expect((await s.keptByRef('o', 'p', 'recording', ['b'])).map((r) => r.id)).toEqual(['r2']);
    expect((await s.keptAll('o', 'p', 'take')).map((r) => r.id)).toEqual(['t1']);
    expect((await s.keptUnits('o', 'p', ['recording', 'take'], 'b')).sort()).toEqual(['u2', 'u4']);
    expect((await s.keptUnits('o', 'p', ['recording'])).sort()).toEqual(['u1', 'u2']);
    expect(await s.keptCount('o', 'p', 'recording')).toBe(2);
    // An upsert replaces; a clear empties one stream only.
    await s.commit({ kept: { orgId: 'o', streamId: 'p', upsert: [{ ...rec('r1', 'u3'), json: '{"v":2}' }] } });
    expect((await s.keptById('o', 'p', 'recording', ['r1']))[0]).toMatchObject({ unitId: 'u3', json: '{"v":2}' });
    await s.commit({ kept: { orgId: 'o', streamId: 'p', clear: true } });
    expect(await s.keptCount('o', 'p', 'recording')).toBe(0);
    expect(await s.keptCount('o', 'q', 'recording')).toBe(1);
    // A fresh snapshot's records, written aside, replace the stream's in one commit.
    await s.commit({ kept: { orgId: 'o', streamId: 'q#incoming', upsert: [rec('n1', 'u5')] } });
    await s.commit({ kept: { orgId: 'o', streamId: 'q', replaceFrom: 'q#incoming' } });
    expect((await s.keptByUnit('o', 'q', ['recording'], ['u1', 'u5'])).map((r) => r.id)).toEqual(['n1']);
    expect(await s.keptCount('o', 'q#incoming', 'recording')).toBe(0);
    // Many ids at once: more than one statement's worth of parameters.
    const many = Array.from({ length: 1000 }, (_, i) => rec(`m${i}`, `u${i % 7}`));
    await s.commit({ kept: { orgId: 'o', streamId: 'p', upsert: many } });
    expect((await s.keptById('o', 'p', 'recording', many.map((r) => r.id))).length).toBe(1000);
    expect((await s.keptByUnit('o', 'p', ['recording', 'take', 'note'], Array.from({ length: 900 }, (_, i) => `u${i}`))).length).toBe(1000);
  });
});

describe('SqliteStore transactions', () => {
  it('putMany runs inside one transaction when the driver offers one', async () => {
    let begun = 0;
    const db = new DatabaseSync(':memory:');
    const driver: SqlDriver = {
      run: async (sql, params = []) => { db.prepare(sql).run(...(params as never[])); },
      all: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as T[],
      transaction: async (fn) => {
        begun += 1;
        db.exec('begin');
        try { await fn(driver); db.exec('commit'); } catch (e) { db.exec('rollback'); throw e; }
      }
    };
    const s = await SqliteStore.open(driver);
    await s.putMany([{ event: ev('a', '1'), status: 'pending' }, { event: ev('b', '2'), status: 'pending' }]);
    expect(begun).toBe(1);
    expect((await s.pending('o', 'p')).length).toBe(2);
  });

  it('a commit that fails halfway leaves nothing behind (SQLite)', async () => {
    // Why: a phone can die between statements. A pull page's events and
    // the cursor past them must move together or not at all, or the next
    // pull would skip events the log does not have.
    const s = await SqliteStore.open(nodeDriver());
    await s.commit({ events: [{ event: ev('a', '1'), status: 'pending' }] });
    const bad = { ...ev('c', '3'), hlc: null as unknown as string };
    await expect(
      s.commit({ events: [{ event: ev('b', '2'), status: 'pending' }, { event: bad, status: 'pending' }], cursor: { orgId: 'o', streamId: 'p', seq: 5 }, meta: { k: 'v' } })
    ).rejects.toThrow();
    expect((await s.pending('o', 'p')).map((e) => e.event.id)).toEqual(['a']);
    expect(await s.cursor('o', 'p')).toBe(0);
    expect(await s.meta('k')).toBeUndefined();
  });
});


it('serializes shared-store mutations across streams and direct metadata writes', async () => {
  const db = nodeDriver();
  const original = db.transaction!;
  let active = 0;
  let maxActive = 0;
  db.transaction = async (fn) => {
    active++;
    maxActive = Math.max(active, maxActive);
    try {
      await new Promise((resolve) => setTimeout(resolve, 1));
      await original(fn);
    } finally { active--; }
  };
  const store = await SqliteStore.open(db);
  await Promise.all([
    store.put({ event: ev('one', '1'), status: 'pending' }),
    store.putMany([{ event: { ...ev('two', '2'), streamId: '_org' }, status: 'pending' }]),
    store.setMeta('journal', 'saved'),
    store.setCursor('o', 'p', 5),
    store.prune('o', 'p', 0)
  ]);
  expect(maxActive).toBe(1);
  expect(await store.meta('journal')).toBe('saved');
  expect(await store.pendingCount('o', 'p')).toBe(1);
  expect(await store.pendingCount('o', '_org')).toBe(1);
});

it('SQLite outbox pagination follows an event clock correction', async () => {
  const store = await SqliteStore.open(nodeDriver());
  await store.put({ event: ev('corrected', '9'), status: 'pending' });
  await store.put({ event: ev('middle', '5'), status: 'pending' });
  await store.put({ event: ev('corrected', '1'), status: 'pending' });
  expect((await store.pendingPage('o', 'p', null, 1)).map((l) => l.event.id)).toEqual(['corrected']);
  expect((await store.pendingPage('o', 'p', '1', 1)).map((l) => l.event.id)).toEqual(['middle']);
});
