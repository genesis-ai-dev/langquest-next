import type { AnyEvent, LocalEventStatus, PassageKey, PassageRow, TaskStatus } from '@langquest-next/core';

/**
 * One atomic local write: events, outbox state, cursor, clock and other
 * metadata, pruning, and the read-model rows the events changed. A store
 * applies all of it or none of it, so a phone that dies mid-commit never
 * holds rows that disagree with its log.
 */
export interface WriteBatch {
  events?: LocalEvent[];
  cursor?: { orgId: string; projectId: string; seq: number };
  meta?: Record<string, string>;
  /** Drop confirmed events at or below `uptoSeq`; a checkpoint holds them now. */
  prune?: { orgId: string; projectId: string; uptoSeq: number };
  rows?: { orgId: string; projectId: string; clear?: boolean; version?: string; put?: PassageRow[]; delete?: PassageKey[] } | undefined;
}

/** A page position in a lane's rows: the last row seen, in display order. */
export interface PassageCursor {
  order: string;
  unitId: string;
  laneId: string;
}

export interface TaskCursor extends PassageCursor { taskId: string }
export interface TaskQuery {
  actorId: string;
  translate: boolean;
  laneId?: string;
  status?: TaskStatus[];
  after?: TaskCursor | null;
  limit: number;
}
export interface TaskMatch { row: PassageRow; taskId: string }
export interface LaneCounts { passages: number; translated: number; approved: number }

/** An event as held on the device: the envelope plus sync bookkeeping. */
export interface LocalEvent {
  event: AnyEvent;
  status: LocalEventStatus;
  rejectReason?: string;
}

/**
 * Device-side persistence. Implemented in memory for tests and on SQLite for
 * the app. The client never touches storage except through this.
 */
export interface EventStore {
  /** Apply one write batch atomically. All other writers are conveniences over this. */
  commit(batch: WriteBatch): Promise<void>;
  taskPage(orgId: string, projectId: string, query: TaskQuery): Promise<TaskMatch[]>;
  laneCounts(orgId: string, projectId: string, laneId: string): Promise<LaneCounts>;
  /** One read-model row, or undefined when the projection has none. */
  passage(orgId: string, projectId: string, unitId: string, laneId: string): Promise<PassageRow | undefined>;
  /** Rows in display order (unit order, unit id, lane id), strictly after `after`, optionally one lane. */
  passages(orgId: string, projectId: string, opts: { laneId?: string; after?: PassageCursor | null; limit: number }): Promise<PassageRow[]>;
  put(local: LocalEvent): Promise<void>;
  /** Upsert many in one transaction: one pull page, one bulk append. */
  putMany(locals: LocalEvent[]): Promise<void>;
  get(id: string): Promise<LocalEvent | undefined>;
  /** Rejected events for a partition, oldest first, so the UI can show them and the client can retry them. */
  rejected(orgId: string, projectId: string): Promise<LocalEvent[]>;
  /** Pending events for a partition, oldest first. The sync status screen reads this; push reads pages. */
  pending(orgId: string, projectId: string): Promise<LocalEvent[]>;
  /**
   * One page of pending events, oldest first, strictly after `afterHlc`
   * (null for the first page). Push walks the outbox this way so a large
   * offline backlog is never materialized at once.
   */
  pendingPage(orgId: string, projectId: string, afterHlc: string | null, limit: number): Promise<LocalEvent[]>;
  /** How many are pending, as a count: the UI asks after every change and must not deserialize the outbox to answer. */
  pendingCount(orgId: string, projectId: string): Promise<number>;
  /**
   * How many of one person's events are pending. On a shared phone the log
   * holds everyone's queued events, and only their author's session can send
   * them (decisions.md 11), so "still to send" is counted per person.
   */
  pendingCountBy(orgId: string, projectId: string, actorId: string): Promise<number>;
  /** Every partition holding pending events by one person: where a hand-over courier has work (decisions.md 60). */
  pendingPartitionsBy(actorId: string): Promise<{ orgId: string; projectId: string }[]>;
  /** How many events all() returns, without loading them. */
  count(orgId: string, projectId: string): Promise<number>;
  /** Every non-rejected event for a partition (confirmed then pending is fine). */
  all(orgId: string, projectId: string): Promise<LocalEvent[]>;
  /** Highest confirmed server_seq seen for a partition, 0 if none. */
  cursor(orgId: string, projectId: string): Promise<number>;
  setCursor(orgId: string, projectId: string, seq: number): Promise<void>;
  /** Drop confirmed events at or below `uptoSeq`; they live in a checkpoint now. */
  prune(orgId: string, projectId: string, uptoSeq: number): Promise<void>;
  /** Small device-level key/value state: device id, persisted clocks. */
  meta(key: string): Promise<string | undefined>;
  setMeta(key: string, value: string): Promise<void>;
}

export interface AppendResult {
  id: string;
  accepted: boolean;
  serverSeq: number | null;
  reason: string | null;
}

/** The server calls from PLAN.md section 9. */
export interface Transport {
  append(events: AnyEvent[]): Promise<AppendResult[]>;
  pull(orgId: string, projectId: string, after: number, limit: number): Promise<AnyEvent[]>;
  /** Newest snapshot for exactly this reducer version: where it is and how big, or null. */
  snapshotMeta(orgId: string, projectId: string, reducerVersion: number): Promise<SnapshotMeta | null>;
  /** One piece of that snapshot's JSON state; null if the seq no longer exists. */
  snapshotChunk(orgId: string, projectId: string, reducerVersion: number, serverSeq: number, index: number): Promise<string | null>;
  /**
   * Be told when something was appended to a partition, and whether the
   * channel is up. Optional: a transport without it is polled. The poke
   * carries no data; the client pulls through the authorized RPC.
   */
  watch?(orgId: string, projectId: string, handlers: WatchHandlers): () => void;
}

export interface WatchHandlers {
  onPoke: () => void;
  onStatus: (connected: boolean) => void;
}

/** What the local log holds for a partition, for the sync status screen. */
export interface SyncInspection {
  pending: LocalEvent[];
  rejected: LocalEvent[];
  total: number;
  cursor: number;
  checkpointSeq: number | null;
}

export interface SnapshotMeta {
  serverSeq: number;
  chunks: number;
  bytes: number;
}

/**
 * Why the server refused an event, classified from its reason text so the
 * client can decide what to do: membership refusals are retried when the
 * actor's membership changes; a clock-ahead refusal re-stamps the clock;
 * invalid payloads never retry.
 */
export type RejectCode = 'NOT_MEMBER' | 'NOT_ALLOWED' | 'INVALID' | 'CLOCK_AHEAD' | 'UNKNOWN';

export function rejectCodeOf(reason: string | undefined): RejectCode {
  const r = reason ?? '';
  if (/clock ahead/i.test(r)) return 'CLOCK_AHEAD';
  if (/not a member/i.test(r)) return 'NOT_MEMBER';
  if (/may not emit/i.test(r)) return 'NOT_ALLOWED';
  if (/invalid payload|malformed|does not match/i.test(r)) return 'INVALID';
  return 'UNKNOWN';
}

/** The request never reached the server: no connection, DNS, or a dead link. */
export class OfflineError extends Error {
  override name = 'OfflineError';
}

/**
 * The server was reached and refused the request: this actor is not a member
 * of the partition, or lacks the privilege. Distinct from `OfflineError` on
 * purpose (PLAN.md invariant 1 keeps queued work, but a device whose session
 * is refused is not offline and must not be treated as such: it cannot queue
 * its way out, and telling the user "offline" strands them).
 */
export class NotAuthorizedError extends Error {
  override name = 'NotAuthorizedError';
}

/** The server refuses this client's protocol version; the app must upgrade. */
export class ClientTooOldError extends Error {
  override name = 'ClientTooOldError';
}
