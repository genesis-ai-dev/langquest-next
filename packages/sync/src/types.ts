import type { AnyEvent, LocalEventStatus } from '@langquest-next/core';

/**
 * One atomic local write: events, outbox state, cursor, clock and other
 * metadata, and pruning. A store applies all of it or none of it.
 */
export interface WriteBatch {
  events?: LocalEvent[];
  cursor?: { orgId: string; streamId: string; seq: number };
  meta?: Record<string, string>;
  /** Drop confirmed events at or below `uptoSeq`; a checkpoint holds them now. */
  prune?: { orgId: string; streamId: string; uptoSeq: number };
  /**
   * Records a language keeps on the phone instead of in memory (decisions.md
   * 110): upsert these. `clear` first drops every kept record of the
   * stream; `replaceFrom` then moves in the records written under another
   * stream id while a fresh snapshot was read, so the language switches to
   * them in the same commit as its new checkpoint.
   */
  kept?: { orgId: string; streamId: string; clear?: boolean; replaceFrom?: string; upsert?: KeptRecord[] };
}

/**
 * One record a big language keeps on the phone rather than in memory
 * (decisions.md 143): an entry of a map the language is cut into by
 * passage (a recording, a take, a review, a note; core `PASSAGE_PARTS`),
 * the server's verdict on an audio file (`file`), which record names an
 * audio file (`audio`), or a passage's line for lists (`line`). `json` is
 * the entry as the state holds it.
 */
export interface KeptRecord {
  kind: KeptKind;
  id: string;
  /** The passage it belongs to; '' for a file verdict. */
  unitId: string;
  /** A second key it is found by: who made a recording or a take, the term of a key-term link; '' otherwise. */
  ref: string;
  json: string;
}

/** A row kind: a part's (core `PassagePart.kind`), or `file`, `audio`, `line`. */
export type KeptKind = string;

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
  put(local: LocalEvent): Promise<void>;
  /** Upsert many in one transaction: one pull page, one bulk append. */
  putMany(locals: LocalEvent[]): Promise<void>;
  get(id: string): Promise<LocalEvent | undefined>;
  /** Rejected events for a stream, oldest first, so the UI can show them and the client can retry them. */
  rejected(orgId: string, streamId: string): Promise<LocalEvent[]>;
  /** How many `rejected` would return, without reading them: the session counts after every append. */
  rejectedCount?(orgId: string, streamId: string): Promise<number>;
  /**
   * The rejected events whose reason contains `text` (any case): push puts
   * not-listed refusals back on every run, and a backlog of other refusals
   * need not be read and parsed each time to find none.
   */
  rejectedWith?(orgId: string, streamId: string, text: string): Promise<LocalEvent[]>;
  /** Pending events for a stream, oldest first. The sync status screen reads this; push reads pages. */
  pending(orgId: string, streamId: string): Promise<LocalEvent[]>;
  /**
   * One page of pending events, oldest first, strictly after `afterHlc`
   * (null for the first page). Push walks the outbox this way so a large
   * offline backlog is never materialized at once.
   */
  pendingPage(orgId: string, streamId: string, afterHlc: string | null, limit: number): Promise<LocalEvent[]>;
  /** How many are pending, as a count: the UI asks after every change and must not deserialize the outbox to answer. */
  pendingCount(orgId: string, streamId: string): Promise<number>;
  /**
   * How many of one person's events are pending. On a shared phone the log
   * holds everyone's queued events, and only their author's session can send
   * them (decisions.md 11), so "still to send" is counted per person.
   */
  pendingCountBy(orgId: string, streamId: string, actorId: string): Promise<number>;
  /** Every stream holding pending events by one person: where a hand-over courier has work (decisions.md 60). */
  pendingStreamsBy(actorId: string): Promise<{ orgId: string; streamId: string }[]>;
  /** How many events all() returns, without loading them. */
  count(orgId: string, streamId: string): Promise<number>;
  /** Every non-rejected event for a stream (confirmed then pending is fine). */
  all(orgId: string, streamId: string): Promise<LocalEvent[]>;
  /**
   * Non-rejected events of a stream a page at a time, in id order, after
   * `afterId` (null for the first page); with `type`, only events of that
   * type. The client folds its log this way, so it is never held whole.
   */
  page(orgId: string, streamId: string, afterId: string | null, limit: number, type?: string): Promise<LocalEvent[]>;
  /** Highest confirmed server_seq seen for a stream, 0 if none. */
  cursor(orgId: string, streamId: string): Promise<number>;
  setCursor(orgId: string, streamId: string, seq: number): Promise<void>;
  /** Drop confirmed events at or below `uptoSeq`; they live in a checkpoint now. */
  prune(orgId: string, streamId: string, uptoSeq: number): Promise<void>;
  /** Kept records of these kinds whose passage is one of these. */
  keptByUnit(orgId: string, streamId: string, kinds: readonly KeptKind[], unitIds: readonly string[]): Promise<KeptRecord[]>;
  /** Kept records of one kind with these ids. */
  keptById(orgId: string, streamId: string, kind: KeptKind, ids: readonly string[]): Promise<KeptRecord[]>;
  /** Kept records of one kind with one of these second keys (`ref`). */
  keptByRef(orgId: string, streamId: string, kind: KeptKind, refs: readonly string[]): Promise<KeptRecord[]>;
  /** Every kept record of one kind (a language's lines). */
  keptAll(orgId: string, streamId: string, kind: KeptKind): Promise<KeptRecord[]>;
  /** Passages holding a kept record of these kinds; with `ref`, only records with that second key (a person's recordings). */
  keptUnits(orgId: string, streamId: string, kinds: readonly KeptKind[], ref?: string): Promise<string[]>;
  /** Which of these passages hold a kept record of these kinds: a batch's question, not the whole language's. */
  keptUnitsAmong(orgId: string, streamId: string, kinds: readonly KeptKind[], unitIds: readonly string[]): Promise<string[]>;
  /** How many records of one kind a stream keeps. */
  keptCount(orgId: string, streamId: string, kind: KeptKind): Promise<number>;
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
  pull(orgId: string, streamId: string, after: number, limit: number): Promise<AnyEvent[]>;
  /** Newest snapshot for exactly this reducer version: where it is and how big, or null. */
  snapshotMeta(orgId: string, streamId: string, reducerVersion: number): Promise<SnapshotMeta | null>;
  /** One piece of that snapshot's JSON state; null if the seq no longer exists. */
  snapshotChunk(orgId: string, streamId: string, reducerVersion: number, serverSeq: number, index: number): Promise<string | null>;
  /**
   * Be told when something was appended to a stream, and whether the
   * channel is up. Optional: a transport without it is polled. The poke
   * carries no data; the client pulls through the authorized RPC.
   */
  watch?(orgId: string, streamId: string, handlers: WatchHandlers): () => void;
  /**
   * The server's cut of a language's newest snapshot (decisions.md 147):
   * what the whole language shares, which passages have rows and how many,
   * and every passage's line of this `LINES_VERSION`. Null when the newest
   * snapshot was written before the server cut snapshots. Optional: a
   * transport without it, or a server without the cut, gives the phone the
   * whole snapshot in pieces as before (decisions.md 143).
   */
  snapshotHead?(orgId: string, streamId: string, reducerVersion: number, linesVersion: number, withShared?: boolean): Promise<SnapshotHead | null>;
  /**
   * These passages' rows in the newest snapshot at or past `minSeq`, a page
   * at a time in (unit, kind, id) order from `after`. Null when there is no
   * such snapshot.
   */
  snapshotRows?(orgId: string, streamId: string, reducerVersion: number, minSeq: number, unitIds: readonly string[], after: RowCursor | null, limit: number): Promise<SnapshotRowsPage | null>;
  /** Which passage each of these takes, reviews, departures, requests or notes is in, by the newest snapshot; absent when it has none. */
  snapshotPassages?(orgId: string, streamId: string, reducerVersion: number, items: readonly { kind: string; id: string }[]): Promise<{ kind: string; id: string; unitId: string }[]>;
}

/** Where a page of a snapshot's rows ends: the next page starts after it. */
export interface RowCursor {
  unitId: string;
  kind: string;
  id: string;
}

export interface SnapshotHead {
  serverSeq: number;
  /** What the whole language shares (`LanguageState` with its passages' maps empty); absent when not asked for. */
  shared?: unknown;
  /** Every passage with rows in this snapshot, and how many: the fill's work and its progress. `''` holds file verdicts no passage names. */
  units: { unitId: string; rows: number }[];
  /** The lines of the asked `LINES_VERSION` and the stream's seq they hold at; null when the server has none of that version yet. */
  lines: { seq: number; lines: unknown[] } | null;
}

export interface SnapshotRowsPage {
  /** The snapshot these rows are from. */
  serverSeq: number;
  /** Each a row as the phone keeps it, but a file verdict's `unitId` is the passage it was fetched with. */
  rows: KeptRecord[];
  next: RowCursor | null;
}

export interface WatchHandlers {
  onPoke: () => void;
  onStatus: (connected: boolean) => void;
}

/** What the local log holds for a stream, for the sync status screen. */
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
 * actor's membership changes; a language not listed yet is retried on every
 * push; a clock-ahead refusal re-stamps the clock; invalid payloads never
 * retry.
 */
export type RejectCode = 'NOT_MEMBER' | 'NOT_ALLOWED' | 'NOT_LISTED' | 'INVALID' | 'CLOCK_AHEAD' | 'UNKNOWN';

/** What the server's not-listed refusal says; `requeue` asks the store for it by this text. */
export const NOT_LISTED_TEXT = 'language not listed';

export function rejectCodeOf(reason: string | undefined): RejectCode {
  const r = reason ?? '';
  if (/clock ahead/i.test(r)) return 'CLOCK_AHEAD';
  // A language's events reached the server before the organization stream
  // listed it (two streams, two outboxes): retried on every push.
  if (r.toLowerCase().includes(NOT_LISTED_TEXT)) return 'NOT_LISTED';
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
 * The phone holds a sign-in it could not renew yet (a rate limit, a 5xx, or
 * a captive portal answering for Supabase Auth), so the request was stopped
 * before it went out as no one (apps/mobile/src/server/sessionSafeFetch.ts).
 * It behaves as offline: work stays queued and nothing is refused. Only
 * diagnostics tell the two apart, because "offline" while the radio is fine
 * sends support looking at the wrong thing.
 */
export class UnrenewedError extends OfflineError {
  override name = 'UnrenewedError';
}

/** The texts sessionSafeFetch.ts fails with while the sign-in cannot be renewed (`NOT_RENEWED`, and a renewal's own answer). */
export const UNRENEWED_TEXT = /sign-in could not be renewed|sign-in renewal answered/i;

/**
 * The server answered with a failure that is neither a refusal nor a
 * version check. `code` is its own fixed code (a SQLSTATE such as `57014`,
 * a PostgREST `PGRST…`) or `http<status>`, never a message, so diagnostics
 * can keep it.
 */
export class ServerError extends Error {
  override name = 'ServerError';
  constructor(message: string, readonly code: string | undefined) {
    super(message);
  }
}

/**
 * The server was reached and refused the request: this actor is not a member
 * of the stream, or lacks the privilege. Distinct from `OfflineError` on
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

/**
 * An event bigger than the server takes (core `eventSizeError`, decisions.md
 * 115). Refused before it is recorded: kept, it could never be sent.
 */
export class EventTooLargeError extends Error {
  override name = 'EventTooLargeError';
}
