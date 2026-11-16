import type { ApkCheck } from './carriedApkModel';

/** The carried build's install file as Get the install file, Let someone in and Share nearby take it (docs/nearby-sync-plan.md 14.4). */
export interface CarriedApkHandle {
  /** The file that installs this phone's versions (core `carriedApkNameHere`), or null where the app runs on no fingerprint. */
  needed: string | null;
  /** Where the phone's browser gets it, or null with no Worker for this build. */
  url: string | null;
  /** The name of the file the person last got, or checked and found right: null if none, undefined until it is read. */
  opened: string | null | undefined;
  /** The file the person got before is for an older version (`apkStale`). */
  stale: boolean;
  /** What the file last chosen under Check my file said, with its name, until the screen closes. */
  checked: { result: ApkCheck; name: string } | null;
  actions: { get(): void; check(): void };
}

const NOTHING = (): void => undefined;
const NOT_HERE: CarriedApkHandle = { needed: null, url: null, opened: null, stale: false, checked: null, actions: { get: NOTHING, check: NOTHING } };

/**
 * Only an Android phone lets someone in, so only Android's file (useCarriedApk.android.ts) names a
 * file, opens the browser or the file picker: the web and iPhone bundles carry none of it.
 */
export function useCarriedApk(): CarriedApkHandle {
  return NOT_HERE;
}
