import { carriedApkVersionsPart, sameCarriedVersions } from '@langquest-next/core';
import type { LetInWhyNot } from './letInModel';

/**
 * The carried build's install file on a carrier's phone (docs/nearby-sync-plan.md 14.4,
 * "Checking before leaving town"), as pure rules: when Share nearby offers Get the install file,
 * when that screen offers to get it, what Sync's Ready for offline says of it, when the file the person got last is for an older version,
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
 * Get the install file's step, which decides its main button (Carl's choice, 2026-11-18):
 * - `get`: the browser download, until the person has gone to get the file for this phone's
 *   versions (`opened`, which the press keeps).
 * - `choose`: then the picker, to choose the file the browser downloaded, until it is in hand,
 *   with the download offered again beside it.
 * - `done`: in hand, as a copy kept for Give the app (14.5), or, on a phone that cannot keep one,
 *   a file found right this visit (`right`); no main button then.
 * Null until the remembered name and the kept copy are read, so the button never changes under a
 * finger. The app still downloads nothing: the browser does, and the person chooses the file.
 */
export type ApkStep = 'get' | 'choose' | 'done';

export function apkStep(o: {
  needed: string | null; opened: string | null | undefined; kept: KeptFile | null | undefined; canGive: boolean; right: boolean;
}): ApkStep | null {
  if (o.needed === null || o.opened === undefined || (o.canGive && o.kept === undefined)) return null;
  const inHand = o.canGive ? !!o.kept && !keptStale(o.kept, o.needed) : o.right;
  if (inHand) return 'done';
  return o.opened !== null && !apkStale(o.needed, o.opened) ? 'choose' : 'get';
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
 * The install file as an item of Sync's Ready for offline checklist (docs/nearby-sync-plan.md 14.4,
 * docs/decisions/2026-11-18-sync-and-offline-one-screen.md): got, never got, or got for older
 * versions. Shown only where Share nearby shows A new person and Get the install file (`joinRows`),
 * online or not, since packing for a trip is checked before leaving and offline it says getting it
 * needs the internet. Null until the remembered name is read, so nothing shows before then.
 */
export type InstallItem = 'got' | 'not-got' | 'older';

export function installFileItem(o: { letIn: LetInWhyNot | null; needed: string | null; opened: string | null | undefined }): InstallItem | null {
  if (!joinRows(o.letIn, o.needed).installFile || o.opened === undefined) return null;
  if (o.opened === null) return 'not-got';
  return apkStale(o.needed, o.opened) ? 'older' : 'got';
}
