import type { OpenGate } from './nearbyModel';

/**
 * Why sharing while LangQuest is open waited (docs/nearby-sync-plan.md 15.6, 2026-11-25): a
 * phone let in offline shared nothing for about 21 minutes after its join, and no record said
 * why, since neither the gate (`openMayRun`) nor a rest after the room's pieces were missing
 * wrote anything. A wait is the time the mode is wanted, the app is in front with the screen on,
 * nothing else owns the radios and no room runs. One that lasts `OPEN_WAIT_RECORD_MS` or more
 * writes one `nearby` record, `event` `wait`, as it ends: `waitMs`, how long each input held it,
 * the rests that began in it by cause, and, for missing pieces, `why`. A locked screen, the app
 * lock, Share nearby or another screen running the radios, online and a cover are no wait: the
 * mode is not meant to run then. A wait a cover ended writes nothing, since the record would date the cover.
 * Durations and fixed words only, never who or what.
 */

/** What holds the room: a gate input that is not as the mode needs it, or `starting` while the gate is open and no room runs yet. */
export type OpenHeld = 'feature' | 'switch' | 'allow' | 'radios' | 'offered' | 'audio' | 'rest' | 'ready' | 'starting';

/** Why a rest began: the room's pieces were missing, a start failed or ran out of time, the radio failed, it turned away an unwelcome phone, or the room stopped by itself. */
export type OpenRest = 'pieces' | 'start' | 'radio' | 'unwelcome' | 'stopped';

/** Why the room's pieces were missing, as the record says it (`NEARBY_DIAG_BLOCKED`'s words). */
export type OpenPiecesWhy = 'no-key' | 'no-certificate';

/** The shortest wait a record is written for: a start takes seconds, and a rest a minute. */
export const OPEN_WAIT_RECORD_MS = 60_000;

/** Each input's field in the record: how long it held the wait, in milliseconds. */
export const OPEN_HELD_FIELDS = {
  feature: 'heldFeatureMs', switch: 'heldSwitchMs', allow: 'heldAllowMs', radios: 'heldRadiosMs', offered: 'heldOfferedMs',
  audio: 'heldAudioMs', rest: 'heldRestMs', ready: 'heldReadyMs', starting: 'startingMs'
} as const satisfies Record<OpenHeld, string>;

/** Each rest cause's field in the record: how many rests began for it. */
export const OPEN_REST_FIELDS = {
  pieces: 'restPieces', start: 'restStart', radio: 'restRadio', unwelcome: 'restUnwelcome', stopped: 'restStopped'
} as const satisfies Record<OpenRest, string>;

/**
 * What holds the room now, in the gate's order; null where nothing is waited on. The app lock is
 * no wait, as a locked screen is not: the person is not using the app behind it, and a record of
 * time behind it would say they use the lock, which marks them (decision 235 as amended).
 */
export function openHeldOf(g: OpenGate, running: boolean): OpenHeld[] | null {
  if (running || !g.active || g.locked || g.screenOpen || g.worn || !g.offline) return null;
  const held: OpenHeld[] = [];
  if (!g.feature) held.push('feature');
  if (!g.switchOn) held.push('switch');
  if (!g.granted) held.push('allow');
  if (!g.radiosOn) held.push('radios');
  if (!g.offered) held.push('offered');
  if (g.busy) held.push('audio');
  if (g.resting) held.push('rest');
  if (!g.ready) held.push('ready');
  return held.length > 0 ? held : ['starting'];
}

/** A `nearby` record's fields, as `NearbyDiagInput` takes them. */
export interface OpenWaitRecord {
  t: Record<string, string>;
  n: Record<string, number>;
}

/**
 * One language's waits: told what holds the room each time that changes, and each rest as it
 * begins. A rest begins while a room runs or starts, just before its wait, so rests told between
 * waits count in the next one.
 */
export class OpenWaitTally {
  private since: number | null = null;
  private last = 0;
  private held: readonly OpenHeld[] = [];
  private heldMs = new Map<OpenHeld, number>();
  private rests = new Map<OpenRest, number>();
  private why: OpenPiecesWhy | undefined;

  /** At `at` the room is held by `held`, or nothing is waited on (`null`): the record of a wait this ended, when it was long enough. */
  note(at: number, held: readonly OpenHeld[] | null): OpenWaitRecord | null {
    if (this.since !== null) {
      const ms = Math.max(0, at - this.last);
      for (const h of this.held) this.heldMs.set(h, (this.heldMs.get(h) ?? 0) + ms);
    }
    this.last = at;
    if (held === null) return this.end(at);
    this.since ??= at;
    this.held = held;
    return null;
  }

  /** A rest began, and why. */
  rest(cause: OpenRest, why?: OpenPiecesWhy): void {
    this.rests.set(cause, (this.rests.get(cause) ?? 0) + 1);
    if (why) this.why = why;
  }

  /** A cover ended the wait: forget it, rests and all, and write nothing. */
  drop(): void {
    this.reset();
  }

  private end(at: number): OpenWaitRecord | null {
    if (this.since === null) return null;
    const waitMs = Math.max(0, at - this.since);
    const n: Record<string, number> = { waitMs };
    for (const [h, ms] of this.heldMs) if (ms > 0) n[OPEN_HELD_FIELDS[h]] = ms;
    for (const [r, c] of this.rests) n[OPEN_REST_FIELDS[r]] = c;
    const why = this.why;
    this.reset();
    if (waitMs < OPEN_WAIT_RECORD_MS) return null;
    return { t: { event: 'wait', mode: 'open', ...(why ? { why } : {}) }, n };
  }

  private reset(): void {
    this.since = null;
    this.held = [];
    this.heldMs = new Map();
    this.rests = new Map();
    this.why = undefined;
  }
}
