import { MANAGE_PRIVILEGES, type OrgState, type Privilege } from '@langquest-next/core';
import type { PassShape } from './nearbyModel';

/**
 * Let someone in on the inviter's phone (docs/nearby-sync-plan.md 14.1, 3), as pure rules: whether
 * this phone may offer it, which roles it offers, and each step of the screen, from choosing a role
 * through the QR code, the one tap beside the two pictures, and the starting copy. Nothing here
 * calls anything, so every rule is tested without a phone.
 */

/** Why Let someone in is not offered here. */
export type LetInWhyNot =
  | 'loading'
  /** Only an Android phone lets someone in. */
  | 'not-in-build'
  /** No pass for this language: the organization has joining off, this person cannot invite here, or the phone has not reached the server since. */
  | 'no-pass'
  /** The pass ran out: the phone needs the server again for a new one (14.1, 1). */
  | 'expired'
  /** No role the pass offers may be given offline. */
  | 'no-role'
  /** A Global Viewer looking in, or a local person, who holds no pass. */
  | 'read-only'
  /** Android has not allowed this phone's nearby radios yet: Share nearby asks, with why. */
  | 'permissions'
  /** Wi-Fi is off, and the new phone joins over it. */
  | 'wifi-off';

/** A role the pass lets this phone give, by its name in the organization. */
export interface LetInRole {
  roleId: string;
  name: string;
}

/**
 * The roles offered (Carl's answer 8): the pass's own, less any with a manage privilege, which a
 * pass can never grant whatever it says, in the pass's order. Named as the organization names them.
 */
export function letInRoles(pass: PassShape | null, org: OrgState | null): LetInRole[] {
  if (!pass) return [];
  return pass.body.roles
    .filter((r) => r.privileges.length > 0 && !r.privileges.some((p) => MANAGE_PRIVILEGES.includes(p as Privilege)))
    .map((r) => ({ roleId: r.roleId, name: org?.roles[r.roleId]?.name.value ?? r.roleId }));
}

/**
 * Whether Let someone in is offered, or why not: a pass for the open language, which the Worker
 * issues only while the organization has both `nearby` and `nearby_join` on (Carl's answer 11),
 * not past its expiry, with a role to give. `features` is what the server said this run, null
 * offline: a pass held is then the word that joining was on when it was given, since an answer
 * replaces every pass whole.
 */
export function letInWhyNot(o: {
  inBuild: boolean; readOnly: boolean; pass: PassShape | null | undefined; features: string[] | null; roles: readonly LetInRole[]; now: number;
  permitted?: boolean; wifiOn?: boolean;
}): LetInWhyNot | null {
  if (!o.inBuild) return 'not-in-build';
  if (o.readOnly) return 'read-only';
  if (o.pass === undefined) return 'loading';
  if (!o.pass) return 'no-pass';
  if (o.features !== null && (!o.features.includes('nearby') || !o.features.includes('nearby_join'))) return 'no-pass';
  if (!(o.now <= o.pass.body.expiresAt)) return 'expired';
  if (o.roles.length === 0) return 'no-role';
  if (o.permitted === false) return 'permissions';
  if (o.wifiOn === false) return 'wifi-off';
  return null;
}

/** How long a QR code nobody has used stays up (14.1, 3, "How long"). */
export const LET_IN_CODE_MS = 120_000;

/** How a link with a newcomer ended, as the screen words it. */
export type LetInEnd =
  /** Nobody used the code in time. */
  | 'expired'
  /** This person said No, or did not tap in time. */
  | 'said-no'
  /** The phone that connected did not open the link: not the phone with the code. */
  | 'no-answer'
  /** The two phones run other versions of the app: the new phone needs the install file for this one. */
  | 'versions'
  /** The clocks are over five minutes apart. */
  | 'clock'
  /** This phone's pass no longer lets anyone in under that role (`joinPassStop`), or the ask did not check. */
  | 'refused'
  /** The link dropped before the grant. */
  | 'dropped'
  /** Let in, and the link dropped during the copy: any teammate can finish it. */
  | 'dropped-after'
  /** Let in, but this phone had no copy of the organization or language to give yet: any teammate can finish it. */
  | 'copy-short'
  /** The phone was locked or left, or the screen closed: the code is gone (5.8). */
  | 'stopped'
  /** This phone holds no certificate or discovery key for the language: it needs the server first. */
  | 'no-certificate'
  | 'failed';

/** What a session's report says of how it ended, on the inviter's side. */
export function letInEndOf(r: {
  ended: { how: string; reason?: string; detail?: string }; versionsDiffer: boolean; clockOff: boolean; join: { granted: boolean; refused: string | null } | null;
  copyServed?: { stateRefused: string | null };
}): LetInEnd | 'done' {
  if (r.join?.granted) return r.ended.how !== 'done' ? 'dropped-after' : r.copyServed?.stateRefused ? 'copy-short' : 'done';
  if (r.versionsDiffer) return 'versions';
  if (r.clockOff) return 'clock';
  if (r.join?.refused === 'not let in') return 'said-no';
  if (r.ended.how === 'said' && r.ended.detail === 'no tap in time') return 'said-no';
  if (r.join?.refused) return 'refused';
  if (r.ended.how === 'silent' || r.ended.how === 'no-answer') return 'no-answer';
  if (r.ended.how === 'said' && r.ended.reason === 'stopped') return 'stopped';
  if (r.ended.how === 'said' || r.ended.how === 'heard') return 'refused';
  if (r.ended.how === 'failed') return 'failed';
  return 'dropped';
}

/** The screen's state. `turnedAway` holds across steps: a second phone tried the code and was refused, and the inviter is told. */
export type LetInStage =
  | { t: 'choose' }
  | { t: 'starting' }
  /** The code is up until `until`. */
  | { t: 'showing'; uri: string; until: number }
  /** A phone opened the link: waiting for its ask. */
  | { t: 'connected' }
  /** The one tap: "Let Nyibol in?", beside the two pictures. */
  | { t: 'asked'; name: string; pictures: [number, number] }
  | { t: 'copying'; name: string; parts: number }
  | { t: 'done'; name: string }
  | { t: 'ended'; why: LetInEnd; name: string | null };

export interface LetInState {
  stage: LetInStage;
  roleId: string | null;
  turnedAway: boolean;
}

export const LET_IN_START: LetInState = { stage: { t: 'choose' }, roleId: null, turnedAway: false };

export type LetInAction =
  | { t: 'role'; roleId: string }
  | { t: 'host' }
  | { t: 'showing'; uri: string; until: number }
  | { t: 'connected' }
  | { t: 'asked'; name: string; pictures: [number, number] }
  | { t: 'answered'; yes: boolean }
  | { t: 'part' }
  | { t: 'ended'; why: LetInEnd | 'done' }
  | { t: 'turned-away' }
  | { t: 'new-code' };

const nameIn = (s: LetInStage): string | null => (s.t === 'asked' || s.t === 'copying' || s.t === 'done' ? s.name : s.t === 'ended' ? s.name : null);

/** Each step. "New code" keeps the chosen role and makes a new secret, group and opening (14.1, 3). */
export function letInReducer(s: LetInState, a: LetInAction): LetInState {
  const { stage } = s;
  switch (a.t) {
    case 'role':
      return stage.t === 'choose' || stage.t === 'ended' ? { ...s, roleId: a.roleId } : s;
    case 'host':
      return s.roleId && (stage.t === 'choose' || stage.t === 'ended') ? { ...s, stage: { t: 'starting' }, turnedAway: false } : s;
    case 'showing':
      return stage.t === 'starting' ? { ...s, stage: { t: 'showing', uri: a.uri, until: a.until } } : s;
    case 'connected':
      return stage.t === 'showing' ? { ...s, stage: { t: 'connected' } } : s;
    case 'asked':
      return stage.t === 'connected' || stage.t === 'showing' ? { ...s, stage: { t: 'asked', name: a.name, pictures: a.pictures } } : s;
    case 'answered':
      if (stage.t !== 'asked') return s;
      return a.yes ? { ...s, stage: { t: 'copying', name: stage.name, parts: 0 } } : { ...s, stage: { t: 'ended', why: 'said-no', name: stage.name } };
    case 'part':
      return stage.t === 'copying' ? { ...s, stage: { ...stage, parts: stage.parts + 1 } } : s;
    case 'ended': {
      if (stage.t === 'choose' || stage.t === 'done') return s;
      // A No already said so; the session's end after it changes nothing.
      if (stage.t === 'ended') return s;
      const name = nameIn(stage);
      if (a.why === 'done') return { ...s, stage: { t: 'done', name: name ?? '' } };
      return { ...s, stage: { t: 'ended', why: a.why, name } };
    }
    case 'turned-away':
      return { ...s, turnedAway: true };
    case 'new-code':
      return stage.t === 'ended' || stage.t === 'done' ? { ...s, stage: { t: 'choose' }, turnedAway: false } : s;
  }
}

/** The QR code is shown only while it can still be used: up, and not past its two minutes. */
export function codeShown(s: LetInStage, now: number): string | null {
  return s.t === 'showing' && now < s.until ? s.uri : null;
}
