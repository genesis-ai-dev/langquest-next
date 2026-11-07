import { createHash, createHmac, createPrivateKey, createPublicKey, diffieHellman, hkdfSync, sign as edSign, verify as edVerify } from 'node:crypto';
import {
  attestationText, base64urlEncode, linkText, nearbyBytes, type Attestation, type ChainLink, type ChainOrg, type Privilege, type WorkerLink
} from '@langquest-next/core';
import type { NearbyCrypto } from '../nearbyLink';
import type { Message } from '../nearbyWire';

/**
 * Doubles for nearby sync (docs/nearby-sync-plan.md 5.12): real Ed25519 under
 * `node:crypto`, keyed from a name so that a run is deterministic, and a Worker that
 * issues certificates and attestations. Node only: nothing here reaches a phone.
 */

const seedOf = (label: string) => createHash('sha256').update(label).digest();
const ED25519_PKCS8 = Buffer.from('302e020100300506032b657004220420', 'hex');
const X25519_PKCS8 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const privateKey = (prefix: Buffer, seed: Uint8Array) => createPrivateKey({ key: Buffer.concat([prefix, seed]), format: 'der', type: 'pkcs8' });
const bytesOf = (b: Buffer | ArrayBuffer) => new Uint8Array(b as ArrayBuffer);

export const fakeSha256 = (bytes: Uint8Array): Uint8Array => bytesOf(createHash('sha256').update(bytes).digest());

/** Checks a real signature. A key or signature it cannot read is a failed check, as a phone's would be. */
export function fakeVerify(publicKey: string, message: Uint8Array, signature: string): boolean {
  try {
    const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' });
    return edVerify(null, message, key, Buffer.from(signature, 'base64url'));
  } catch {
    return false;
  }
}

/** `NearbyCrypto` for one install. The same name gives the same key, on any run. */
export function fakeSigner(installId: string): NearbyCrypto {
  const secret = privateKey(ED25519_PKCS8, seedOf(`install:${installId}`));
  let drawn = 0;
  const randomBytes = (size: number) => {
    const out = new Uint8Array(size);
    for (let at = 0; at < size; at += 32) out.set(seedOf(`random:${installId}:${drawn++}`).subarray(0, Math.min(32, size - at)), at);
    return out;
  };
  return {
    publicKey: createPublicKey(secret).export({ format: 'jwk' }).x!,
    sign: async (message) => base64urlEncode(bytesOf(edSign(null, message, secret))),
    verify: fakeVerify,
    sha256: fakeSha256,
    hmacSha256: (key, message) => bytesOf(createHmac('sha256', key).update(message).digest()),
    hkdfSha256: (ikm, salt, info, length) => bytesOf(hkdfSync('sha256', ikm, salt, info, length)),
    x25519Pair: () => {
      const seed = randomBytes(32);
      const pub = createPublicKey(privateKey(X25519_PKCS8, seed)).export({ format: 'jwk' }).x!;
      return { secret: seed, public: bytesOf(Buffer.from(pub, 'base64url')) };
    },
    x25519: (mine, theirs) => bytesOf(diffieHellman({
      privateKey: privateKey(X25519_PKCS8, mine),
      publicKey: createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: base64urlEncode(theirs) }, format: 'jwk' })
    })),
    randomBytes
  };
}

export interface FakeWorker {
  kid: string;
  rootKeys: ReadonlyMap<string, string>;
  /** A one-link chain, as the certificate call answers. */
  certify(holder: { installKey: string; profileId: string; deviceId: string }, org: Pick<ChainOrg, 'orgId'> & Partial<Omit<ChainOrg, 'orgId'>> & { privileges?: Privilege[] }): Promise<ChainLink[]>;
  /** A `claims` page over these rows' events, as the attest call answers, with `events` the rows it carries. */
  attest(att: Omit<Attestation, 'v' | 'kid'>): Promise<Omit<Extract<Message, { t: 'claims' }>, 'events' | 't'>>;
}

export function fakeWorker(kid = 'k1'): FakeWorker {
  const root = fakeSigner(`worker:${kid}`);
  return {
    kid,
    rootKeys: new Map([[kid, root.publicKey]]),
    async certify(holder, { orgId, orgSeq = 1, scopes, privileges = [] }) {
      const body: WorkerLink['body'] = {
        ...holder, expiresAt: Number.MAX_SAFE_INTEGER,
        org: { orgId, orgSeq, scopes: scopes ?? [{ level: 'org', privileges }] }
      };
      return [{ kind: 'worker@1', kid, body, sig: await root.sign(nearbyBytes('link', linkText({ kind: 'worker@1', kid, body }, ''))) }];
    },
    async attest(att) {
      const text = attestationText({ v: 1, kid, ...att });
      return { text, kid, sig: await root.sign(nearbyBytes('attest', text)) };
    }
  };
}
