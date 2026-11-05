import { decodeHlc } from '@langquest-next/core';
import { DEVICE } from '@langquest-next/v2-import';

/**
 * What the projection pass learns about how work reaches the server, from a
 * sample of the events that arrived since its last pass (ops dashboard plan
 * 5.4). `public.events` has no index on `received_at`, so the pass reads the
 * newest few per language through the (org, stream, server_seq) index it
 * already uses, instead of a query that scans the log. Pure: the pass reads
 * the rows (server/projectionWorker.ts), this works out the numbers.
 */

/** Most events read per language per pass: the newest ones. */
export const ARRIVAL_SAMPLE = 1000;
/** An event stamped later than this after the server's clock when it arrived came from a wrong clock. */
export const FUTURE_SLACK_MS = 5 * 60_000;

/**
 * Devices that write work on the server rather than upload it: the v2
 * import (packages/v2-import/src/reconcile.ts DEVICE) stamps each event with
 * the time its v2 record changed, so its "delay" is the import's schedule,
 * not a phone's. Their events count as arrived but not in the delays.
 */
export const SERVER_DEVICES: ReadonlySet<string> = new Set([DEVICE]);

/** The columns the sample selects. */
export interface ArrivalRow { hlc: string; received_at: string; device_id: string }

/** Recorded in the `projection` job run's `n`. The max… fields are kept as the window's largest by diag.totals, the rest are summed. */
export interface ArrivalStats {
  /** Events the sample read from phones and browsers (not SERVER_DEVICES). */
  arrivalsSampled: number;
  /** Events appended since the last pass, sampled or not. */
  newEvents: number;
  maxUploadDelayP50Ms: number;
  maxUploadDelayP95Ms: number;
  maxUploadDelayMs: number;
  /** Events stamped more than five minutes after the server's clock. */
  futureStamped: number;
  /** Distinct devices among them. */
  futureStampedInstalls: number;
}

/** Nearest-rank percentile of an ascending list; 0 when empty. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]!;
}

/** The numbers for a pass: every sampled row of every language, and how many events arrived in all. */
export function arrivalStats(rows: readonly ArrivalRow[], newEvents: number): ArrivalStats {
  const delays: number[] = [];
  const future = new Set<string>();
  let futureStamped = 0;
  for (const row of rows) {
    if (SERVER_DEVICES.has(row.device_id)) continue;
    let wall: number;
    try {
      wall = decodeHlc(row.hlc).wallMs;
    } catch {
      continue;
    }
    const received = Date.parse(row.received_at);
    if (!Number.isFinite(wall) || Number.isNaN(received)) continue;
    // A phone that was never offline uploads within seconds; a stamp ahead of the server is no delay.
    delays.push(Math.max(0, received - wall));
    if (wall - received > FUTURE_SLACK_MS) {
      futureStamped += 1;
      future.add(row.device_id);
    }
  }
  delays.sort((a, b) => a - b);
  return {
    arrivalsSampled: delays.length,
    newEvents,
    maxUploadDelayP50Ms: percentile(delays, 50),
    maxUploadDelayP95Ms: percentile(delays, 95),
    maxUploadDelayMs: delays.at(-1) ?? 0,
    futureStamped,
    futureStampedInstalls: future.size
  };
}
