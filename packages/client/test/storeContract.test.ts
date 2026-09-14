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
