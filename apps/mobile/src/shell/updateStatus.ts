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

/** The running build, for the settings line: "update 4f2a1c9 · Sep 17, 2:02 PM". */
export function runningBuildLabel(c: { updateId?: string; createdAt?: Date; isEmbeddedLaunch: boolean }): string {
  const which = c.isEmbeddedLaunch ? t('account.update.storeBuild')
    : c.updateId ? t('account.update.updateBuild', { id: c.updateId.slice(0, 7) }) : t('account.update.unknownBuild');
  if (!c.createdAt) return which;
  return `${which} · ${formatDayTime(c.createdAt)}`;
}
