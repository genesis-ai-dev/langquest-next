import { SqliteDiagStore, SqliteFileLedger, SqliteStore, type SqlDriver } from '@langquest-next/sync';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';
import { isTestBuild } from '../shell/testBuild';

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

/**
 * The driver as it was: every commit on a connection of its own, opened and
 * closed by expo's `withExclusiveTransactionAsync`, each statement prepared,
 * run and finalized. Kept for the storage benchmark (storageBench.ts) only.
 */
export function exclusiveTransactionDriver(db: SQLite.SQLiteDatabase): SqlDriver {
  return {
    ...statements(db),
    transaction: (fn) => db.withExclusiveTransactionAsync((txn) => fn({ ...statements(txn) }))
  };
}

/**
 * Statements on a connection, each prepared once and kept for the life of
 * the connection: running one is then one call across the bridge instead of
 * three (prepare, run, finalize).
 */
function preparedRun(db: SQLite.SQLiteDatabase): SqlDriver['run'] {
  const cache = new Map<string, Promise<SQLite.SQLiteStatement>>();
  return async (sql, params = []) => {
    let statement = cache.get(sql);
    if (!statement) {
      statement = db.prepareAsync(sql);
      cache.set(sql, statement);
      statement.catch(() => cache.delete(sql));
    }
    await (await statement).executeAsync(params as SQLite.SQLiteBindParams);
  };
}

/**
 * One transaction per commit batch: tens of thousands of events after a
 * month offline must not be one fsync each. Commits run one at a time on a
 * write connection of their own, opened once with the store's pragmas, so
 * nothing else can land inside a commit and be rolled back with it: expo
 * documents that `withTransactionAsync` lets unrelated queries in. Opening
 * a connection for every commit, as `withExclusiveTransactionAsync` does,
 * cost an open and a close per append and per pull page, and that
 * connection ran at SQLite's default `synchronous = full`
 * (performance-audit.md item 1). Reads stay on the main connection; WAL
 * lets them run while a commit writes.
 */
export function writeConnectionDriver(db: SQLite.SQLiteDatabase, writer: SQLite.SQLiteDatabase): SqlDriver {
  const tx: SqlDriver = { run: preparedRun(writer), all: statements(writer).all };
  let queue: Promise<unknown> = Promise.resolve();
  return {
    ...statements(db),
    transaction: (fn) => {
      const next = queue.then(async () => {
        await writer.execAsync('BEGIN IMMEDIATE');
        try {
          await fn(tx);
          await writer.execAsync('COMMIT');
        } catch (e) {
          await writer.execAsync('ROLLBACK').catch(() => {});
          throw e;
        }
      });
      queue = next.catch(() => {});
      return next;
    }
  };
}

/** A database's write connection, with the pragmas a connection does not inherit. */
export async function openWriter(name: string): Promise<SQLite.SQLiteDatabase> {
  const writer = await SQLite.openDatabaseAsync(name, { useNewConnection: true });
  await writer.execAsync('pragma journal_mode = wal; pragma synchronous = normal; pragma busy_timeout = 5000;');
  return writer;
}

/** expo-sqlite driver; the test twin lives in packages/sync/test. */
async function expoDriver(db: SQLite.SQLiteDatabase, name: string): Promise<SqlDriver> {
  if (Platform.OS === 'web') return webDriver(db);
  const writer = await openWriter(name);
  writers.set(name, writer);
  return writeConnectionDriver(db, writer);
}

let storePromise: Promise<SqliteStore> | undefined;
let diagPromise: Promise<SqliteDiagStore> | undefined;
let ledgerPromise: Promise<SqliteFileLedger> | undefined;
/** The open databases, so signing out on the web can close and delete them. */
const opened = new Map<string, SQLite.SQLiteDatabase>();
/** Their write connections (phones only). */
const writers = new Map<string, SQLite.SQLiteDatabase>();
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
  // On the web the event log opens first: a record written at start-up (a
  // sign-in record, before any screen) opened this at the same moment, and
  // expo-sqlite's file pool failed to open both.
  diagPromise ??= allowed
    .then(() => (Platform.OS === 'web' ? getStore().then(() => undefined, () => undefined) : undefined))
    .then(() => open('langquest-diagnostics.db'))
    .then(async (db) => SqliteDiagStore.open(await expoDriver(db, 'langquest-diagnostics.db')))
    .catch((error: unknown) => { diagPromise = undefined; throw error; });
  return diagPromise;
}

/**
 * What the file store has kept (blobs.ts, decisions.md 92). Its own file
 * too, so writing down a downloaded file never waits on an event commit.
 * Only the file store opens it, and only on a phone: a browser's SQLite
 * keeps at most six files open (expo-sqlite's access handle pool), which
 * the two databases above already fill, so a third makes the web fail to
 * open its storage at all.
 */
export function getFileLedger(): Promise<SqliteFileLedger> {
  ledgerPromise ??= allowed.then(() => open('langquest-files.db'))
    .then(async (db) => SqliteFileLedger.open(await expoDriver(db, 'langquest-files.db')))
    .catch((error: unknown) => { ledgerPromise = undefined; throw error; });
  return ledgerPromise;
}

/** One local event log per device, shared by every stream this phone syncs. */
export function getStore(): Promise<SqliteStore> {
  storePromise ??= allowed.then(() => open('langquest-next.db')).then(async (db) => {
    const driver = await expoDriver(db, 'langquest-next.db');
    const store = await SqliteStore.open(driver);
    // The web UI suite reads the device log directly (e2e/ui, web dev
    // and local-stack exports only (testBuild.ts)). Installed once the schema exists, so its presence means ready.
    if (isTestBuild() && Platform.OS === 'web') (globalThis as { __langquestLog?: unknown }).__langquestLog = {
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
    await writers.get(name)?.closeAsync().catch(() => undefined);
    writers.delete(name);
    await opened.get(name)?.closeAsync().catch(() => undefined);
    opened.delete(name);
    await SQLite.deleteDatabaseAsync(name);
  }
}
