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
 * Why this phone's Hello turned a phone away as `identity` (docs/nearby-sync-plan.md 15.8): its
 * certificate and the day met are older than the quiet mode's window, its key was revoked, it is
 * of another organization, its certificate expired, or anything else (a bad proof or signature, a
 * key this build does not know, another device). Never who it was.
 */
export const NEARBY_DIAG_REFUSALS = ['window', 'revoked', 'org', 'expired', 'other'] as const;

export type NearbyDiagRefusal = (typeof NEARBY_DIAG_REFUSALS)[number];

const REFUSAL_OF: Record<string, NearbyDiagRefusal> = {
  'certificate not recent': 'window', 'key revoked': 'revoked', listed: 'revoked',
  'wrong organization': 'org', 'no certificate for this organization': 'org', 'certificate expired': 'expired'
};

/** A refusal's reason as the record says it, from Hello's own words. */
export function refusalOf(detail: string | undefined): NearbyDiagRefusal {
  return (detail !== undefined ? REFUSAL_OF[detail] : undefined) ?? 'other';
}

/**
 * The `nearby` kind. `event` says which record: `room` when a room stops (`stop` why, never
 * `run` or `level`, which read as `asked`; `ms` it ran and `levelMs` to its first "Up to date",
 * each at most `NEARBY_ROOM_MS_CAP`; the phones `heard` that matched a key and how many
 * `echoed`, the bare adverts heard `alone` (an iPhone's, one per salt, which `heard` leaves out,
 * so a report tells an iPhone that heard another from one that heard nothing; 2026-11-19), `maybe` offers of a tap and the `taps`, `maxUnmatched` salts of this form no key
 * matched at once, `pipeFails` with the last `code`, `strangers` whose opening never checked,
 * `busy` turned away while in a session, `noAnswer`, `sessions` and `done`, and what the radio
 * can do: `adv`, `direct`, `hotspot`); `session` when one of this phone's sessions ends (`role`,
 * how it `end`ed with its `bye` reason or its native `code` or the class of a store `error`,
 * the `link` that moved the work after `fallbacks` attempts, events and files each way, refusals,
 * and flags as 0 or 1); `find` when Find fails natively (`code`); `blocked` when the screen
 * cannot run (`why`); `deliver` when a sync delivered teammates' work to the server (docs/nearby-sync-plan.md
 * section 6): `ms`, events `sent`, `events` the server took as new, `refused` here, of them `farAhead` and
 * `keyRefused` (a revoked key's later work or its cap), `noAnswer` batches the relay did not try, `done`
 * batches answered, and `error` the class of what stopped it early (`later` for not yet). A room record
 * from a build with sharing while LangQuest is open (docs/nearby-sync-plan.md 15.6) also says its
 * `mode`, `screen` or `open`, and for `open` the minutes it ran, `openMin`, and of them the minutes
 * spent scanning, `scanMin`, which is what the mode costs and whether it meets anyone.
 *
 * From 2026-11-24 (docs/nearby-sync-plan.md 15.8, decision 235 as amended): a session record says
 * its `mode`, and when this phone turned a phone away as `identity`, the `refusal` reason. A room
 * says `greets`, the sessions Share nearby began only to note a teammate's day again, and
 * `maxMeetMs`, the longest from first hearing a teammate to the first session this phone began
 * with it; `stop` `rest` is the quiet mode stopping to rest. While LangQuest is open, a session
 * that finished writes no record of its own: its room sums them (`events`, `sent`, `files`,
 * `served`, `fileFails`, `fallbacks`, `viaDirect` for those over Wi-Fi Direct, `syncMin`), so a
 * phone offline for weeks does not fill its queue, and says `pauseMin`, the minutes its radios
 * were off at "Up to date". Any other end still writes its own record.
 *
 * Also from 2026-11-24 (library documents and files between teammates): a session in which this
 * phone asked a teammate for library documents its language uses says how many it kept, how many
 * it refused (a text that did not check), how many the teammate could not give, and whether it
 * stopped at its cap (`docsKept`, `docsRefused`, `docsMissing`, `docsCapped` as 0 or 1); with
 * `library-files` on both sides, how many library files it said it holds, how many of the
 * teammate's it could use, and how many it got and served (`libHeld`, `libTheirs`, `libGot`,
 * `libServed`; `files` and `served` count only the language's recordings). Neither is there when
 * the session asked for no documents or exchanged no library files. A quiet room sums the
 * documents and the files got and served of its finished sessions; what a phone holds is not a sum.
 */
export const NEARBY_DIAG_SCHEMA = {
  nearby: {
    n: ['ms', 'levelMs', 'heard', 'echoed', 'alone', 'maybe', 'taps', 'maxUnmatched', 'pipeFails', 'strangers', 'busy', 'noAnswer', 'sessions', 'done',
      'fallbacks', 'events', 'sent', 'refused', 'overBudget', 'files', 'served', 'fileFails', 'keyRefused', 'farAhead',
      'noRoom', 'cutBackups', 'older', 'clockOff', 'newerApp', 'openMin', 'scanMin', 'pauseMin', 'syncMin', 'viaDirect', 'greets', 'maxMeetMs',
      'docsKept', 'docsRefused', 'docsMissing', 'docsCapped', 'libHeld', 'libTheirs', 'libGot', 'libServed'],
    t: {
      event: ['room', 'session', 'find', 'blocked', 'deliver'],
      mode: ['screen', 'open'],
      stop: ['asked', 'idle', 'wait', 'run', 'level', 'no-key', 'rest'],
      role: ['i', 'r'],
      end: ['done', 'silent', 'no-answer', 'said', 'heard', 'dropped', 'stalled', 'failed'],
      bye: ['done', 'nothing', 'busy', 'protocol', 'identity', 'not-member', 'stopped'],
      refusal: NEARBY_DIAG_REFUSALS,
      link: ['wifi-direct', 'hotspot', 'awdl', 'bluetooth'],
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

/** One of this phone's sessions, as it ended, and in which room's `mode`. Nothing in it says who the other phone was. */
export function sessionDiagOf(report: NearbySessionReport, ms: number, mode?: NearbyRoomModeDiag): NearbyDiagInput {
  const { ended, got, sent, files, topUp, libraryFiles: lib } = report;
  const t: Record<string, string> = { event: 'session', role: report.role, end: ended.how, ...(mode ? { mode } : {}) };
  if (ended.how === 'said' || ended.how === 'heard') t.bye = ended.reason;
  if (ended.how === 'said' && ended.reason === 'identity') t.refusal = refusalOf(ended.detail);
  if (ended.how === 'failed') t.error = ended.error;
  if (report.code) t.code = report.code;
  if (report.linkKind && report.linkKind !== 'memory') t.link = report.linkKind;
  return {
    t,
    n: {
      ms, fallbacks: report.fallbacks, events: got.events, sent: sent.events, refused: got.refused, overBudget: got.overBudget,
      files: files.got, served: files.served, fileFails: files.failed, keyRefused: report.handedKeyRefused, farAhead: report.farAhead.length,
      noRoom: flag(files.noRoom), cutBackups: flag(files.cutBackups), older: flag(report.older), clockOff: flag(report.clockOff),
      newerApp: flag(report.newerAppNeeded),
      ...(topUp ? { docsKept: topUp.kept, docsRefused: topUp.refused, docsMissing: topUp.missing, docsCapped: flag(topUp.capped) } : {}),
      ...(lib ? { libHeld: lib.held, libTheirs: lib.theirs, libGot: lib.got, libServed: lib.served } : {})
    }
  };
}

/** What a room counted while it ran: numbers only. */
export interface NearbyRoomTally {
  heard: number;
  echoed: number;
  /** Bare adverts heard (an iPhone's), one per salt: `heard` counts only phones that matched with a scan response. */
  alone: number;
  maybe: number;
  taps: number;
  maxUnmatched: number;
  pipeFails: number;
  strangers: number;
  busy: number;
  noAnswer: number;
  sessions: number;
  done: number;
  /** Sessions begun only to note a teammate's day again (15.8). */
  greets: number;
  /** From the room's start to its first "Up to date"; null when it never was. */
  levelMs: number | null;
  /** The longest from first hearing a teammate to the first session this phone began with it; null when none began. */
  maxMeetMs: number | null;
  code: NearbyDiagCode | null;
}

export const emptyRoomTally = (): NearbyRoomTally => ({
  heard: 0, echoed: 0, alone: 0, maybe: 0, taps: 0, maxUnmatched: 0, pipeFails: 0, strangers: 0, busy: 0, noAnswer: 0, sessions: 0, done: 0, greets: 0,
  levelMs: null, maxMeetMs: null, code: null
});

/** While LangQuest is open, the sessions that finished, summed in the room's record (decision 235 as amended). */
export interface NearbySyncedTally {
  events: number;
  sent: number;
  files: number;
  served: number;
  fileFails: number;
  fallbacks: number;
  viaDirect: number;
  /** Library documents taken from teammates, and the sessions that stopped at the cap. */
  docsKept: number;
  docsRefused: number;
  docsMissing: number;
  docsCapped: number;
  /** Library files got and served. */
  libGot: number;
  libServed: number;
  ms: number;
}

export const emptySyncedTally = (): NearbySyncedTally => ({
  events: 0, sent: 0, files: 0, served: 0, fileFails: 0, fallbacks: 0, viaDirect: 0, docsKept: 0, docsRefused: 0, docsMissing: 0, docsCapped: 0, libGot: 0, libServed: 0, ms: 0
});

/** Adds a finished session to the room's sums. */
export function addSynced(sum: NearbySyncedTally, report: NearbySessionReport, ms: number): void {
  sum.events += report.got.events;
  sum.sent += report.sent.events;
  sum.files += report.files.got;
  sum.served += report.files.served;
  sum.fileFails += report.files.failed;
  sum.fallbacks += report.fallbacks;
  if (report.linkKind === 'wifi-direct') sum.viaDirect += 1;
  if (report.topUp) {
    sum.docsKept += report.topUp.kept;
    sum.docsRefused += report.topUp.refused;
    sum.docsMissing += report.topUp.missing;
    sum.docsCapped += flag(report.topUp.capped);
  }
  if (report.libraryFiles) {
    sum.libGot += report.libraryFiles.got;
    sum.libServed += report.libraryFiles.served;
  }
  sum.ms += ms;
}

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

/** The longest `openMin` says: a day. */
export const NEARBY_OPEN_MIN_CAP = 24 * 60;

export type NearbyRoomModeDiag = 'screen' | 'open';

/** Which way a room ran, and while LangQuest was open how long it scanned and paused, and what its finished sessions moved. */
export type RoomDiagMode = { mode: 'screen' } | { mode: 'open'; scanMs: number; pauseMs: number; synced: NearbySyncedTally };

/**
 * A room that stopped, why, how long it ran (to the cap), and what this phone's radio can do. With
 * `mode`, which way it ran; only a phone with no cover runs while LangQuest is open, so an `open`
 * room's minutes are not capped at a disguised phone's run limit.
 */
export function roomDiagOf(tally: NearbyRoomTally, stop: string, ms: number, caps: NearbyCapabilities | null, how?: RoomDiagMode): NearbyDiagInput {
  const { levelMs, maxMeetMs, code, ...counts } = tally;
  const t: Record<string, string> = { event: 'room', stop: STOP_RECORDED[stop] ?? stop, ...(how ? { mode: how.mode } : {}) };
  if (code) t.code = code;
  if (caps) {
    t.adv = caps.advertise ? 'yes' : 'no';
    t.direct = caps.directByName ? 'yes' : 'no';
    t.hotspot = caps.hotspot ? 'yes' : 'no';
  }
  const capped = (x: number) => Math.min(x, NEARBY_ROOM_MS_CAP);
  const minutes = (x: number) => Math.min(NEARBY_OPEN_MIN_CAP, Math.round(x / 60_000));
  let open: Record<string, number> = {};
  if (how?.mode === 'open') {
    const { ms: syncMs, ...synced } = how.synced;
    open = { openMin: minutes(ms), scanMin: minutes(Math.min(how.scanMs, ms)), pauseMin: minutes(Math.min(how.pauseMs, ms)), ...synced, syncMin: minutes(Math.min(syncMs, ms)) };
  }
  return {
    t,
    n: { ms: capped(ms), ...counts, ...(levelMs !== null ? { levelMs: capped(levelMs) } : {}), ...(maxMeetMs !== null ? { maxMeetMs: capped(maxMeetMs) } : {}), ...open }
  };
}

/** One sync's delivery of teammates' work: counts, and why it stopped early. Names no author, key or event. */
export function deliverDiagOf(d: { sent: number; taken: number; refused: number; farAhead: number; keyRefused: number; batchesRefused: number; batches: number; stopped?: string }, ms: number): NearbyDiagInput {
  return {
    t: { event: 'deliver', ...(d.stopped ? { error: d.stopped } : {}) },
    n: { ms, sent: d.sent, events: d.taken, refused: d.refused, farAhead: d.farAhead, keyRefused: d.keyRefused, noAnswer: d.batchesRefused, done: d.batches }
  };
}
