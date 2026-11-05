/**
 * A language kept on disk (decisions.md 143, 147), which `bench:core` does
 * not reach: the synthetic language of `bench:core`, cut into the rows a
 * phone keeps, in node:sqlite, then the passage lines worked out for all of
 * it (`KeptLines.build`, what adopting a snapshot runs, and the same work an
 * app update owes every kept language). Each time is the median of several
 * runs. performance-audit-2026-10-26.md items 5 and 6.
 *
 *   npm run bench:kept
 *
 * Node on a laptop: compare runs with each other, not with a phone.
 */
import { DatabaseSync } from 'node:sqlite';
import { emptyLanguageState, foldLanguage } from '@langquest-next/core';
import { KeptLanguage } from '../../packages/sync/src/keptLanguage';
import { KeptLines } from '../../packages/sync/src/keptLines';
import { cutLanguage, keptRowsOf } from '../../packages/sync/src/serverCut';
import { SqliteStore, type SqlDriver } from '../../packages/sync/src/sqliteStore';
import { syntheticLanguage } from './synthetic';

const SIZES = [1200, 5000];
const RUNS = 3;

/** node:sqlite, the test twin of the app's expo-sqlite driver. */
function nodeDriver(): SqlDriver {
  const db = new DatabaseSync(':memory:');
  const driver: SqlDriver = {
    run: async (sql, params = []) => { db.prepare(sql).run(...(params as never[])); },
    all: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as T[],
    transaction: async (fn) => {
      db.exec('begin');
      try { await fn(driver); db.exec('commit'); } catch (e) { db.exec('rollback'); throw e; }
    }
  };
  return driver;
}

async function median(f: () => Promise<void>): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await f();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  return Math.round(times[Math.floor(RUNS / 2)]!);
}

for (const passages of SIZES) {
  const state = foldLanguage(syntheticLanguage(passages), emptyLanguageState());
  const cut = cutLanguage(state);
  const rows = cut.rows.flatMap((r) => keptRowsOf(r));
  const store = await SqliteStore.open(nodeDriver());
  await store.commit({ kept: { orgId: 'o', streamId: 'L1', upsert: rows } });
  const kept = new KeptLanguage(store, 'o', 'L1');
  const lines = new KeptLines(store, 'o', 'L1', kept, (b) => store.commit(b), () => cut.shared);
  const buildMs = await median(async () => { await lines.build(cut.shared, 'L1'); });
  console.log(`${passages} passages, ${rows.length} kept rows: every passage's line worked out from disk ${buildMs} ms`);
}
