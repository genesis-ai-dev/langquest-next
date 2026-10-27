/**
 * JSON Web Tokens signed in the Worker with WebCrypto, for the services
 * that take one instead of a token: a Google service account (RS256, for
 * Google Play) and an App Store Connect API key (ES256). The private keys
 * come from the Worker's secrets and never leave it.
 */

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const text = (s: string) => b64url(new TextEncoder().encode(s));

/** A PKCS#8 PEM ("-----BEGIN PRIVATE KEY-----"), as Google's JSON and Apple's .p8 both give it, to DER bytes. */
export function pemToDer(pem: string): Uint8Array {
  const body = pem.replace(/\\n/g, '\n').replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, '');
  if (!body) throw new Error('the private key is empty');
  return Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
}

export type Alg = 'RS256' | 'ES256';

const PARAMS: Record<Alg, { import: SubtleCryptoImportKeyAlgorithm; sign: SubtleCryptoSignAlgorithm }> = {
  RS256: { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, sign: { name: 'RSASSA-PKCS1-v1_5' } },
  // WebCrypto's ECDSA signature is r||s, 64 bytes, which is what JWS ES256 wants.
  ES256: { import: { name: 'ECDSA', namedCurve: 'P-256' }, sign: { name: 'ECDSA', hash: 'SHA-256' } }
};

export async function signJwt(alg: Alg, pem: string, claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(pem), PARAMS[alg].import, false, ['sign']);
  const input = `${text(JSON.stringify({ alg, typ: 'JWT', ...header }))}.${text(JSON.stringify(claims))}`;
  const signature = new Uint8Array(await crypto.subtle.sign(PARAMS[alg].sign, key, new TextEncoder().encode(input)));
  return `${input}.${b64url(signature)}`;
}

/** A secret holding JSON (a service account's key file, the App Store key's three parts), read or refused by name. */
export function jsonSecret<T>(value: string, name: string, fields: (keyof T & string)[]): T {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error(`${name} is not JSON (docs/admin.md says how to make it)`); }
  for (const f of fields) {
    if (typeof (parsed as Record<string, unknown>)?.[f] !== 'string') throw new Error(`${name} has no "${f}"`);
  }
  return parsed as T;
}
