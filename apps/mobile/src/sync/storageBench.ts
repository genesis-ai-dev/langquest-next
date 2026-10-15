// i18n-ignore-file: a developer benchmark, shown only in development builds.
/**
 * How long the device's event log takes to commit, with the driver as it
 * was (a connection per commit) and as it is (one write connection, kept
 * statements), on the phone itself (performance-audit.md item 1). Each runs
 * on a scratch database that is deleted after: 200 appends of one event,
 * then 4 pull pages of 500 events, each a commit. Run it from the
 * developer menu; the results show there and go to the Metro log as
 * `LQ_STORAGE_BENCH {...}`.
 */
import { SqliteStore, type SqlDriver } from '@langquest-next/sync';
import type { AnyEvent } from '@langquest-next/core';
import * as SQLite from 'expo-sqlite';
import { exclusiveTransactionDriver, openWriter, writeConnectionDriver } from './store';

export interface StorageBenchResult {
  driver: 'connection per commit' | 'one write connection';
  appendMsEach: number;
  pageMsEach: number;
  totalMs: number;
}

const event = (i: number): AnyEvent => ({
  id: `bench-${i}-${Math.random().toString(36).slice(2)}`, type: 'v1.UnitAdded', orgId: 'bench', streamId: 'bench',
  actorId: 'bench', deviceId: 'bench', hlc: `${String(1_700_000_000_000 + i).padStart(15, '0')}:000000:bench`,
  payload: { unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P ${i}`, order: `p${i}` }, serverSeq: i + 1
} as AnyEvent);

async function measure(name: StorageBenchResult['driver'], file: string, make: (db: SQLite.SQLiteDatabase) => Promise<{ driver: SqlDriver; close: () => Promise<void> }>): Promise<StorageBenchResult> {
  await SQLite.deleteDatabaseAsync(file).catch(() => {});
  const db = await SQLite.openDatabaseAsync(file);
  const { driver, close } = await make(db);
  try {
    const store = await SqliteStore.open(driver);
    let n = 0;
    const started = performance.now();
    for (let i = 0; i < 200; i++) await store.commit({ events: [{ event: event(n++), status: 'pending' }] });
    const appends = performance.now() - started;
    const pagesStarted = performance.now();
    for (let p = 0; p < 4; p++) {
      await store.commit({ events: Array.from({ length: 500 }, () => ({ event: event(n++), status: 'confirmed' as const })), cursor: { orgId: 'bench', streamId: 'bench', seq: n } });
    }
    const pages = performance.now() - pagesStarted;
    return { driver: name, appendMsEach: round(appends / 200), pageMsEach: round(pages / 4), totalMs: round(appends + pages) };
  } finally {
    await close();
    await db.closeAsync().catch(() => {});
    await SQLite.deleteDatabaseAsync(file).catch(() => {});
  }
}

export async function runStorageBench(): Promise<StorageBenchResult[]> {
  const results = [
    await measure('connection per commit', 'bench-per-commit.db', async (db) => ({ driver: exclusiveTransactionDriver(db), close: async () => {} })),
    await measure('one write connection', 'bench-one-writer.db', async (db) => {
      const writer = await openWriter('bench-one-writer.db');
      return { driver: writeConnectionDriver(db, writer), close: () => writer.closeAsync().catch(() => {}) };
    })
  ];
  console.log(`LQ_STORAGE_BENCH ${JSON.stringify(results)}`);
  return results;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
