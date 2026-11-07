import { ed25519 } from '@noble/curves/ed25519';
import { base64urlDecode, base64urlEncode } from '@langquest-next/core/nearby';
import * as Crypto from 'expo-crypto';
import { INSTALL_KEY } from './nearbySecrets';
import { secureStorage } from './secureStorage';
import type { InstallKey } from './nearbyKey';

/**
 * This install's nearby key on Android (docs/nearby-sync-plan.md 5.5): one Ed25519 key per
 * install, made the first time someone on the phone belongs to an organization with nearby sync
 * on, and kept in the Keystore (secureStorage.ts), which Android's backups leave out
 * (`configureAndroidBackup`), so a restored phone makes a new key and counts from 1 under it.
 * The seed comes from `expo-crypto`, because Hermes has no global `crypto.getRandomValues`.
 * It sits outside decision 168's seal (Carl's answer 5). Never logged.
 */

export type { InstallKey } from './nearbyKey';

function keyOf(raw: string | null): InstallKey | null {
  const seed = raw ? base64urlDecode(raw) : null;
  if (!seed || seed.length !== 32) return null;
  return { seed, publicKey: base64urlEncode(ed25519.getPublicKey(seed)) };
}

let making: Promise<InstallKey> | null = null;

async function makeKey(): Promise<InstallKey> {
  const seed = Crypto.getRandomBytes(32);
  await secureStorage.setItem(INSTALL_KEY, base64urlEncode(seed));
  return keyOf(base64urlEncode(seed))!;
}

export async function installKey(): Promise<InstallKey | null> {
  return keyOf(await secureStorage.getItem(INSTALL_KEY));
}

/** One key, however many ask at once. A stored seed that cannot be read is replaced, as a lost Keystore entry is. */
export async function ensureInstallKey(): Promise<InstallKey | null> {
  const held = await installKey();
  if (held) return held;
  making ??= makeKey().finally(() => { making = null; });
  return making;
}

export async function replaceInstallKey(): Promise<InstallKey | null> {
  if (making) await making.catch(() => null);
  making = makeKey().finally(() => { making = null; });
  return making;
}
