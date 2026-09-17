import { SqliteStore, type SqlDriver } from '@langquest-next/client';
import * as SQLite from 'expo-sqlite';

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

/** expo-sqlite driver; the test twin lives in packages/client/test. */
function expoDriver(db: SQLite.SQLiteDatabase): SqlDriver {
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
