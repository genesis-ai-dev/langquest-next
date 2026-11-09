/**
 * The carried build's install file on a carrier's phone (docs/nearby-sync-plan.md 14.4,
 * "Checking before leaving town"), as pure rules: when Let someone in offers to get it, when the
 * file the person got last is for an older version, what a file they chose says, and how a
 * refusal over versions is worded. Nothing here calls anything, so every rule is tested without
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
export function apkStale(needed: string | null, opened: string | null): boolean {
  return needed !== null && opened !== null && opened !== needed;
}

/** What a chosen file's name says: the right file, or one for another version. Exact: any other name is the wrong version. */
export type ApkCheck = 'right' | 'other';

export function apkCheck(chosen: string, needed: string): ApkCheck {
  return chosen === needed ? 'right' : 'other';
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
