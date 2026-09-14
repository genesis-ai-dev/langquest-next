import { SqliteStore, type SqlDriver } from '@langquest-next/client';
import * as SQLite from 'expo-sqlite';

/** expo-sqlite driver; the test twin lives in packages/client/test. */
function expoDriver(db: SQLite.SQLiteDatabase): SqlDriver {
  return {
    run: async (sql, params = []) => {
      await db.runAsync(sql, params as SQLite.SQLiteBindParams);
    },
    all: async <T,>(sql: string, params: unknown[] = []) =>
      db.getAllAsync<T>(sql, params as SQLite.SQLiteBindParams)
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
