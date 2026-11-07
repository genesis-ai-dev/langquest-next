import { useSyncExternalStore } from 'react';
import { signInBlocked } from '../server/renewalWatch';

/** True while the sign-in cannot be renewed although the phone is online (LAN-221); the sync icon says so. */
export function useSignInBlocked(): boolean {
  return useSyncExternalStore(signInBlocked.subscribe, signInBlocked.get, () => false);
}
