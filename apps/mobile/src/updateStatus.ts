/**
 * OTA updates are invisible by default: expo-updates checks on load, downloads
 * in the background, and swaps the bundle at some later cold start. A tester
 * then cannot say which build they are on, and a fix we shipped looks like a
 * fix we did not. This turns the update machine's state into one line of text
 * the banner shows, so "is the new version in yet?" has an answer on screen.
 *
 * Pure so the wording is testable without a native module.
 */
import { t } from './i18n';
import { formatDayTime, formatPercent } from './i18n/format';
type UpdateStatus = {
  /**
   * `busy` = something is happening, no action. `ready`/`failed`/`offline` are
   * tappable. `offline` is its own kind because "Update failed" reads as "the
   * app broke" when all that happened is the device has no network; the banner
   * shows it as a struck-through cloud instead of an error.
   */
  kind: 'busy' | 'ready' | 'failed' | 'offline';
  text: string;
  /** What a tap does, when the banner is tappable. */
  action?: 'restart' | 'retry';
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
  const error = u.downloadError ?? u.checkError;
  if (error) {
    if (isOffline(error)) return { kind: 'offline', text: t('account.update.offline'), action: 'retry' };
    // expo-updates' own reason, for the tester reading it out (it has no codes).
    return { kind: 'failed', text: t('account.update.failed', { reason: error.message }), action: 'retry' };
  }
  // A check with nothing to report stays silent: a banner on every launch
  // saying "up to date" is a banner nobody reads.
  if (u.isChecking) return null;
  return null;
}

/**
 * A reachability failure, as opposed to a real update failure. The update
 * machine has no error codes, only messages, so this matches on the wording
 * the platforms use when the request never reached a server.
 */
const OFFLINE_HINTS = /network request failed|internet connection appears to be offline|could not connect to the server|network is unreachable|no internet|offline|timed out|timeout/i;

function isOffline(error: Error): boolean {
  return OFFLINE_HINTS.test(error.message);
}

/** The running build, for the settings line: "update 4f2a1c9 · Sep 17, 2:02 PM". */
export function runningBuildLabel(c: { updateId?: string; createdAt?: Date; isEmbeddedLaunch: boolean }): string {
  const which = c.isEmbeddedLaunch ? t('account.update.storeBuild')
    : c.updateId ? t('account.update.updateBuild', { id: c.updateId.slice(0, 7) }) : t('account.update.unknownBuild');
  if (!c.createdAt) return which;
  return `${which} · ${formatDayTime(c.createdAt)}`;
}
