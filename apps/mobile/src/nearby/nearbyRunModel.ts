import type { FindKey } from './nearbyModel';
import type { NearbyUnavailable, PermissionsState, PermissionStep, RadioOff } from './nearbyPermissionsModel';

/**
 * Share nearby's run as plain data (docs/nearby-sync-plan.md 5.8, 5.11, section 8): what
 * `useNearby` keeps between the room's reports, when a stop latches, what a press and a lock
 * do, and what the screen is handed. Pure, so every rule is tested without radios: the hook
 * (useNearby.android.ts) turns the room's events into actions here and draws nothing.
 *
 * The room's events and a session's report are mirrored here by shape (`RoomReport`,
 * `SessionReportLike`), because only `.android` files import the nearby entries; sync's types
 * fit them as they are. No word is chosen here: the screen maps each key to its catalog, and
 * words a worn phone alone shows stay in src/disguise/i18n.
 */

// ---- what the room is told to do ----------------------------------------------------------

/** "Up to date" this long with nobody new stops the radios (5.8; a starting guess). */
export const NEARBY_IDLE_LIMIT_MS = 5 * 60_000;
/** Waiting on a busy teammate with something to swap: a longer backstop (a starting guess). */
export const NEARBY_WAIT_LIMIT_MS = 30 * 60_000;
/** On a phone that wears a cover, ten minutes from the press, even during a session (Carl's answer 15). */
export const NEARBY_RUN_LIMIT_MS = 10 * 60_000;
/** The room's tick: a new scan response, and so a new mask, whether or not anyone was heard (5.12, Find). */
export const NEARBY_TICK_MS = 2_000;
/** A session's progress redraws the screen at most this often. */
export const NEARBY_PROGRESS_MS = 250;
/** Lines of what came across, newest last. */
export const NEARBY_SESSIONS_KEPT = 20;

export interface RoomLimits {
  idleLimitMs: number;
  waitLimitMs: number;
  runLimitMs?: number;
  /** Stop at "Up to date", with no listening bursts. */
  stopWhenLevel: boolean;
}

/** A worn phone stops sooner: at ten minutes, and as soon as it is level (Carl's answer 15). */
export function roomLimitsFor(worn: boolean): RoomLimits {
  return worn
    ? { idleLimitMs: NEARBY_IDLE_LIMIT_MS, waitLimitMs: NEARBY_WAIT_LIMIT_MS, runLimitMs: NEARBY_RUN_LIMIT_MS, stopWhenLevel: true }
    : { idleLimitMs: NEARBY_IDLE_LIMIT_MS, waitLimitMs: NEARBY_WAIT_LIMIT_MS, stopWhenLevel: false };
}

export interface RadiosLike {
  directByName: boolean;
  band5: boolean;
  hotspot: boolean;
  joinHotspot: boolean;
}

/** What `arrange` says: a worn phone never joins a hotspot, whose system dialog names the application; it may still host. */
export function radiosFor(caps: RadiosLike, worn: boolean): RadiosLike {
  return { directByName: caps.directByName, band5: caps.band5, hotspot: caps.hotspot, joinHotspot: caps.joinHotspot && !worn };
}

/** Share nearby is offered only to someone holding a certificate for the organization and a discovery key for the language. */
export function nearbyOffered(certificate: boolean, findKey: FindKey | null | undefined): boolean {
  return certificate && !!findKey;
}

/** `orgSeqHere`: the organization stream as far as this phone has it, its cursor or its checkpoint (5.12, Chains). */
export function orgSeqHereOf(inspection: { cursor: number; checkpointSeq: number | null } | null): number {
  if (!inspection) return 0;
  return Math.max(inspection.cursor, inspection.checkpointSeq ?? 0);
}

/**
 * The `orgSeq` of this phone's certificate, which the hand-on waits for. With no readable first
 * link it is infinite, so a phone that cannot say what its key was made after never hands one on.
 */
export function certOrgSeqOf(chain: readonly unknown[] | undefined): number {
  const seq = (chain?.[0] as { body?: { org?: { orgSeq?: unknown } } } | undefined)?.body?.org?.orgSeq;
  return typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0 ? seq : Number.POSITIVE_INFINITY;
}

/**
 * Whether an install key is on the revocation list, for choosing partners only. Hello refuses
 * by pair; here any pair naming the key keeps the room from picking it, the cautious side,
 * at the cost of meetings with another person on that shared phone.
 */
export function listedKey(list: { keys: readonly (readonly [string, string, number])[] } | null | undefined, key: string | null): boolean {
  return key !== null && !!list?.keys.some(([k]) => k === key);
}

/** From holdings, as the room asks it: an unknown key counts as true both ways. */
export function swapOf(holdings: ReadonlyMap<string, { files: readonly string[] }>, myKey: string, key: string | null): { hasWhatIWant: boolean; wantsWhatIHave: boolean } {
  const theirs = key === null ? undefined : holdings.get(key);
  if (!theirs) return { hasWhatIWant: true, wantsWhatIHave: true };
  const mine = holdings.get(myKey)?.files ?? [];
  const held = new Set(mine);
  const theirsHeld = new Set(theirs.files);
  return { hasWhatIWant: theirs.files.some((f) => !held.has(f)), wantsWhatIHave: mine.some((f) => !theirsHeld.has(f)) };
}

/** `nearbyNames:<orgId>`, install key to person, as checked chains filled it; anything unreadable reads as nothing. */
export function namesOf(raw: string | null): Map<string, string> {
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Map();
    return new Map(parsed.filter((p): p is [string, string] => Array.isArray(p) && typeof p[0] === 'string' && typeof p[1] === 'string'));
  } catch {
    return new Map();
  }
}

// ---- what the room reports, by shape ------------------------------------------------------

/** sync's `NearbySessionReport`, as far as the screen reads it. */
export interface SessionReportLike {
  role: 'i' | 'r';
  ended: { how: string };
  peer: { profileId: string; tag: string } | null;
  newerAppNeeded: boolean;
  clockOff: boolean;
  linkKind: 'wifi-direct' | 'hotspot' | 'bluetooth' | 'memory' | null;
  got: { events: number; refused: number };
  sent: { events: number };
  files: { got: number; served: number; failed: number; noRoom: boolean; cutBackups: boolean };
  older: boolean;
  farAhead: readonly { actorId: string; hlc: string }[];
}

/** Why the room stopped: sync's `NearbyRoomStop`. `asked` is this phone's own stop (a blur, the background). */
export type RoomStop = 'asked' | 'idle' | 'wait' | 'run' | 'level' | 'no-key';

/** sync's `NearbyRoomEvent`. */
export type RoomReport =
  | { t: 'teammates'; seen: readonly { tag: string; key: string | null; older: boolean }[] }
  | { t: 'maybe'; tag: string }
  | { t: 'session'; tag: string | null; role: 'i' | 'r' }
  | { t: 'ended'; tag: string | null; report: SessionReportLike }
  | { t: 'level' }
  | { t: 'stopped'; why: RoomStop };

// ---- the run ------------------------------------------------------------------------------

/**
 * A stop that latches until Look again, reopening the screen, or on a worn phone a new press:
 * the room's own (`idle`, `wait`, `run`, `level`, `no-key`), `left` when a worn phone went to
 * the background (its lock clears the press), and `failed` when the radios would not start.
 */
export type NearbyStop = Exclude<RoomStop, 'asked'> | 'left' | 'failed';

/**
 * A teammate as the screen shows it: `here` once echoed (or tapped), `maybe` when no echo came
 * and connecting takes a tap ("A teammate may be nearby"), `exchanging` during a session with
 * them, `done` after one that ended well, `missed` after one that did not.
 */
export type TeammateState = 'here' | 'maybe' | 'exchanging' | 'done' | 'missed';

export interface NearbyTeammate {
  tag: string;
  /** Their install key, when this phone could put one to the tag. */
  key: string | null;
  /** The person, when known: from a session's checked chain, or `nearbyNames`; else "A teammate". */
  profileId: string | null;
  /** Heard under an older generation (5.12, Generations). */
  older: boolean;
  state: TeammateState;
}

/** What came across in one session. */
export interface NearbySessionLine {
  tag: string | null;
  profileId: string | null;
  role: 'i' | 'r';
  /** How it ended: `done`, `silent`, `no-answer`, `said`, `heard`, `dropped`, `stalled`, `failed`. */
  how: string;
  linkKind: SessionReportLike['linkKind'];
  eventsIn: number;
  eventsOut: number;
  refused: number;
  filesIn: number;
  filesOut: number;
  filesFailed: number;
  /** This phone stopped asking for files: too little room. */
  noRoom: boolean;
  /** Backups were cut for a teammate waiting (5.11). */
  cutBackups: boolean;
  /** The teammate could not send all it knows of: older work will come from the server. */
  olderFromServer: boolean;
}

/** The session under way, as its progress reports come. */
export interface NearbyProgress {
  tag: string | null;
  role: 'i' | 'r';
  eventsIn: number;
  eventsOut: number;
  filesIn: number;
  filesOut: number;
}

export interface NearbyRunState {
  /** A press since the last lock, on a worn phone. */
  pressed: boolean;
  /** The warning was shown for this press. */
  warned: boolean;
  /** Some press this run was warned: the first press always is. */
  warnedOnce: boolean;
  stopped: NearbyStop | null;
  running: boolean;
  /** "Up to date". */
  level: boolean;
  teammates: NearbyTeammate[];
  sessions: NearbySessionLine[];
  current: NearbyProgress | null;
  /** Authors of batches stamped far ahead, one line each (5.4). */
  farAhead: { actorId: string; hlc: string }[];
  /** A teammate's clock and this phone's differ by over five minutes (Hello). */
  clockOff: boolean;
  /** A teammate speaks a protocol range this build shares nothing with. */
  newerAppNeeded: boolean;
  /** Find failed natively: the module's code. */
  findError: string | null;
}

export const NEARBY_RUN_START: NearbyRunState = {
  pressed: false, warned: false, warnedOnce: false, stopped: null, running: false, level: false, teammates: [], sessions: [], current: null,
  farAhead: [], clockOff: false, newerAppNeeded: false, findError: null
};

export type NearbyRunAction =
  /** "Start sharing" on a worn phone. */
  | { t: 'press'; worn: boolean }
  /** The warning before any prompt was shown and read. */
  | { t: 'warned' }
  /** The cover came down over the app: a lock. */
  | { t: 'covered'; worn: boolean }
  /** The screen was opened again (a focus after a blur), which restarts a latched stop on a phone with no cover. */
  | { t: 'reopened'; worn: boolean }
  /** Look again: on a worn phone, a press. */
  | { t: 'look-again'; worn: boolean }
  | { t: 'started' }
  | { t: 'failed' }
  | { t: 'room'; report: RoomReport; worn: boolean; names?: ReadonlyMap<string, string> }
  | { t: 'progress'; report: SessionReportLike }
  | { t: 'tapped'; tag: string }
  | { t: 'find-error'; code: string };

const sameFarAhead = (a: { actorId: string; hlc: string }, b: { actorId: string; hlc: string }) => a.actorId === b.actorId;

/** One line per author, the furthest stamp. */
export function mergeFarAhead(held: readonly { actorId: string; hlc: string }[], more: readonly { actorId: string; hlc: string }[]): { actorId: string; hlc: string }[] {
  const out = [...held];
  for (const f of more) {
    const at = out.findIndex((h) => sameFarAhead(h, f));
    if (at < 0) out.push({ actorId: f.actorId, hlc: f.hlc });
    else if (f.hlc > out[at]!.hlc) out[at] = { actorId: f.actorId, hlc: f.hlc };
  }
  return out;
}

export function sessionLineOf(tag: string | null, r: SessionReportLike): NearbySessionLine {
  return {
    tag: tag ?? r.peer?.tag ?? null, profileId: r.peer?.profileId ?? null, role: r.role, how: r.ended.how, linkKind: r.linkKind,
    eventsIn: r.got.events, eventsOut: r.sent.events, refused: r.got.refused, filesIn: r.files.got, filesOut: r.files.served, filesFailed: r.files.failed,
    noRoom: r.files.noRoom, cutBackups: r.files.cutBackups, olderFromServer: r.older
  };
}

function withTeammate(list: NearbyTeammate[], tag: string, change: (t: NearbyTeammate) => NearbyTeammate, made: () => NearbyTeammate): NearbyTeammate[] {
  const at = list.findIndex((t) => t.tag === tag);
  if (at < 0) return [...list, change(made())];
  return list.map((t, i) => (i === at ? change(t) : t));
}

const stranger = (tag: string): NearbyTeammate => ({ tag, key: null, profileId: null, older: false, state: 'here' });

/** A stop clears the room's picture of who is here; what came across stays. */
function halted(s: NearbyRunState, stopped: NearbyStop | null, worn: boolean): NearbyRunState {
  const pressCleared = worn && stopped !== null;
  return {
    ...s, running: false, current: null, teammates: [], level: false, stopped: stopped ?? s.stopped,
    ...(pressCleared ? { pressed: false, warned: false } : {})
  };
}

function roomReported(s: NearbyRunState, e: RoomReport, worn: boolean, names: ReadonlyMap<string, string>): NearbyRunState {
  switch (e.t) {
    case 'teammates': {
      // Who echoed, in the room's order; a tag waiting on a tap, or in a session now, stays though the list leaves it out.
      const list: NearbyTeammate[] = e.seen.map((seen) => {
        const before = s.teammates.find((t) => t.tag === seen.tag);
        const key = seen.key ?? before?.key ?? null;
        const profileId = (key ? names.get(key) : undefined) ?? before?.profileId ?? null;
        return { tag: seen.tag, key, profileId, older: seen.older, state: before && before.state !== 'maybe' ? before.state : 'here' };
      });
      const waiting = s.teammates.filter((t) => (t.state === 'maybe' || t.state === 'exchanging') && !e.seen.some((x) => x.tag === t.tag));
      return { ...s, teammates: [...list, ...waiting] };
    }
    case 'maybe':
      if (s.teammates.some((t) => t.tag === e.tag)) return s;
      return { ...s, teammates: [...s.teammates, { ...stranger(e.tag), state: 'maybe' }] };
    case 'session': {
      const current: NearbyProgress = { tag: e.tag, role: e.role, eventsIn: 0, eventsOut: 0, filesIn: 0, filesOut: 0 };
      const teammates = e.tag === null ? s.teammates : withTeammate(s.teammates, e.tag, (t) => ({ ...t, state: 'exchanging' }), () => stranger(e.tag!));
      return { ...s, current, teammates, level: false };
    }
    case 'ended': {
      const r = e.report;
      const line = sessionLineOf(e.tag, r);
      const state: TeammateState = r.ended.how === 'done' ? 'done' : 'missed';
      // A responder learns who it was only from the report; the session it showed had no tag.
      const teammates = line.tag === null
        ? s.teammates
        : withTeammate(s.teammates.filter((t) => t.state !== 'exchanging' || t.tag === line.tag), line.tag,
          (t) => ({ ...t, profileId: line.profileId ?? t.profileId, state }), () => stranger(line.tag!));
      return {
        ...s, current: null, teammates, sessions: [...s.sessions, line].slice(-NEARBY_SESSIONS_KEPT),
        farAhead: mergeFarAhead(s.farAhead, r.farAhead), clockOff: s.clockOff || r.clockOff, newerAppNeeded: s.newerAppNeeded || r.newerAppNeeded
      };
    }
    case 'level':
      return { ...s, level: true };
    case 'stopped':
      return halted(s, e.why === 'asked' ? null : e.why, worn);
  }
}

export function nearbyRunReducer(s: NearbyRunState, a: NearbyRunAction): NearbyRunState {
  switch (a.t) {
    case 'press':
      return a.worn ? { ...s, pressed: true, warned: false, stopped: null } : { ...s, stopped: null };
    case 'warned':
      return { ...s, warned: true, warnedOnce: true };
    case 'covered':
      // A lock clears the press; typing the code does not set it again, so only a new press restarts (Carl's answer 15).
      if (!a.worn || (!s.pressed && !s.running)) return s;
      return { ...halted(s, 'left', true), pressed: false, warned: false };
    case 'reopened':
      return a.worn ? s : { ...s, stopped: null };
    case 'look-again':
      return nearbyRunReducer(s, { t: 'press', worn: a.worn });
    case 'started':
      return { ...s, running: true, level: false, findError: null };
    case 'failed':
      return halted(s, 'failed', false);
    case 'room':
      return roomReported(s, a.report, a.worn, a.names ?? new Map());
    case 'progress':
      if (!s.current) return s;
      return { ...s, current: { ...s.current, eventsIn: a.report.got.events, eventsOut: a.report.sent.events, filesIn: a.report.files.got, filesOut: a.report.files.served } };
    case 'tapped':
      return { ...s, teammates: s.teammates.map((t) => (t.tag === a.tag && t.state === 'maybe' ? { ...t, state: 'here' } : t)) };
    case 'find-error':
      return { ...s, findError: a.code };
  }
}

// ---- what the screen is handed ------------------------------------------------------------

/**
 * Why Share nearby cannot run here: the phone's own reasons (`NearbyUnavailable`), then
 * `no-key` (no install key yet), `no-certificate` (no certificate or discovery key for this
 * organization and language), `read-only` (a Global Viewer), and `loading` while it is worked out.
 */
export type NearbyWhyNot = NearbyUnavailable | 'no-key' | 'no-certificate' | 'read-only' | 'loading';

export interface NearbyView {
  /** Show the Share nearby row at all: a certificate for the organization and a discovery key for the language. */
  offered: boolean;
  /** Null when it can run; else why not, for the disabled row's line. */
  whyNot: NearbyWhyNot | null;
  /** Radios the person must turn on. */
  radiosOff: RadioOff[];
  permissions: { state: PermissionsState; step: PermissionStep };
  /** This phone wears a cover: it waits for a press, and stops sooner. */
  worn: boolean;
  /** Show "Start sharing": worn, and no press since the last lock. */
  needsPress: boolean;
  running: boolean;
  stopped: NearbyStop | null;
  /** "Up to date". */
  level: boolean;
  teammates: readonly NearbyTeammate[];
  sessions: readonly NearbySessionLine[];
  current: NearbyProgress | null;
  /** "Holding N for teammates": their recordings here the server has not confirmed. */
  holding: number;
  farAhead: readonly { actorId: string; hlc: string }[];
  clockOff: boolean;
  newerAppNeeded: boolean;
  findError: string | null;
  /** "Hold teammates' recordings", as pressed or by default. */
  hold: boolean;
}

export interface NearbyActions {
  /** "Start sharing" on a worn phone. */
  press(): void;
  /** After a stop that latched. On a worn phone it is a press. */
  lookAgain(): void;
  /** "A teammate may be nearby": connect with this one. */
  tap(tag: string): void;
  /** The warning was read: go on to the prompts, if any. */
  warned(): void;
  /** The line saying why was read: the system's prompts now. */
  askPermissions(): Promise<void>;
  /** Android will not prompt again: the app's settings. */
  openSettings(): Promise<void>;
  setHold(hold: boolean): Promise<void>;
}

export interface NearbyHandle {
  view: NearbyView;
  actions: NearbyActions;
}

export interface NearbyViewFacts {
  offered: boolean;
  whyNot: NearbyWhyNot | null;
  radiosOff: RadioOff[];
  permissions: { state: PermissionsState; step: PermissionStep };
  worn: boolean;
  run: NearbyRunState;
  holding: number;
  hold: boolean;
}

export function nearbyViewOf(f: NearbyViewFacts): NearbyView {
  const { run } = f;
  return {
    offered: f.offered, whyNot: f.whyNot, radiosOff: f.radiosOff, permissions: f.permissions, worn: f.worn,
    needsPress: f.worn && !run.pressed, running: run.running, stopped: run.stopped, level: run.level, teammates: run.teammates,
    sessions: run.sessions, current: run.current, holding: f.holding, farAhead: run.farAhead, clockOff: run.clockOff,
    newerAppNeeded: run.newerAppNeeded, findError: run.findError, hold: f.hold
  };
}
