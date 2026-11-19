import { joinRows } from './carriedApkModel';
import type { LetInWhyNot } from './letInModel';
import type { NearbyPermission, PermissionReason, RadioOff } from './nearbyPermissionsModel';
import type { NearbySessionLine, NearbyStop, NearbyTeammate, NearbyView, NearbyWhyNot, TeammateState } from './nearbyRunModel';
import type { CarrySeen } from './readyToCarryModel';

/**
 * What Share nearby shows first, from `NearbyView` (docs/nearby-sync-plan.md 5.8, section 8):
 * screen states are tested through this model, since the web has no Share nearby and no radio
 * runs in a test. Each state names its words by catalog key; the screen (src/screens/nearby.tsx)
 * says them. A phone that wears a cover hands its own states to `NearbyCoverNotes`, whose words
 * stay in src/disguise/i18n, so none of them is named here.
 */
export type NearbyStage =
  /** It cannot run here, and why: the line under the screen's title. */
  | { t: 'unavailable'; why: NearbyWhyNot }
  /** A phone that wears a cover waits for a press, warns before any prompt, or says why it stopped. `NearbyCoverNotes` speaks. */
  | { t: 'cover'; stopped: NearbyStop | null }
  /** Radios the person must turn on. */
  | { t: 'radios'; off: RadioOff[] }
  /** The line saying why, before the phone's question; nothing is asked until the button. */
  | { t: 'permission'; reason: PermissionReason; permissions: NearbyPermission[] }
  /** The phone will not ask again: the app's settings. */
  | { t: 'settings' }
  /** Stopped, and it stays stopped until Look again. */
  | { t: 'stopped'; why: NearbyStop }
  | { t: 'running'; level: boolean; sharing: boolean }
  /** Everything allows it, and the radios are on their way. */
  | { t: 'starting' };

export function stageOf(v: NearbyView): NearbyStage {
  if (v.whyNot !== null) return { t: 'unavailable', why: v.whyNot };
  if (v.worn && (v.needsPress || v.permissions.step.t === 'warn')) return { t: 'cover', stopped: v.stopped };
  if (v.radiosOff.length > 0) return { t: 'radios', off: v.radiosOff };
  const step = v.permissions.step;
  if (step.t === 'explain') return { t: 'permission', reason: step.reason, permissions: step.permissions };
  if (step.t === 'settings') return { t: 'settings' };
  if (v.stopped !== null) return { t: 'stopped', why: v.stopped };
  if (v.running) return { t: 'running', level: v.level, sharing: v.current !== null };
  return { t: 'starting' };
}

export const WHY_NOT_WORDS = {
  loading: 'nearby.why.loading',
  'not-in-build': 'nearby.why.notInBuild',
  'android-too-old': 'nearby.why.androidTooOld',
  'no-bluetooth-le': 'nearby.why.noBluetoothLe',
  'no-wifi-direct': 'nearby.why.noWifiDirect',
  'no-key': 'nearby.why.noKey',
  'no-certificate': 'nearby.why.noCertificate',
  limited: 'nearby.why.limited',
  'read-only': 'nearby.why.readOnly'
} as const satisfies Record<NearbyWhyNot, string>;

/**
 * The Share nearby row's line on Sync (docs/nearby-sync-plan.md 5.8): why it cannot run while it
 * cannot, else its jobs: sharing work progress with teammates both ways, and bringing in a new
 * person only on the terms that show Let someone in on Share nearby (`joinRows`: joining on for
 * this organization and a pass to let people in), so nobody is told of a job the screen will not
 * offer them. Help mode says the same. Getting the install file is on Ready for offline's list,
 * not here (docs/decisions/2026-11-18-sync-and-offline-one-screen.md).
 */
export function nearbyRowWords(whyNot: NearbyWhyNot | null, letIn: LetInWhyNot | null): {
  sub: (typeof WHY_NOT_WORDS)[NearbyWhyNot] | 'nearby.rowSub' | 'nearby.rowSubJoin';
  help: 'nearby.rowHelp' | 'nearby.rowHelpJoin';
} {
  if (whyNot !== null) return { sub: WHY_NOT_WORDS[whyNot], help: 'nearby.rowHelp' };
  if (joinRows(letIn, null).letIn === null) return { sub: 'nearby.rowSub', help: 'nearby.rowHelp' };
  return { sub: 'nearby.rowSubJoin', help: 'nearby.rowHelpJoin' };
}

export const RADIO_WORDS = { bluetooth: 'nearby.radios.bluetooth', wifi: 'nearby.radios.wifi', location: 'nearby.radios.location' } as const satisfies Record<RadioOff, string>;

export const PERMISSION_WORDS = {
  location: 'nearby.permission.location',
  'nearby-and-location': 'nearby.permission.nearbyAndLocation',
  'nearby-devices': 'nearby.permission.nearbyDevices',
  precise: 'nearby.permission.precise',
  bluetooth: 'nearby.permission.bluetooth',
  settings: 'nearby.permission.settings'
} as const satisfies Record<PermissionReason, string>;

/**
 * Words that name the phone's own question, its settings, or what only Android offers: Android's,
 * and an iPhone's, which never names Android or the install file (section 7's phase 5). The
 * screen's first line is the same on both, since its two headings say what each phone can do.
 */
export const PHONE_WORDS = {
  android: { settings: 'nearby.permission.settings', allowHelp: 'nearby.permission.allowHelp', newerApp: 'nearby.newerApp' },
  iphone: { settings: 'nearby.permission.settingsIphone', allowHelp: 'nearby.permission.allowHelpIphone', newerApp: 'nearby.newerAppIphone' }
} as const;

export function phoneWords(v: Pick<NearbyView, 'iphone'>): (typeof PHONE_WORDS)[keyof typeof PHONE_WORDS] {
  return v.iphone ? PHONE_WORDS.iphone : PHONE_WORDS.android;
}

/** Connect's help: one teammate, or on an iPhone every teammate it cannot get an echo from (Carl's answer 26). */
export function connectHelp(v: Pick<NearbyView, 'tapCoversAll'>): 'nearby.connectHelp' | 'nearby.connectHelpAll' {
  return v.tapCoversAll ? 'nearby.connectHelpAll' : 'nearby.connectHelp';
}

/**
 * A stop's line on a phone with no cover. `run` and `level` stop only a phone that wears one, and
 * `left` only follows its lock, so their words are `NearbyCoverNotes`' own; here they say nothing.
 */
export const STOP_WORDS = {
  idle: 'nearby.stopped.idle',
  wait: 'nearby.stopped.wait',
  // The same line as when it cannot start for want of a key: one thing, said one way.
  'no-key': 'nearby.why.noKey',
  failed: 'nearby.stopped.failed',
  run: null,
  level: null,
  left: null
} as const satisfies Record<NearbyStop, string | null>;

export const TEAMMATE_WORDS = {
  here: 'nearby.state.here',
  maybe: 'nearby.state.maybe',
  exchanging: 'nearby.state.exchanging',
  done: 'nearby.state.done',
  missed: 'nearby.state.missed'
} as const satisfies Record<TeammateState, string>;

export const SEEN_WORDS = {
  today: 'nearby.carry.today',
  'since-online': 'nearby.carry.sinceOnline',
  'not-since-online': 'nearby.carry.notSinceOnline'
} as const satisfies Record<CarrySeen, string>;

/** How a session ended, when it did not end well; null for `done`. */
export function endedWords(how: string) {
  switch (how) {
    case 'done': return null;
    case 'dropped': return 'nearby.came.dropped';
    case 'stalled': return 'nearby.came.stalled';
    case 'no-answer': case 'silent': return 'nearby.came.noAnswer';
    case 'heard': return 'nearby.came.heard';
    case 'said': return 'nearby.came.said';
    default: return 'nearby.came.failed';
  }
}

/**
 * Sessions worth a line: one with a known teammate, or one where something moved. A played-back
 * advert or a stranger's connection moves nothing and names nobody, and draws no line (section 8).
 */
export function linesShown(sessions: readonly NearbySessionLine[]): NearbySessionLine[] {
  const moved = (l: NearbySessionLine) => l.eventsIn + l.eventsOut + l.filesIn + l.filesOut + l.refused + l.filesFailed > 0;
  return sessions.filter((l) => l.profileId !== null || moved(l)).reverse();
}

/**
 * Teammates worth a row: a session that named nobody and did not finish was no teammate this phone
 * can show. Where one tap covers every teammate without an echo (`tapCoversAll`, an iPhone), one
 * "A teammate may be nearby" row stands for them all, since its Connect reaches every one: phones
 * heard only by their advert have no name and look alike.
 */
export function teammatesShown(teammates: readonly NearbyTeammate[], tapCoversAll = false): NearbyTeammate[] {
  const shown = teammates.filter((m) => !(m.state === 'missed' && m.profileId === null));
  if (!tapCoversAll) return shown;
  const firstMaybe = shown.findIndex((m) => m.state === 'maybe');
  return shown.filter((m, i) => m.state !== 'maybe' || i === firstMaybe);
}
