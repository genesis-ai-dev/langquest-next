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

/**
 * A second phone-wide meta row, for the name of the file last found right under Check my file or
 * Choose the downloaded file. It tells a file in hand from a press that only opened the browser,
 * on a phone that keeps no copy (docs/decisions/0246-a-carried-build-is-the-newcomers.md, amended
 * 2026-11-19). Like the first, it holds a carried build's name and nothing else.
 */
export const CARRIED_APK_RIGHT_KEY = 'carriedApkRight';

/** How the browser download shows: pressable, disabled because the phone is offline, or not at all. */
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
 * The install file screen's step, which decides its main button (Carl's choice, 2026-11-18):
 * - `get`: the browser download, until the person has gone to get the file for this phone's
 *   versions (`opened`, which the press keeps).
 * - `choose`: then the picker, to choose the file the browser downloaded, until it is in hand,
 *   with the download offered again beside it.
 * - `done`: in hand, as a copy kept for Give the app (14.5), or, on a phone that keeps no copy,
 *   a file found right by its name (`right`, remembered); no main button then.
 * Null until what it rests on is read, so the button never changes under a finger. The app still
 * downloads nothing: the browser does, and the person chooses the file.
 */
export type ApkStep = 'get' | 'choose' | 'done';

export function apkStep(o: {
  needed: string | null; opened: string | null | undefined; kept: KeptFile | null | undefined; canGive: boolean; right: string | null | undefined;
}): ApkStep | null {
  if (o.needed === null || o.opened === undefined || (o.canGive ? o.kept === undefined : o.right === undefined)) return null;
  const inHand = o.canGive ? !!o.kept && !keptStale(o.kept, o.needed) : !!o.right && !apkStale(o.needed, o.right);
  if (inHand) return 'done';
  return o.opened !== null && !apkStale(o.needed, o.opened) ? 'choose' : 'get';
}

/**
 * Why this phone cannot give the app over Wi-Fi, so the screens say what would mend it: Android
 * before 10, which no update mends, or an older build of the app whose native module lacks Give
 * the app's functions, which an update from the store does (Carl, 2026-11-19).
 */
export type CannotGive = 'android' | 'update';

export function cannotGive(o: { sdk: number; native: boolean }): CannotGive | null {
  if (o.sdk < 29) return 'android';
  return o.native ? null : 'update';
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
  return sameCarriedVersions(chosenName(chosen), needed) ? 'right' : 'other';
}

/** A chosen file's name without the number a browser adds to a second download of it ("name (1).apk"). */
export function chosenName(chosen: string): string {
  return chosen.replace(/ ?\(\d+\)(?=\.apk$)/, '');
}

/**
 * How the screens name the file this phone needs, where they must: the start of its name that
 * must match and the rest left open, as `r21-l1-p1-….apk`, since the file got may end in another
 * build's fingerprint. A name core does not write is shown as it is. Shown only when a wrong file
 * is chosen or a new phone runs other versions: the app checks the file, not the person
 * (docs/decisions/2026-11-18-carried-file-matches-by-versions.md, amended 2026-11-19).
 */
export function apkShown(needed: string): string {
  const start = carriedApkVersionsPart(needed);
  return start === null ? needed : `${start}….apk`;
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
 * docs/decisions/2026-11-18-sync-and-offline-one-screen.md), by the screen's own step (`apkStep`):
 * never got, got for older versions, downloaded but not chosen yet, or ready, which it says only
 * once the file is in hand, never for a press that only opened the browser (Carl, 2026-11-19).
 * Shown only where Share nearby shows A new person (`joinRows`), online or not, since packing for
 * a trip is checked before leaving. Null until what it rests on is read.
 */
export type InstallItem = 'not-got' | 'older' | 'downloaded' | 'ready';

export function installFileItem(o: {
  letIn: LetInWhyNot | null; needed: string | null; opened: string | null | undefined;
  kept: KeptFile | null | undefined; canGive: boolean; right: string | null | undefined;
}): InstallItem | null {
  if (!joinRows(o.letIn, o.needed).installFile) return null;
  const step = apkStep(o);
  if (step === null) return null;
  if (step === 'done') return 'ready';
  if (step === 'choose') return 'downloaded';
  return apkStale(o.needed, o.opened) ? 'older' : 'not-got';
}

/**
 * The install file Check my file keeps in the app's own folder for Give the app
 * (docs/nearby-sync-plan.md 14.5): a copy, checked to be this app's own (its package and signing
 * certificates), so the phone can hand it to a new phone over its own Wi-Fi.
 */
export interface KeptFile {
  name: string;
  size: number;
  /** When its JavaScript was built, in ms since 1970 (`builtAtOf` in native); null or absent when unknown. */
  builtMs?: number | null;
}

/**
 * How far a kept copy may fall behind the app its carrier runs before the screens say a newer file
 * is ready: longer than the daily refresh can lag behind main, so by then the bucket surely holds a
 * newer one, and a download never brings back the same file
 * (docs/decisions/2026-11-19-carried-build-refreshed-daily.md).
 */
export const KEPT_BEHIND_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * Whether the kept copy's JavaScript is more than KEPT_BEHIND_MS older than the app this phone runs
 * (`Updates.createdAt`, from an OTA update or the build itself). Both times come from the build
 * servers, not this phone's clock. Unknown on either side says nothing.
 */
export function keptBehind(kept: KeptFile | null | undefined, runningMs: number | null): boolean {
  if (!kept || typeof kept.builtMs !== 'number' || runningMs === null) return false;
  return runningMs - kept.builtMs > KEPT_BEHIND_MS;
}

/** Room left on the phone after keeping the file, for recordings: about 100 MB. */
export const KEEP_MIN_FREE_BYTES = 100 * 1024 * 1024;

/**
 * What keeping a chosen file came to: kept; not this app's own file (another app, or a file
 * signed by someone else); no room for it; unreadable; failed otherwise; or a phone that keeps
 * no copy, by why (`cannotGive`): Android before 10, or an older build of the app.
 */
export type KeepResult = 'keeping' | 'kept' | 'not-ours' | 'no-space' | 'unreadable' | 'failed' | 'needs-android' | 'needs-update';

/** A native rejection's code as a keep result. */
export function keepResultOf(code: string | null): Exclude<KeepResult, 'keeping' | 'kept' | 'needs-android' | 'needs-update'> {
  return code === 'FILE_REFUSED' ? 'not-ours' : code === 'FILE_NO_SPACE' ? 'no-space' : code === 'FILE_UNREADABLE' || code === 'BAD_ARGUMENT' ? 'unreadable' : 'failed';
}

/**
 * Whether the kept copy has gone out of date: kept for versions other than this phone needs now.
 * It is then deleted, so a carrier never hands over a file a new phone could not join with
 * (Carl's answer, 2026-11-18: kept until a newer version is needed).
 */
export function keptStale(kept: KeptFile | null | undefined, needed: string | null): boolean {
  return !!kept && needed !== null && !sameCarriedVersions(kept.name, needed);
}
