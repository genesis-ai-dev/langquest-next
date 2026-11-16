import type { LetInWhyNot } from './letInModel';

/**
 * The carried build's install file on a carrier's phone (docs/nearby-sync-plan.md 14.4,
 * "Checking before leaving town"), as pure rules: when Share nearby offers Get the install file,
 * when that screen offers to get it, when Sync reminds a carrier to get it, when the file the person got last is for an older version,
 * what a file they chose says, and how a refusal over versions is worded. Nothing here calls anything, so every rule is tested without
 * a phone. The app never downloads or installs the file: the phone's browser does, and the person.
 */

/**
 * The phone-wide meta row that remembers the name of the file the person last went to get (or
 * checked and found right). It holds a carried build's name and nothing else: no person,
 * organization or time.
 */
export const CARRIED_APK_OPENED_KEY = 'carriedApkOpened';

/** How "Get the install file" shows: pressable, disabled because the phone is offline, or not at all. */
export type ApkGet = 'ready' | 'offline' | null;

/**
 * Whether to offer the browser download. Not at all with no name for this phone's versions or no
 * Worker to get it from; disabled only once the server could not be reached (`online` false),
 * since null is a phone that has not tried yet and the browser says for itself when it cannot.
 */
export function apkGet(o: { needed: string | null; url: string | null; online: boolean | null }): ApkGet {
  if (o.needed === null || o.url === null) return null;
  return o.online === false ? 'offline' : 'ready';
}

/**
 * The file the person got before is for an older version: a name remembered, and not the one this
 * phone needs now. The words go when the two match again, and never show before the first press.
 */
export function apkStale(needed: string | null, opened: string | null | undefined): boolean {
  return needed !== null && opened !== null && opened !== undefined && opened !== needed;
}

/**
 * What a chosen file's name says: the right file, or one for another version. The name must be
 * this one, but for the number a browser adds to a second download of the same file
 * ("name (1).apk"), which changes no version. Any other name is the wrong version.
 */
export type ApkCheck = 'right' | 'other';

export function apkCheck(chosen: string, needed: string): ApkCheck {
  return chosen.replace(/ ?\(\d+\)(?=\.apk$)/, '') === needed ? 'right' : 'other';
}

/**
 * The inviter's words when the new phone runs other versions: they need this phone's file, by
 * name, or, where this phone has no name for its versions (a development build), the file for
 * this phone's version.
 */
export function letInVersionsWords(installFile: string | null):
  | { key: 'nearby.letIn.end.versions'; file: string }
  | { key: 'nearby.letIn.end.versionsUnnamed' } {
  return installFile !== null ? { key: 'nearby.letIn.end.versions', file: installFile } : { key: 'nearby.letIn.end.versionsUnnamed' };
}

/**
 * Share nearby's two rows for joining without internet (docs/nearby-sync-plan.md 14.1, 14.4): Let
 * someone in for a phone holding a pass while the organization has joining on, disabled once the
 * pass runs out; and Get the install file above it on the same terms, where this phone has a file
 * to name. That one stays pressable on a run-out pass: it is done online, which renews the pass.
 */
export function joinRows(whyNot: LetInWhyNot | null, needed: string | null): { letIn: 'ready' | 'expired' | null; installFile: boolean } {
  const letIn = whyNot === null ? 'ready' : whyNot === 'expired' ? 'expired' : null;
  return { letIn, installFile: letIn !== null && needed !== null };
}

/**
 * Why Sync reminds a carrier to get the install file (docs/nearby-sync-plan.md 14.4, "Reminded
 * while online"): this phone never got one, or got one for an older version.
 */
export type ApkReminder = 'not-got' | 'older';

/**
 * Whether Sync reminds this person to get the install file while they still can: only where Share
 * nearby shows A new person and Get the install file (`joinRows`), only while the server was just
 * reached (`online` true) and the file can be got (`apkGet`), and only while the file this phone
 * has is not the one it needs now. `opened` is undefined until the remembered name is read, so
 * nothing shows before then. Getting the file, or a right file under Check my file, ends it.
 */
export function apkReminder(o: { letIn: LetInWhyNot | null; needed: string | null; url: string | null; opened: string | null | undefined; online: boolean | null }): ApkReminder | null {
  if (!joinRows(o.letIn, o.needed).installFile || o.online !== true || apkGet(o) !== 'ready' || o.opened === undefined) return null;
  if (o.opened === null) return 'not-got';
  return apkStale(o.needed, o.opened) ? 'older' : null;
}

/** The line on Sync's Ready for offline card for each reminder. */
export const APK_REMINDER_WORDS = {
  'not-got': 'nearby.installFile.notGot',
  older: 'nearby.installFile.older'
} as const satisfies Record<ApkReminder, string>;
