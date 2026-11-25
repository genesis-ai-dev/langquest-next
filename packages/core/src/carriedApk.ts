import { LINES_VERSION } from './passageLines';
import { REDUCER_VERSION } from './reducer';
import { NEARBY_PROTOCOL } from './version';

/**
 * The carried build's file name (docs/nearby-sync-plan.md 14.4): the versions that decide
 * whether a starting copy can be read and two phones can talk, and the first 8 of the Android
 * fingerprint, such as `r21-l1-p1-0a1b2c3d.apk`. A carrier keeps the file in Downloads or on an
 * SD card, where no disguise applies, so the name holds nothing that names the app or an
 * organization. One function names it for `scripts/carried-build.mjs`, the Worker's `/apk/*`
 * route and Let someone in, so the three always agree.
 */
export interface CarriedVersions {
  reducer: number;
  lines: number;
  protocol: { min: number; max: number };
  /** The Android native fingerprint (the runtime version), hex; only its first 8 go in the name. */
  fingerprint: string;
}

/** What the Worker serves under (`/apk/<name>`), as a literal so a reader finds it. */
export const CARRIED_APK_PATH = '/apk/';

/**
 * The custom metadata that `scripts/carried-build.mjs` puts on each file in the APK bucket (as
 * `x-amz-meta-version-code`): its Play version code, by which the Worker finds the newest file
 * for a phone's versions.
 */
export const CARRIED_APK_VERSION_CODE = 'version-code';

/**
 * More custom metadata on each file in the APK bucket (as `x-amz-meta-built-ms`): when its
 * JavaScript was built, in ms since 1970, the `commitTime` in expo-updates' manifest inside it,
 * which the Android app reads from its own kept copy the same way. The Worker answers it under
 * `CARRIED_BUILT_HEADER`, so a carrier's phone can tell a newer file from the one it keeps
 * (docs/decisions/2026-11-19-carried-build-refreshed-daily.md, amended 2026-11-25).
 */
export const CARRIED_APK_BUILT_MS = 'built-ms';

/** The response header the Worker gives a carried build's built time under (`CARRIED_APK_BUILT_MS`). */
export const CARRIED_BUILT_HEADER = 'x-carried-built-ms';

const FINGERPRINT = /^[0-9a-f]{8,}$/;
const NAME = /^r(\d{1,6})-l(\d{1,6})-p(\d{1,6})(?:\.(\d{1,6}))?-([0-9a-f]{8})\.apk$/;

const whole = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** The name for these versions, or null when any is not one (a fingerprint shorter than 8 hex, a range upside down). */
export function carriedApkName(v: CarriedVersions): string | null {
  const fingerprint = v.fingerprint.toLowerCase();
  if (!whole(v.reducer) || !whole(v.lines) || !whole(v.protocol.min) || !whole(v.protocol.max)) return null;
  if (v.protocol.min > v.protocol.max || !FINGERPRINT.test(fingerprint)) return null;
  const protocol = v.protocol.min === v.protocol.max ? `${v.protocol.max}` : `${v.protocol.min}.${v.protocol.max}`;
  return `r${v.reducer}-l${v.lines}-p${protocol}-${fingerprint.slice(0, 8)}.apk`;
}

/** The versions a name holds, or null for anything that is not a carried build's name as `carriedApkName` writes it. */
export function parseCarriedApkName(name: string): CarriedVersions | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const min = Number(m[3]);
  const max = m[4] === undefined ? min : Number(m[4]);
  const v = { reducer: Number(m[1]), lines: Number(m[2]), protocol: { min, max }, fingerprint: m[5]! };
  // One spelling per name: `p1.1` and `r021` are not names this writes, so they name nothing.
  return carriedApkName(v) === name ? v : null;
}

/**
 * The start of a carried build's name that says which phones it fits: its reducer, lines and
 * protocol versions, such as `r21-l1-p1-`, without the fingerprint; null for a name core does not
 * write. Every file whose name starts the same way installs an app that can join a phone on those
 * versions (the session's `sameVersions` checks only the reducer and lines, and the protocol
 * decides whether two phones can talk), so the Worker sends a phone whose own build has no file
 * to the newest that fits, and Check my file takes any of them
 * (docs/decisions/2026-11-18-carried-file-matches-by-versions.md).
 */
export function carriedApkVersionsPart(name: string): string | null {
  const v = parseCarriedApkName(name);
  if (!v) return null;
  return carriedApkName(v)!.slice(0, -'00000000.apk'.length);
}

/** Whether two names are carried builds for the same versions, whatever their fingerprints. */
export function sameCarriedVersions(a: string, b: string): boolean {
  const start = carriedApkVersionsPart(a);
  return start !== null && start === carriedApkVersionsPart(b);
}

/** The name of the file that installs this build's versions, for the runtime version (fingerprint) it runs on; null where there is none. */
export function carriedApkNameHere(fingerprint: string | null | undefined): string | null {
  if (!fingerprint) return null;
  return carriedApkName({ reducer: REDUCER_VERSION, lines: LINES_VERSION, protocol: NEARBY_PROTOCOL, fingerprint });
}

/**
 * The content type the Worker gives a carried build that a carrier's browser downloads for
 * LangQuest itself (docs/decisions/0246-a-carried-build-is-the-newcomers.md, amended 2026-11-20).
 * The Android app opens this type, so the browser's own Open, when the download finishes, hands
 * the file to the app, which checks it and keeps a copy for Give the app: no system picker, and no
 * finding the way back. Not an install file's type, so the carrier's browser does not warn that it
 * may be harmful, and Open does not offer to install it over the app. The bytes are the same.
 */
export const CARRIED_FILE_TYPE = 'application/x-carried-build';

const APK_END = '.apk';
const FILE_END = '.carried';

/**
 * The name a carrier's browser downloads a carried build under for the app to take, as
 * `r21-l1-p1-0a1b2c3d.carried`: the same versions as `apkName`, so it names nothing either. Null
 * for a name `carriedApkName` does not write.
 */
export function carriedFileName(apkName: string): string | null {
  return parseCarriedApkName(apkName) ? `${apkName.slice(0, -APK_END.length)}${FILE_END}` : null;
}

/**
 * The carried build a file's name stands for: an install file's own name as it is, or one
 * `carriedFileName` writes as the install file's name; null for any other.
 */
export function carriedApkNameOf(fileName: string): string | null {
  if (parseCarriedApkName(fileName)) return fileName;
  if (!fileName.endsWith(FILE_END)) return null;
  const name = `${fileName.slice(0, -FILE_END.length)}${APK_END}`;
  return parseCarriedApkName(name) ? name : null;
}
