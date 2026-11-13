import { signOutAndForget } from '../web/forgetBrowser';
import { choosePassword, signOutHere } from '../server/auth';
import { LOCKS_ON_SIGN_OUT, lockAndSignOut } from '../server/lock';
import { tryUnregisterNotifications, unregisterNotifications } from '../notifications/notifications';
import { HANDS_OVER, signOutHandingOver } from '../sync/handOver';
import type { BlobRef } from '@langquest-next/core';

// The phone's sign-in lock (decisions.md 168), for the account screen's sign-out and password.
export { LOCKS_ON_SIGN_OUT, lockAndSignOut, rememberPassword, setLockPattern } from '../server/lock';

/** Give this account a password (it needs a connection); the server's refusal comes back as `error`. */
export function setAccountPassword(password: string) {
  return choosePassword(password);
}

/** Sign out of this device only (your other devices stay signed in, decision 87), and forget what this browser kept. */
export async function signOutThisDevice(): Promise<void> {
  await signOutAndForget(signOutHere);
}

/**
 * Sign Out, once nothing holds it back: a phone hands unsent work over and
 * sends it as you later (decisions.md 60), else locks the sign-in for your
 * return (168); a browser signs out of this device only (87). Sign Out and
 * the app lock's Forgot? (200) both leave this way. `unsent` lists the open
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
