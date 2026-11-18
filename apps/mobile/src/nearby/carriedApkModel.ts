import { carriedApkVersionsPart, sameCarriedVersions } from '@langquest-next/core';
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
 * The file the person got before is for older versions: a name remembered, and not for the
 * versions this phone needs now. Only the versions count, not the fingerprint, since any file for
 * them lets a new phone join this one (core `sameCarriedVersions`). The words go when the two
 * match again, and never show before the first press.
 */
export function apkStale(needed: string | null, opened: string | null | undefined): boolean {
  return needed !== null && opened !== null && opened !== undefined && !sameCarriedVersions(opened, needed);
}

/**
 * What a chosen file's name says: the right file, or one for other versions. Its name must start
 * with the versions this phone needs (core `carriedApkVersionsPart`), whatever fingerprint ends
 * it: the Worker sends a phone whose own build has no file to the newest file for its versions
 * (docs/decisions/2026-11-18-carried-file-matches-by-versions.md). The number a browser adds to a
 * second download of a file ("name (1).apk") changes no version. Any other name is the wrong
 * version.
 */
export type ApkCheck = 'right' | 'other';

export function apkCheck(chosen: string, needed: string): ApkCheck {
  return sameCarriedVersions(chosen.replace(/ ?\(\d+\)(?=\.apk$)/, ''), needed) ? 'right' : 'other';
}

/**
 * How the screens show the file this phone needs: the start of its name that must match and the
 * rest left open, as `r21-l1-p1-….apk`, since the file got may end in another build's
 * fingerprint. A name core does not write is shown as it is.
 */
export function apkShown(needed: string): string {
  const start = carriedApkVersionsPart(needed);
  return start === null ? needed : `${start}….apk`;
}

/** The start a file's name must have to fit this phone, such as `r21-l1-p1-`; a name core does not write, whole. */
export function apkStart(needed: string): string {
  return carriedApkVersionsPart(needed) ?? needed;
}

/**
 * The inviter's words when the new phone runs other versions: they need a file for this phone's
 * versions, shown as its name's start (`apkShown`), or, where this phone has no name for its
 * versions (a development build), the file for this phone's version.
 */
export function letInVersionsWords(installFile: string | null):
  | { key: 'nearby.letIn.end.versions'; file: string }
  | { key: 'nearby.letIn.end.versionsUnnamed' } {
  return installFile !== null ? { key: 'nearby.letIn.end.versions', file: apkShown(installFile) } : { key: 'nearby.letIn.end.versionsUnnamed' };
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
