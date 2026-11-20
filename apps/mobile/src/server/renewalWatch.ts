import { recordAuth } from '../diagnostics/authDiag';
import { listenToRenewals, type RenewalChange } from './sessionSafeFetch';

/**
 * Renewing the sign-in, only when it changes (sessionSafeFetch.ts): it
 * started failing with a status or for want of a network, or it worked
 * again, including a change from before the app started listening. Returns
 * the unsubscribe.
 */
/**
 * Whether the sign-in's renewal is being answered by something that is not
 * Supabase Auth (a 429, a 5xx, a hotspot's page): the phone is online but
 * cannot renew, which "Offline" would misreport (LAN-221). A plain loss of
 * network stays "Offline".
 */
let renewalBlocked = false;
const blockedListeners = new Set<() => void>();
export const signInBlocked = {
  get: () => renewalBlocked,
  subscribe: (l: () => void) => { blockedListeners.add(l); return () => { blockedListeners.delete(l); }; }
};
function setBlocked(next: boolean): void {
  if (next === renewalBlocked) return;
  renewalBlocked = next;
  blockedListeners.forEach((l) => l());
}

export function watchRenewals(): () => void {
  const listener = (c: RenewalChange) => {
    setBlocked(c.outcome === 'http');
    if (c.outcome === 'http') recordAuth('renew', 'http', { code: `http${c.status}`, n: { status: c.status } });
    else if (c.outcome === 'offline') recordAuth('renew', 'offline');
    else recordAuth('renew', 'ok', { n: { ms: c.ms, ...(c.sinceOkMs !== undefined ? { sinceOkMs: c.sinceOkMs } : {}) } });
  };
  return listenToRenewals(listener);
}
