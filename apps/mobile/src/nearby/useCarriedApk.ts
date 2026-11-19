import type { ApkCheck, CannotGive, KeepResult, KeptFile } from './carriedApkModel';

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
  /**
   * What the file last chosen under Check my file said, with its name, until the screen closes;
   * for a right name, also what keeping a copy for Give the app came to (14.5).
   */
  checked: { result: ApkCheck; name: string; keep?: KeepResult } | null;
  /** The copy kept for Give the app: null if none, undefined until it is read (docs/nearby-sync-plan.md 14.5). */
  kept: KeptFile | null | undefined;
  /** The name of the file last found right, which a phone that keeps no copy goes by: null if none, undefined until it is read. */
  right: string | null | undefined;
  /** This phone can keep a file and give the app. */
  canGive: boolean;
  /** Why it cannot, where it cannot: Android before 10, or an older build of the app (`cannotGive`). */
  cannotGive: CannotGive | null;
  actions: { get(): void; check(): void };
}

const NOTHING = (): void => undefined;
const NOT_HERE: CarriedApkHandle = { needed: null, url: null, opened: null, stale: false, checked: null, kept: null, right: null, canGive: false, cannotGive: null, actions: { get: NOTHING, check: NOTHING } };

/**
 * Only an Android phone lets someone in, so only Android's file (useCarriedApk.android.ts) names a
 * file, opens the browser or the file picker: the web and iPhone bundles carry none of it.
 */
export function useCarriedApk(): CarriedApkHandle {
  return NOT_HERE;
}
