import { signOutAndForget } from '../web/forgetBrowser';
import { changeEmail, choosePassword, refreshSignIn, signOutHere } from '../server/auth';
import { LOCKS_ON_SIGN_OUT, lockAndSignOut, rememberAddress } from '../server/lock';
import { tryUnregisterNotifications, unregisterNotifications } from '../notifications/notifications';
import { HANDS_OVER, signOutHandingOver } from '../sync/handOver';
import type { BlobRef } from '@langquest-next/core';

// The phone's sign-in lock (decisions.md 168), for the account screen's sign-out and password.
export { LOCKS_ON_SIGN_OUT, lockAndSignOut, rememberPassword, setLockPattern } from '../server/lock';

/** Give this account a password (it needs a connection); the server's refusal comes back as `error`. */
export function setAccountPassword(password: string) {
  return choosePassword(password);
}

/**
 * Give this account `address` as its email (it needs a connection; LAN-304).
 * Null once it is the account's address; else the reason as Supabase Auth's
 * codes say it (authErrorText), or `offline` when the server was not reached.
 * The session is renewed so the app sees the new address at once, and this
 * phone's lock is found by it from now on (decisions.md 168).
 */
export async function setAccountEmail(actorId: string, address: string): Promise<{ code: string; message: string } | null> {
  const { error } = await changeEmail(address);
  if (error) {
    if ((error as { name?: string }).name === 'FunctionsFetchError') return { code: 'offline', message: error.message };
    const context = (error as { context?: unknown }).context as { json?: () => Promise<unknown> } | undefined;
    const reply = typeof context?.json === 'function'
      ? await context.json().catch(() => null) as { error?: unknown; code?: unknown } | null
      : null;
    return { code: typeof reply?.code === 'string' ? reply.code : 'unknown', message: typeof reply?.error === 'string' ? reply.error : error.message };
  }
  // Saved on the server: a renewal that fails now comes with the next one, within the hour.
  await refreshSignIn().catch(() => undefined);
  await rememberAddress(actorId, address);
  return null;
}

/** Sign out of this device only (your other devices stay signed in, decision 87), and forget what this browser kept. */
export async function signOutThisDevice(): Promise<void> {
  await signOutAndForget(signOutHere);
}

/**
 * Sign Out, once nothing holds it back: a phone hands unsent work over and
 * sends it as you later (decisions.md 60), else locks the sign-in for your
 * return (168); a browser signs out of this device only (87). Sign Out and
 * the app lock's Forgot? (253) both leave this way. `unsent` lists the open
 * language's recordings still to upload.
 */
export async function leaveThisDevice(actorId: string, handsOver: boolean, language: { orgId: string; languageId: string; unsent: () => Promise<BlobRef[]> }): Promise<void> {
  if (HANDS_OVER && handsOver) {
    const { orgId, languageId } = language;
    await signOutHandingOver(actorId, (await language.unsent()).map((ref) => ({ orgId, languageId, ref })));
    return;
  }
  if (HANDS_OVER) {
    // Offline, the courier disconnects this phone's notifications later, as you (decision 87).
    if (!await tryUnregisterNotifications()) { await signOutHandingOver(actorId, []); return; }
  } else {
    await unregisterNotifications();
  }
  // A phone keeps the session, locked, for your return (decision 168); this device only either way (decision 87).
  if (LOCKS_ON_SIGN_OUT) { await lockAndSignOut(actorId); return; }
  await signOutThisDevice();
}
