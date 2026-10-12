import type { SqlDriver } from './sqliteStore';

/** A file the store keeps: its name on disk is `<hash>.<format>`. */
export interface KeptFile {
  hash: string;
  format: string;
}

/** A file the device's file store held and then found gone, and when it noticed. */
export interface LostFile {
  hash: string;
  format: string;
  at: number;
}

/**
 * What the device's file store has kept, written down apart from the files
 * (decisions.md 92). Some phones sold in the field claim more storage than
 * they have and silently delete files once it runs out; the folder listing
 * alone cannot tell a file the phone threw away from one that was never
 * here. A file named here but missing from the folder was lost, and stays in
 * `lost_files` until someone has seen the alert.
 *
 * Nothing derives work from this: the upload and download lists still come
 * from the fold and the folder (PLAN.md section 14 rules 1 and 9). It only
 * remembers, so a disagreement with the folder is the signal, not a bug.
 */
export interface FileLedger {
  /** Every file written down as kept: hash to format. */
  kept(): Promise<Map<string, string>>;
  keep(files: readonly KeptFile[]): Promise<void>;
  /** The store deleted these itself: no alarm when they are gone. */
  forget(hashes: readonly string[]): Promise<void>;
  /** Move these from kept to lost, noticed at `at`. */
  markLost(hashes: readonly string[], at: number): Promise<void>;
  /** Losses nobody has seen yet. */
  lost(): Promise<LostFile[]>;
  /** The alert for these was seen. */
  clearLost(hashes: readonly string[]): Promise<void>;
}

/** Rows per statement: well under SQLite's oldest bound-parameter limit (999). */
const CHUNK = 400;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

const marks = (n: number, each = '?') => Array.from({ length: n }, () => each).join(',');

/**
 * The ledger in a SQLite file of its own, so its writes never wait on an
 * event commit. One row per file: tens of thousands of files cost a single
 * read at startup, and each change after that is a small batched write.
 */
export class SqliteFileLedger implements FileLedger {
  private constructor(private readonly db: SqlDriver) {}

  static async open(db: SqlDriver): Promise<SqliteFileLedger> {
    await db.run(`create table if not exists kept_files (hash text primary key, format text not null)`);
    await db.run(`create table if not exists lost_files (hash text primary key, format text not null, at integer not null)`);
    return new SqliteFileLedger(db);
  }

  private async atomically(fn: (tx: SqlDriver) => Promise<void>): Promise<void> {
    if (this.db.transaction) await this.db.transaction(fn);
    else await fn(this.db);
  }

  async kept(): Promise<Map<string, string>> {
    const rows = await this.db.all<KeptFile>(`select hash, format from kept_files`);
    return new Map(rows.map((r) => [r.hash, r.format]));
  }

  async keep(files: readonly KeptFile[]): Promise<void> {
    if (files.length === 0) return;
    await this.atomically(async (tx) => {
      for (const part of chunks(files)) {
        await tx.run(`insert into kept_files (hash, format) values ${marks(part.length, '(?, ?)')} on conflict(hash) do update set format = excluded.format`,
          part.flatMap((f) => [f.hash, f.format]));
      }
    });
  }

  async forget(hashes: readonly string[]): Promise<void> {
    if (hashes.length === 0) return;
    await this.atomically(async (tx) => {
      for (const part of chunks(hashes)) await tx.run(`delete from kept_files where hash in (${marks(part.length)})`, part);
    });
  }

  async markLost(hashes: readonly string[], at: number): Promise<void> {
    if (hashes.length === 0) return;
    await this.atomically(async (tx) => {
      for (const part of chunks(hashes)) {
        const list = marks(part.length);
        await tx.run(`insert or ignore into lost_files (hash, format, at) select hash, format, ? from kept_files where hash in (${list})`, [at, ...part]);
        await tx.run(`delete from kept_files where hash in (${list})`, part);
      }
    });
  }

  async lost(): Promise<LostFile[]> {
    return this.db.all<LostFile>(`select hash, format, at from lost_files order by at, hash`);
  }

  async clearLost(hashes: readonly string[]): Promise<void> {
    if (hashes.length === 0) return;
    await this.atomically(async (tx) => {
      for (const part of chunks(hashes)) await tx.run(`delete from lost_files where hash in (${marks(part.length)})`, part);
    });
  }
}

/** The ledger in memory, for tests. */
export class MemoryFileLedger implements FileLedger {
  readonly keptFiles = new Map<string, string>();
  readonly lostFiles = new Map<string, LostFile>();
  async kept(): Promise<Map<string, string>> { return new Map(this.keptFiles); }
  async keep(files: readonly KeptFile[]): Promise<void> { for (const f of files) this.keptFiles.set(f.hash, f.format); }
  async forget(hashes: readonly string[]): Promise<void> { for (const h of hashes) this.keptFiles.delete(h); }
  async markLost(hashes: readonly string[], at: number): Promise<void> {
    for (const hash of hashes) {
      const format = this.keptFiles.get(hash);
      if (format === undefined) continue;
      this.keptFiles.delete(hash);
      if (!this.lostFiles.has(hash)) this.lostFiles.set(hash, { hash, format, at });
    }
  }
  async lost(): Promise<LostFile[]> { return [...this.lostFiles.values()].sort((a, b) => a.at - b.at || (a.hash < b.hash ? -1 : 1)); }
  async clearLost(hashes: readonly string[]): Promise<void> { for (const h of hashes) this.lostFiles.delete(h); }
}
