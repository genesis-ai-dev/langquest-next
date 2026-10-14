import type { DiagRecord, DiagStore } from './diagnostics';
import type { SqlDriver } from './sqliteStore';

/**
 * Diagnostics waiting for delivery. They are not events: they never fold
 * and are deleted once delivered (decisions.md 39). The app keeps them in
 * a SQLite file of their own, so a diagnostics write never contends for the
 * lock an event commit needs.
 */
export class SqliteDiagStore implements DiagStore {
  private constructor(private readonly db: SqlDriver) {}

  static async open(db: SqlDriver): Promise<SqliteDiagStore> {
    await db.run(`create table if not exists diag_records (
      id text primary key,
      kind text not null,
      at integer not null,
      json text not null
    )`);
    await db.run(`create index if not exists diag_records_at on diag_records (at)`);
    return new SqliteDiagStore(db);
  }

  async addDiag(record: DiagRecord, max: number): Promise<void> {
    await this.db.run(`insert or ignore into diag_records (id, kind, at, json) values (?, ?, ?, ?)`, [
      record.id, record.kind, record.at, JSON.stringify(record)
    ]);
    // max(0, ...): a negative LIMIT in SQLite means no limit at all.
    await this.db.run(
      `delete from diag_records where id in (
        select id from diag_records order by (kind = 'error'), at
        limit max(0, (select count(*) from diag_records) - ?))`,
      [max]
    );
  }

  async diagBatch(limit: number): Promise<DiagRecord[]> {
    const rows = await this.db.all<{ json: string }>(`select json from diag_records order by at, id limit ?`, [limit]);
    return rows.map((r) => JSON.parse(r.json) as DiagRecord);
  }

  async removeDiag(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.run(`delete from diag_records where id in (${ids.map(() => '?').join(',')})`, ids);
  }

  async diagCount(): Promise<number> {
    const rows = await this.db.all<{ n: number }>(`select count(*) as n from diag_records`);
    return Number(rows[0]?.n ?? 0);
  }
}
