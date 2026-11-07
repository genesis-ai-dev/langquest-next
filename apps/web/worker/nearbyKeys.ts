import { base64urlDecode, base64urlEncode, isBase64url, type Sha256, type Verify } from '@langquest-next/core/nearby';

/**
 * The Worker's Ed25519 for nearby sync (docs/nearby-sync-plan.md 5.5, 5.12):
 * `crypto.subtle`, which workerd and Node both have, so the same code signs in
 * production and in the tests. The private key is `NEARBY_SIGNING_KEY`, one
 * compact JWK with its `kid` (a secret of its own, never derived from the
 * service key: rotating that would strand offline phones). The public keys are
 * `NEARBY_CERT_KEYS`, `kid:base64url,...`, the same list phones carry in
 * `EXPO_PUBLIC_NEARBY_CERT_KEYS` (a test holds them equal).
 */

export interface NearbySigner {
  kid: string;
  /** Base64url, 32 bytes. */
  publicKey: string;
  /** Plain Ed25519 over these bytes; base64url, 64 bytes. */
  sign(message: Uint8Array): Promise<string>;
}

const KID = /^[A-Za-z0-9_-]{1,64}$/;

/** A view `crypto.subtle` takes whatever buffer the bytes sit on. */
const view = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(bytes);

/**
 * `kid:base64url,...` as a map. Any entry that is not a kid and a 32-byte key
 * makes the whole list empty, so a typo refuses every chain rather than
 * trusting part of a list nobody meant. Empty text is an empty list: until a
 * person runs `scripts/nearby-signing-key.sh`, nothing is trusted.
 */
export function parseCertKeys(text: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const entry of (text ?? '').split(',').map((e) => e.trim()).filter(Boolean)) {
    const at = entry.indexOf(':');
    const kid = entry.slice(0, at);
    const key = entry.slice(at + 1);
    if (at < 1 || !KID.test(kid) || !isBase64url(key, 32) || out.has(kid)) return new Map();
    out.set(kid, key);
  }
  return out;
}

/**
 * The signer, or null when there is no usable key: no secret, a JWK that is not
 * an Ed25519 private key with a `kid`, or a `kid` that `NEARBY_CERT_KEYS` does
 * not list with this very public key. A chain no phone would trust is no use,
 * so the routes answer 503 until both are in place.
 */
export async function nearbySigner(jwkText: string | undefined, certKeys: string | undefined): Promise<NearbySigner | null> {
  if (!jwkText?.trim()) return null;
  let jwk: unknown;
  try {
    jwk = JSON.parse(jwkText);
  } catch {
    return null;
  }
  if (typeof jwk !== 'object' || jwk === null) return null;
  const { kty, crv, d, x, kid } = jwk as Record<string, unknown>;
  if (kty !== 'OKP' || crv !== 'Ed25519' || !isBase64url(d, 32) || !isBase64url(x, 32) || typeof kid !== 'string' || !KID.test(kid)) return null;
  if (parseCertKeys(certKeys).get(kid) !== x) return null;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey('jwk', { kty, crv, d, x }, { name: 'Ed25519' }, false, ['sign']);
  } catch {
    return null;
  }
  return {
    kid,
    publicKey: x,
    sign: async (message) => base64urlEncode(new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key, view(message))))
  };
}

/** Core's `Verify` on `crypto.subtle`. Bytes that are not a key or a signature answer false. */
export const subtleVerify: Verify = async (publicKey, message, signature) => {
  const raw = isBase64url(publicKey, 32) ? base64urlDecode(publicKey) : null;
  const sig = isBase64url(signature, 64) ? base64urlDecode(signature) : null;
  if (!raw || !sig) return false;
  try {
    const key = await crypto.subtle.importKey('raw', view(raw), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, view(sig), view(message));
  } catch {
    return false;
  }
};

/** Core's `Sha256` on `crypto.subtle`. */
export const subtleSha256: Sha256 = async (bytes) => new Uint8Array(await crypto.subtle.digest('SHA-256', view(bytes)));

/** Lowercase or upper hex as bytes; null for anything else. */
export function hexBytes(hex: unknown): Uint8Array | null {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
