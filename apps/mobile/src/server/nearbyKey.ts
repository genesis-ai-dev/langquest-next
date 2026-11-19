/**
 * This install's nearby key (docs/nearby-sync-plan.md 5.5). Key making and the certificate call
 * are a phone's, Android's and an iPhone's, behind `.native` files (nearbyKey.native.ts), because
 * the web shares nothing nearby (decision 58). Here there is none.
 */

/** The Ed25519 seed and its public half, base64url. Never logged, never sent but the public half. */
export interface InstallKey {
  publicKey: string;
  seed: Uint8Array;
}

/** The key this install holds, if any. */
export async function installKey(): Promise<InstallKey | null> {
  return null;
}

/** The key, made the first time it is needed. */
export async function ensureInstallKey(): Promise<InstallKey | null> {
  return null;
}

/** A new key in place of the old, after the server said the old one was revoked. */
export async function replaceInstallKey(): Promise<InstallKey | null> {
  return null;
}

/** Remove this install's key; here there is none. */
export async function forgetInstallKey(): Promise<void> {}
