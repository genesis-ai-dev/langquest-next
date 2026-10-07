import { DatabaseSync } from 'node:sqlite';
import type { AnyEvent } from '@langquest-next/core';
import { MemoryStore } from '../src/memoryStore';
import { SqliteStore, type SqlDriver } from '../src/sqliteStore';
import type { EventStore } from '../src/types';

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
    expect((await s.all('o', 'p')).map((e) => e.event.id).sort()).toEqual(['a', 'b']);
    expect((await s.rejected('o', 'p')).map((e) => e.event.id)).toEqual(['x', 'y']);
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
