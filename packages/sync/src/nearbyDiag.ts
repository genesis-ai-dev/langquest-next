import type { DiagSpec } from './diagnostics';
import type { NearbyCapabilities } from './nearbyLink';
import type { NearbySessionReport } from './nearbySession';

/**
 * What Share nearby records for field diagnostics (docs/diagnostics.md, docs/nearby-sync-plan.md
 * sections 9 and 11): one `nearby` record when a room stops, one when a session of this phone's
 * ends, one when Find fails natively, and one when the screen cannot run. Counts, durations and
 * fixed codes only, so "Share nearby never finds anyone" or "it stops" can be read with `npm run
 * diag`: never a tag, salt, key, install key, profile or device id, name, summary or file, so
 * nothing says who was met or what moved. Whether a phone wears a disguise, and its "Hold
 * teammates' recordings" row, are not recorded either, since either would mark the person.
 * It lives in the nearby entry, so the web carries none of it; the server's allowlist
 * (`diag.schema()`) holds it beside the rest.
 */

/**
 * The nearby module's codes (apps/mobile/modules/nearby-link/src/codes.ts, in its order): the
 * allowlist holds them, so a code is one of these or nothing. apps/mobile/test/nearbyDiagModel.test.ts
 * holds the two lists equal, since sync may not import the app.
 */
export const NEARBY_DIAG_CODES = [
  'NOT_AVAILABLE', 'NO_PERMISSION', 'BLUETOOTH_OFF', 'WIFI_OFF', 'BAD_ARGUMENT', 'ADVERTISE_UNSUPPORTED', 'ADVERTISE_FAILED', 'SCAN_FAILED',
  'FIND_NOT_RUNNING', 'PEER_GONE', 'PIPE_FAILED', 'PIPE_TIMEOUT', 'P2P_UNSUPPORTED', 'GROUP_BUSY', 'GROUP_FAILED', 'HOTSPOT_NO_CHANNEL',
  'HOTSPOT_INCOMPATIBLE', 'HOTSPOT_TETHERING_DISALLOWED', 'HOTSPOT_FAILED', 'JOIN_FAILED', 'JOIN_TIMEOUT', 'HOST_TAKEN_DOWN', 'LINK_UNKNOWN',
  'LINK_CLOSED', 'LINK_DROPPED', 'TAG_FAILED', 'FRAME_TOO_LARGE', 'MESSAGE_TOO_LARGE', 'NOT_SECURED', 'ALREADY_SECURED', 'OPENING_AFTER_SECURE',
  'TRANSFER_BUSY', 'FILE_TOO_BIG', 'FILE_NO_SPACE', 'FILE_REFUSED', 'FILE_CANCELLED', 'FILE_UNREADABLE', 'FILE_WRITE_FAILED', 'FILE_SIZE_MISMATCH',
  'STAGING_REFUSED', 'STOPPED', 'INTERNAL'
] as const;

export type NearbyDiagCode = (typeof NEARBY_DIAG_CODES)[number];

/** Why Share nearby could not run when the screen was open: the app's reasons, a radio off, or permissions refused. */
export const NEARBY_DIAG_BLOCKED = [
  'not-in-build', 'android-too-old', 'no-bluetooth-le', 'no-wifi-direct', 'no-key', 'no-certificate', 'read-only',
  'bluetooth-off', 'wifi-off', 'location-off', 'permission-approximate', 'permission-blocked'
] as const;

export type NearbyDiagBlocked = (typeof NEARBY_DIAG_BLOCKED)[number];

const YES_NO = ['yes', 'no'] as const;

/**
 * The `nearby` kind. `event` says which record: `room` when a room stops (`stop` why, never
 * `run` or `level`, which read as `asked`; `ms` it ran and `levelMs` to its first "Up to date",
 * each at most `NEARBY_ROOM_MS_CAP`; the phones `heard` that matched a key and how many
 * `echoed`, `maybe` offers of a tap and the `taps`, `maxUnmatched` salts of this form no key
 * matched at once, `pipeFails` with the last `code`, `strangers` whose opening never checked,
 * `busy` turned away while in a session, `noAnswer`, `sessions` and `done`, and what the radio
 * can do: `adv`, `direct`, `hotspot`); `session` when one of this phone's sessions ends (`role`,
 * how it `end`ed with its `bye` reason or its native `code` or the class of a store `error`,
 * the `link` that moved the work after `fallbacks` attempts, events and files each way, refusals,
 * and flags as 0 or 1); `find` when Find fails natively (`code`); `blocked` when the screen
 * cannot run (`why`); `deliver` when a sync delivered teammates' work to the server (docs/nearby-sync-plan.md
 * section 6): `ms`, events `sent`, `events` the server took as new, `refused` here, of them `farAhead` and
 * `keyRefused` (a revoked key's later work or its cap), `noAnswer` batches the relay did not try, `done`
 * batches answered, and `error` the class of what stopped it early (`later` for not yet).
 */
export const NEARBY_DIAG_SCHEMA = {
  nearby: {
    n: ['ms', 'levelMs', 'heard', 'echoed', 'maybe', 'taps', 'maxUnmatched', 'pipeFails', 'strangers', 'busy', 'noAnswer', 'sessions', 'done',
      'fallbacks', 'events', 'sent', 'refused', 'overBudget', 'files', 'served', 'fileFails', 'keyRefused', 'farAhead',
      'noRoom', 'cutBackups', 'older', 'clockOff', 'newerApp'],
    t: {
      event: ['room', 'session', 'find', 'blocked', 'deliver'],
      stop: ['asked', 'idle', 'wait', 'run', 'level', 'no-key'],
      role: ['i', 'r'],
      end: ['done', 'silent', 'no-answer', 'said', 'heard', 'dropped', 'stalled', 'failed'],
      bye: ['done', 'nothing', 'busy', 'protocol', 'identity', 'not-member', 'stopped'],
      link: ['wifi-direct', 'hotspot', 'bluetooth'],
      code: NEARBY_DIAG_CODES,
      error: 'token',
      why: NEARBY_DIAG_BLOCKED,
      adv: YES_NO,
      direct: YES_NO,
      hotspot: YES_NO
    }
  }
} as const satisfies Record<string, DiagSpec>;

/** A `nearby` record's fields; the caller adds the organization and language. */
export interface NearbyDiagInput {
  n?: Record<string, number>;
  t: Record<string, string>;
}

/**
 * The native code an error carries: the app's adapter rejects a drop with an `OfflineError` whose
 * message is the code, and anything else with an error whose `code` is. Only a listed code counts.
 */
export function nearbyCodeOf(error: unknown): NearbyDiagCode | undefined {
  if (!(error instanceof Error)) return undefined;
  const code = (error as { code?: unknown }).code;
  const text = typeof code === 'string' ? code : error.message;
  return (NEARBY_DIAG_CODES as readonly string[]).includes(text) ? (text as NearbyDiagCode) : undefined;
}

const flag = (b: boolean) => (b ? 1 : 0);

/** One of this phone's sessions, as it ended. Nothing in it says who the other phone was. */
export function sessionDiagOf(report: NearbySessionReport, ms: number): NearbyDiagInput {
  const { ended, got, sent, files } = report;
  const t: Record<string, string> = { event: 'session', role: report.role, end: ended.how };
  if (ended.how === 'said' || ended.how === 'heard') t.bye = ended.reason;
  if (ended.how === 'failed') t.error = ended.error;
  if (report.code) t.code = report.code;
  if (report.linkKind && report.linkKind !== 'memory') t.link = report.linkKind;
  return {
    t,
    n: {
      ms, fallbacks: report.fallbacks, events: got.events, sent: sent.events, refused: got.refused, overBudget: got.overBudget,
      files: files.got, served: files.served, fileFails: files.failed, keyRefused: report.handedKeyRefused, farAhead: report.farAhead.length,
      noRoom: flag(files.noRoom), cutBackups: flag(files.cutBackups), older: flag(report.older), clockOff: flag(report.clockOff),
      newerApp: flag(report.newerAppNeeded)
    }
  };
}

/** What a room counted while it ran: numbers only. */
export interface NearbyRoomTally {
  heard: number;
  echoed: number;
  maybe: number;
  taps: number;
  maxUnmatched: number;
  pipeFails: number;
  strangers: number;
  busy: number;
  noAnswer: number;
  sessions: number;
  done: number;
  /** From the room's start to its first "Up to date"; null when it never was. */
  levelMs: number | null;
  code: NearbyDiagCode | null;
}

export const emptyRoomTally = (): NearbyRoomTally => ({
  heard: 0, echoed: 0, maybe: 0, taps: 0, maxUnmatched: 0, pipeFails: 0, strangers: 0, busy: 0, noAnswer: 0, sessions: 0, done: 0, levelMs: null, code: null
});

/**
 * The longest a room record says it ran: a disguised phone's run limit (the app's
 * `NEARBY_RUN_LIMIT_MS`, held equal by apps/mobile/test/nearbyDiagModel.test.ts). A worn phone's
 * room always stops by then, so a plain phone's longer run reads as this too, and a run that
 * ended at exactly ten minutes is one any phone left on past ten records.
 */
export const NEARBY_ROOM_MS_CAP = 10 * 60_000;

/**
 * Stops only a disguised phone makes, at its run limit and at "Up to date" (decision 231), read
 * as a stop by asking, so a worn phone's record is one a plain phone also makes (decision 235).
 */
const STOP_RECORDED: Record<string, string> = { run: 'asked', level: 'asked' };

/** A room that stopped, why, how long it ran (to the cap), and what this phone's radio can do. */
export function roomDiagOf(tally: NearbyRoomTally, stop: string, ms: number, caps: NearbyCapabilities | null): NearbyDiagInput {
  const { levelMs, code, ...counts } = tally;
  const t: Record<string, string> = { event: 'room', stop: STOP_RECORDED[stop] ?? stop };
  if (code) t.code = code;
  if (caps) {
    t.adv = caps.advertise ? 'yes' : 'no';
    t.direct = caps.directByName ? 'yes' : 'no';
    t.hotspot = caps.hotspot ? 'yes' : 'no';
  }
  const capped = (x: number) => Math.min(x, NEARBY_ROOM_MS_CAP);
  return { t, n: { ms: capped(ms), ...counts, ...(levelMs !== null ? { levelMs: capped(levelMs) } : {}) } };
}

/** One sync's delivery of teammates' work: counts, and why it stopped early. Names no author, key or event. */
export function deliverDiagOf(d: { sent: number; taken: number; refused: number; farAhead: number; keyRefused: number; batchesRefused: number; batches: number; stopped?: string }, ms: number): NearbyDiagInput {
  return {
    t: { event: 'deliver', ...(d.stopped ? { error: d.stopped } : {}) },
    n: { ms, sent: d.sent, events: d.taken, refused: d.refused, farAhead: d.farAhead, keyRefused: d.keyRefused, noAnswer: d.batchesRefused, done: d.batches }
  };
}
