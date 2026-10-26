import { recordAuth } from '../diagnostics/authDiag';
import { renewalChanges, type RenewalChange } from './sessionSafeFetch';

/**
 * Renewing the sign-in, only when it changes (sessionSafeFetch.ts): it
 * started failing with a status or for want of a network, or it worked
 * again. Returns the unsubscribe.
 */
export function watchRenewals(): () => void {
  const listener = (c: RenewalChange) => {
    if (c.outcome === 'http') recordAuth('renew', 'http', { code: `http${c.status}`, n: { status: c.status } });
    else if (c.outcome === 'offline') recordAuth('renew', 'offline');
    else recordAuth('renew', 'ok', { n: { ms: c.ms, ...(c.sinceOkMs !== undefined ? { sinceOkMs: c.sinceOkMs } : {}) } });
  };
  renewalChanges.add(listener);
  return () => { renewalChanges.delete(listener); };
}
