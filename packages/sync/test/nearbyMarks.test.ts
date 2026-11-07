import { DatabaseSync } from 'node:sqlite';
import type { NearbyMark } from '@langquest-next/core/nearby';
import { MemoryNearbyMarks, SqliteNearbyMarks, type NearbyMarks } from '../src/nearbyMarks';
import { SqliteFileLedger } from '../src/fileLedger';
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
const mark = (n: number, over: Partial<NearbyMark> = {}): NearbyMark => ({ hash: hash(n), format: 'm4a', languageId: 'luke', group: 'backup', copies: 0, ...over });
const sorted = (marks: NearbyMark[]) => [...marks].sort((a, b) => (a.hash < b.hash ? -1 : 1));

// The ledger's nearby marks (docs/nearby-sync-plan.md 5.6), on both stores.
for (const [name, make] of [
  ['SQLite', async () => { const db = nodeDriver(); await SqliteFileLedger.open(db); return SqliteNearbyMarks.open(db); }],
  ['memory', async () => new MemoryNearbyMarks()]
] as const) {
  describe(`nearby marks (${name})`, () => {
    let marks: NearbyMarks;
    beforeEach(async () => { marks = await make(); });

    it('keeps one mark per file, the newest group and copies replacing the old', async () => {
      await marks.put([mark(1), mark(2, { group: 'review', copies: 2, languageId: 'mark' })]);
      await marks.put([mark(1, { group: 'needed', copies: 3 })]);
      expect(sorted(await marks.all())).toEqual([mark(1, { group: 'needed', copies: 3 }), mark(2, { group: 'review', copies: 2, languageId: 'mark' })]);
    });

    it('drops marks, and many at once', async () => {
      const many = Array.from({ length: 450 }, (_, i) => mark(i + 1));
      await marks.put(many);
      expect(await marks.all()).toHaveLength(450);
      await marks.drop(many.slice(0, 400).map((m) => m.hash));
      expect(sorted(await marks.all())).toEqual(many.slice(400));
      await marks.drop([]);
      await marks.put([]);
      expect(await marks.all()).toHaveLength(50);
    });
  });
}

it('a row this build cannot read counts as no mark, and so as protected', async () => {
  const db = nodeDriver();
  const marks = await SqliteNearbyMarks.open(db);
  await db.run(`insert into nearby_files (hash, format, language_id, grp, copies) values (?, ?, ?, ?, ?)`, [hash(1), 'm4a', 'luke', 'someday', 0]);
  await marks.put([mark(2)]);
  expect(await marks.all()).toEqual([mark(2)]);
});
