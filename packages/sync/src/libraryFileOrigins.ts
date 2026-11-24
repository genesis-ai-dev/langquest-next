import type { SqlDriver } from './sqliteStore';

/**
 * The library files this phone knows came from the library (docs/nearby-sync-plan.md 5.12, Library
 * files; security review 2026-11-24): fetched from the organization's guide files, uploaded from the
 * guide editor, downloaded as a library source's chapter, or taken from a teammate's phone as a
 * library file. A phone passes on a file as a library file only if it is here, so a document that
 * names a recording's hash, a redacted one, another language's unsent one, or Bible Brain's audio,
 * never makes it hand that file to a teammate: none of them ever came this way. A file from before
 * this record began is not here, and is passed on once it is fetched again.
 */
export interface LibraryFileOrigins {
  /** Of these hashes, the ones known to have come from the library. */
  has(hashes: readonly string[]): Promise<Set<string>>;
  add(hashes: readonly string[]): Promise<void>;
}

/** Rows per statement, well under SQLite's oldest bound-parameter limit (999). */
const CHUNK = 400;
const HASH = /^[0-9a-f]{64}$/;

/** In the file ledger's database, beside the nearby marks. */
export class SqliteLibraryFileOrigins implements LibraryFileOrigins {
  private constructor(private readonly db: SqlDriver) {}

  static async open(db: SqlDriver): Promise<SqliteLibraryFileOrigins> {
    await db.run(`create table if not exists library_files (hash text primary key)`);
    return new SqliteLibraryFileOrigins(db);
  }

  async has(hashes: readonly string[]): Promise<Set<string>> {
    const out = new Set<string>();
    const all = [...new Set(hashes.filter((h) => HASH.test(h)))];
    for (let i = 0; i < all.length; i += CHUNK) {
      const rows = await this.db.all<{ hash: string }>(`select hash from library_files where hash in (select value from json_each(?))`, [JSON.stringify(all.slice(i, i + CHUNK))]);
      for (const r of rows) out.add(r.hash);
    }
    return out;
  }

  async add(hashes: readonly string[]): Promise<void> {
    const all = [...new Set(hashes.filter((h) => HASH.test(h)))];
    for (let i = 0; i < all.length; i += CHUNK) {
      await this.db.run(`insert or ignore into library_files (hash) select value from json_each(?)`, [JSON.stringify(all.slice(i, i + CHUNK))]);
    }
  }
}

/** The record in memory, for tests. */
export class MemoryLibraryFileOrigins implements LibraryFileOrigins {
  readonly hashes = new Set<string>();
  async has(hashes: readonly string[]): Promise<Set<string>> {
    return new Set(hashes.filter((h) => this.hashes.has(h)));
  }
  async add(hashes: readonly string[]): Promise<void> {
    for (const h of hashes) if (HASH.test(h)) this.hashes.add(h);
  }
}
