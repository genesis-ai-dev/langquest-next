import { recordAuth, since } from './authDiag';
import type { Wrap } from './lockModel';
import { keepPushToken } from '../notifications/notifications';
import { openLock, restoreSession } from '../server/lock';
import { takeBackHandOver } from '../sync/handOver';

export type SignBackIn = { kind: 'ok' } | { kind: 'none' } | { kind: 'wrong' } | { kind: 'wait'; ms: number };

/**
 * Sign back in from the lock on this phone, with no connection
 * (decisions.md 168): with a password and the email or sign-in name typed
 * with it, or with the pattern of the person whose picture was tapped.
 * Their session comes back as it was, from the courier when it still held
 * their unsent work (decisions.md 60), so that work now goes as them from
 * here. `none`: no lock here fits, and the server decides instead.
 */
export async function signBackIn(kind: Wrap['kind'], secret: string, who: { address?: string; actorId?: string }): Promise<SignBackIn> {
  const started = Date.now();
  const opened = await openLock(kind, secret, who);
  const action = kind === 'pattern' ? 'lock_pattern' : 'lock_password';
  if (opened.kind === 'wrong') recordAuth('sign_in', 'refused', { action, n: { ms: since(started) } });
  if (opened.kind === 'wait') recordAuth('sign_in', 'rate_limited', { action });
  if (opened.kind !== 'ok') return opened;
  const back = await takeBackHandOver(opened.actorId);
  if (back?.pushToken) await keepPushToken(back.pushToken);
  if (!await restoreSession(opened.actorId, opened.key, back?.session ?? null)) return { kind: 'none' };
  recordAuth('sign_in', 'ok', { action, n: { ms: since(started) } });
  return { kind: 'ok' };
}
