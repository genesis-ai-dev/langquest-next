import { ed25519 } from '@noble/curves/ed25519';
import { base64urlDecode, base64urlEncode } from '@langquest-next/core/nearby';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { INSTALL_KEY } from './nearbySecrets';
import { deviceOnlyStorage } from './secureStorage';
import type { InstallKey } from './nearbyKey';

/**
 * This install's nearby key on an Android phone or an iPhone (docs/nearby-sync-plan.md 5.5,
 * decision 217): one Ed25519 key per install, made the first time someone on the phone belongs to
 * an organization with nearby sync on. On Android it is kept in the Keystore, which Android's
 * backups leave out (`configureAndroidBackup`); on an iPhone in the Keychain for this device only
 * (`deviceOnlyStorage`), which neither an iCloud backup nor a move to a new iPhone carries. So a
 * restored phone makes a new key and counts from 1 under it.
 * The seed comes from `expo-crypto`, because Hermes has no global `crypto.getRandomValues`.
 * It sits outside decision 168's seal (Carl's answer 5). Never logged.
 */

export type { InstallKey } from './nearbyKey';

function keyOf(raw: string | null): InstallKey | null {
  const seed = raw ? base64urlDecode(raw) : null;
  if (!seed || seed.length !== 32) return null;
  return { seed, publicKey: base64urlEncode(ed25519.getPublicKey(seed)) };
}

/**
 * An iPhone's Keychain outlives the app, unlike Android's Keystore: a key left by an earlier install
 * on this iPhone would come back with none of the batches it numbered, and teammates would skip the
 * new ones under the same numbers (Carl's answer 2). The app's own storage goes with the app, so a
 * mark there says this install made the key; a key without it is an earlier install's, and a new
 * one is made.
 */
const MADE_HERE = 'nearby-install-key-made';
const marks = Platform.OS === 'ios';

let making: Promise<InstallKey> | null = null;

async function makeKey(): Promise<InstallKey> {
  const seed = Crypto.getRandomBytes(32);
  await deviceOnlyStorage.setItem(INSTALL_KEY, base64urlEncode(seed));
  const key = keyOf(base64urlEncode(seed))!;
  if (marks) await AsyncStorage.setItem(MADE_HERE, key.publicKey);
  return key;
}

export async function installKey(): Promise<InstallKey | null> {
  const key = keyOf(await deviceOnlyStorage.getItem(INSTALL_KEY));
  if (!key || !marks) return key;
  return (await AsyncStorage.getItem(MADE_HERE)) === key.publicKey ? key : null;
}

/** One key, however many ask at once. A stored seed that cannot be read, or an earlier install's, is replaced, as a lost Keystore entry is. */
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

/** Remove this install's key (Remove me from this phone, docs/nearby-sync-plan.md 14.1, 5): whoever needs one next makes a new one. */
export async function forgetInstallKey(): Promise<void> {
  if (making) await making.catch(() => null);
  await deviceOnlyStorage.removeItem(INSTALL_KEY);
  if (marks) await AsyncStorage.removeItem(MADE_HERE);
}
