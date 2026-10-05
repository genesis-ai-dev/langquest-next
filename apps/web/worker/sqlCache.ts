import type { OrgCache } from './orgFolder';

/**
 * Characters per stored part. A Durable Object's SQLite row is capped at
 * 2 MB; at most 3 UTF-8 bytes per UTF-16 unit keeps a part well under it.
 */
export const PART_CHARS = 400_000;

/** Split text into parts of at most `size` units, never between the two halves of a surrogate pair. */
export function splitText(text: string, size = PART_CHARS): string[] {
  const parts: string[] = [];
  for (let at = 0; at < text.length;) {
    let end = Math.min(at + size, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end -= 1;
    parts.push(text.slice(at, end));
    at = end;
  }
  return parts;
}

/** The two calls of a Durable Object's storage the cache needs. */
export interface SqlStore {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
  transactionSync<T>(fn: () => T): T;
}

/** The folder's cache in the object's own SQLite (decision 44, amended 2026-10-03). */
export class SqlCache implements OrgCache {
  constructor(private readonly db: SqlStore) {
    db.exec('create table if not exists cache (key text not null, part integer not null, value text not null, primary key (key, part))');
  }

  async get(key: string): Promise<string | null> {
    const rows = this.db.exec('select value from cache where key = ? order by part', key).toArray();
    return rows.length > 0 ? rows.map((r) => r.value as string).join('') : null;
  }

  async put(key: string, value: string): Promise<void> {
    const parts = splitText(value);
    this.db.transactionSync(() => {
      this.db.exec('delete from cache where key = ?', key);
      parts.forEach((part, i) => this.db.exec('insert into cache (key, part, value) values (?, ?, ?)', key, i, part));
    });
  }
}
