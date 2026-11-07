import { createHash, diffieHellman, createPrivateKey, createPublicKey, hkdfSync, randomBytes } from 'node:crypto';
import {
  base64urlDecode, base64urlEncode, checkChain, discoveryKeyAt, eventDigest, isBase64url, nearbyBytes, newcomerProfileId
} from '@langquest-next/core/nearby';
import { checkOpeningI, makeOpeningI, makeOpeningR, openingKeyOf, sessionKeysOf, type NearbyCrypto } from '@langquest-next/sync/nearby';
import { fakeSigner } from '../../../packages/sync/src/testing/memoryNearbyLink';
import * as v from '../../../packages/core/test/nearbyVectors';
import { base64url, fromBase64url, nobleSha256, nobleVerify, phoneCryptoOf, publicKeyOf, signWith } from '../src/nearby/nearbyCryptoModel';

/**
 * The phone's nearby cryptography (src/nearby/nearbyCryptoModel.ts) against core's golden
 * vectors (packages/core/test/nearbyVectors.ts, made with Python's hashlib and Node's
 * Ed25519, not with the code they check), against the RFCs where core has none, and
 * against Node's own X25519 and HKDF, which the fleet's doubles use.
 */

const fromHex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const SEED = fromHex(v.SEED_HEX);
const random = (n: number) => new Uint8Array(randomBytes(n));
// Typed as sync's, so a change to `NearbyCrypto` that this does not follow fails here too.
const phone: NearbyCrypto = phoneCryptoOf(SEED, random);

describe('base64url', () => {
  it('writes and reads core\'s spelling, and refuses any other', () => {
    for (const size of [0, 1, 2, 3, 16, 31, 32, 33, 64]) {
      const bytes = random(size);
      const text = base64url(bytes);
      expect(text).toBe(base64urlEncode(bytes));
      expect(fromBase64url(text, size)).toEqual(bytes);
      expect(isBase64url(text, size)).toBe(true);
    }
    expect(base64url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
    expect(fromBase64url(v.PUBLIC_KEY, 32)).toEqual(base64urlDecode(v.PUBLIC_KEY));
    // Wrong length, padding, another alphabet, a last character with stray low bits, not text.
    expect(fromBase64url(v.PUBLIC_KEY, 31)).toBeNull();
    expect(fromBase64url(`${v.PUBLIC_KEY}=`, 32)).toBeNull();
    expect(fromBase64url(v.PUBLIC_KEY.replace(/.$/, '+'), 32)).toBeNull();
    expect(fromBase64url('AB', 1)).toBeNull();
    expect(fromBase64url(42, 1)).toBeNull();
  });
});

describe('Ed25519, against the golden vectors', () => {
  it('makes the vectors\' public key from their seed', () => {
    expect(publicKeyOf(SEED)).toBe(v.PUBLIC_KEY);
    expect(phone.publicKey).toBe(v.PUBLIC_KEY);
  });

  it('signs a manifest to the very signature Node made', async () => {
    const bytes = nearbyBytes('batch', v.MANIFEST_TEXT);
    expect(await phone.sign(bytes)).toBe(v.MANIFEST_SIG);
    expect(signWith(SEED, bytes)).toBe(v.MANIFEST_SIG);
  });

  it('verifies what Node signed, and nothing changed', () => {
    const bytes = nearbyBytes('batch', v.MANIFEST_TEXT);
    expect(nobleVerify(v.PUBLIC_KEY, bytes, v.MANIFEST_SIG)).toBe(true);
    expect(nobleVerify(v.PUBLIC_KEY, nearbyBytes('attest', v.MANIFEST_TEXT), v.MANIFEST_SIG)).toBe(false);
    expect(nobleVerify(v.CHAIN_ROOT_KEY, bytes, v.MANIFEST_SIG)).toBe(false);
    const flipped = v.MANIFEST_SIG.slice(0, 10) + (v.MANIFEST_SIG[10] === 'A' ? 'B' : 'A') + v.MANIFEST_SIG.slice(11);
    expect(nobleVerify(v.PUBLIC_KEY, bytes, flipped)).toBe(false);
    // Bytes that are not a key or a signature are a failed check, not a throw.
    expect(nobleVerify('not a key', bytes, v.MANIFEST_SIG)).toBe(false);
    expect(nobleVerify(v.PUBLIC_KEY, bytes, 'short')).toBe(false);
    expect(nobleVerify(base64url(new Uint8Array(32).fill(0xff)), bytes, v.MANIFEST_SIG)).toBe(false);
  });

  it('checks the golden two-link chain as core\'s own test does', async () => {
    const out = await checkChain(v.CHAIN, { rootKeys: new Map([['k1', v.CHAIN_ROOT_KEY]]), orgId: 'org1', languageId: 'lang1', now: null, verify: nobleVerify, sha256: nobleSha256 });
    expect(out).toMatchObject({ ok: true, links: 2, holder: { installKey: v.PUBLIC_KEY, profileId: v.NEWCOMER_ID }, inviter: v.PROFILE });
    const tampered = JSON.parse(JSON.stringify(v.CHAIN)) as { body: { name?: string } }[];
    tampered[1]!.body.name = 'Mallory';
    expect(await checkChain(tampered, { rootKeys: new Map([['k1', v.CHAIN_ROOT_KEY]]), orgId: 'org1', now: null, verify: nobleVerify, sha256: nobleSha256 }))
      .toEqual({ ok: false, reason: 'bad link signature' });
  });

  it('signs what Node verifies, for a key made by the phone', async () => {
    const seed = random(32);
    const mine = phoneCryptoOf(seed, random);
    const message = random(100);
    const sig = await mine.sign(message);
    expect(fakeSigner('x').verify(mine.publicKey, message, sig)).toBe(true);
    expect(nobleVerify(mine.publicKey, message, sig)).toBe(true);
  });

  it('refuses a seed that is not 32 bytes', () => {
    expect(() => phoneCryptoOf(new Uint8Array(31), random)).toThrow();
  });
});

describe('SHA-256, against the golden vectors', () => {
  it('digests events as Python did', async () => {
    expect(await eventDigest(v.EVENT_NO_PARENT, nobleSha256)).toBe(v.EVENT_NO_PARENT_DIGEST);
    expect(await eventDigest(v.EVENT_PULLED, nobleSha256)).toBe(v.EVENT_PULLED_DIGEST);
  });

  it('walks discovery generations down as the migration does', async () => {
    const [top, ...below] = v.GENERATIONS;
    for (let i = 0; i < below.length; i++) {
      expect(base64url((await discoveryKeyAt({ gen: 10, key: top! }, 9 - i, nobleSha256))!)).toBe(below[i]);
    }
  });

  it('derives a newcomer\'s id from their key', async () => {
    expect(await newcomerProfileId(v.PUBLIC_KEY, v.NEWCOMER_SALT, nobleSha256)).toBe(v.NEWCOMER_ID);
  });
});

describe('HMAC, HKDF and X25519', () => {
  it('makes both openings of the golden vectors', () => {
    const { kOpen, salt, nonceI, ephI, nonceR, ephR, i, r } = v.OPENING;
    const unused = new Uint8Array(32);
    const made = makeOpeningI(phone, fromHex(kOpen), fromHex(salt), { nonce: fromHex(nonceI), eph: { secret: unused, public: fromHex(ephI) } });
    expect(hex(made.bytes)).toBe(i);
    expect(checkOpeningI(phone, fromHex(kOpen), fromHex(salt), made.bytes)).toEqual({ nonce: fromHex(nonceI), eph: fromHex(ephI) });
    const reply = makeOpeningR(phone, fromHex(kOpen), fromHex(salt), made.bytes, { nonce: fromHex(nonceR), eph: { secret: unused, public: fromHex(ephR) } });
    expect(hex(reply.bytes)).toBe(r);
  });

  it('HKDF-SHA256 gives RFC 5869\'s third test case, and Node\'s answers', () => {
    expect(hex(phone.hkdfSha256(fromHex('0b'.repeat(22)), new Uint8Array(0), '', 42)))
      .toBe('8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8');
    const kSess = new Uint8Array(32).fill(3);
    expect(hex(openingKeyOf(phone, kSess))).toBe(Buffer.from(hkdfSync('sha256', kSess, new Uint8Array(0), 'lq-nearby-open-v1', 32)).toString('hex'));
    expect(hex(phone.hkdfSha256(kSess, fromHex('aa'.repeat(32)), 'lq-nearby-keys-v1', 128)))
      .toBe(Buffer.from(hkdfSync('sha256', kSess, fromHex('aa'.repeat(32)), 'lq-nearby-keys-v1', 128)).toString('hex'));
  });

  it('HMAC-SHA256 gives RFC 4231\'s second test case', () => {
    expect(hex(phone.hmacSha256(new TextEncoder().encode('Jefe'), new TextEncoder().encode('what do ya want for nothing?'))))
      .toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  });

  it('X25519 gives RFC 7748\'s shared secret, and refuses an all-zero one', () => {
    const alice = fromHex('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a');
    const bobPublic = fromHex('de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f');
    expect(hex(phone.x25519(alice, bobPublic))).toBe('4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742');
    expect(() => phone.x25519(alice, new Uint8Array(32))).toThrow();
  });

  it('agrees with Node\'s X25519, so a phone and the fleet open the same session keys', () => {
    const pair = phone.x25519Pair();
    expect(pair.secret.length).toBe(32);
    const node = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), randomBytes(32)]), format: 'der', type: 'pkcs8' });
    const nodePublic = new Uint8Array(Buffer.from(createPublicKey(node).export({ format: 'jwk' }).x!, 'base64url'));
    const theirs = diffieHellman({ privateKey: node, publicKey: createPublicKey({ key: { kty: 'OKP', crv: 'X25519', x: base64url(pair.public) }, format: 'jwk' }) });
    expect(hex(phone.x25519(pair.secret, nodePublic))).toBe(Buffer.from(theirs).toString('hex'));
  });

  it('opens the same session keys as a fleet phone on the other side', () => {
    const fleet = fakeSigner('other side');
    const kOpen = openingKeyOf(phone, new Uint8Array(32).fill(4));
    const salt = new Uint8Array([1, 2, 3]);
    const oi = makeOpeningI(phone, kOpen, salt);
    const or = makeOpeningR(fleet, kOpen, salt, oi.bytes);
    const t = { ephI: oi.eph, ephR: or.eph, nonceI: oi.nonce, nonceR: or.nonce };
    const kSess = new Uint8Array(32).fill(4);
    const mine = sessionKeysOf(phone, kSess, { secret: oi.secret }, { eph: or.eph }, t);
    const theirs = sessionKeysOf(fleet, kSess, { secret: or.secret }, { eph: oi.eph }, t);
    expect(mine).not.toBeNull();
    expect(mine).toEqual(theirs);
  });

  it('hashes as Node does', () => {
    const bytes = random(1000);
    expect(hex(phone.sha256(bytes))).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(phone.randomBytes(7).length).toBe(7);
  });
});
