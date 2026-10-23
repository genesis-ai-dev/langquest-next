// Where this phone stands with the server, as the sync indicator says it (sync/SyncIndicator.tsx).
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';

export type SyncStanding = 'live' | 'checking' | 'offline' | 'refused';

export function syncStanding(p: Ctx['language']): SyncStanding {
  if (p.refused || p.tooOld || p.refusedEvents > 0) return 'refused';
  if (p.online === false) return 'offline';
  return p.live ? 'live' : 'checking';
}

/** The state in a word or two ("Live", "Offline"), the button's spoken name. */
export function standingTitle(s: SyncStanding): string {
  return s === 'live' ? t('account.sync.standing.live') : s === 'offline' ? t('account.sync.standing.offline')
    : s === 'checking' ? t('account.sync.standing.checking') : t('account.sync.standing.refused');
}

export let previewCount: number | null = null;

export const previewListeners = new Set<(n: number | null) => void>();

export function setPreview(n: number | null) {
  previewCount = n;
  previewListeners.forEach((l) => l(n));
}

/** Developer menu: a slow drain, a burst that lands at once, then a long stall that shows the heavier laps. */
export function previewSyncRing() {
  const steps: [number, number | null][] = [
    [0, 12], [900, 11], [1600, 9], [2400, 8], [3000, 5], [3800, 3], [4500, 1], [5200, 0],
    [7500, 200], [9000, 0],
    [11500, 6], [32000, 2], [34000, 0], [36000, null]
  ];
  for (const [at, n] of steps) setTimeout(() => setPreview(n), at);
}

/**
 * What the sync icon counts. Its number and name say what this device holds for the server
 * (events, language and organization, and recordings not yet uploaded); its ring turns for
 * anything in flight, recordings still coming down too, so a phone that is still receiving
 * never looks done. The Sync screen splits the two ("To send", "To receive").
 */
export function iconCounts(s: { pending: number; orgPending: number; pendingUp: number; pendingDown: number }): { toSend: number; inFlight: number } {
  const toSend = s.pending + s.orgPending + s.pendingUp;
  return { toSend, inFlight: toSend + s.pendingDown };
}
