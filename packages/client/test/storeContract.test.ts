import { DatabaseSync } from 'node:sqlite';
import type { AnyEvent, PassageRow } from '@langquest-next/core';
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

function row(unitId: string, laneId: string, order: string): PassageRow {
  return { unitId, laneId, order, label: unitId, takeId: null, outcome: null, submitted: false, cardCount: 0, steps: [], assignees: [] };
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
    // A warm checkpoint reads its tail without hiding pending work.
    expect((await s.all('o', 'p', 1)).map((e) => e.event.id).sort()).toEqual(['a', 'b']);
    expect((await s.get('x'))?.rejectReason).toBe('no');
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

  it('commit writes events, cursor, meta, and rows together; rows page in display order', async () => {
    // Why: the single writer's promise is that one batch is one durable
    // step. The rows a screen reads must come from the same commit as the
    // events that produced them.
    const s = await make();
    await s.commit({
      events: [{ event: ev('a', '1'), status: 'pending' }],
      cursor: { orgId: 'o', projectId: 'p', seq: 9 },
      meta: { k: 'v' },
      rows: { orgId: 'o', projectId: 'p', put: [row('u2', 'L1', 'b'), row('u1', 'L1', 'a'), row('u1', 'L2', 'a'), row('u3', 'L1', 'c')] }
    });
    expect((await s.pending('o', 'p')).map((e) => e.event.id)).toEqual(['a']);
    expect(await s.cursor('o', 'p')).toBe(9);
    expect(await s.meta('k')).toBe('v');
    expect((await s.passage('o', 'p', 'u1', 'L2'))?.laneId).toBe('L2');
    const first = await s.passages('o', 'p', { limit: 2 });
    expect(first.map((r) => `${r.unitId}:${r.laneId}`)).toEqual(['u1:L1', 'u1:L2']);
    const last = first[first.length - 1]!;
    const rest = await s.passages('o', 'p', { after: { order: last.order, unitId: last.unitId, laneId: last.laneId }, limit: 10 });
    expect(rest.map((r) => `${r.unitId}:${r.laneId}`)).toEqual(['u2:L1', 'u3:L1']);
    expect((await s.passages('o', 'p', { laneId: 'L1', limit: 10 })).map((r) => r.unitId)).toEqual(['u1', 'u2', 'u3']);
    await s.commit({ rows: { orgId: 'o', projectId: 'p', delete: [{ unitId: 'u3', laneId: 'L1' }] } });
    expect(await s.passage('o', 'p', 'u3', 'L1')).toBeUndefined();
    await s.commit({ rows: { orgId: 'o', projectId: 'p', clear: true, put: [row('u9', 'L1', 'z')] } });
    expect((await s.passages('o', 'p', { limit: 10 })).map((r) => r.unitId)).toEqual(['u9']);
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
  it('legacy prune cannot delete raw events', async () => {
    const s = await make();
    await s.put({ event: ev('a', '1', 1), status: 'confirmed' });
    await s.put({ event: ev('b', '2', 2), status: 'confirmed' });
    await s.put({ event: ev('c', '3', 3), status: 'confirmed' });
    await s.put({ event: ev('p', '4'), status: 'pending' });
    await s.put({ event: ev('x', '5'), status: 'rejected', rejectReason: 'no' });
    await s.prune('o', 'p', 2);
    expect((await s.all('o', 'p')).map((e) => e.event.id).sort()).toEqual(['a', 'b', 'c', 'p']);
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
        try { await fn(driver); db.exec('commit'); } catch (e) { db.exec('rollback'); throw e; }
      }
    };
    const s = await SqliteStore.open(driver);
    await s.putMany([{ event: ev('a', '1'), status: 'pending' }, { event: ev('b', '2'), status: 'pending' }]);
    expect(begun).toBe(1);
    expect((await s.pending('o', 'p')).length).toBe(2);
  });

  it('a commit that fails halfway leaves nothing behind (SQLite)', async () => {
    // Why: a phone can die between statements. The log and the rows must
    // move together or not at all, or a screen could show a take the log
    // does not have.
    const s = await SqliteStore.open(nodeDriver());
    await s.commit({ events: [{ event: ev('a', '1'), status: 'pending' }] });
    const bad = { ...row('u1', 'L1', 'a'), order: null as unknown as string };
    await expect(
      s.commit({ events: [{ event: ev('b', '2'), status: 'pending' }], cursor: { orgId: 'o', projectId: 'p', seq: 5 }, rows: { orgId: 'o', projectId: 'p', put: [bad] } })
    ).rejects.toThrow();
    expect((await s.pending('o', 'p')).map((e) => e.event.id)).toEqual(['a']);
    expect(await s.cursor('o', 'p')).toBe(0);
    expect(await s.passages('o', 'p', { limit: 10 })).toEqual([]);
  });
});


it('serializes shared-store mutations across partitions and direct metadata writes', async () => {
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
    store.putMany([{ event: { ...ev('two', '2'), projectId: '_org' }, status: 'pending' }]),
    store.setMeta('journal', 'saved'),
    store.setCursor('o', 'p', 5),
    store.prune('o', 'p', 0)
  ]);
  expect(maxActive).toBe(1);
  expect(await store.meta('journal')).toBe('saved');
  expect(await store.pendingCount('o', 'p')).toBe(1);
  expect(await store.pendingCount('o', '_org')).toBe(1);
});

it('SQLite task filters page individual tasks and maintain progress totals', async () => {
  const store = await SqliteStore.open(nodeDriver());
  const submitted: PassageRow = { ...row('u1', 'L1', 'a'), takeId: 'take',
    submitted: true, outcome: 'approved', steps: [
      { stepId: 'a', eligible: ['reviewer'], decided: [] },
      { stepId: 'b', eligible: ['reviewer'], decided: ['reviewer'] }
    ] };
  await store.commit({ rows: { orgId: 'o', projectId: 'p', put: [submitted,
    ...Array.from({ length: 500 }, (_, i) => row(`unused${i}`, 'L1', `z${i}`))] } });
  const query = { actorId: 'reviewer', translate: false, limit: 1 };
  const first = await store.taskPage('o', 'p', query);
  expect(first.map((r) => r.taskId)).toEqual(['review:u1:L1:a']);
  const next = await store.taskPage('o', 'p', { ...query,
    after: { order: 'a', unitId: 'u1', laneId: 'L1', taskId: first[0]!.taskId } });
  expect(next.map((r) => r.taskId)).toEqual(['review:u1:L1:b']);
  expect((await store.taskPage('o', 'p', { ...query, status: ['done'], laneId: 'L1' })).map((r) => r.taskId))
    .toEqual(['review:u1:L1:b']);
  expect(await store.taskPage('o', 'p', { ...query, status: [] })).toEqual([]);
  expect(await store.laneCounts('o', 'p', 'L1')).toEqual({ passages: 501, translated: 1, approved: 1 });
  await store.commit({ rows: { orgId: 'o', projectId: 'p', put: [{ ...submitted, outcome: 'in_review' }] } });
  expect(await store.laneCounts('o', 'p', 'L1')).toEqual({ passages: 501, translated: 1, approved: 0 });
  await store.commit({ rows: { orgId: 'o', projectId: 'p', delete: [{ unitId: 'u1', laneId: 'L1' }] } });
  expect(await store.laneCounts('o', 'p', 'L1')).toEqual({ passages: 500, translated: 0, approved: 0 });
  expect(await store.taskPage('o', 'p', query)).toEqual([]);
  await store.commit({ rows: { orgId: 'o', projectId: 'p', clear: true, put: [submitted] } });
  expect(await store.laneCounts('o', 'p', 'L1')).toEqual({ passages: 1, translated: 1, approved: 1 });
});


it('filtered SQLite task lookup uses task indexes, not passage scans', async () => {
  const db = nodeDriver();
  const all = db.all.bind(db);
  let plan: string[] = [];
  db.all = async <T,>(sql: string, params: unknown[] = []) => {
    if (sql.includes('select p.json, t.task_id')) {
      plan = (await all<{ detail: string }>(`explain query plan ${sql}`, params)).map((r) => r.detail);
    }
    return all<T>(sql, params);
  };
  const store = await SqliteStore.open(db);
  await store.commit({ rows: { orgId: 'o', projectId: 'p', put: [row('u', 'lane', 'a')] } });
  await store.taskPage('o', 'p', { actorId: 'actor', translate: true,
    status: ['todo', 'doing'], laneId: 'lane', limit: 20 });
  expect(plan.some((line) => line.includes('SEARCH task_rows') && line.includes('task_rows_lane_status'))).toBe(true);
  expect(plan.some((line) => line.includes('SCAN task_rows'))).toBe(false);
});


it('SQLite outbox pagination follows an event clock correction', async () => {
  const store = await SqliteStore.open(nodeDriver());
  await store.put({ event: ev('corrected', '9'), status: 'pending' });
  await store.put({ event: ev('middle', '5'), status: 'pending' });
  await store.put({ event: ev('corrected', '1'), status: 'pending' });
  expect((await store.pendingPage('o', 'p', null, 1)).map((l) => l.event.id)).toEqual(['corrected']);
  expect((await store.pendingPage('o', 'p', '1', 1)).map((l) => l.event.id)).toEqual(['middle']);
});
