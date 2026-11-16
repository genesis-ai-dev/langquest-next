/**
 * OTA updates are invisible by default: expo-updates checks on load, downloads
 * in the background, and swaps the bundle at some later cold start. A tester
 * then cannot say which build they are on, and a fix we shipped looks like a
 * fix we did not. This turns the update machine's state into one line of text
 * the banner shows, so "is the new version in yet?" has an answer on screen.
 *
 * Pure so the wording is testable without a native module.
 */
import { t } from '../i18n';
import { formatDayTime, formatPercent } from '../i18n/format';
type UpdateStatus = {
  /** `busy` = something is happening, no action. `ready` is tappable. */
  kind: 'busy' | 'ready';
  text: string;
  /** What a tap does, when the banner is tappable. */
  action?: 'restart';
};

export type UpdateSignals = {
  isChecking: boolean;
  isDownloading: boolean;
  isUpdatePending: boolean;
  isRestarting: boolean;
  downloadProgress?: number;
  checkError?: Error;
  downloadError?: Error;
};

export function updateStatus(u: UpdateSignals): UpdateStatus | null {
  if (u.isRestarting) return { kind: 'busy', text: t('account.update.restarting') };
  // Pending outranks a stale error: the bundle is on the device either way.
  if (u.isUpdatePending) return { kind: 'ready', text: t('account.update.ready'), action: 'restart' };
  if (u.isDownloading) {
    return {
      kind: 'busy',
      text: typeof u.downloadProgress === 'number'
        ? t('account.update.downloadingPercent', { percent: formatPercent(Math.round(u.downloadProgress * 100)) })
        : t('account.update.downloading')
    };
  }
  // A check that failed says nothing (decisions.md 166). Almost always the
  // phone is offline, which the platforms word in their own ways ("Unable to
  // resolve host u.expo.dev"), and nothing on screen could help: the next
  // return to the app looks again, and diagnostics keep the reason. Nor does
  // a check with nothing to report: a banner on every launch saying "up to
  // date" is a banner nobody reads.
  return null;
}

/** Why the last check or download failed, for diagnostics; null when nothing failed. */
export function updateFailure(u: UpdateSignals): Error | null {
  return u.isUpdatePending ? null : u.downloadError ?? u.checkError ?? null;
}

/**
 * The running build, for the Sync screen: the store build and the update on
 * top of it, each with its date.
 *   store build 2026.1030.1319 (48) · Oct 30, 1:19 PM
 *   update 4f2a1c9 · Nov 12, 4:05 PM
 * The phone's settings show only the store build and the update shows
 * nowhere else, so a tester needs both to say which code they are on. A
 * browser has no store build, so it has the update line alone.
 */
export function runningBuildLines(c: {
  store?: { version: string; build?: string };
  updateId?: string;
  createdAt?: Date;
  isEmbeddedLaunch: boolean;
}): string[] {
  const dated = (text: string, at: Date | null | undefined) => (at ? `${text} · ${formatDayTime(at)}` : text);
  const lines: string[] = [];
  if (c.store) {
    const { version, build } = c.store;
    // A build that is not a store build (1.0.0) has no time in its version; running its own bundle, the bundle's time is its own.
    const at = storeVersionTime(version) ?? (c.isEmbeddedLaunch ? c.createdAt : null);
    lines.push(dated(t('account.update.storeBuild', { version: build ? `${version} (${build})` : version }), at));
  }
  if (c.isEmbeddedLaunch) lines.push(t('account.update.noUpdate'));
  else lines.push(dated(c.updateId ? t('account.update.updateBuild', { id: c.updateId.slice(0, 7) }) : t('account.update.unknownBuild'), c.createdAt));
  return lines;
}

/**
 * When a store build was made, read back from its version: a store build's
 * version is the time of its merge in UTC as year.monthday.hourminute
 * (apps/mobile/app.config.js, decisions.md 157), so 2026.1022.1830 is
 * 2026-10-22T18:30Z. Null for any other version, such as 1.0.0.
 */
export function storeVersionTime(version: string): Date | null {
  const m = /^(\d{4})\.(\d{3,4})\.(\d{1,4})$/.exec(version);
  if (!m) return null;
  const [year, monthDay, hourMinute] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(year, Math.floor(monthDay / 100) - 1, monthDay % 100, Math.floor(hourMinute / 100), hourMinute % 100));
  // Only a version that its time gives back exactly: 2026.1340.2575 is no time.
  const again = `${at.getUTCFullYear()}.${(at.getUTCMonth() + 1) * 100 + at.getUTCDate()}.${at.getUTCHours() * 100 + at.getUTCMinutes()}`;
  return again === version ? at : null;
}
