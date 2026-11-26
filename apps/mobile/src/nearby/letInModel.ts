import { bookNameOf, MANAGE_PRIVILEGES, usfmOf, type LanguageState, type OrgState, type PassageLines, type Privilege } from '@langquest-next/core';
import { bookEntries, languageEntries, summarizeBooks, type BookSummary } from '../map/mapModel';
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
  | 'wifi-off'
  /**
   * This phone has let in as many people as its pass allows (`maxUses`, 2026-11-24, review item 7):
   * teammates and the server would refuse one more, so the phone needs the server for a new pass.
   */
  | 'used-up'
  /**
   * This phone's own copy of the team's work is not ready to give (`canGiveCopy`, 2026-11-24,
   * review item 5): its download did not reach the server's newest, or its passages are still being
   * filled in. Only the internet finishes either.
   */
  | 'copy-not-ready';

/** What `canGiveCopy` answers, as Let someone in reads it: ready, or why not, with how far a fill has come (`copyReadyOf`). */
export type LetInCopyReady = { ok: true } | { ok: false; why: 'filling' | 'downloading' | 'nothing'; fill?: { filled: number; total: number } | null };

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
 * replaces every pass whole. `pass` is the one in effect (`passInEffect`) and `now` the clock
 * Hello checks with (`nearbyHelloNow`), as the session that signs the link checks it.
 */
export function letInWhyNot(o: {
  inBuild: boolean; readOnly: boolean; pass: PassShape | null | undefined; features: string[] | null; roles: readonly LetInRole[]; now: number;
  permitted?: boolean; wifiOn?: boolean;
  /** People this phone let in under `pass` (2026-11-24, review item 7); unknown, nothing is said of it. */
  used?: number;
  /** Whether this phone can give a whole copy (`copyReadyOf`), checked before the code is shown (review item 5); null while read. */
  copy?: LetInCopyReady | null;
}): LetInWhyNot | null {
  if (!o.inBuild) return 'not-in-build';
  if (o.readOnly) return 'read-only';
  if (o.pass === undefined) return 'loading';
  if (!o.pass) return 'no-pass';
  if (o.features !== null && (!o.features.includes('nearby') || !o.features.includes('nearby_join'))) return 'no-pass';
  if (!(o.now <= o.pass.body.expiresAt)) return 'expired';
  if (o.roles.length === 0) return 'no-role';
  if (o.used !== undefined && o.used >= o.pass.body.maxUses) return 'used-up';
  if (o.copy === null) return 'loading';
  if (o.copy && !o.copy.ok) return 'copy-not-ready';
  if (o.permitted === false) return 'permissions';
  if (o.wifiOn === false) return 'wifi-off';
  return null;
}

/** The session's word for a pass used up (sync's `NEARBY_PASS_USED_UP`), copied so the web bundle, which carries this file, carries no nearby entry; letIn.test.ts holds them equal. */
// i18n-ignore: the session's word in its report, never shown
export const LET_IN_USED_UP = 'pass used up';

/** How long a QR code nobody has used stays up (14.1, 3, "How long"). */
export const LET_IN_CODE_MS = 120_000;

/**
 * How long a code on Give the app's group stays up (14.5): the new phone is still installing when
 * it is shown, so it lasts as long as Give the app itself waits for a phone with nothing asked
 * (`GIVE_IDLE_MS`, held equal by letIn.test.ts; not imported, so the web bundle, which carries
 * this file, does not carry Give the app's page).
 */
export const LET_IN_GIVE_CODE_MS = 15 * 60 * 1000;

/** How long a code nobody used stays up: on Give the app's group, or on a group of this phone's own. */
export function letInCodeMs(onGiveGroup: boolean): number {
  return onGiveGroup ? LET_IN_GIVE_CODE_MS : LET_IN_CODE_MS;
}

/** What the countdown under a code says: seconds for two minutes, and whole minutes, rounded up, on Give the app's group. */
export function codeLeft(seconds: number, onGiveGroup: boolean): { unit: 'seconds' | 'minutes'; n: number } {
  return onGiveGroup ? { unit: 'minutes', n: Math.ceil(seconds / 60) } : { unit: 'seconds', n: seconds };
}

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
  /**
   * Let in with a whole copy, and the link went during the names or documents after it (2026-11-24,
   * review item 3): they can work already, and any teammate gives the rest.
   */
  | 'dropped-docs'
  /** This phone's pass has let in as many people as it allows (2026-11-24, review item 7): nobody more until it reaches the internet. */
  | 'used-up'
  /** The phone was locked or left, or the screen closed: the code is gone (5.8). */
  | 'stopped'
  /** This phone holds no certificate or discovery key for the language: it needs the server first. */
  | 'no-certificate'
  | 'failed';

/**
 * What a session's report says of how it ended, on the inviter's side. A drop after the newcomer's
 * copy was whole, while the two went on to the newest work (`exchange`, 2026-11-24), is done: they
 * are in, and what was newer comes from any teammate or the server.
 */
export function letInEndOf(r: {
  ended: { how: string; reason?: string; detail?: string }; versionsDiffer: boolean; clockOff: boolean;
  join: { granted: boolean; refused: string | null; exchange?: boolean; copyWhole?: boolean } | null;
  copyServed?: { stateRefused: string | null };
}): LetInEnd | 'done' {
  if (r.join?.granted) {
    if (r.ended.how !== 'done' && !r.join.exchange) return r.join.copyWhole ? 'dropped-docs' : 'dropped-after';
    return r.copyServed?.stateRefused ? 'copy-short' : 'done';
  }
  if (r.join?.refused === LET_IN_USED_UP) return 'used-up';
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
  /** The code is up until `until`; on Give the app's group, the new phone's LangQuest also finds it by itself (14.5). */
  | { t: 'showing'; uri: string; until: number; onGiveGroup: boolean }
  /** A phone opened the link: waiting for its ask. */
  | { t: 'connected' }
  /** The one tap: "Let Nyibol in?", beside the two pictures. */
  | { t: 'asked'; name: string; pictures: [number, number] }
  /**
   * Sending the starting copy. `shown`: the bar's share, 0 to 1, once the inviter knows what the new
   * phone asks for (`copyShown`), else null. `rest`: the copy is whole, and the newest work and the
   * guides' files follow on the same link (`join-exchange`), which no bar measures.
   */
  | { t: 'copying'; name: string; parts: number; shown: number | null; rest: boolean }
  /** In. `guideFilesWent`: guide pictures and audio went to them on the link (`letInGuideFilesWent`), so none are said to come later. */
  | { t: 'done'; name: string; guideFilesWent?: true }
  | { t: 'ended'; why: LetInEnd; name: string | null };

export interface LetInState {
  stage: LetInStage;
  roleId: string | null;
  /**
   * The book the new person will work on, chosen with the role before the code, or none: its
   * passages go in the grant, kept offline on their phone so the join brings their recordings
   * (docs/decisions/2026-11-25-text-goes-whole-and-recordings-go-by-want.md).
   */
  workBook: string | null;
  turnedAway: boolean;
}

export const LET_IN_START: LetInState = { stage: { t: 'choose' }, roleId: null, workBook: null, turnedAway: false };

/**
 * The books a new person may be given to work on, as the Map lists them, with what the language calls them: those with
 * passages to record, not one listed and not broken up yet (2026-11-25).
 */
export function letInBooks(state: LanguageState | null, lines: PassageLines): BookSummary[] {
  if (!state) return [];
  return summarizeBooks(languageEntries(state, lines), 'all', new Set(), [], (id) => bookNameOf(state, usfmOf(id))).filter((b) => !b.waiting && b.total > 0);
}

/** A book's passages, for the grant: what the new person's phone keeps offline (2026-11-25). */
export function workSetOf(state: LanguageState | null, lines: PassageLines, bookId: string): string[] {
  return state ? bookEntries(languageEntries(state, lines), bookId).map((e) => e.unitId) : [];
}

export type LetInAction =
  | { t: 'role'; roleId: string }
  /** The book the new person will work on, or none (2026-11-25). */
  | { t: 'work'; bookId: string | null }
  | { t: 'host' }
  | { t: 'showing'; uri: string; until: number; onGiveGroup?: boolean }
  | { t: 'connected' }
  | { t: 'asked'; name: string; pictures: [number, number] }
  | { t: 'answered'; yes: boolean }
  /** How far the copy has gone, from the session's report: parts sent, the estimate in characters, and whether the copy is whole. */
  | { t: 'copy'; parts: number; progress: { sent: number; total: number } | null; rest: boolean }
  /** `guideFilesWent`: the session said guide pictures and audio went (`letInGuideFilesWent`). */
  | { t: 'ended'; why: LetInEnd | 'done'; guideFilesWent?: boolean }
  | { t: 'turned-away' }
  | { t: 'new-code' };

const nameIn = (s: LetInStage): string | null => (s.t === 'asked' || s.t === 'copying' || s.t === 'done' ? s.name : s.t === 'ended' ? s.name : null);

/** Each step. "New code" keeps the chosen role and makes a new secret, group and opening (14.1, 3). */
export function letInReducer(s: LetInState, a: LetInAction): LetInState {
  const { stage } = s;
  switch (a.t) {
    case 'role':
      return stage.t === 'choose' || stage.t === 'ended' ? { ...s, roleId: a.roleId } : s;
    case 'work':
      return stage.t === 'choose' || stage.t === 'ended' ? { ...s, workBook: a.bookId } : s;
    case 'host':
      return s.roleId && (stage.t === 'choose' || stage.t === 'ended') ? { ...s, stage: { t: 'starting' }, turnedAway: false } : s;
    case 'showing':
      return stage.t === 'starting' ? { ...s, stage: { t: 'showing', uri: a.uri, until: a.until, onGiveGroup: a.onGiveGroup === true } } : s;
    case 'connected':
      return stage.t === 'showing' ? { ...s, stage: { t: 'connected' } } : s;
    case 'asked':
      return stage.t === 'connected' || stage.t === 'showing' ? { ...s, stage: { t: 'asked', name: a.name, pictures: a.pictures } } : s;
    case 'answered':
      if (stage.t !== 'asked') return s;
      return a.yes ? { ...s, stage: { t: 'copying', name: stage.name, parts: 0, shown: null, rest: false } } : { ...s, stage: { t: 'ended', why: 'said-no', name: stage.name } };
    case 'copy': {
      if (stage.t !== 'copying') return s;
      const parts = Math.max(stage.parts, a.parts);
      const shown = copyShown(stage.shown, a.progress);
      const rest = stage.rest || a.rest;
      // The same screen when nothing it shows changed: the session reports every message.
      return parts === stage.parts && shown === stage.shown && rest === stage.rest ? s : { ...s, stage: { ...stage, parts, shown, rest } };
    }
    case 'ended': {
      if (stage.t === 'choose' || stage.t === 'done') return s;
      // A No already said so; the session's end after it changes nothing.
      if (stage.t === 'ended') return s;
      const name = nameIn(stage);
      if (a.why === 'done') return { ...s, stage: { t: 'done', name: name ?? '', ...(a.guideFilesWent ? { guideFilesWent: true as const } : {}) } };
      return { ...s, stage: { t: 'ended', why: a.why, name } };
    }
    case 'turned-away':
      return { ...s, turnedAway: true };
    case 'new-code':
      return stage.t === 'ended' || stage.t === 'done' ? { ...s, stage: { t: 'choose' }, turnedAway: false } : s;
  }
}

/** The bar stops short of the end until the copy is whole: the estimate can reach what went before the last small parts have. */
export const COPY_SHOWN_MAX = 0.99;

/**
 * The bar's share while a starting copy goes (2026-11-25): what went of the inviter's estimate
 * (`CopyProgress`), in steps of half a percent, never back from what it showed, and short of the
 * end (`COPY_SHOWN_MAX`). Null until there is an estimate.
 */
export function copyShown(before: number | null, progress: { sent: number; total: number } | null): number | null {
  if (!progress || !(progress.total > 0)) return before;
  const now = Math.min(Math.floor((progress.sent / progress.total) * 200) / 200, COPY_SHOWN_MAX);
  return before === null ? now : Math.max(before, now);
}

/**
 * Whether guide pictures and audio went to the new person on the join's link: it ran to its end,
 * and its library files step, which follows a whole copy when both phones run a build from
 * 2026-11-24 (`join-exchange`, `library-files`), served at least one (docs/nearby-sync-plan.md
 * 5.12, Library files).
 */
export function letInGuideFilesWent(r: { ended: { how: string }; libraryFiles: { served: number } | null }): boolean {
  return r.ended.how === 'done' && (r.libraryFiles?.served ?? 0) > 0;
}

/**
 * Whether the screen says the new person's guide pictures and audio come later: once they are in,
 * done with none sent (`guideFilesWent`), or with a copy a teammate finishes. The starting copy
 * carries the language's guides but never the files they name. Since 2026-11-24 the join's link
 * sends them after a whole copy; but a copy left to finish, an older phone on either side, a link
 * that dropped first, or none held on this phone leaves them to the new person's first Wi-Fi
 * session with any teammate, and nothing else tells the inviter so. When some went, nothing is
 * said: any this phone did not hold come in any later session, as for everyone.
 */
export function letInGuideFilesLine(s: LetInStage): boolean {
  return (s.t === 'done' && !s.guideFilesWent) || (s.t === 'ended' && (s.why === 'dropped-after' || s.why === 'dropped-docs' || s.why === 'copy-short'));
}

/** The QR code is shown only while it can still be used: up, and not past its time (two minutes, or Give the app's fifteen). */
export function codeShown(s: LetInStage, now: number): string | null {
  return s.t === 'showing' && now < s.until ? s.uri : null;
}
