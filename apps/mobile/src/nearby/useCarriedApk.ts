import type { ApkCheck, CannotGive, KeepResult, KeptFile } from './carriedApkModel';

/** The carried build's install file as Get the install file, Let someone in and Share nearby take it (docs/nearby-sync-plan.md 14.4). */
export interface CarriedApkHandle {
  /** The file that installs this phone's versions (core `carriedApkNameHere`), or null where the app runs on no fingerprint. */
  needed: string | null;
  /** Where the phone's browser gets it, or null with no Worker for this build. */
  url: string | null;
  /**
   * The browser's own Open hands the downloaded file to the app, which takes and keeps it (a build
   * that opens the app's own file type); false where the person comes back and chooses it.
   */
  handOff: boolean;
  /** The name of the file the person last got, or checked and found right: null if none, undefined until it is read. */
  opened: string | null | undefined;
  /** The file the person got before is for an older version (`apkStale`). */
  stale: boolean;
  /**
   * What the file last chosen (Choose a file you already have, or Choose the downloaded file) said, with its name, until the screen closes;
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
  /**
   * A newer file than the kept copy is ready: the Worker's was built after it, or, without that
   * answer, the copy is more than two days older than the app this phone runs (`keptOutdated`); or the
   * copy comes from an older native build (`keptFromOlderBuild`).
   */
  behind: boolean;
  /**
   * `take`: a file the browser handed over with its Open (src/nearby/handedFile.android.ts), checked and kept as one chosen.
   * `reread`: what the phone keeps, read again, as when Download the install file comes back from the browser.
   */
  actions: { get(): void; check(): void; take(uri: string): void; reread(): void };
}

const NOTHING = (): void => undefined;
const NOT_HERE: CarriedApkHandle = {
  needed: null, url: null, handOff: false, opened: null, stale: false, checked: null, kept: null, right: null, canGive: false, cannotGive: null, behind: false,
  actions: { get: NOTHING, check: NOTHING, take: NOTHING, reread: NOTHING }
};

/**
 * Only an Android phone lets someone in, so only Android's file (useCarriedApk.android.ts) names a
 * file, opens the browser or the file picker: the web and iPhone bundles carry none of it.
 */
export function useCarriedApk(): CarriedApkHandle {
  return NOT_HERE;
}
