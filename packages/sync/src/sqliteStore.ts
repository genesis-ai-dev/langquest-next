import { WriteQueue } from './writeQueue';
import type { AnyEvent } from '@langquest-next/core';
import type { EventStore, KeptKind, KeptRecord, LocalEvent, WriteBatch } from './types';

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
    // A phone from before streams (decisions.md 63) holds a log from a server
    // that was reset since, so it starts empty: its events, cursors, device
    // id and any read-model tables of that time go.
    const columns = await db.all<{ name: string }>(`select name from pragma_table_info('events')`);
    if (columns.length > 0 && !columns.some((c) => c.name === 'stream_id')) {
      for (const t of ['events', 'cursors', 'meta', 'passage_rows', 'task_rows', 'lane_counts']) await db.run(`drop table if exists ${t}`);
    }
    await db.run(`create table if not exists events (
      id text primary key,
      org_id text not null,
      stream_id text not null,
      status text not null,
      reject_reason text,
      hlc text not null,
      server_seq integer,
      json text not null
    )`);
    await db.run(`create index if not exists events_stream_status on events (org_id, stream_id, status, hlc)`);
    // The log read a page at a time in id order (`page`).
    await db.run(`create index if not exists events_stream_id on events (org_id, stream_id, id)`);
    await db.run(`create table if not exists cursors (
      org_id text not null,
      stream_id text not null,
      seq integer not null,
      primary key (org_id, stream_id)
    )`);
    await db.run(`create table if not exists meta (key text primary key, value text not null)`);
    // Records a big language keeps here rather than in memory (decisions.md 143).
    // A build of pull request 120 before passages kept their versions and
    // reviews here too wrote some to `kept`; that shape is gone, and only a
    // test phone ever had it.
    await db.run(`drop table if exists kept`);
    await db.run(`create table if not exists kept_rows (
      org_id text not null,
      stream_id text not null,
      kind text not null,
      id text not null,
      unit_id text not null,
      ref text not null,
      json text not null,
      primary key (org_id, stream_id, kind, id)
    )`);
    await db.run(`create index if not exists kept_rows_unit on kept_rows (org_id, stream_id, kind, unit_id)`);
    await db.run(`create index if not exists kept_rows_ref on kept_rows (org_id, stream_id, kind, ref)`);
    return new SqliteStore(db);
  }

  async commit(batch: WriteBatch): Promise<void> {
    const write = async (tx: SqlDriver) => {
      await this.putOn(tx, batch.events ?? []);
      if (batch.cursor) await this.setCursorOn(tx, batch.cursor.orgId, batch.cursor.streamId, batch.cursor.seq);
      for (const [k, v] of Object.entries(batch.meta ?? {})) await this.setMetaOn(tx, k, v);
      if (batch.prune) await this.pruneOn(tx, batch.prune.orgId, batch.prune.streamId, batch.prune.uptoSeq);
      if (batch.kept) {
        const { orgId, streamId } = batch.kept;
        if (batch.kept.clear || batch.kept.replaceFrom !== undefined) await tx.run(`delete from kept_rows where org_id = ? and stream_id = ?`, [orgId, streamId]);
        if (batch.kept.replaceFrom !== undefined) {
          await tx.run(`update kept_rows set stream_id = ? where org_id = ? and stream_id = ?`, [streamId, orgId, batch.kept.replaceFrom]);
        }
        // A thousand rows a statement, handed over as one JSON array: a first
        // download writes 160,000 rows for a language like Koro Miyan, and a
        // statement per row took over a minute on a test phone.
        const upsert = batch.kept.upsert ?? [];
        for (let i = 0; i < upsert.length; i += KEPT_ROWS_PER_STATEMENT) {
          const rows = upsert.slice(i, i + KEPT_ROWS_PER_STATEMENT).map((r) => [r.kind, r.id, r.unitId, r.ref, r.json]);
          await tx.run(
            `insert into kept_rows (org_id, stream_id, kind, id, unit_id, ref, json)
             select ?, ?, value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4 from json_each(?) where true
             on conflict(org_id, stream_id, kind, id) do update set unit_id = excluded.unit_id, ref = excluded.ref, json = excluded.json`,
            [orgId, streamId, JSON.stringify(rows)]
          );
        }
      }
    };
    await this.writer.run(async () => {
      if (this.db.transaction) await this.db.transaction(write);
      else await write(this.db);
    });
  }

  async put(local: LocalEvent): Promise<void> {
    await this.commit({ events: [local] });
  }

  /**
   * Upsert events, a few hundred a statement handed over as one JSON array,
   * as kept rows are: a pull page of 500 was 500 awaited statements, each a
   * round trip to the native side (performance-audit-2026-10-26.md). Rows
   * apply in order, so an id given twice ends as its last.
   */
  private async putOn(db: SqlDriver, locals: readonly LocalEvent[]): Promise<void> {
    for (let i = 0; i < locals.length; i += EVENTS_PER_STATEMENT) {
      const rows = locals.slice(i, i + EVENTS_PER_STATEMENT).map(({ event: e, status, rejectReason }) =>
        [e.id, e.orgId, e.streamId, status, rejectReason ?? null, e.hlc, e.serverSeq ?? null, JSON.stringify(e)]);
      await db.run(
        `insert into events (id, org_id, stream_id, status, reject_reason, hlc, server_seq, json)
         select value ->> 0, value ->> 1, value ->> 2, value ->> 3, value ->> 4, value ->> 5, value ->> 6, value ->> 7
           from json_each(?) where true
         on conflict(id) do update set
           hlc = excluded.hlc,
           status = excluded.status,
           reject_reason = excluded.reject_reason,
           server_seq = excluded.server_seq,
           json = excluded.json`,
        [JSON.stringify(rows)]
      );
    }
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

  async pending(orgId: string, streamId: string): Promise<LocalEvent[]> {
    const rows = await this.db.all<Row>(
      `select * from events where org_id = ? and stream_id = ? and status = 'pending' order by hlc`,
      [orgId, streamId]
    );
    return rows.map(toLocal);
  }

  async pendingPage(orgId: string, streamId: string, afterHlc: string | null, limit: number): Promise<LocalEvent[]> {
    const rows = await this.db.all<Row>(
      `select * from events where org_id = ? and stream_id = ? and status = 'pending' and hlc > ?
       order by hlc limit ?`,
      [orgId, streamId, afterHlc ?? '', limit]
    );
    return rows.map(toLocal);
  }

  async pendingCount(orgId: string, streamId: string): Promise<number> {
    const rows = await this.db.all<{ n: number }>(
      `select count(*) as n from events where org_id = ? and stream_id = ? and status = 'pending'`,
      [orgId, streamId]
    );
    return Number(rows[0]?.n ?? 0);
  }

  async pendingStreamsBy(actorId: string): Promise<{ orgId: string; streamId: string }[]> {
    const rows = await this.db.all<{ org_id: string; stream_id: string }>(
      `select distinct org_id, stream_id from events where status = 'pending' and json_extract(json, '$.actorId') = ?
       order by org_id, stream_id`,
      [actorId]
    );
    return rows.map((r) => ({ orgId: r.org_id, streamId: r.stream_id }));
  }

  async pendingCountBy(orgId: string, streamId: string, actorId: string): Promise<number> {
    // The outbox is small and already narrowed by the index, so reading the
    // author out of the stored event costs less than a column and a migration.
    const rows = await this.db.all<{ n: number }>(
      `select count(*) as n from events where org_id = ? and stream_id = ? and status = 'pending'
       and json_extract(json, '$.actorId') = ?`,
      [orgId, streamId, actorId]
    );
    return Number(rows[0]?.n ?? 0);
  }

  async count(orgId: string, streamId: string): Promise<number> {
    const rows = await this.db.all<{ n: number }>(
      `select count(*) as n from events where org_id = ? and stream_id = ? and status <> 'rejected'`,
      [orgId, streamId]
    );
    return Number(rows[0]?.n ?? 0);
  }

  async all(orgId: string, streamId: string): Promise<LocalEvent[]> {
    const rows = await this.db.all<Row>(
      `select * from events where org_id = ? and stream_id = ? and status <> 'rejected'
       order by server_seq is null, server_seq, hlc`,
      [orgId, streamId]
    );
    return rows.map(toLocal);
  }

  async page(orgId: string, streamId: string, afterId: string | null, limit: number, type?: string): Promise<LocalEvent[]> {
    const rows = await this.db.all<Row>(
      `select * from events where org_id = ? and stream_id = ? and status <> 'rejected' and id > ?
       ${type === undefined ? '' : `and json_extract(json, '$.type') = ?`} order by id limit ?`,
      [orgId, streamId, afterId ?? '', ...(type === undefined ? [] : [type]), limit]
    );
    return rows.map(toLocal);
  }

  async cursor(orgId: string, streamId: string): Promise<number> {
    const rows = await this.db.all<{ seq: number }>(
      `select seq from cursors where org_id = ? and stream_id = ?`,
      [orgId, streamId]
    );
    return rows[0]?.seq ?? 0;
  }

  async setCursor(orgId: string, streamId: string, seq: number): Promise<void> {
    await this.commit({ cursor: { orgId, streamId, seq } });
  }

  private async setCursorOn(db: SqlDriver, orgId: string, streamId: string, seq: number): Promise<void> {
    await db.run(
      `insert into cursors (org_id, stream_id, seq) values (?, ?, ?)
       on conflict(org_id, stream_id) do update set seq = excluded.seq`,
      [orgId, streamId, seq]
    );
  }

  async prune(orgId: string, streamId: string, uptoSeq: number): Promise<void> {
    await this.commit({ prune: { orgId, streamId, uptoSeq } });
  }

  private async pruneOn(db: SqlDriver, orgId: string, streamId: string, uptoSeq: number): Promise<void> {
    await db.run(
      `delete from events where org_id = ? and stream_id = ? and status = 'confirmed' and server_seq <= ?`,
      [orgId, streamId, uptoSeq]
    );
  }

  async keptByUnit(orgId: string, streamId: string, kinds: readonly KeptKind[], unitIds: readonly string[]): Promise<KeptRecord[]> {
    return this.keptWhere('unit_id', orgId, streamId, kinds, unitIds);
  }

  async keptById(orgId: string, streamId: string, kind: KeptKind, ids: readonly string[]): Promise<KeptRecord[]> {
    return this.keptWhere('id', orgId, streamId, [kind], [...new Set(ids)]);
  }

  async keptByRef(orgId: string, streamId: string, kind: KeptKind, refs: readonly string[]): Promise<KeptRecord[]> {
    return this.keptWhere('ref', orgId, streamId, [kind], refs);
  }

  /**
   * In slices, each list handed over as one JSON array: four parameters a
   * statement, whatever the list's length, since a Durable Object's SQLite
   * takes far fewer bound parameters than a phone's (decisions.md 147).
   */
  async keptUnitsAmong(orgId: string, streamId: string, kinds: readonly KeptKind[], unitIds: readonly string[]): Promise<string[]> {
    const out: string[] = [];
    if (kinds.length === 0) return out;
    for (let i = 0; i < unitIds.length; i += KEPT_SLICE) {
      const rows = await this.db.all<{ unit_id: string }>(
        `select distinct unit_id from kept_rows where org_id = ? and stream_id = ?
           and kind in (select value from json_each(?)) and unit_id in (select value from json_each(?))`,
        [orgId, streamId, JSON.stringify(kinds), JSON.stringify(unitIds.slice(i, i + KEPT_SLICE))]
      );
      for (const r of rows) out.push(r.unit_id);
    }
    return out;
  }

  private async keptWhere(column: 'unit_id' | 'id' | 'ref', orgId: string, streamId: string, kinds: readonly KeptKind[], values: readonly string[]): Promise<KeptRecord[]> {
    const out: KeptRecord[] = [];
    if (kinds.length === 0) return out;
    for (let i = 0; i < values.length; i += KEPT_SLICE) {
      const slice = values.slice(i, i + KEPT_SLICE);
      const rows = await this.db.all<KeptRow>(
        `select kind, id, unit_id, ref, json from kept_rows where org_id = ? and stream_id = ?
           and kind in (select value from json_each(?)) and ${column} in (select value from json_each(?))`,
        [orgId, streamId, JSON.stringify(kinds), JSON.stringify(slice)]
      );
      for (const r of rows) out.push(keptRecord(r));
    }
    return out;
  }

  async keptAll(orgId: string, streamId: string, kind: KeptKind): Promise<KeptRecord[]> {
    const rows = await this.db.all<KeptRow>(
      `select kind, id, unit_id, ref, json from kept_rows where org_id = ? and stream_id = ? and kind = ?`,
      [orgId, streamId, kind]
    );
    return rows.map(keptRecord);
  }

  async keptUnits(orgId: string, streamId: string, kinds: readonly KeptKind[], ref?: string): Promise<string[]> {
    if (kinds.length === 0) return [];
    const rows = await this.db.all<{ unit_id: string }>(
      `select distinct unit_id from kept_rows where org_id = ? and stream_id = ? and kind in (select value from json_each(?))${ref === undefined ? '' : ' and ref = ?'}`,
      [orgId, streamId, JSON.stringify(kinds), ...(ref === undefined ? [] : [ref])]
    );
    return rows.map((r) => r.unit_id);
  }

  async keptCount(orgId: string, streamId: string, kind: KeptKind): Promise<number> {
    const rows = await this.db.all<{ n: number }>(
      `select count(*) as n from kept_rows where org_id = ? and stream_id = ? and kind = ?`,
      [orgId, streamId, kind]
    );
    return Number(rows[0]?.n ?? 0);
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

  /**
   * What this phone holds, for the `device` diagnostics record: streams
   * (with events or a cursor), events of every stream, and the database's
   * size in bytes (pages in use, not the WAL beside it). Counts over the
   * index and two pragmas: cheap enough for once per delivery.
   */
  async footprint(): Promise<{ streams: number; events: number; bytes: number }> {
    const [row] = await this.db.all<{ streams: number; events: number; bytes: number }>(
      `select
         (select count(*) from (select org_id, stream_id from cursors union select distinct org_id, stream_id from events)) as streams,
         (select count(*) from events) as events,
         (select page_count from pragma_page_count()) * (select page_size from pragma_page_size()) as bytes`
    );
    return { streams: Number(row?.streams ?? 0), events: Number(row?.events ?? 0), bytes: Number(row?.bytes ?? 0) };
  }

  /** Rejected events for a stream, for the UI to show what was refused. */
  async rejected(orgId: string, streamId: string): Promise<LocalEvent[]> {
    const rows = await this.db.all<Row>(
      `select * from events where org_id = ? and stream_id = ? and status = 'rejected' order by hlc`,
      [orgId, streamId]
    );
    return rows.map(toLocal);
  }

  async rejectedCount(orgId: string, streamId: string): Promise<number> {
    const rows = await this.db.all<{ n: number }>(
      `select count(*) as n from events where org_id = ? and stream_id = ? and status = 'rejected'`,
      [orgId, streamId]
    );
    return Number(rows[0]?.n ?? 0);
  }

  async rejectedWith(orgId: string, streamId: string, text: string): Promise<LocalEvent[]> {
    // like is case-blind for ASCII, as rejectCodeOf's patterns are; % and _ are not in the texts asked for.
    const rows = await this.db.all<Row>(
      `select * from events where org_id = ? and stream_id = ? and status = 'rejected' and reject_reason like ? order by hlc`,
      [orgId, streamId, `%${text}%`]
    );
    return rows.map(toLocal);
  }
}

/** Ids per lookup. */
const KEPT_SLICE = 1_000;
/** Events written per statement. */
const EVENTS_PER_STATEMENT = 500;
/** Kept rows written per statement. */
const KEPT_ROWS_PER_STATEMENT = 1_000;

function toLocal(row: Row): LocalEvent {
  const event = JSON.parse(row.json) as AnyEvent;
  return {
    event,
    status: row.status as LocalEvent['status'],
    ...(row.reject_reason ? { rejectReason: row.reject_reason } : {})
  };
}

interface KeptRow { kind: KeptKind; id: string; unit_id: string; ref: string; json: string }

function keptRecord(r: KeptRow): KeptRecord {
  return { kind: r.kind, id: r.id, unitId: r.unit_id, ref: r.ref, json: r.json };
}
