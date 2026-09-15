import type { AnyEvent, LocalEventStatus } from '@langquest-next/core';

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
  put(local: LocalEvent): Promise<void>;
  /** Upsert many in one transaction: one pull page, one bulk append. */
  putMany(locals: LocalEvent[]): Promise<void>;
  get(id: string): Promise<LocalEvent | undefined>;
  /** Rejected events for a partition, oldest first, so the UI can show them and the client can retry them. */
  rejected(orgId: string, projectId: string): Promise<LocalEvent[]>;
  /** Pending events for a partition, oldest first. */
  pending(orgId: string, projectId: string): Promise<LocalEvent[]>;
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
