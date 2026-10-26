import { signOutAndForget } from '../web/forgetBrowser';
import { choosePassword, signOutHere } from '../server/auth';

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
