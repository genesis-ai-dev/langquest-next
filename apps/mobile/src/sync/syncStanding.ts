// Where this phone stands with the server, as the sync indicator says it (sync/SyncIndicator.tsx).
import type { Ctx } from '../shell/ctx';
import { t } from '../i18n';

export type SyncStanding = 'live' | 'checking' | 'offline' | 'refused' | 'tooOld';

/**
 * An app below the minimum version is its own standing, not "refused" (UI
 * audit, finding 119): its own work still goes out, nothing new comes in,
 * and Update is the way on. An account the server refused outranks it.
 */
export function syncStanding(p: Ctx['language']): SyncStanding {
  if (p.refused) return 'refused';
  if (p.tooOld) return 'tooOld';
  if (p.refusedEvents > 0) return 'refused';
  if (p.online === false) return 'offline';
  return p.live ? 'live' : 'checking';
}

/**
 * Each state's own glyph, so none rests on the dot's colour alone (PLAN
 * section 12, WCAG 1.4.1; UI audit, finding 83): a cloud with a tick when
 * live, a plain cloud while checking, a struck-out one offline, one with
 * a warning when the server refused something, and one with a down arrow
 * when the app must update to receive.
 */
export function standingIcon(s: SyncStanding): 'onPhone' | 'cloud' | 'notOnPhone' | 'cloudAlert' | 'cloudDown' {
  return s === 'live' ? 'onPhone' : s === 'checking' ? 'cloud' : s === 'offline' ? 'notOnPhone' : s === 'tooOld' ? 'cloudDown' : 'cloudAlert';
}

/** The state in a word or two ("Live", "Offline"), the button's spoken name. */
export function standingTitle(s: SyncStanding): string {
  return s === 'live' ? t('account.sync.standing.live') : s === 'offline' ? t('account.sync.standing.offline')
    : s === 'checking' ? t('account.sync.standing.checking') : s === 'tooOld' ? t('account.sync.standing.tooOld') : t('account.sync.standing.refused');
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
