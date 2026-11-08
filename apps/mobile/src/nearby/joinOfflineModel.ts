import type { LocalPerson } from '../session/localPersonModel';
import { mayKeepLocalPerson } from '../session/localPersonModel';

/**
 * Joining offline on the newcomer's phone (docs/nearby-sync-plan.md 14.1, 3 to 5), as pure rules:
 * whether this phone may take a newcomer at all, the record after the inviter's grant and after the
 * starting copy, what the app is told before the person is set, and what the progress screen says.
 * Nothing here calls anything, so every rule is tested without a phone.
 */

/** Why this phone cannot take a newcomer: it already holds someone's work (14.1, 3, "Only on a phone with nobody on it"). */
export type NotEmptyWhy = 'session' | 'locks' | 'hand-over' | 'local-person' | 'unsent' | 'cover';

/**
 * Only a phone with nobody on it: no saved session, lock, hand-over, local person beyond a leftover
 * `asking` record, or unsent row. A local person makes Sign In unreachable, which would lock out
 * everyone signed out here (decision 168), so the first of these that holds says why not.
 */
export function notEmptyWhy(here: { session: boolean; locks: boolean; handOvers: boolean; local: LocalPerson | null; unsent: boolean; worn?: boolean }): NotEmptyWhy | null {
  if (here.session) return 'session';
  if (here.local && here.local.stage !== 'asking') return 'local-person';
  if (here.locks) return 'locks';
  if (here.handOvers) return 'hand-over';
  if (here.unsent) return 'unsent';
  // A cover is chosen by someone signed in, so a phone that wears one has had someone on it.
  if (here.worn) return 'cover';
  return null;
}

/**
 * The record to ask with: a leftover `asking` record is kept only when its install key is still the
 * one in the Keystore and its name is the one typed, so a dropped link or another inviter gets the
 * same id (14.1, 3); otherwise a new key and `idSalt` replace it. Null means make new ones.
 */
export function askingRecord(held: LocalPerson | null, installKey: string | null, name: string): LocalPerson | null {
  if (!held || held.stage !== 'asking' || !installKey || held.installKey !== installKey || held.name !== name) return null;
  return held;
}

/** The record once the grant has been checked: `filling`, with the two-link chain. Null when it may not be kept over what is held. */
export function afterGrant(held: LocalPerson, chain: unknown[]): LocalPerson | null {
  const next: LocalPerson = { ...held, stage: 'filling', chain };
  return mayKeepLocalPerson(held, next) ? next : null;
}

/** The record once the copy is whole: `ready`, and only then, since `Shell` remounts on the actor id (section 7, phase 6). */
export function afterCopy(held: LocalPerson, whole: boolean): LocalPerson | null {
  if (!whole || held.stage !== 'filling') return null;
  return { ...held, stage: 'ready' };
}

/**
 * What the app reads at its first start as this person, written before `ready`: the organization
 * open, the language worked in, the welcome for joining, and the names the copy's members go by,
 * with the person's own and the inviter's (the chain names both). Plain `AsyncStorage` pairs.
 */
export function seedsFor(o: { profileId: string; orgId: string; languageId: string; name: string; names: Record<string, string> }): [string, string][] {
  const names: Record<string, string> = {};
  for (const [id, n] of Object.entries(o.names)) if (typeof n === 'string' && n.trim() && n.length <= 200) names[id] = n;
  if (o.name.trim()) names[o.profileId] = o.name.trim();
  return [
    [`selection:${o.profileId}`, JSON.stringify({ orgId: o.orgId })],
    [`language:${o.profileId}:${o.orgId}`, o.languageId],
    [`joined:${o.profileId}`, '1'],
    [`profile-directory:${o.profileId}`, JSON.stringify(names)]
  ];
}

/** How a join ended, as the progress screen words it. */
export type JoinEnd =
  /** The inviter said No, or never tapped in time. */
  | 'not-let-in'
  /** The opening did not answer, or did not match the code: an old code, or another phone. */
  | 'no-answer'
  /** The two phones' clocks are over five minutes apart. */
  | 'clock'
  /** The two phones run other versions of the app: no starting copy moves between them. */
  | 'versions'
  /** The grant did not check: refused, as a stranger would be. */
  | 'refused'
  /** The link dropped before the grant: a new code is needed. */
  | 'dropped'
  /** Something on this phone failed. */
  | 'failed';

/** What the session's report says of how it ended, for a newcomer who was not let in. */
export function joinEndOf(r: {
  ended: { how: string; reason?: string; detail?: string }; versionsDiffer: boolean; clockOff: boolean; join: { granted: boolean; refused: string | null } | null;
}): JoinEnd {
  if (r.versionsDiffer) return 'versions';
  if (r.clockOff) return 'clock';
  const e = r.ended;
  if (e.how === 'silent' || e.how === 'no-answer') return 'no-answer';
  if (e.how === 'heard' && e.reason === 'stopped') return 'not-let-in';
  if (e.how === 'said' && e.reason === 'stopped') return 'not-let-in';
  if (e.how === 'said' && (e.reason === 'identity' || e.reason === 'protocol')) return 'refused';
  if (e.how === 'heard' && (e.reason === 'identity' || e.reason === 'protocol' || e.reason === 'nothing')) return 'refused';
  if (e.how === 'failed') return 'failed';
  return 'dropped';
}

/** The progress screen's state (14.1, 3 and 4). */
export type JoinStage =
  | { t: 'checking' }
  /** This phone holds someone's work already. */
  | { t: 'not-empty'; why: NotEmptyWhy }
  /** No code held: scan one first. */
  | { t: 'no-code' }
  /** Not on this phone: only an Android phone joins offline. */
  | { t: 'not-in-build' }
  /** The person types their name. */
  | { t: 'name' }
  /** Android has not allowed the nearby radios; `blocked`, only the phone's settings can. */
  | { t: 'permission'; blocked: boolean }
  /** Wi-Fi is off, and the link comes over it. */
  | { t: 'wifi-off' }
  | { t: 'connecting' }
  /** Asked; the two pictures to compare while the inviter decides. */
  | { t: 'asked'; pictures: [number, number] | null }
  /** Let in: the starting copy comes. */
  | { t: 'copying'; parts: number }
  /** Let in, the copy not whole: any teammate on the same versions can finish it. */
  | { t: 'unfinished' }
  /** Looking for a teammate to finish the copy. */
  | { t: 'looking' }
  /** Whole: the person is set, and the app starts over as them. */
  | { t: 'whole' }
  | { t: 'ended'; why: JoinEnd };

export type JoinAction =
  | { t: 'checked'; notEmpty: NotEmptyWhy | null; code: boolean; filling: boolean }
  | { t: 'start' }
  | { t: 'permission'; blocked: boolean }
  | { t: 'wifi-off' }
  | { t: 'look' }
  | { t: 'look-stopped' }
  | { t: 'asked'; pictures: [number, number] }
  | { t: 'granted' }
  | { t: 'part' }
  | { t: 'copied'; whole: boolean }
  | { t: 'ended'; why: JoinEnd }
  | { t: 'again'; code: boolean };

export const JOIN_START: JoinStage = { t: 'checking' };

/** Each step of the progress screen. A grant never goes back to asking: once let in, only the copy is left. */
export function joinReducer(s: JoinStage, a: JoinAction): JoinStage {
  switch (a.t) {
    case 'checked':
      // The person this phone let in, with a copy to finish: the local person the empty-phone check sees is them.
      if (a.filling) return { t: 'unfinished' };
      if (a.notEmpty) return { t: 'not-empty', why: a.notEmpty };
      return a.code ? { t: 'name' } : { t: 'no-code' };
    case 'start':
      return s.t === 'name' || s.t === 'ended' || s.t === 'permission' || s.t === 'wifi-off' ? { t: 'connecting' } : s;
    case 'permission':
      return s.t === 'connecting' || s.t === 'name' || s.t === 'permission' ? { t: 'permission', blocked: a.blocked } : s;
    case 'wifi-off':
      return s.t === 'connecting' || s.t === 'name' || s.t === 'unfinished' || s.t === 'looking' ? { t: 'wifi-off' } : s;
    case 'look':
      return s.t === 'unfinished' || s.t === 'wifi-off' ? { t: 'looking' } : s;
    case 'look-stopped':
      return s.t === 'looking' ? { t: 'unfinished' } : s;
    case 'asked':
      return s.t === 'connecting' || s.t === 'asked' ? { t: 'asked', pictures: a.pictures } : s;
    case 'granted':
      return { t: 'copying', parts: 0 };
    case 'part':
      return s.t === 'copying' ? { t: 'copying', parts: s.parts + 1 } : s;
    case 'copied':
      return a.whole ? { t: 'whole' } : { t: 'unfinished' };
    case 'ended':
      // After the grant a drop leaves the copy to finish, never a new code.
      if (s.t === 'copying' || s.t === 'unfinished' || s.t === 'looking' || s.t === 'whole') return s.t === 'whole' ? s : { t: 'unfinished' };
      return { t: 'ended', why: a.why };
    case 'again':
      return s.t === 'ended' || s.t === 'permission' || s.t === 'wifi-off' ? (a.code ? { t: 'name' } : { t: 'no-code' }) : s;
  }
}

/** A name as the newcomer typed it, trimmed, or null when it cannot go in an invite link (1 to 80 characters, no control characters). */
export function joinName(typed: string): string | null {
  const name = typed.trim().replace(/\s+/g, ' ');
  if (name.length < 1 || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return name;
}
