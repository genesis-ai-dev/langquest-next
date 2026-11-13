vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-sqlite', () => ({}));

import type * as SQLite from 'expo-sqlite';
import { writeConnectionDriver } from '../src/storage/store';

/**
 * The phone's SQL driver (src/storage/store.ts) on expo-sqlite, against a stand-in for its
 * connections. expo-modules-core looks a shared object's id up in a table that the JavaScript
 * thread grows while expo-sqlite's queue reads it, without a lock (`SharedObjectRegistry`
 * `toNativeObject`), so a database or statement in use is now and then reported as "already
 * released" though it is not. Seen on an Android emulator with Share nearby running under the
 * Sync screen (E-QLI101, `sync inspect`). The lookup fails before the call's native body runs,
 * so the driver asks again; any other error, or the same one every time, still reaches the caller.
 */

const RACE = "Call to function 'NativeDatabase.prepareAsync' has been rejected.\n"
  + '→ Caused by: The 1st argument cannot be cast to type class expo.modules.sqlite.NativeDatabase (received class java.lang.Integer)\n'
  + '→ Caused by: Cannot use shared object that was already released';

/** A connection whose native calls fail as the race does at the given call numbers (from 1), before doing anything. */
function connection(log: string[], failing: (n: number) => Error | null) {
  let calls = 0;
  const native = async () => {
    const e = failing(++calls);
    if (e) throw e;
  };
  const statement = (sql: string) => ({
    executeAsync: async () => { await native(); log.push(`run ${sql}`); return { changes: 1, lastInsertRowId: 0 }; },
    finalizeAsync: async () => { await native(); }
  });
  const db = {
    prepareAsync: async (sql: string) => { await native(); return statement(sql); },
    // expo-sqlite's own convenience calls: prepare, run or read, finalize, each a native call.
    runAsync: async (sql: string) => {
      const st = await db.prepareAsync(sql);
      try { return await st.executeAsync(); } finally { await st.finalizeAsync(); }
    },
    getAllAsync: async (sql: string) => {
      const st = await db.prepareAsync(sql);
      try { await native(); log.push(`read ${sql}`); return [{ one: 1 }]; } finally { await st.finalizeAsync(); }
    },
    execAsync: async (sql: string) => { await native(); log.push(`exec ${sql}`); }
  };
  return db as unknown as SQLite.SQLiteDatabase;
}

const race = (...at: number[]) => (n: number) => (at.includes(n) ? new Error(RACE) : null);
const never = () => null;

describe('a lookup the race missed is asked again', () => {
  it('a read returns its rows', async () => {
    for (const at of [1, 2, 3]) {
      const log: string[] = [];
      const driver = writeConnectionDriver(connection(log, race(at)), connection([], never));
      await expect(driver.all('select 1 as one')).resolves.toEqual([{ one: 1 }]);
    }
  });

  it('a write runs once, whichever step missed', async () => {
    for (const at of [1, 2, 3]) {
      const log: string[] = [];
      const driver = writeConnectionDriver(connection(log, race(at)), connection([], never));
      await driver.run('insert into meta values (1)');
      expect(log, `call ${at}`).toEqual(['run insert into meta values (1)']);
    }
  });

  it('a commit begins, writes and commits once, and nothing is rolled back', async () => {
    // Calls on the write connection: BEGIN, prepare, execute, COMMIT.
    for (const at of [1, 2, 3, 4]) {
      const log: string[] = [];
      const driver = writeConnectionDriver(connection([], never), connection(log, race(at)));
      await driver.transaction(async (tx) => { await tx.run('insert into events values (1)'); });
      expect(log, `call ${at}`).toEqual(['exec BEGIN IMMEDIATE', 'run insert into events values (1)', 'exec COMMIT']);
    }
  });

  it('any other error, or the race every time, still reaches the caller', async () => {
    const log: string[] = [];
    const other = writeConnectionDriver(connection(log, (n) => (n === 1 ? new Error('no such table: meta') : null)), connection([], never));
    await expect(other.all('select * from meta')).rejects.toThrow('no such table');
    const always = writeConnectionDriver(connection(log, () => new Error(RACE)), connection([], never));
    await expect(always.all('select 1')).rejects.toThrow('already released');
    await expect(always.run('insert into meta values (1)')).rejects.toThrow('already released');
    expect(log).toEqual([]);
  });
});
