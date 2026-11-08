import { createPrivateKey, createPublicKey, sign as nodeSign, verify as nodeVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AnyEvent } from '@langquest-next/core';
import {
  base64urlDecode, base64urlEncode, bytesToHex, certRequestText, checkChain, eventDigest, issueInviteLink, JOIN_PASS_USES, nearbyBytes, newcomerProfileId,
  parseAttestation, parseRevocationList, passText, type JoinPass, type Verify, type WorkerLink
} from '@langquest-next/core/nearby';
import { NotAuthorizedError, SupabaseTransport } from '@langquest-next/sync';
import type { SupabaseClient } from '@supabase/supabase-js';
import { handleApi, type ApiDeps } from '../worker/api';
import { ATTEST_PATH, CERTIFICATE_MS, CERTIFICATE_PATH, handleNearby, type NearbyDeps, type RpcAnswer } from '../worker/nearby';
import { hexBytes, nearbySigner, parseCertKeys, subtleSha256, subtleVerify } from '../worker/nearbyKeys';
import { routeClass } from '../worker/requestTally';
import {
  ATTESTATION_TEXT, CHAIN, CHAIN_INVITER_KEY, CHAIN_ROOT_KEY, EVENT_NO_PARENT, EVENT_NO_PARENT_DIGEST, EVENT_PULLED, EVENT_PULLED_DIGEST, GENERATIONS,
  MANIFEST_SIG, MANIFEST_TEXT, PASS_EXPIRES_AT, PASS_ID, PASS_NOW_MS, PROFILE, PUBLIC_KEY, REVOCATION_TEXT, SEED_HEX
} from '../../../packages/core/test/nearbyVectors';

/**
 * Nearby sync's Worker routes (docs/nearby-sync-plan.md 5.12) with real Ed25519
 * on Node's `crypto.subtle`, against core's golden vectors. Signatures are
 * checked with node:crypto, not with the Worker's own verify. The same signer
 * runs under workerd in nearbyWorkerd.test.ts.
 */

// ---- keys from seeds, as the vectors were made -------------------------------------

const pkcs8 = (seedHex: string) => createPrivateKey({ key: Buffer.from(`302e020100300506032b657004220420${seedHex}`, 'hex'), format: 'der', type: 'pkcs8' });
const jwkOf = (seedHex: string, kid: string) => {
  const { kty, crv, d, x } = pkcs8(seedHex).export({ format: 'jwk' });
  return JSON.stringify({ kty, crv, d, x, kid });
};
const signWith = (seedHex: string, message: Uint8Array) => base64urlEncode(new Uint8Array(nodeSign(null, message, pkcs8(seedHex))));
const nodeVerifyFn: Verify = (publicKey, message, signature) =>
  nodeVerify(null, message, createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' }), Buffer.from(base64urlDecode(signature)!));

/** The vectors' root is a seed of 0x03; the inviter, whose phone asks here, a seed of 0x02. */
const ROOT_SEED = '03'.repeat(32);
const PHONE_SEED = '02'.repeat(32);
const ROOT_JWK = jwkOf(ROOT_SEED, 'k1');
const CERT_KEYS = `k1:${CHAIN_ROOT_KEY}`;
const ROOT_KEYS = new Map([['k1', CHAIN_ROOT_KEY]]);
const DEVICE = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'token-of-the-inviter';
/** CHAIN's first link expires at 1730000000000. */
const NOW = 1730000000000 - CERTIFICATE_MS;

const signer = nearbySigner(ROOT_JWK, CERT_KEYS);

// ---- what the database answers -----------------------------------------------------

const DISCOVERY_HEX = bytesToHex(base64urlDecode(GENERATIONS[0]!)!);
const factsOrg = (over: Record<string, unknown> = {}) => ({
  orgId: 'org1', orgSeq: 40, features: ['nearby'],
  scopes: [{ level: 'language', languageId: 'lang1', roleId: 'translator', privileges: ['invite_members', 'translate', 'review'] }],
  discoveryKeys: [{ languageId: 'lang1', gen: 3, floor: 1, key: DISCOVERY_HEX }],
  revokedSeq: 4, revocations: [{ seq: 4, publicKey: PUBLIC_KEY, profileId: PROFILE, revokedAtMs: 1700000000000 }],
  ...over
});
const FACTS = { revoked: false, limited: false, orgs: [factsOrg()] };

/** Rows as `pull_events` returns them: an empty parent is null. */
const row = (e: AnyEvent, seq: number) => ({
  id: e.id, org_id: e.orgId, stream_id: e.streamId, server_seq: seq, type: e.type, actor_id: e.actorId, device_id: e.deviceId, hlc: e.hlc,
  parent_event_id: e.parentEventId ?? null, payload: e.payload
});
const deep = (n: number): unknown => (n === 0 ? 'x' : { a: deep(n - 1) });
const UNDIGESTIBLE = { ...EVENT_PULLED, id: 'e-deep', parentEventId: undefined, payload: deep(40) } as unknown as AnyEvent;

/** A client that answers `pull_events` from these rows, so the Worker maps them through the real `SupabaseTransport.pull`. */
function pullingClient(rows: ReturnType<typeof row>[], calls: Record<string, unknown>[]) {
  return {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, ...args });
      if (args['p_org_id'] === 'org1' && args['p_stream_id'] === 'secret') return { data: null, error: { code: '42501', message: 'not a member' }, status: 403 };
      const after = args['p_after'] as number;
      return { data: rows.filter((r) => r.server_seq > after).slice(0, args['p_limit'] as number), error: null, status: 200 };
    }
  } as unknown as SupabaseClient;
}

interface World {
  rows: ReturnType<typeof row>[];
  facts: RpcAnswer;
  on: RpcAnswer;
  allowed: boolean;
  factsCalls: unknown[][];
  pullCalls: Record<string, unknown>[];
}

function setup(over: Partial<NearbyDeps> = {}, world: Partial<World> = {}): { deps: NearbyDeps; w: World } {
  const w: World = {
    rows: [row(EVENT_NO_PARENT, 77), row(EVENT_PULLED, 78)],
    facts: { data: FACTS, error: null },
    on: { data: true, error: null },
    allowed: true,
    factsCalls: [],
    pullCalls: [],
    ...world
  };
  const deps: NearbyDeps = {
    signer: () => signer,
    certificateCaller: async (token) => (token === TOKEN ? PROFILE : null),
    profileOf: async (token) => (token === TOKEN ? PROFILE : null),
    allowed: async () => w.allowed,
    facts: async (...args) => { w.factsCalls.push(args); return w.facts; },
    nearbyOn: async () => w.on,
    pullAs: (token, orgId, streamId, after, limit) => {
      expect(token).toBe(TOKEN);
      return new SupabaseTransport(pullingClient(w.rows, w.pullCalls)).pull(orgId, streamId, after, limit);
    },
    now: () => NOW,
    verify: subtleVerify,
    sha256: subtleSha256,
    ...over
  };
  return { deps, w };
}

const post = (path: string, body: unknown, token: string | null = TOKEN) => new Request(`https://next.langquest.org${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});

const certBody = (over: Record<string, unknown> = {}) => {
  const req = { profileId: PROFILE, deviceId: DEVICE, publicKey: CHAIN_INVITER_KEY };
  return {
    publicKey: CHAIN_INVITER_KEY, deviceId: DEVICE, languages: ['org1/lang1', 'org2/x'],
    proof: signWith(PHONE_SEED, nearbyBytes('certRequest', certRequestText(req))),
    ...over
  };
};

// ---- the key ---------------------------------------------------------------------

describe('the Worker\'s nearby key', () => {
  it('signs as Ed25519 does: the golden manifest and the golden first link come out byte for byte', async () => {
    const phone = await nearbySigner(jwkOf(SEED_HEX, 'p1'), `p1:${PUBLIC_KEY}`);
    expect(phone?.publicKey).toBe(PUBLIC_KEY);
    expect(await phone!.sign(nearbyBytes('batch', MANIFEST_TEXT))).toBe(MANIFEST_SIG);
    const { sig, ...link } = CHAIN[0] as { sig: string; kind: 'worker@1'; kid: string; body: never };
    const { linkText } = await import('@langquest-next/core/nearby');
    expect(await (await signer)!.sign(nearbyBytes('link', linkText(link, '')))).toBe(sig);
  });

  it('verifies and hashes as node:crypto and the vectors do', async () => {
    expect(await subtleVerify(PUBLIC_KEY, nearbyBytes('batch', MANIFEST_TEXT), MANIFEST_SIG)).toBe(true);
    expect(await subtleVerify(PUBLIC_KEY, nearbyBytes('batch', `${MANIFEST_TEXT} `), MANIFEST_SIG)).toBe(false);
    expect(await subtleVerify('not a key', new Uint8Array(1), MANIFEST_SIG)).toBe(false);
    expect(await subtleVerify(PUBLIC_KEY, new Uint8Array(1), 'short')).toBe(false);
    expect(await eventDigest(EVENT_NO_PARENT, subtleSha256)).toBe(EVENT_NO_PARENT_DIGEST);
    expect(await eventDigest(EVENT_PULLED, subtleSha256)).toBe(EVENT_PULLED_DIGEST);
  });

  it('is no key at all without a secret, with a JWK that is not an Ed25519 private key, or with a kid phones do not trust with this key', async () => {
    const { d: _d, ...publicOnly } = JSON.parse(ROOT_JWK) as Record<string, string>;
    for (const [jwk, keys] of [
      [undefined, CERT_KEYS], ['', CERT_KEYS], ['{not json', CERT_KEYS], [JSON.stringify(publicOnly), CERT_KEYS],
      [JSON.stringify({ ...JSON.parse(ROOT_JWK), kid: undefined }), CERT_KEYS], [JSON.stringify({ ...JSON.parse(ROOT_JWK), crv: 'X25519' }), CERT_KEYS],
      [ROOT_JWK, undefined], [ROOT_JWK, ''], [ROOT_JWK, `k2:${CHAIN_ROOT_KEY}`], [ROOT_JWK, `k1:${PUBLIC_KEY}`]
    ] as const) expect(await nearbySigner(jwk, keys), `${jwk} / ${keys}`).toBeNull();
    expect((await nearbySigner(ROOT_JWK, `k0:${PUBLIC_KEY}, k1:${CHAIN_ROOT_KEY}`))?.kid).toBe('k1');
  });

  it('reads the public list as kid:key pairs, and a list with any bad entry as no list', () => {
    expect([...parseCertKeys(`k0:${PUBLIC_KEY},k1:${CHAIN_ROOT_KEY}`)]).toEqual([['k0', PUBLIC_KEY], ['k1', CHAIN_ROOT_KEY]]);
    for (const bad of [`k1${CHAIN_ROOT_KEY}`, `:${CHAIN_ROOT_KEY}`, `k1:${CHAIN_ROOT_KEY}=`, `k1:${CHAIN_ROOT_KEY},k1:${PUBLIC_KEY}`, `k 1:${CHAIN_ROOT_KEY}`]) {
      expect(parseCertKeys(bad).size, bad).toBe(0);
    }
    expect(parseCertKeys('').size).toBe(0);
    expect(hexBytes('0aFf')).toEqual(new Uint8Array([10, 255]));
    for (const bad of ['abc', 'zz', 7]) expect(hexBytes(bad)).toBeNull();
  });
});

// ---- the certificate ---------------------------------------------------------------

describe('POST /api/nearby/certificate', () => {
  it('signs one worker@1 link per organization that core\'s checkChain takes, equal to the golden link', async () => {
    const { deps, w } = setup();
    const res = await handleNearby(post(CERTIFICATE_PATH, certBody()), deps);
    expect(res.status).toBe(200);
    const out = await res.json() as { chains: { orgId: string; chain: unknown[] }[]; discoveryKeys: unknown[]; passes: unknown[]; revocations: { orgId: string; text: string; kid: string; sig: string }[] };
    expect(w.factsCalls).toEqual([[PROFILE, DEVICE, CHAIN_INVITER_KEY, ['org1/lang1', 'org2/x']]]);
    expect(out.chains).toEqual([{ orgId: 'org1', chain: [CHAIN[0]] }]);
    const verdict = await checkChain(out.chains[0]!.chain, { rootKeys: ROOT_KEYS, orgId: 'org1', now: NOW, verify: nodeVerifyFn, sha256: subtleSha256 });
    expect(verdict).toMatchObject({ ok: true, holder: { installKey: CHAIN_INVITER_KEY, profileId: PROFILE, deviceId: DEVICE }, links: 1 });
    // The role id stays out of the signed body: privileges are resolved.
    expect(JSON.stringify(out.chains)).not.toContain('translator');
    expect(out.discoveryKeys).toEqual([{ orgId: 'org1', languageId: 'lang1', gen: 3, floor: 1, key: GENERATIONS[0] }]);
    expect(out.passes).toEqual([]);
  });

  it('signs a join pass per language the facts give, over the roles core\'s passRoles keeps, with the golden id and expiry, which a newcomer\'s chain then takes', async () => {
    const passes = [
      {
        languageId: 'lang1', held: ['invite_members', 'review', 'translate'],
        roles: [
          { roleId: 'translator', privileges: ['translate'] }, { roleId: 'admin', privileges: ['manage_roles', 'translate'] },
          { roleId: 'reviewer', privileges: ['translate', 'review'] }, { roleId: 'viewer', privileges: ['view_status'] }
        ]
      },
      // No Invite there, so no pass, whatever the facts list.
      { languageId: 'lang2', held: ['translate'], roles: [{ roleId: 'translator', privileges: ['translate'] }] }
    ];
    const { deps } = setup({ now: () => PASS_NOW_MS }, { facts: { data: { ...FACTS, orgs: [factsOrg({ passes })] }, error: null } });
    const proof = signWith(SEED_HEX, nearbyBytes('certRequest', certRequestText({ profileId: PROFILE, deviceId: DEVICE, publicKey: PUBLIC_KEY })));
    const ask = async () => await (await handleNearby(post(CERTIFICATE_PATH, certBody({ publicKey: PUBLIC_KEY, proof })), deps)).json() as {
      chains: { orgId: string; chain: WorkerLink[] }[]; passes: { orgId: string; languageId: string; pass: JoinPass }[];
    };
    const out = await ask();
    expect(out.passes.map((p) => [p.orgId, p.languageId])).toEqual([['org1', 'lang1']]);
    const { pass } = out.passes[0]!;
    expect(pass).toMatchObject({ kind: 'pass@1', kid: 'k1' });
    expect(pass.body).toEqual({
      passId: PASS_ID, orgId: 'org1', languageId: 'lang1', inviter: PROFILE, inviterKey: PUBLIC_KEY,
      roles: [{ roleId: 'reviewer', privileges: ['review', 'translate'] }, { roleId: 'translator', privileges: ['translate'] }],
      maxUses: JOIN_PASS_USES, expiresAt: PASS_EXPIRES_AT
    });
    expect(await nodeVerifyFn(CHAIN_ROOT_KEY, nearbyBytes('pass', passText(pass)), pass.sig)).toBe(true);
    // The daily refresh makes no new pass: the same window, the same id, the same bytes.
    expect((await ask()).passes[0]!.pass).toEqual(pass);

    // The inviter's phone issues a newcomer's link under it, and core's checkChain takes the two links.
    const key = createPublicKey(pkcs8('0f'.repeat(32))).export({ format: 'jwk' }).x!;
    const salt = 'ICEiIyQlJicoKSorLC0uLw';
    const profileId = (await newcomerProfileId(key, salt, subtleSha256))!;
    const inviterLink = out.chains[0]!.chain[0]!;
    const issued = await issueInviteLink({
      inviterLink, pass, ask: { installKey: key, idSalt: salt, profileId, deviceId: 'd-0f', name: 'Deng' }, roleId: 'reviewer',
      now: PASS_NOW_MS, sha256: subtleSha256, sign: (m) => signWith(SEED_HEX, m)
    });
    if (!issued.ok) throw new Error(issued.reason);
    const verdict = await checkChain([inviterLink, issued.link], { rootKeys: ROOT_KEYS, orgId: 'org1', languageId: 'lang1', now: PASS_NOW_MS, verify: nodeVerifyFn, sha256: subtleSha256 });
    expect(verdict).toMatchObject({ ok: true, links: 2, holder: { installKey: key, profileId }, roleId: 'reviewer' });
  });

  it('gives no pass where the facts give none, as a database before passes does', async () => {
    const { deps } = setup({}, { facts: { data: { ...FACTS, orgs: [factsOrg({ passes: [] })] }, error: null } });
    expect((await (await handleNearby(post(CERTIFICATE_PATH, certBody()), deps)).json() as { passes: unknown[] }).passes).toEqual([]);
    const bad = setup({}, { facts: { data: { ...FACTS, orgs: [factsOrg({ passes: [{ languageId: 'lang1', held: 'all', roles: [] }] })] }, error: null } });
    expect((await handleNearby(post(CERTIFICATE_PATH, certBody()), bad.deps)).status).toBe(502);
  });

  it('signs the revocation list with seq = revokedSeq, as the golden text, and leaves out a list with no seq yet', async () => {
    const { deps } = setup({}, {
      facts: { data: { ...FACTS, orgs: [factsOrg(), factsOrg({ orgId: 'org2', orgSeq: 3, scopes: [{ level: 'org', privileges: ['translate'] }], discoveryKeys: [], revokedSeq: 0, revocations: [] })] }, error: null }
    });
    const out = await (await handleNearby(post(CERTIFICATE_PATH, certBody()), deps)).json() as { chains: { orgId: string; chain: { body: { org: unknown } }[] }[]; revocations: { orgId: string; text: string; kid: string; sig: string }[] };
    expect(out.revocations).toHaveLength(1);
    const [list] = out.revocations;
    expect(list).toMatchObject({ orgId: 'org1', text: REVOCATION_TEXT, kid: 'k1' });
    expect(nodeVerifyFn(CHAIN_ROOT_KEY, nearbyBytes('revoked', list!.text), list!.sig)).toBe(true);
    expect(parseRevocationList(list!.text, { orgId: 'org1', kid: 'k1' })).toMatchObject({ seq: 4, keys: [[PUBLIC_KEY, PROFILE, 1700000000000]] });
    expect(out.chains.map((c) => c.orgId)).toEqual(['org1', 'org2']);
    expect(out.chains[1]!.chain[0]!.body.org).toEqual({ orgId: 'org2', orgSeq: 3, scopes: [{ level: 'org', privileges: ['translate'] }] });
    const second = await checkChain(out.chains[1]!.chain, { rootKeys: ROOT_KEYS, orgId: 'org2', now: NOW, verify: nodeVerifyFn, sha256: subtleSha256 });
    expect(second.ok).toBe(true);
    // A link names its organization alone: org2's chain does not pass for org1.
    expect((await checkChain(out.chains[1]!.chain, { rootKeys: ROOT_KEYS, orgId: 'org1', now: NOW, verify: nodeVerifyFn, sha256: subtleSha256 })).ok).toBe(false);
  });

  it('answers every list empty when no organization of theirs is on, so the phone drops what it holds', async () => {
    const { deps } = setup({}, { facts: { data: { revoked: false, limited: false, orgs: [] }, error: null } });
    const res = await handleNearby(post(CERTIFICATE_PATH, certBody()), deps);
    expect([res.status, await res.json()]).toEqual([200, { chains: [], discoveryKeys: [], passes: [], revocations: [] }]);
  });

  it('answers { revoked: true } for a revoked key, and 429 past the new keys a day', async () => {
    const revoked = setup({}, { facts: { data: { revoked: true }, error: null } });
    const res = await handleNearby(post(CERTIFICATE_PATH, certBody()), revoked.deps);
    expect([res.status, await res.json()]).toEqual([200, { revoked: true }]);
    const limited = setup({}, { facts: { data: { revoked: false, limited: true, orgs: [] }, error: null } });
    const again = await handleNearby(post(CERTIFICATE_PATH, certBody()), limited.deps);
    expect(again.status).toBe(429);
    expect(await again.json()).toMatchObject({ limited: true });
  });

  it('answers 503 with no signing key, on PGRST202, and when the session cannot be asked about', async () => {
    const noKey = setup({ signer: async () => null });
    expect((await handleNearby(post(CERTIFICATE_PATH, certBody()), noKey.deps)).status).toBe(503);
    expect(noKey.w.factsCalls).toEqual([]);
    const behind = setup({}, { facts: { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } } });
    expect((await handleNearby(post(CERTIFICATE_PATH, certBody()), behind.deps)).status).toBe(503);
    const down = setup({ certificateCaller: async () => { throw new Error('session_is_live: timeout'); } });
    expect((await handleNearby(post(CERTIFICATE_PATH, certBody()), down.deps)).status).toBe(503);
    expect(down.w.factsCalls).toEqual([]);
    // And through the API without the deps at all.
    const api = { profileOf: async () => null, orgsOf: async () => [], reports: async () => null } as ApiDeps;
    expect((await handleApi(post(CERTIFICATE_PATH, certBody()), api)).status).toBe(503);
    expect((await handleApi(post(ATTEST_PATH, {}), api)).status).toBe(503);
  });

  it('answers 400 for what the database refuses as 22023 and for a body it cannot read, and 502 for any other failure', async () => {
    const refused = setup({}, { facts: { data: null, error: { code: '22023', message: 'too many languages: 501 (max 500)' } } });
    const res = await handleNearby(post(CERTIFICATE_PATH, certBody()), refused.deps);
    expect([res.status, await res.json()]).toEqual([400, { error: 'too many languages: 501 (max 500)' }]);
    const { deps, w } = setup();
    for (const body of ['{', certBody({ publicKey: 'short' }), certBody({ deviceId: '' }), certBody({ languages: 'org1/lang1' }), certBody({ languages: ['lang1'] }),
      certBody({ languages: Array.from({ length: 501 }, (_, i) => `org1/l${i}`) }), certBody({ proof: undefined })]) {
      expect((await handleNearby(post(CERTIFICATE_PATH, body), deps)).status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
    expect(w.factsCalls).toEqual([]);
    for (const answer of [{ data: null, error: { code: 'XX000', message: 'boom' } }, { data: { revoked: false, limited: false, orgs: [{ orgId: 'org1' }] }, error: null }, { data: 'nonsense', error: null }]) {
      expect((await handleNearby(post(CERTIFICATE_PATH, certBody()), setup({}, { facts: answer }).deps)).status).toBe(502);
    }
  });

  it('refuses a proof the key did not sign: another key, another person\'s text, another device\'s', async () => {
    const { deps, w } = setup();
    const other = { profileId: PROFILE, deviceId: DEVICE, publicKey: CHAIN_INVITER_KEY };
    for (const proof of [
      signWith(SEED_HEX, nearbyBytes('certRequest', certRequestText(other))),
      signWith(PHONE_SEED, nearbyBytes('certRequest', certRequestText({ ...other, profileId: '22222222-2222-4222-8222-222222222222' }))),
      signWith(PHONE_SEED, nearbyBytes('certRequest', certRequestText({ ...other, deviceId: 'another-device' }))),
      signWith(PHONE_SEED, nearbyBytes('firstContact', certRequestText(other)))
    ]) expect((await handleNearby(post(CERTIFICATE_PATH, certBody({ proof })), deps)).status).toBe(403);
    expect(w.factsCalls).toEqual([]);
  });

  it('wants a live token, and stops at the per-minute limit before any work', async () => {
    const { deps, w } = setup();
    expect((await handleNearby(post(CERTIFICATE_PATH, certBody(), null), deps)).status).toBe(401);
    expect((await handleNearby(post(CERTIFICATE_PATH, certBody(), 'stale'), deps)).status).toBe(401);
    const limited = setup({}, { allowed: false });
    expect((await handleNearby(post(CERTIFICATE_PATH, certBody()), limited.deps)).status).toBe(429);
    expect([w.factsCalls, limited.w.factsCalls]).toEqual([[], []]);
    expect((await handleNearby(new Request(`https://x${CERTIFICATE_PATH}`), deps)).status).toBe(405);
  });

  it('is counted as its own kind of request', () => {
    expect(routeClass('POST', CERTIFICATE_PATH)).toBe('nearby');
    expect(routeClass('POST', ATTEST_PATH)).toBe('nearby');
  });
});

// ---- the attestation ---------------------------------------------------------------

describe('POST /api/nearby/attest', () => {
  it('reads the rows as the caller and signs the golden text, which the phone\'s parser takes, digests equal to a pulled row\'s with an absent parent', async () => {
    const { deps, w } = setup();
    const res = await handleNearby(post(ATTEST_PATH, { orgId: 'org1', streamId: 'lang1', afterSeq: 76 }), deps);
    expect(res.status).toBe(200);
    const out = await res.json() as { text: string; kid: string; sig: string };
    expect(out.text).toBe(ATTESTATION_TEXT);
    expect(out.kid).toBe('k1');
    expect(nodeVerifyFn(CHAIN_ROOT_KEY, nearbyBytes('attest', out.text), out.sig)).toBe(true);
    const attested = parseAttestation(out.text, { orgId: 'org1', streamId: 'lang1', kid: out.kid });
    // What the phone pulled, mapped by the same transport, digests the same.
    const pulled = await new SupabaseTransport(pullingClient(w.rows, [])).pull('org1', 'lang1', 76, 200);
    expect(pulled[0]!.parentEventId).toBeUndefined();
    expect(attested?.rows).toEqual(await Promise.all(pulled.map(async (e) => [e.id, await eventDigest(e, subtleSha256), e.serverSeq])));
    expect(w.pullCalls).toMatchObject([{ fn: 'pull_events', p_org_id: 'org1', p_stream_id: 'lang1', p_after: 76, p_limit: 200 }]);
  });

  it('leaves out a row no digest can stand for, and stays in seq order from where it was asked', async () => {
    const { deps } = setup({}, { rows: [row(EVENT_NO_PARENT, 77), row(UNDIGESTIBLE, 78), row(EVENT_PULLED, 79)] });
    const out = await (await handleNearby(post(ATTEST_PATH, { orgId: 'org1', streamId: 'lang1', afterSeq: 76 }), deps)).json() as { text: string };
    expect(await eventDigest(UNDIGESTIBLE, subtleSha256)).toBe('');
    expect(parseAttestation(out.text, { orgId: 'org1', streamId: 'lang1', kid: 'k1' })?.rows).toEqual([
      [EVENT_NO_PARENT.id, EVENT_NO_PARENT_DIGEST, 77], [EVENT_PULLED.id, EVENT_PULLED_DIGEST, 79]
    ]);
    const later = await (await handleNearby(post(ATTEST_PATH, { orgId: 'org1', streamId: 'lang1', afterSeq: 77 }), deps)).json() as { text: string };
    expect(parseAttestation(later.text, { orgId: 'org1', streamId: 'lang1', kid: 'k1' })?.rows).toEqual([[EVENT_PULLED.id, EVENT_PULLED_DIGEST, 79]]);
  });

  it('signs at most 200 rows, contiguous from the asked seq, and reads past a page of rows no digest can stand for', async () => {
    const many = Array.from({ length: 250 }, (_, i) => row({ ...EVENT_PULLED, id: `m${i}` } as AnyEvent, i + 1));
    const full = setup({}, { rows: many });
    const out = await (await handleNearby(post(ATTEST_PATH, { orgId: 'org1', streamId: 'lang1', afterSeq: 10 }), full.deps)).json() as { text: string };
    const rows = parseAttestation(out.text, { orgId: 'org1', streamId: 'lang1', kid: 'k1' })!.rows;
    expect(rows.map(([, , seq]) => seq)).toEqual(Array.from({ length: 200 }, (_, i) => i + 11));
    const blocked = [...Array.from({ length: 200 }, (_, i) => row({ ...UNDIGESTIBLE, id: `d${i}` } as AnyEvent, i + 1)), row(EVENT_PULLED, 201)];
    const past = setup({}, { rows: blocked });
    const passed = await (await handleNearby(post(ATTEST_PATH, { orgId: 'org1', streamId: 'lang1', afterSeq: 0 }), past.deps)).json() as { text: string };
    expect(parseAttestation(passed.text, { orgId: 'org1', streamId: 'lang1', kid: 'k1' })?.rows).toEqual([[EVENT_PULLED.id, EVENT_PULLED_DIGEST, 201]]);
    expect(past.w.pullCalls.map((c) => c['p_after'])).toEqual([0, 200]);
  });

  it('gives a non-reader nothing signed, refuses the organization and person streams, and answers null while nearby is off', async () => {
    const { deps, w } = setup();
    const res = await handleNearby(post(ATTEST_PATH, { orgId: 'org1', streamId: 'secret', afterSeq: 0 }), deps);
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain('sig');
    for (const [orgId, streamId] of [['org1', '_org'], ['_person', PROFILE], ['_person', '_org']]) {
      expect((await handleNearby(post(ATTEST_PATH, { orgId, streamId, afterSeq: 0 }), deps)).status, `${orgId}/${streamId}`).toBe(400);
    }
    const off = setup({}, { on: { data: false, error: null } });
    const answer = await handleNearby(post(ATTEST_PATH, { orgId: 'org1', streamId: 'lang1', afterSeq: 0 }), off.deps);
    expect([answer.status, await answer.json()]).toEqual([200, null]);
    expect(w.pullCalls.length).toBe(1);
  });

  it('tells a non-reader nothing of whether nearby is on: 403 either way, before the flag is asked', async () => {
    const asked: string[] = [];
    for (const on of [true, false]) {
      const { deps } = setup({ nearbyOn: async (orgId) => { asked.push(orgId); return { data: on, error: null }; } });
      const res = await handleNearby(post(ATTEST_PATH, { orgId: 'org1', streamId: 'secret', afterSeq: 0 }), deps);
      expect([res.status, await res.json()], `nearby ${on ? 'on' : 'off'}`).toEqual([403, { error: 'You cannot read this language.' }]);
    }
    expect(asked).toEqual([]);
  });

  it('answers 503 with no key and on PGRST202, 401 with no live token, 400 for a body it cannot read, 502 for any other failure', async () => {
    const body = { orgId: 'org1', streamId: 'lang1', afterSeq: 0 };
    expect((await handleNearby(post(ATTEST_PATH, body), setup({ signer: async () => null }).deps)).status).toBe(503);
    expect((await handleNearby(post(ATTEST_PATH, body), setup({}, { on: { data: null, error: { code: 'PGRST202', message: 'gone' } } }).deps)).status).toBe(503);
    expect((await handleNearby(post(ATTEST_PATH, body), setup({}, { on: { data: null, error: { code: 'XX000', message: 'boom' } } }).deps)).status).toBe(502);
    expect((await handleNearby(post(ATTEST_PATH, body), setup({ pullAs: async () => { throw new Error('offline'); } }).deps)).status).toBe(502);
    expect((await handleNearby(post(ATTEST_PATH, body), setup({ pullAs: async () => { throw new NotAuthorizedError('not a member'); } }).deps)).status).toBe(403);
    const { deps } = setup();
    expect((await handleNearby(post(ATTEST_PATH, body, null), deps)).status).toBe(401);
    expect((await handleNearby(post(ATTEST_PATH, body, 'stale'), deps)).status).toBe(401);
    for (const bad of [{ ...body, afterSeq: -1 }, { ...body, afterSeq: 1.5 }, { ...body, orgId: '' }, { orgId: 'org1', streamId: 'lang1' }, '[]']) {
      expect((await handleNearby(post(ATTEST_PATH, bad), deps)).status, JSON.stringify(bad)).toBe(400);
    }
  });
});
