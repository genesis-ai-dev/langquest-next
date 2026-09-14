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
  get(id: string): Promise<LocalEvent | undefined>;
  /** Pending events for a partition, oldest first. */
  pending(orgId: string, projectId: string): Promise<LocalEvent[]>;
  /** Every non-rejected event for a partition (confirmed then pending is fine). */
  all(orgId: string, projectId: string): Promise<LocalEvent[]>;
  /** Highest confirmed server_seq seen for a partition, 0 if none. */
  cursor(orgId: string, projectId: string): Promise<number>;
  setCursor(orgId: string, projectId: string, seq: number): Promise<void>;
}

export interface AppendResult {
  id: string;
  accepted: boolean;
  serverSeq: number | null;
  reason: string | null;
}

/** The two server calls from PLAN.md section 9. */
export interface Transport {
  append(events: AnyEvent[]): Promise<AppendResult[]>;
  pull(orgId: string, projectId: string, after: number, limit: number): Promise<AnyEvent[]>;
}

export class OfflineError extends Error {
  override name = 'OfflineError';
}
