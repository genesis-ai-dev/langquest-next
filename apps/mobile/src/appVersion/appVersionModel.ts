/**
 * Telling people to update (decisions.md 154). The server records each
 * store version once it is live (app_versions(), storeReleases.ts), and
 * keeps the lowest version that may still sync. This says what a phone
 * running some version should show:
 * - `required`: below the minimum. The app stops syncing and keeps the
 *   person's work on the phone until they update.
 * - `available`: an older version than the newest live one, and the person
 *   has not dismissed that newest one.
 * - `none`: up to date, or nothing known yet.
 */

import { compareVersions, versionParts } from '@langquest-next/core';

export { compareVersions, versionParts };

export type Platform = 'ios' | 'android';

/** What the server says about one platform (app_versions()). */
export interface PlatformVersions {
  platform: Platform;
  /** The newest version live in the store, or null before any is recorded. */
  version: string | null;
  /** The lowest version that may still sync; '0' lets every version sync. */
  minVersion: string;
}

export type Offer = 'none' | 'available' | 'required';

/** What a phone running `running` should show. A version it cannot read is never stopped. */
export function offerFor(input: { running: string | null; versions: PlatformVersions | null; dismissed: string | null }): Offer {
  const { running, versions, dismissed } = input;
  if (!versions || !versionParts(running)) return 'none';
  if (versionParts(versions.minVersion) && compareVersions(running!, versions.minVersion) < 0) return 'required';
  if (!versions.version || !versionParts(versions.version)) return 'none';
  if (compareVersions(running!, versions.version) >= 0) return 'none';
  if (dismissed && compareVersions(dismissed, versions.version) >= 0) return 'none';
  return 'available';
}

/** The store page where the person gets the newest version. */
export function storeUrl(platform: Platform): string {
  return platform === 'ios'
    ? 'https://apps.apple.com/app/id6812492008'
    : 'https://play.google.com/store/apps/details?id=com.frontierrnd.langquestnext';
}
