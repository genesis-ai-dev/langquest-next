import type { AnyEvent, LocalEventStatus } from '@langquest-next/core';
import type { NearbyVia } from '@langquest-next/core/nearby';

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
  /**
   * Events from a teammate's phone, applied after `events`. Insert only: `events`
   * would overwrite a row's status, and a nearby copy must never downgrade a
   * confirmed, pending or rejected one.
   */
  receive?: LocalEvent[];
  /** Removes these ids from this stream, only where they are still `nearby`. */
  dropNearby?: { orgId: string; streamId: string; ids: string[] };
  /** Insert only: the first signature for a number stays. */
  batches?: NearbyBatchRow[];
  dropBatches?: { orgId: string; streamId: string; keys: { key: string; n: number }[] };
  /** Insert only. */
  attests?: NearbyAttestRow[];
  dropAttests?: { orgId: string; streamId: string; upToSeq: number };
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
  /** How it got here from a teammate's phone. A row written without one has it cleared, so a confirm or a restamp leaves none. */
  via?: NearbyVia;
}

/** One signed batch (docs/nearby-sync-plan.md 5.12). A manifest cannot live on a row: it holds up to 200 ids and digests. */
export interface NearbyBatchRow {
  orgId: string;
  streamId: string;
  /** The signer's install key. */
  key: string;
  n: number;
  deviceId: string;
  actorId: string;
  /** Its oldest event's clock, for delivery's order; null with no events. */
  firstHlc: string | null;
  /** The canonical text as signed, so nobody has to reproduce it. */
  manifest: string;
  sig: string;
  /** The signer's chain at signing, as JSON. */
  chain: string;
}

/** The Worker's word for rows this phone pulled, kept until `prune` passes them. */
export interface NearbyAttestRow {
  orgId: string;
  streamId: string;
  lastSeq: number;
  /** The canonical text as signed. */
  text: string;
  kid: string;
  sig: string;
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
  /** Removes every meta row whose key starts with this, exactly and in this case. An empty prefix removes nothing, since the device id lives here. */
  clearMeta(prefix: string): Promise<void>;
  // All required below, so a store missing one cannot silently break a trap in docs/nearby-sync-plan.md 5.4.
  /** Pending and nearby together: what the checkpoint's fast path must not save as confirmed. */
  unconfirmedCount(orgId: string, streamId: string): Promise<number>;
  nearbyCount(orgId: string, streamId: string): Promise<number>;
  /** Nearby rows in id order, after `afterId` (null for the first page). */
  nearbyPage(orgId: string, streamId: string, afterId: string | null, limit: number): Promise<LocalEvent[]>;
  /** Nearby rows that withdraw or undo one of these reviews, notes or departures: the three undo types, by the id each names. */
  nearbyUndoing(orgId: string, streamId: string, targetIds: readonly string[]): Promise<LocalEvent[]>;
  /** The rows holding these ids, of any status and any stream, in no set order. */
  getMany(ids: readonly string[]): Promise<LocalEvent[]>;
  /** Pending rows no batch speaks for yet, oldest first, strictly after `afterHlc` (null for the first page). */
  unsignedPage(orgId: string, streamId: string, afterHlc: string | null, limit: number): Promise<LocalEvent[]>;
  /** Confirmed rows past `afterSeq`, in `serverSeq` order. */
  confirmedAfter(orgId: string, streamId: string, afterSeq: number, limit: number): Promise<LocalEvent[]>;
  /** Every batch held, without its manifest, by signer and then number. */
  batchKeys(orgId: string, streamId: string): Promise<{ key: string; n: number; actorId: string; firstHlc: string | null }[]>;
  /** One signer's batches past `afterN`, in number order. */
  batchesAfter(orgId: string, streamId: string, key: string, afterN: number, limit: number): Promise<NearbyBatchRow[]>;
  /** Every attestation held, by `lastSeq`. */
  attestedUpTo(orgId: string, streamId: string): Promise<NearbyAttestRow[]>;
  /** One grouped read of what nearby rows cost, by whose budget they spend (`nearbyBudgetOf`). */
  nearbyUse(orgId: string, streamId: string): Promise<NearbyUse[]>;
}

/** Rows and characters of JSON held as nearby under one budget, and characters of manifest text kept for it. */
export interface NearbyUse {
  who: string;
  rows: number;
  bytes: number;
  manifestBytes: number;
}

/**
 * Whose budget a nearby row spends: a batch row its author's, and a claim its claimer's,
 * never the event's author, so that a teammate cannot spend Sam's budget by naming him.
 */
export const nearbyBudgetOf = (actorId: string, via: NearbyVia | undefined): string => (via && 'claim' in via ? `claim:${via.claim.key}` : `actor:${actorId}`);

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
  /**
   * What the server holds of these ids, at most 500 (docs/nearby-sync-plan.md 5.7). Null
   * when the database is behind. An id it does not hold is not in the answer. Optional, and
   * in every list that wraps a transport by hand: a list that misses it turns the sweep off
   * and says nothing (`nearbySweep.test.ts`).
   */
  knownEvents?(orgId: string, streamId: string, ids: readonly string[]): Promise<KnownEvent[] | null>;
  /**
   * The Worker's word for up to 200 rows past `afterSeq`, over rows it read itself (docs/nearby-sync-plan.md
   * 5.12, Claims). Null when off, or not yet.
   */
  attest?(orgId: string, streamId: string, afterSeq: number): Promise<{ text: string; kid: string; sig: string } | null>;
  /**
   * Teammates' signed batches, delivered on their authors' behalf (docs/nearby-sync-plan.md
   * section 6, the Worker's `POST /api/relay`): one answer per batch, `refused` when it was
   * not tried, else a verdict per event as `append_events` words it. Null when not yet (no
   * key on the Worker, a database behind); LQ001 throws `ClientTooOldError`. Optional, and in
   * every list that wraps a transport by hand.
   */
  relay?(orgId: string, streamId: string, batches: RelayBatch[]): Promise<RelayAnswer[] | null>;
}

/** One signed batch as it is kept here: its manifest as signed, the signature, the signer's chain, and the rows still here it speaks for. */
export interface RelayBatch {
  manifest: string;
  sig: string;
  chain: unknown[];
  events: AnyEvent[];
}

/** The relay's answer for one batch, named by its signer's key and number. */
export interface RelayAnswer {
  key: string;
  n: number;
  refused?: string;
  verdicts?: AppendResult[];
}

/** One id as the server holds it. */
export interface KnownEvent {
  id: string;
  serverSeq: number;
  hlc: string;
  actorId: string;
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
  /** Rows held for teammates, which `total` also counts. */
  nearby: number;
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
