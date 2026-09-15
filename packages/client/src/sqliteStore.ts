import type { AnyEvent } from '@langquest-next/core';
import type { EventStore, LocalEvent } from './types';

/**
 * Minimal SQL driver so the same store runs on expo-sqlite in the app and on
 * node:sqlite in tests. Positional `?` parameters only.
 */
export interface SqlDriver {
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Run `fn` inside one transaction. Optional: without it, putMany runs statement by statement. */
  transaction?(fn: () => Promise<void>): Promise<void>;
}

interface Row {
  id: string;
  status: string;
  reject_reason: string | null;
  server_seq: number | null;
  json: string;
}

/**
 * SQLite EventStore. The event envelope is stored as JSON; the columns
 * duplicated beside it exist only for indexing and ordering. Sync status is
 * a column on this table (PLAN.md invariant 7), never on state tables.
 */
export class SqliteStore implements EventStore {
  private constructor(private readonly db: SqlDriver) {}

  static async open(db: SqlDriver): Promise<SqliteStore> {
    // Durability on phones that die mid-write: WAL keeps the main file
    // consistent; NORMAL still syncs the WAL at checkpoint. Pragmas return
    // rows on some drivers, so read them rather than run them.
    await db.all(`pragma journal_mode = wal`);
    await db.all(`pragma synchronous = normal`);
    await db.run(`create table if not exists events (
      id text primary key,
      org_id text not null,
      project_id text not null,
      status text not null,
      reject_reason text,
      hlc text not null,
      server_seq integer,
      json text not null
    )`);
    await db.run(
      `create index if not exists events_partition_status on events (org_id, project_id, status, hlc)`
    );
    await db.run(`create table if not exists cursors (
      org_id text not null,
      project_id text not null,
      seq integer not null,
      primary key (org_id, project_id)
    )`);
    await db.run(`create table if not exists meta (key text primary key, value text not null)`);
    return new SqliteStore(db);
  }

  async put(local: LocalEvent): Promise<void> {
    const e = local.event;
    await this.db.run(
      `insert into events (id, org_id, project_id, status, reject_reason, hlc, server_seq, json)
       values (?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         status = excluded.status,
         reject_reason = excluded.reject_reason,
         server_seq = excluded.server_seq,
         json = excluded.json`,
      [
        e.id,
        e.orgId,
        e.projectId,
        local.status,
        local.rejectReason ?? null,
        e.hlc,
        e.serverSeq ?? null,
        JSON.stringify(e)
      ]
    );
  }

  async putMany(locals: LocalEvent[]): Promise<void> {
    if (locals.length === 0) return;
    const write = async () => {
      for (const l of locals) await this.put(l);
    };
    if (this.db.transaction) await this.db.transaction(write);
    else await write();
  }

  async get(id: string): Promise<LocalEvent | undefined> {
    const rows = await this.db.all<Row>(`select * from events where id = ?`, [id]);
    const row = rows[0];
    return row ? toLocal(row) : undefined;
  }

  async pending(orgId: string, projectId: string): Promise<LocalEvent[]> {
    const rows = await this.db.all<Row>(
      `select * from events where org_id = ? and project_id = ? and status = 'pending' order by hlc`,
      [orgId, projectId]
    );
    return rows.map(toLocal);
  }

  async all(orgId: string, projectId: string): Promise<LocalEvent[]> {
    const rows = await this.db.all<Row>(
      `select * from events where org_id = ? and project_id = ? and status <> 'rejected'
       order by server_seq is null, server_seq, hlc`,
      [orgId, projectId]
    );
    return rows.map(toLocal);
  }

  async cursor(orgId: string, projectId: string): Promise<number> {
    const rows = await this.db.all<{ seq: number }>(
      `select seq from cursors where org_id = ? and project_id = ?`,
      [orgId, projectId]
    );
    return rows[0]?.seq ?? 0;
  }

  async setCursor(orgId: string, projectId: string, seq: number): Promise<void> {
    await this.db.run(
      `insert into cursors (org_id, project_id, seq) values (?, ?, ?)
       on conflict(org_id, project_id) do update set seq = excluded.seq`,
      [orgId, projectId, seq]
    );
  }

  async prune(orgId: string, projectId: string, uptoSeq: number): Promise<void> {
    await this.db.run(
      `delete from events where org_id = ? and project_id = ? and status = 'confirmed' and server_seq <= ?`,
      [orgId, projectId, uptoSeq]
    );
  }

  async meta(key: string): Promise<string | undefined> {
    const rows = await this.db.all<{ value: string }>(`select value from meta where key = ?`, [key]);
    return rows[0]?.value;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.run(
      `insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value`,
      [key, value]
    );
  }

  /** Rejected events for a partition, for the UI to show what was refused. */
  async rejected(orgId: string, projectId: string): Promise<LocalEvent[]> {
    const rows = await this.db.all<Row>(
      `select * from events where org_id = ? and project_id = ? and status = 'rejected' order by hlc`,
      [orgId, projectId]
    );
    return rows.map(toLocal);
  }
}

function toLocal(row: Row): LocalEvent {
  const event = JSON.parse(row.json) as AnyEvent;
  return {
    event,
    status: row.status as LocalEvent['status'],
    ...(row.reject_reason ? { rejectReason: row.reject_reason } : {})
  };
}
