import { CARRIED_APK_PATH, parseCarriedApkName } from '@langquest-next/core';

/**
 * Where the Worker serves a carried build's file (apps/web/worker/apk.ts, `GET /apk/<name>`), for
 * the phone's browser to download: the Worker's address and the name, or null with no Worker or a
 * name core does not write, which the Worker would answer with 404 anyway.
 */
export function carriedApkAddress(apiUrl: string | null, name: string): string | null {
  if (!apiUrl || parseCarriedApkName(name) === null) return null;
  return `${apiUrl.replace(/\/$/, '')}${CARRIED_APK_PATH}${name}`;
}
