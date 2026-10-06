import { SqliteDiagStore, SqliteStore, type SqlDriver } from '@langquest-next/client';
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
let diagPromise: Promise<SqliteDiagStore> | undefined;
/** The open databases, so signing out on the web can close and delete them. */
const opened = new Map<string, SQLite.SQLiteDatabase>();
const open = (name: string) => SQLite.openDatabaseAsync(name).then((db) => { opened.set(name, db); return db; });

/**
 * On the web nothing may open SQLite before this tab holds the database
 * (webGate.tsx): expo-sqlite's file pool claims its handles for the life of
 * the page, so one opened in a second tab fails, and that tab's database
 * stays broken until it reloads. Phones open at once.
 */
let allow: () => void = () => {};
const allowed: Promise<void> = Platform.OS === 'web' ? new Promise((resolve) => { allow = resolve; }) : Promise.resolve();
export function allowStorage(): void {
  allow();
}

const failureListeners = new Set<(error: unknown) => void>();
/** Hear when the device's storage could not be opened; the next `getStore` tries again. */
export function onStoreFailure(listener: (error: unknown) => void): () => void {
  failureListeners.add(listener);
  return () => failureListeners.delete(listener);
}
function failed<T>(forget: () => void) {
  return (error: unknown): Promise<T> => {
    forget();
    for (const l of failureListeners) l(error);
    throw error;
  };
}

/**
 * Field diagnostics waiting for delivery (diagnostics.ts). Their own file:
 * a diagnostics write must never hold a lock an event commit is waiting for.
 */
export function getDiagStore(): Promise<SqliteDiagStore> {
  // Diagnostics fail quietly (diagnostics.ts); only the event log tells the screen.
  diagPromise ??= allowed.then(() => open('langquest-diagnostics.db')).then((db) => SqliteDiagStore.open(expoDriver(db)))
    .catch((error: unknown) => { diagPromise = undefined; throw error; });
  return diagPromise;
}

/** One local event log per device, shared by every stream this phone syncs. */
export function getStore(): Promise<SqliteStore> {
  storePromise ??= allowed.then(() => open('langquest-next.db')).then(async (db) => {
    const driver = expoDriver(db);
    const store = await SqliteStore.open(driver);
    // The journey oracle reads the device log directly (smart tests, web dev
    // only). Installed once the schema exists, so its presence means ready.
    if (__DEV__ && Platform.OS === 'web') (globalThis as { __langquestLog?: unknown }).__langquestLog = {
      select: (sql: string, params?: unknown[]) => {
        if (!/^\s*select\b/i.test(sql)) throw new Error('__langquestLog is read-only.');
        return driver.all(sql, params);
      }
    };
    return store;
  }).catch(failed<SqliteStore>(() => { storePromise = undefined; }));
  return storePromise;
}

/**
 * Web only, signing out on a shared computer (decisions.md 11, amended):
 * close and delete both databases. Callers reload the page afterwards, so
 * nothing holds a handle to what was closed.
 */
export async function deleteLocalDatabases(): Promise<void> {
  storePromise = undefined;
  diagPromise = undefined;
  for (const name of ['langquest-next.db', 'langquest-diagnostics.db']) {
    await opened.get(name)?.closeAsync().catch(() => undefined);
    opened.delete(name);
    await SQLite.deleteDatabaseAsync(name);
  }
}
