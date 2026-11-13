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

/** The name of the file that installs this build's versions, for the runtime version (fingerprint) it runs on; null where there is none. */
export function carriedApkNameHere(fingerprint: string | null | undefined): string | null {
  if (!fingerprint) return null;
  return carriedApkName({ reducer: REDUCER_VERSION, lines: LINES_VERSION, protocol: NEARBY_PROTOCOL, fingerprint });
}
