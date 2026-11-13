import type { NearbyGroup, NearbyMark } from '@langquest-next/core/nearby';
import type { SqlDriver } from './sqliteStore';

/**
 * The file ledger's nearby marks (docs/nearby-sync-plan.md 5.6): one row for each file that
 * landed over a link from a teammate's phone, in a table beside `kept_files` and `lost_files` in
 * the ledger's own database. A nearby file is marked, never inferred: the store knows a file
 * only by its hash, and an unconfirmed file here could be anyone's, so no mark means protected.
 * That keeps a shared phone's recordings safe, and nothing a teammate's phone sends can make
 * this phone's own file deletable.
 *
 * A row names the language whose session marked it, the file's group and its known copies,
 * kept current by that language's session when it runs, so any session can free another
 * language's level 2 files from the mark alone. The store is global by hash, so this could
 * delete a file a second language also names; that is rare and accepted.
 *
 * Here and not in `fileLedger.ts`, which every client carries: the web shares nothing nearby
 * (decision 58), and its bundle has no room for what it would never run.
 */
export interface NearbyMarks {
  all(): Promise<NearbyMark[]>;
  /** Write these marks, replacing any for the same hashes. */
  put(marks: readonly NearbyMark[]): Promise<void>;
  /** The server confirmed these, or the store deleted them: no longer nearby files. */
  drop(hashes: readonly string[]): Promise<void>;
}

const GROUPS: readonly NearbyGroup[] = ['needed', 'review', 'backup', 'unnamed'];
const CHUNK = 150;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

const places = (n: number, each = '?') => Array.from({ length: n }, () => each).join(',');

/** A row as read back, or null for one this build cannot read, which then counts as unmarked and so protected. */
function markOf(r: { hash: unknown; format: unknown; language_id: unknown; grp: unknown; copies: unknown }): NearbyMark | null {
  const group = GROUPS.find((g) => g === r.grp);
  if (typeof r.hash !== 'string' || typeof r.format !== 'string' || typeof r.language_id !== 'string' || !group) return null;
  const copies = typeof r.copies === 'number' && Number.isSafeInteger(r.copies) && r.copies >= 0 ? r.copies : 0;
  return { hash: r.hash, format: r.format, languageId: r.language_id, group, copies };
}

export class SqliteNearbyMarks implements NearbyMarks {
  private constructor(private readonly db: SqlDriver) {}

  /** In the ledger's database (`SqliteFileLedger`), so a mark and the file it names are written down together. */
  static async open(db: SqlDriver): Promise<SqliteNearbyMarks> {
    await db.run(`create table if not exists nearby_files (hash text primary key, format text not null, language_id text not null, grp text not null, copies integer not null)`);
    return new SqliteNearbyMarks(db);
  }

  private async atomically(fn: (tx: SqlDriver) => Promise<void>): Promise<void> {
    if (this.db.transaction) await this.db.transaction(fn);
    else await fn(this.db);
  }

  async all(): Promise<NearbyMark[]> {
    const rows = await this.db.all<{ hash: string; format: string; language_id: string; grp: string; copies: number }>(`select hash, format, language_id, grp, copies from nearby_files`);
    return rows.map(markOf).filter((m): m is NearbyMark => m !== null);
  }

  async put(marks: readonly NearbyMark[]): Promise<void> {
    if (marks.length === 0) return;
    await this.atomically(async (tx) => {
      for (const part of chunks(marks)) {
        await tx.run(
          `insert into nearby_files (hash, format, language_id, grp, copies) values ${places(part.length, '(?, ?, ?, ?, ?)')}
           on conflict(hash) do update set format = excluded.format, language_id = excluded.language_id, grp = excluded.grp, copies = excluded.copies`,
          part.flatMap((m) => [m.hash, m.format, m.languageId, m.group, m.copies])
        );
      }
    });
  }

  async drop(hashes: readonly string[]): Promise<void> {
    if (hashes.length === 0) return;
    await this.atomically(async (tx) => {
      for (const part of chunks(hashes)) await tx.run(`delete from nearby_files where hash in (${places(part.length)})`, part);
    });
  }
}

/** The marks in memory, for tests and the fleet. */
export class MemoryNearbyMarks implements NearbyMarks {
  readonly rows = new Map<string, NearbyMark>();
  async all(): Promise<NearbyMark[]> { return [...this.rows.values()].map((m) => ({ ...m })); }
  async put(marks: readonly NearbyMark[]): Promise<void> { for (const m of marks) this.rows.set(m.hash, { ...m }); }
  async drop(hashes: readonly string[]): Promise<void> { for (const h of hashes) this.rows.delete(h); }
}
