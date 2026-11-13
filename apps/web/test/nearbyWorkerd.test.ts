import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unstable_startWorker } from 'wrangler';
import { base64urlDecode, base64urlEncode, bytesToHex, certRequestText, checkChain, nearbyBytes, utf8Encode, type Verify } from '@langquest-next/core/nearby';
import { CERTIFICATE_MS } from '../worker/nearby';
import { subtleSha256 } from '../worker/nearbyKeys';
import { CHAIN, CHAIN_INVITER_KEY, CHAIN_ROOT_KEY, GENERATIONS, MANIFEST_SIG, MANIFEST_TEXT, PROFILE, PUBLIC_KEY, SEED_HEX } from '../../../packages/core/test/nearbyVectors';

/**
 * One sign and verify under workerd (docs/nearby-sync-plan.md 7, phase 2 step 3):
 * the root of trust is the Worker's `crypto.subtle` Ed25519, and Node's is not the
 * same code. Wrangler, a dev dependency already, starts the real runtime with the
 * Worker's compatibility date and flags; the signatures are checked here with
 * node:crypto and core's checkChain.
 */

const pkcs8 = (seedHex: string) => createPrivateKey({ key: Buffer.from(`302e020100300506032b657004220420${seedHex}`, 'hex'), format: 'der', type: 'pkcs8' });
const jwkOf = (seedHex: string, kid: string) => {
  const { kty, crv, d, x } = pkcs8(seedHex).export({ format: 'jwk' });
  return JSON.stringify({ kty, crv, d, x, kid });
};
const nodeVerifyFn: Verify = (publicKey, message, signature) =>
  nodeVerify(null, message, createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' }), Buffer.from(base64urlDecode(signature)!));

const DEVICE = '33333333-3333-4333-8333-333333333333';
const NOW = 1730000000000 - CERTIFICATE_MS;

const CONFIG = fileURLToPath(new URL('./workerd/wrangler.jsonc', import.meta.url));
const jsonc = (file: string) => JSON.parse(readFileSync(file, 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')) as
  { compatibility_date: string; compatibility_flags: string[] };

let worker: Awaited<ReturnType<typeof unstable_startWorker>>;

beforeAll(async () => {
  // Its own config, so wrangler reads nothing of the app Worker's (containers, bindings) above it.
  worker = await unstable_startWorker({ config: CONFIG, dev: { server: { port: 0 }, inspector: false, logLevel: 'error' } });
}, 60_000);

afterAll(async () => {
  await worker?.dispose();
});

describe('the Worker\'s nearby key under workerd', () => {
  it('runs on the app Worker\'s compatibility date and flags', () => {
    const app = jsonc(fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)));
    const mine = jsonc(CONFIG);
    expect([mine.compatibility_date, mine.compatibility_flags]).toEqual([app.compatibility_date, app.compatibility_flags]);
  });

  it('signs the golden manifest byte for byte, verifies a golden signature, and signs a first link that core\'s checkChain takes', async () => {
    const req = { profileId: PROFILE, deviceId: DEVICE, publicKey: CHAIN_INVITER_KEY };
    const proof = base64urlEncode(new Uint8Array(nodeSign(null, nearbyBytes('certRequest', certRequestText(req)), pkcs8('02'.repeat(32)))));
    const res = await worker.fetch('http://nearby.test/', {
      method: 'POST',
      body: JSON.stringify({
        // The phone's key signs the manifest; the root key (seed 0x03, kid k1) signs the link.
        jwk: jwkOf(SEED_HEX, 'k1'), certKeys: `k1:${PUBLIC_KEY}`,
        sign: base64urlEncode(nearbyBytes('batch', MANIFEST_TEXT)),
        verify: { key: PUBLIC_KEY, message: base64urlEncode(nearbyBytes('batch', MANIFEST_TEXT)), sig: MANIFEST_SIG },
        certificate: { body: { publicKey: CHAIN_INVITER_KEY, deviceId: DEVICE, languages: [], proof }, profileId: PROFILE, now: NOW, facts: { revoked: false, limited: false, orgs: [] } }
      })
    });
    const out = await res.json() as { runtime: string; signature: string; verified: boolean; status: number };
    expect(out).toMatchObject({ runtime: 'Cloudflare-Workers', signature: MANIFEST_SIG, verified: true, status: 200 });

    const root = await worker.fetch('http://nearby.test/', {
      method: 'POST',
      body: JSON.stringify({
        jwk: jwkOf('03'.repeat(32), 'k1'), certKeys: `k1:${CHAIN_ROOT_KEY}`,
        sign: base64urlEncode(utf8Encode('anything')),
        verify: { key: PUBLIC_KEY, message: base64urlEncode(nearbyBytes('batch', `${MANIFEST_TEXT} `)), sig: MANIFEST_SIG },
        certificate: {
          body: { publicKey: CHAIN_INVITER_KEY, deviceId: DEVICE, languages: ['org1/lang1'], proof }, profileId: PROFILE, now: NOW,
          facts: {
            revoked: false, limited: false,
            orgs: [{
              orgId: 'org1', orgSeq: 40, features: ['nearby'], revokedSeq: 0, revocations: [],
              scopes: [{ level: 'language', languageId: 'lang1', roleId: 'translator', privileges: ['invite_members', 'translate', 'review'] }],
              discoveryKeys: [{ languageId: 'lang1', gen: 2, floor: 1, key: bytesToHex(base64urlDecode(GENERATIONS[0]!)!) }]
            }]
          }
        }
      })
    });
    const signed = await root.json() as { verified: boolean; status: number; chainOk: boolean; certificate: { chains: { chain: unknown[] }[] } };
    expect(signed).toMatchObject({ verified: false, status: 200, chainOk: true });
    // The same bytes Node's Ed25519 made for the golden vector, and Node takes them.
    expect(signed.certificate.chains[0]!.chain).toEqual([CHAIN[0]]);
    const verdict = await checkChain(signed.certificate.chains[0]!.chain, {
      rootKeys: new Map([['k1', CHAIN_ROOT_KEY]]), orgId: 'org1', now: NOW, verify: nodeVerifyFn, sha256: subtleSha256
    });
    expect(verdict.ok).toBe(true);
  }, 60_000);
});
