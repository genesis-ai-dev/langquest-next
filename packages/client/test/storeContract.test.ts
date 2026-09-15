import { DatabaseSync } from 'node:sqlite';
import type { AnyEvent } from '@langquest-next/core';
import { MemoryStore } from '../src/memoryStore';
import { SqliteStore, type SqlDriver } from '../src/sqliteStore';
import type { EventStore } from '../src/types';

/** node:sqlite driver, the test twin of the expo-sqlite driver in apps/mobile. */
function nodeDriver(): SqlDriver {
  const db = new DatabaseSync(':memory:');
  return {
    run: async (sql, params = []) => {
      db.prepare(sql).run(...(params as never[]));
    },
    all: async <T,>(sql: string, params: unknown[] = []) =>
      db.prepare(sql).all(...(params as never[])) as T[]
  };
}

function ev(id: string, hlc: string, serverSeq?: number): AnyEvent {
  return {
    id,
    type: 'v1.LaneAdded',
    orgId: 'o',
    projectId: 'p',
    actorId: 'a',
    deviceId: 'd',
    hlc,
    payload: { laneId: id, languoidId: 'x' },
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
  it('pending returns only pending, oldest first; all excludes rejected', async () => {
    const s = await make();
    await s.put({ event: ev('b', '2'), status: 'pending' });
    await s.put({ event: ev('a', '1'), status: 'pending' });
    await s.put({ event: ev('c', '3', 1), status: 'confirmed' });
    await s.put({ event: ev('x', '4'), status: 'rejected', rejectReason: 'no' });
    expect((await s.pending('o', 'p')).map((e) => e.event.id)).toEqual(['a', 'b']);
    expect((await s.all('o', 'p')).map((e) => e.event.id).sort()).toEqual(['a', 'b', 'c']);
    expect((await s.get('x'))?.rejectReason).toBe('no');
  });

  it('put is an upsert by id, so a confirm replaces the pending row', async () => {
    const s = await make();
    await s.put({ event: ev('a', '1'), status: 'pending' });
    await s.put({ event: ev('a', '1', 7), status: 'confirmed' });
    expect((await s.pending('o', 'p')).length).toBe(0);
    expect((await s.get('a'))?.event.serverSeq).toBe(7);
  });

  it('cursor defaults to 0 and persists per partition', async () => {
    const s = await make();
    expect(await s.cursor('o', 'p')).toBe(0);
    await s.setCursor('o', 'p', 42);
    await s.setCursor('o', 'q', 5);
    expect(await s.cursor('o', 'p')).toBe(42);
    expect(await s.cursor('o', 'q')).toBe(5);
  });

  it('partitions do not leak into each other', async () => {
    const s = await make();
    await s.put({ event: { ...ev('a', '1'), projectId: 'other' }, status: 'pending' });
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
});

describe.each(impls)('%s batch and rejected contract', (_name, make) => {
  it('putMany upserts every row and rejected() lists refusals oldest first per partition', async () => {
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
      { event: { ...ev('z', '5'), projectId: 'other' }, status: 'rejected', rejectReason: 'no' }
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
        try { await fn(); db.exec('commit'); } catch (e) { db.exec('rollback'); throw e; }
      }
    };
    const s = await SqliteStore.open(driver);
    await s.putMany([{ event: ev('a', '1'), status: 'pending' }, { event: ev('b', '2'), status: 'pending' }]);
    expect(begun).toBe(1);
    expect((await s.pending('o', 'p')).length).toBe(2);
  });
});
