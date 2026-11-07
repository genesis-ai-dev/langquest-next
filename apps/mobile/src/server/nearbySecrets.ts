import { secureStorage } from './secureStorage';

/**
 * Nearby sync's secrets in the Keychain or Keystore (docs/nearby-sync-plan.md 5.5, 5.12 "The
 * store"): the install key, and each person's discovery keys. Never logged, never sent.
 *
 * - The install key sits outside decision 168's seal (Carl's answer 5): a signed-out person's
 *   unsent work may still be signed and sent, by someone signed in who opened Share nearby.
 * - `nearbyFindKeys:<profileId>` is inside it: lock.ts seals it with that person's session at
 *   sign-out and puts it back at sign-in, since only their own Share nearby uses it.
 *
 * Plain storage calls, the same on every build: only Android writes any (nearbyKey.android.ts,
 * src/nearby), so elsewhere these read nothing.
 */

export const INSTALL_KEY = 'nearby-install-key';

/** Where a signed-in person's discovery keys are kept. */
export const findKeysKey = (profileId: string) => `nearbyFindKeys:${profileId}`;

/** This person's discovery keys as stored (src/nearby/nearbyModel.ts reads them), or null. */
export function readFindKeys(profileId: string): Promise<string | null> {
  return secureStorage.getItem(findKeysKey(profileId));
}

export async function writeFindKeys(profileId: string, raw: string | null): Promise<void> {
  if (raw === null) await secureStorage.removeItem(findKeysKey(profileId));
  else await secureStorage.setItem(findKeysKey(profileId), raw);
}
