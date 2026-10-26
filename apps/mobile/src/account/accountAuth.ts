import { signOutAndForget } from '../web/forgetBrowser';
import { choosePassword, signOutHere } from '../server/auth';

/** Give this account a password (it needs a connection); the server's refusal comes back as `error`. */
export function setAccountPassword(password: string) {
  return choosePassword(password);
}

/** Sign out of this device only (your other devices stay signed in, decision 87), and forget what this browser kept. */
export async function signOutThisDevice(): Promise<void> {
  await signOutAndForget(signOutHere);
}
