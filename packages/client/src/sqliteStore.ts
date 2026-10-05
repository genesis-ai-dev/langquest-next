import { openReadModels, updateReadModels, taskPage, laneCounts } from './sqliteReadModels';
import { WriteQueue } from './writeQueue';
import type { AnyEvent, PassageRow } from '@langquest-next/core';
import type { EventStore, LocalEvent, PassageCursor, WriteBatch, TaskQuery } from './types';

/**
 * Minimal SQL driver so the same store runs on expo-sqlite in the app and on
 * node:sqlite in tests. Positional `?` parameters only.
 */
export interface SqlDriver {
  run(sql: string, params?: unknown[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /**
   * Run `fn` inside one transaction, on a driver bound to that transaction.
   * The store issues every statement of the batch through `tx`, never
   * through the outer driver, so an implementation may open a separate
   * connection (expo's exclusive transaction) and unrelated queries cannot
   * slip into the batch. Optional: without it, a commit runs statement by
   * statement and is not atomic.
   */
  transaction?(fn: (tx: SqlDriver) => Promise<void>): Promise<void>;
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
  private readonly writer = new WriteQueue();
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
    // Read-model rows (PLAN.md invariant 5 still holds: derived, rebuildable,
    // never written by a user). `ord` is the unit's order key for paging.
    await db.run(`create table if not exists passage_rows (
      org_id text not null,
      project_id text not null,
      unit_id text not null,
      lane_id text not null,
      ord text not null,
      json text not null,
      primary key (org_id, project_id, unit_id, lane_id)
    )`);
    await db.run(
      `create index if not exists passage_rows_order on passage_rows (org_id, project_id, lane_id, ord, unit_id)`
    );
    await openReadModels(db);
    return new SqliteStore(db);
  }

  async commit(batch: WriteBatch): Promise<void> {
    const write = async (tx: SqlDriver) => {
      for (const l of batch.events ?? []) await this.putOn(tx, l);
      for (const key of new Set((batch.events ?? []).map((l) => `projection:${l.event.orgId}/${l.event.projectId}`))) {
        await this.setMetaOn(tx, key, '');
      }
      if (batch.cursor) await this.setCursorOn(tx, batch.cursor.orgId, batch.cursor.projectId, batch.cursor.seq);
      for (const [k, v] of Object.entries(batch.meta ?? {})) await this.setMetaOn(tx, k, v);
      if (batch.prune) await this.pruneOn(tx, batch.prune.orgId, batch.prune.projectId, batch.prune.uptoSeq);
      const rows = batch.rows;
      if (rows) {
        await updateReadModels(tx, rows);
        if (rows.clear) await tx.run(`delete from passage_rows where org_id = ? and project_id = ?`, [rows.orgId, rows.projectId]);
        for (const k of rows.delete ?? []) {
          await tx.run(`delete from passage_rows where org_id = ? and project_id = ? and unit_id = ? and lane_id = ?`, [rows.orgId, rows.projectId, k.unitId, k.laneId]);
        }
        for (const r of rows.put ?? []) {
          await tx.run(
            `insert into passage_rows (org_id, project_id, unit_id, lane_id, ord, json) values (?, ?, ?, ?, ?, ?)
             on conflict(org_id, project_id, unit_id, lane_id) do update set ord = excluded.ord, json = excluded.json`,
            [rows.orgId, rows.projectId, r.unitId, r.laneId, r.order, JSON.stringify(r)]
          );
        }
        if (rows.version) {
          const cursor = await tx.all<{ seq: number }>(
            'select seq from cursors where org_id = ? and project_id = ?', [rows.orgId, rows.projectId]);
          await this.setMetaOn(tx, `projection:${rows.orgId}/${rows.projectId}`,
            `${rows.version}:${cursor[0]?.seq ?? 0}`);
        }
      }
    };
    await this.writer.run(async () => {
      if (this.db.transaction) await this.db.transaction(write);
      else await write(this.db);
    });
  }

  taskPage(orgId: string, projectId: string, query: TaskQuery) {
    return taskPage(this.db, orgId, projectId, query);
  }

  laneCounts(orgId: string, projectId: string, laneId: string) {
    return laneCounts(this.db, orgId, projectId, laneId);
  }

  async passage(orgId: string, projectId: string, unitId: string, laneId: string): Promise<PassageRow | undefined> {
    const rows = await this.db.all<{ json: string }>(
      `select json from passage_rows where org_id = ? and project_id = ? and unit_id = ? and lane_id = ?`,
      [orgId, projectId, unitId, laneId]
    );
    return rows[0] ? (JSON.parse(rows[0].json) as PassageRow) : undefined;
  }

  async passages(orgId: string, projectId: string, opts: { laneId?: string; after?: PassageCursor | null; limit: number }): Promise<PassageRow[]> {
    const after = opts.after ?? null;
    const rows = await this.db.all<{ json: string }>(
      `select json from passage_rows where org_id = ? and project_id = ?
         and (? is null or lane_id = ?)
         and (? is null or (ord, unit_id, lane_id) > (?, ?, ?))
       order by ord, unit_id, lane_id limit ?`,
      [orgId, projectId, opts.laneId ?? null, opts.laneId ?? null, after ? 1 : null, after?.order ?? '', after?.unitId ?? '', after?.laneId ?? '', opts.limit]
    );
    return rows.map((r) => JSON.parse(r.json) as PassageRow);
  }

  async put(local: LocalEvent): Promise<void> {
    await this.commit({ events: [local] });
  }

  private async putOn(db: SqlDriver, local: LocalEvent): Promise<void> {
    const e = local.event;
    await db.run(
      `insert into events (id, org_id, project_id, status, reject_reason, hlc, server_seq, json)
       values (?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(id) do update set
         hlc = excluded.hlc,
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
    await this.commit({ events: locals });
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

  async pendingPage(orgId: string, projectId: string, afterHlc: string | null, limit: number): Promise<LocalEvent[]> {
    const rows = await this.db.all<Row>(
      `select * from events where org_id = ? and project_id = ? and status = 'pending' and hlc > ?
       order by hlc limit ?`,
      [orgId, projectId, afterHlc ?? '', limit]
    );
    return rows.map(toLocal);
  }

  async pendingCount(orgId: string, projectId: string): Promise<number> {
    const rows = await this.db.all<{ n: number }>(
      `select count(*) as n from events where org_id = ? and project_id = ? and status = 'pending'`,
      [orgId, projectId]
    );
    return Number(rows[0]?.n ?? 0);
  }

  async pendingCountBy(orgId: string, projectId: string, actorId: string): Promise<number> {
    // The outbox is small and already narrowed by the index, so reading the
    // author out of the stored event costs less than a column and a migration.
    const rows = await this.db.all<{ n: number }>(
      `select count(*) as n from events where org_id = ? and project_id = ? and status = 'pending'
       and json_extract(json, '$.actorId') = ?`,
      [orgId, projectId, actorId]
    );
    return Number(rows[0]?.n ?? 0);
  }

  async count(orgId: string, projectId: string): Promise<number> {
    const rows = await this.db.all<{ n: number }>(
      `select count(*) as n from events where org_id = ? and project_id = ? and status <> 'rejected'`,
      [orgId, projectId]
    );
    return Number(rows[0]?.n ?? 0);
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
    await this.commit({ cursor: { orgId, projectId, seq } });
  }

  private async setCursorOn(db: SqlDriver, orgId: string, projectId: string, seq: number): Promise<void> {
    await db.run(
      `insert into cursors (org_id, project_id, seq) values (?, ?, ?)
       on conflict(org_id, project_id) do update set seq = excluded.seq`,
      [orgId, projectId, seq]
    );
  }

  async prune(orgId: string, projectId: string, uptoSeq: number): Promise<void> {
    await this.commit({ prune: { orgId, projectId, uptoSeq } });
  }

  private async pruneOn(db: SqlDriver, orgId: string, projectId: string, uptoSeq: number): Promise<void> {
    await db.run(
      `delete from events where org_id = ? and project_id = ? and status = 'confirmed' and server_seq <= ?`,
      [orgId, projectId, uptoSeq]
    );
  }

  async meta(key: string): Promise<string | undefined> {
    const rows = await this.db.all<{ value: string }>(`select value from meta where key = ?`, [key]);
    return rows[0]?.value;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.commit({ meta: { [key]: value } });
  }

  private async setMetaOn(db: SqlDriver, key: string, value: string): Promise<void> {
    await db.run(
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
