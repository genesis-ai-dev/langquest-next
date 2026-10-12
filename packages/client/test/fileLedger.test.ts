import { DatabaseSync } from 'node:sqlite';
import { MemoryFileLedger, SqliteFileLedger, type FileLedger } from '../src/fileLedger';
import type { SqlDriver } from '../src/sqliteStore';

/** node:sqlite driver, the test twin of the expo-sqlite driver in apps/mobile, with transactions. */
function nodeDriver(): SqlDriver {
  const db = new DatabaseSync(':memory:');
  const driver: SqlDriver = {
    run: async (sql, params = []) => { db.prepare(sql).run(...(params as never[])); },
    all: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as T[],
    transaction: async (fn) => {
      db.exec('begin');
      try { await fn(driver); } catch (e) { db.exec('rollback'); throw e; }
      db.exec('commit');
    }
  };
  return driver;
}

const hash = (n: number) => n.toString(16).padStart(64, '0');

// What the file store has kept, written down apart from the files (decisions.md 87).
for (const [name, make] of [['SQLite', async () => SqliteFileLedger.open(nodeDriver())], ['memory', async () => new MemoryFileLedger()]] as const) {
  describe(`the file ledger (${name})`, () => {
    let ledger: FileLedger;
    beforeEach(async () => { ledger = await make(); });

    it('remembers what was kept and forgets what the store deleted itself', async () => {
      await ledger.keep([{ hash: hash(1), format: 'wav' }, { hash: hash(2), format: 'm4a' }]);
      await ledger.keep([{ hash: hash(1), format: 'wav' }]);
      expect(await ledger.kept()).toEqual(new Map([[hash(1), 'wav'], [hash(2), 'm4a']]));
      await ledger.forget([hash(1)]);
      expect([...(await ledger.kept()).keys()]).toEqual([hash(2)]);
      expect(await ledger.lost()).toEqual([]);
    });

    it('moves lost files out of kept until the alert is seen, keeping when each was noticed', async () => {
      await ledger.keep([{ hash: hash(1), format: 'wav' }, { hash: hash(2), format: 'mp3' }, { hash: hash(3), format: 'm4a' }]);
      await ledger.markLost([hash(2)], 100);
      await ledger.markLost([hash(3), hash(2)], 200);
      expect([...(await ledger.kept()).keys()]).toEqual([hash(1)]);
      expect(await ledger.lost()).toEqual([{ hash: hash(2), format: 'mp3', at: 100 }, { hash: hash(3), format: 'm4a', at: 200 }]);
      // Lost and then downloaded again: kept again, and the alert still says it was lost.
      await ledger.keep([{ hash: hash(2), format: 'mp3' }]);
      expect((await ledger.lost()).map((l) => l.hash)).toEqual([hash(2), hash(3)]);
      await ledger.clearLost([hash(2), hash(3)]);
      expect(await ledger.lost()).toEqual([]);
    });

    it('a file it never kept cannot be lost', async () => {
      await ledger.markLost([hash(9)], 100);
      expect(await ledger.lost()).toEqual([]);
    });

    it('takes tens of thousands of files in one go', async () => {
      const many = Array.from({ length: 2500 }, (_, i) => ({ hash: hash(i), format: 'wav' }));
      await ledger.keep(many);
      expect((await ledger.kept()).size).toBe(2500);
      await ledger.markLost(many.slice(0, 1200).map((f) => f.hash), 5);
      expect((await ledger.kept()).size).toBe(1300);
      expect((await ledger.lost()).length).toBe(1200);
      await ledger.forget(many.map((f) => f.hash));
      await ledger.clearLost(many.map((f) => f.hash));
      expect((await ledger.kept()).size).toBe(0);
      expect(await ledger.lost()).toEqual([]);
    });
  });
}
