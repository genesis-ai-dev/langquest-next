/**
 * OTA updates are invisible by default: expo-updates checks on load, downloads
 * in the background, and swaps the bundle at some later cold start. A tester
 * then cannot say which build they are on, and a fix we shipped looks like a
 * fix we did not. This turns the update machine's state into one line of text
 * the banner shows, so "is the new version in yet?" has an answer on screen.
 *
 * Pure so the wording is testable without a native module.
 */
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
  if (u.isRestarting) return { kind: 'busy', text: 'Restarting…' };
  // Pending outranks a stale error: the bundle is on the device either way.
  if (u.isUpdatePending) return { kind: 'ready', text: 'Update ready — tap to restart', action: 'restart' };
  if (u.isDownloading) {
    const pct = typeof u.downloadProgress === 'number' ? ` ${Math.round(u.downloadProgress * 100)}%` : '';
    return { kind: 'busy', text: `Downloading update…${pct}` };
  }
  const error = u.downloadError ?? u.checkError;
  if (error) {
    if (isOffline(error)) return { kind: 'offline', text: 'Offline — tap to retry', action: 'retry' };
    return { kind: 'failed', text: `Update failed: ${error.message} — tap to retry`, action: 'retry' };
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
const OFFLINE_HINTS = [
  'network request failed',
  'internet connection appears to be offline',
  'could not connect to the server',
  'network is unreachable',
  'no internet',
  'offline',
  'timed out',
  'timeout'
];

function isOffline(error: Error): boolean {
  const message = error.message.toLowerCase();
  return OFFLINE_HINTS.some((hint) => message.includes(hint));
}

/** The running build, for the settings line: "update 4f2a1c9 · 17 Sep, 14:02". */
export function runningBuildLabel(c: { updateId?: string; createdAt?: Date; isEmbeddedLaunch: boolean }): string {
  const which = c.isEmbeddedLaunch ? 'store build' : `update ${c.updateId ? c.updateId.slice(0, 7) : 'unknown'}`;
  if (!c.createdAt) return which;
  const when = c.createdAt.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `${which} · ${when}`;
}
