import { CARRIED_BUILT_HEADER } from '@langquest-next/core';
import { Platform } from 'react-native';
import { carriedApkAddress } from './carriedApkModel';

/** The Worker's address, as blobTransport.ts reads it. */
const apiUrl = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') || (Platform.OS === 'web' ? '' : null);

/**
 * The address of the carried build's file named `name` (docs/nearby-sync-plan.md 14.4), for Let
 * someone in to open in the phone's browser. The browser downloads the file, and the person
 * installs it on the new phone; the app only asks when it was built (`carriedApkBuiltMs`).
 */
export function carriedApkUrl(name: string): string | null {
  return carriedApkAddress(apiUrl, name);
}

/**
 * When the file the Worker serves for `name` was built (its JavaScript, in ms since 1970), so a
 * phone keeping a copy can tell whether a newer one is ready
 * (docs/decisions/2026-11-19-carried-build-refreshed-daily.md, amended 2026-11-25). A HEAD
 * request: nothing is downloaded, and it names only the versions in `name`. Null when the Worker
 * does not say (a file published before the time was recorded) or answers otherwise; a phone with
 * no internet rejects.
 */
export async function carriedApkBuiltMs(name: string): Promise<number | null> {
  const url = carriedApkUrl(name);
  if (!url) return null;
  const res = await fetch(url, { method: 'HEAD' });
  if (!res.ok) return null;
  const ms = Number(res.headers.get(CARRIED_BUILT_HEADER));
  return Number.isSafeInteger(ms) && ms > 0 ? ms : null;
}
