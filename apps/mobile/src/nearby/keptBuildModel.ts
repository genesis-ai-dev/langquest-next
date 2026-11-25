import { parseCarriedApkName } from '@langquest-next/core';
import { keptBehind, type KeptFile } from './carriedApkModel';

/*
 * Whether a newer install file than the kept copy is ready: the copy comes from an older native
 * build than this phone runs, or the Worker holds a file built after it
 * (docs/decisions/2026-11-19-carried-build-refreshed-daily.md, amended 2026-11-20 and 2026-11-25), as pure rules.
 * Only Android's files import this (useCarriedApk.android.ts, carriedApkKept.ts), so the web
 * bundle, which never keeps a file, carries none of it.
 */

/**
 * A third phone-wide meta row: the name this phone needed when a copy was last kept, so a copy from
 * an older native build is flagged only until one is kept under this build (`keptFromOlderBuild`).
 * Like the other two, it holds a carried build's name and nothing else.
 */
export const CARRIED_APK_KEPT_UNDER_KEY = 'carriedApkKeptUnder';

/**
 * Whether the kept copy comes from an older native build than this phone runs: its name's
 * fingerprint is not this build's (`needed`), so it installs an app without this build's native
 * parts, though its versions let a newcomer join (Carl, 2026-11-20). Files match by versions, so
 * before this nothing was said until the copy's JavaScript fell two days behind (`keptBehind`).
 * Not once a copy was kept while this phone ran this build (`keptUnder`): then the server had
 * nothing newer for these versions (a build on a release branch, or a file still being made), and
 * asking again would bring the same file. Unknown until the row is read, so nothing changes under
 * a finger.
 */
export function keptFromOlderBuild(kept: KeptFile | null | undefined, needed: string | null, keptUnder: string | null | undefined): boolean {
  if (!kept || needed === null || keptUnder === undefined || keptUnder === needed) return false;
  const have = parseCarriedApkName(kept.name);
  const want = parseCarriedApkName(needed);
  return !!have && !!want && have.fingerprint !== want.fingerprint;
}

/**
 * Whether the Worker holds a newer file than the kept copy, so a newer one is ready
 * (docs/decisions/2026-11-19-carried-build-refreshed-daily.md, amended 2026-11-25): its file for
 * this phone's versions was built after the copy (`serverBuiltMs`, asked while online), as on the
 * day a refresh or a refresh started by hand lands. The two times come from the same place, the
 * `commitTime` built into each file, so the copy of the same file is never newer or older. Where
 * either is unknown (a file published before its time was recorded, a copy whose time native
 * could not read, or no answer yet, as offline), the two-day rule decides as before (`keptBehind`).
 */
export function keptOutdated(kept: KeptFile | null | undefined, serverBuiltMs: number | null | undefined, runningMs: number | null): boolean {
  if (!kept) return false;
  if (typeof kept.builtMs === 'number' && typeof serverBuiltMs === 'number') return serverBuiltMs > kept.builtMs;
  return keptBehind(kept, runningMs);
}
