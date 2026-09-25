import { SqliteStore, type SqlDriver } from '@langquest-next/client';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

/** Statements on one connection: the database, or a transaction's own connection. */
function statements(db: SQLite.SQLiteDatabase): Pick<SqlDriver, 'run' | 'all'> {
  return {
    run: async (sql, params = []) => {
      await db.runAsync(sql, params as SQLite.SQLiteBindParams);
    },
    all: async <T,>(sql: string, params: unknown[] = []) =>
      db.getAllAsync<T>(sql, params as SQLite.SQLiteBindParams)
  };
}

/**
 * Web (a test target) has no exclusive transaction, so the same guarantee
 * comes from a lock: while a batch is open, outer statements wait, and only
 * the batch's own statements (on `tx`) reach the connection.
 */
function webDriver(db: SQLite.SQLiteDatabase): SqlDriver {
  const raw = statements(db);
  let lock: Promise<unknown> = Promise.resolve();
  const exclusive = <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = lock.then(fn, fn);
    lock = next.catch(() => {});
    return next;
  };
  // The journey oracle reads the device log directly (smart tests, dev only).
  if (__DEV__) (globalThis as { __langquestLog?: unknown }).__langquestLog = {
    select: (sql: string, params?: unknown[]) => {
      if (!/^\s*select\b/i.test(sql)) throw new Error('__langquestLog is read-only.');
      return exclusive(() => raw.all(sql, params));
    }
  };
  return {
    run: (sql, params) => exclusive(() => raw.run(sql, params)),
    all: <T,>(sql: string, params?: unknown[]) => exclusive(() => raw.all<T>(sql, params)),
    transaction: (fn) => exclusive(async () => {
      await raw.run('BEGIN IMMEDIATE');
      try { await fn(raw); } catch (e) { await raw.run('ROLLBACK'); throw e; }
      await raw.run('COMMIT');
    })
  };
}

/** expo-sqlite driver; the test twin lives in packages/client/test. */
function expoDriver(db: SQLite.SQLiteDatabase): SqlDriver {
  if (Platform.OS === 'web') return webDriver(db);
  return {
    ...statements(db),
    // One transaction per commit batch: tens of thousands of events after a
    // month offline must not be one fsync each. Exclusive, on its own
    // connection: expo documents that `withTransactionAsync` lets unrelated
    // concurrent queries run inside the transaction, so a blob-store read
    // or a pending count could otherwise land in a commit and be rolled
    // back with it. The batch's statements run on `txn`, nothing else does.
    transaction: (fn) => db.withExclusiveTransactionAsync((txn) => fn({ ...statements(txn) }))
  };
}

let storePromise: Promise<SqliteStore> | undefined;

/** One local event log per device, shared by every open project. */
export function getStore(): Promise<SqliteStore> {
  storePromise ??= SQLite.openDatabaseAsync('langquest-next.db').then((db) =>
    SqliteStore.open(expoDriver(db))
  );
  return storePromise;
}
