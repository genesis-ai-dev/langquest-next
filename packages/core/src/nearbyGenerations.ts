import type { Sha256 } from './nearbyChain';
import { base64urlDecode, concatBytes, utf8Encode } from './nearbySigning';

/**
 * A language's discovery key rotates as a one-way hash chain of generations
 * (docs/nearby-sync-plan.md 5.12, Generations; Carl's answer 13). Hashing runs only
 * downward, so a key opens every generation below it and none above, and a phone
 * stores only its newest. The twin is in SQL, with a golden vector for both.
 */

const GENERATION_LABEL = 'lq-nearby-gen-v1';
const KEY_BYTES = 32;

/** One generation's key, as a certificate answer or a hand-on gives it. `key` is base64url. */
export interface DiscoveryKey {
  gen: number;
  key: string;
}

/** The key one generation below. */
export async function olderDiscoveryKey(key: Uint8Array, sha256: Sha256): Promise<Uint8Array> {
  return sha256(concatBytes(utf8Encode(GENERATION_LABEL), key));
}

/** The key of generation `gen`, worked out when needed and never stored. Null above what is held, or below generation 1. */
export async function discoveryKeyAt(held: DiscoveryKey, gen: number, sha256: Sha256): Promise<Uint8Array | null> {
  if (!Number.isSafeInteger(gen) || gen < 1 || gen > held.gen) return null;
  let key = base64urlDecode(held.key);
  if (key === null || key.length !== KEY_BYTES) return null;
  for (let g = held.gen; g > gen; g--) key = await olderDiscoveryKey(key, sha256);
  return key;
}

/**
 * Does a key a teammate handed on really come from above mine? Only someone holding
 * a newer key can make one that hashes down to mine. `maxSteps` bounds the work a
 * teammate can ask of this phone. A failure drops the message and ends nothing.
 */
export async function handedKeyHolds(mine: DiscoveryKey, handed: DiscoveryKey, sha256: Sha256, maxSteps: number): Promise<boolean> {
  const steps = handed.gen - mine.gen;
  if (!Number.isSafeInteger(handed.gen) || !Number.isSafeInteger(steps) || steps < 1 || steps > maxSteps) return false;
  const ours = base64urlDecode(mine.key);
  const down = await discoveryKeyAt(handed, mine.gen, sha256);
  return !!ours && !!down && ours.length === down.length && down.every((b, i) => b === ours[i]);
}
