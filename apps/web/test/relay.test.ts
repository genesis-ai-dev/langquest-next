import { createPrivateKey, createPublicKey, sign as nodeSign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encodeHlc, type AnyEvent } from '@langquest-next/core';
import { base64urlEncode, eventDigest, linkText, manifestText, nearbyBytes, type WorkerLink } from '@langquest-next/core/nearby';
import { handleApi, type ApiDeps } from '../worker/api';
import type { RpcAnswer } from '../worker/nearby';
import { subtleSha256, subtleVerify } from '../worker/nearbyKeys';
import { handleRelay, RELAY_PATH, type RelayDeps } from '../worker/relay';
import { routeClass } from '../worker/requestTally';

/**
 * Delivery through a teammate, at the Worker (docs/nearby-sync-plan.md section 6), with real
 * Ed25519 on Node's `crypto.subtle`. Why: any phone may carry the team's work to the server,
 * so the Worker must take only batches their authors signed, under a chain it signed, whose
 * events are the ones signed, and then append them as each author, one call per author and
 * key, never as the caller. Expiry is skipped, since a batch may be carried for months.
 */

const pkcs8 = (seedHex: string) => createPrivateKey({ key: Buffer.from(`302e020100300506032b657004220420${seedHex}`, 'hex'), format: 'der', type: 'pkcs8' });
const publicOf = (seedHex: string) => createPublicKey(pkcs8(seedHex)).export({ format: 'jwk' }).x!;
const signWith = (seedHex: string, message: Uint8Array) => base64urlEncode(new Uint8Array(nodeSign(null, message, pkcs8(seedHex))));

const ROOT_SEED = '03'.repeat(32);
const ROOT_KEYS = new Map([['k1', publicOf(ROOT_SEED)]]);
const TOKEN = 'token-of-the-carrier';
const CARRIER = 'carrier';

interface Author { seed: string; key: string; profileId: string; deviceId: string; chain: WorkerLink[] }

function author(seedByte: string, profileId: string, o: { expiresAt?: number; chainFor?: string } = {}): Author {
  const seed = seedByte.repeat(32);
  const key = publicOf(seed);
  const deviceId = `d-${profileId}`;
  const unsigned: Omit<WorkerLink, 'sig'> = {
    kind: 'worker@1', kid: 'k1',
    body: { installKey: key, profileId: o.chainFor ?? profileId, deviceId, expiresAt: o.expiresAt ?? 4_000_000_000_000, org: { orgId: 'org1', orgSeq: 3, scopes: [{ level: 'language', languageId: 'L1', privileges: ['translate'] }] } }
  };
  return { seed, key, profileId, deviceId, chain: [{ ...unsigned, sig: signWith(ROOT_SEED, nearbyBytes('link', linkText(unsigned, ''))) }] };
}

let serial = 0;
const note = (a: Author, over: Partial<AnyEvent> = {}): AnyEvent => {
  serial += 1;
  return {
    id: `by:${a.profileId}:e${serial}`, type: 'v1.NoteAdded', orgId: 'org1', streamId: 'L1', actorId: a.profileId, deviceId: a.deviceId,
    hlc: encodeHlc(1_700_000_000_000 + serial, 0, a.deviceId), payload: { noteId: `n${serial}`, unitId: 'u1', anchor: { kind: 'passage' }, text: 'x' }, ...over
  } as AnyEvent;
};

async function batchOf(a: Author, n: number, events: AnyEvent[], o: { signer?: string; carrying?: unknown[]; chain?: unknown[] } = {}) {
  const manifest = manifestText({
    v: 1, orgId: 'org1', streamId: 'L1', key: a.key, deviceId: a.deviceId, actorId: a.profileId, n, floor: 0,
    events: await Promise.all(events.map(async (e) => [e.id, await eventDigest(e, subtleSha256)] as [string, string]))
  });
  return { manifest, sig: signWith(o.signer ?? a.seed, nearbyBytes('batch', manifest)), chain: o.chain ?? a.chain, events: o.carrying ?? events };
}

interface World { calls: { author: string; key: string; ids: string[]; clientVersion: number }[]; may: RpcAnswer; answer: (author: string, events: AnyEvent[]) => RpcAnswer }

function setup(over: Partial<RelayDeps> = {}, world: Partial<World> = {}): { deps: RelayDeps; w: World } {
  const w: World = {
    calls: [],
    may: { data: true, error: null },
    answer: (_author, events) => ({ data: events.map((e, i) => ({ id: e.id, accepted: true, server_seq: 100 + i, reason: null })), error: null }),
    ...world
  };
  const deps: RelayDeps = {
    rootKeys: () => ROOT_KEYS,
    profileOf: async (token) => (token === TOKEN ? CARRIER : null),
    mayRead: async () => w.may,
    append: async (who, key, events, clientVersion) => {
      w.calls.push({ author: who, key, ids: events.map((e) => e.id), clientVersion });
      return w.answer(who, events);
    },
    verify: subtleVerify,
    sha256: subtleSha256,
    ...over
  };
  return { deps, w };
}

const post = (body: unknown, token: string | null = TOKEN) => new Request(`https://next.langquest.org${RELAY_PATH}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: typeof body === 'string' ? body : JSON.stringify(body)
});
const relayBody = (batches: unknown[], over: Record<string, unknown> = {}) => ({ orgId: 'org1', streamId: 'L1', clientVersion: 7, batches, ...over });
type Answer = { batches: { key: string; n: number; refused?: string; verdicts?: { id: string; accepted: boolean; serverSeq: number | null; reason: string | null }[] }[] };

const sam = author('05', 'sam');
const ana = author('06', 'ana');

describe('POST /api/relay', () => {
  it('appends a signed batch as its author, with the carrier\'s version, and answers each event as append_events did', async () => {
    const events = [note(sam), note(sam)];
    const { deps, w } = setup();
    const res = await handleRelay(post(relayBody([await batchOf(sam, 4, events)])), deps);
    expect(res.status).toBe(200);
    expect(w.calls).toEqual([{ author: 'sam', key: sam.key, ids: events.map((e) => e.id), clientVersion: 7 }]);
    expect(await res.json()).toEqual({
      batches: [{ key: sam.key, n: 4, verdicts: [{ id: events[0]!.id, accepted: true, serverSeq: 100, reason: null }, { id: events[1]!.id, accepted: true, serverSeq: 101, reason: null }] }]
    });
  });

  it('takes a batch whose certificate has expired, since a batch may be carried for months', async () => {
    const old = author('07', 'old', { expiresAt: 1 });
    const { deps, w } = setup();
    const out = await (await handleRelay(post(relayBody([await batchOf(old, 1, [note(old)])])), deps)).json() as Answer;
    expect(out.batches[0]!.refused).toBeUndefined();
    expect(w.calls).toHaveLength(1);
  });

  it('refuses a batch whole, appending nothing of it, when its signature, chain or manifest does not hold', async () => {
    const events = [note(sam)];
    const { deps, w } = setup();
    const forged = author('05', 'sam', { chainFor: 'ana' });
    const unknownRoot = { ...sam.chain[0]!, kid: 'k9' };
    const cases = [
      [await batchOf(sam, 1, events, { signer: ana.seed }), 'bad signature'],
      [await batchOf(sam, 2, events, { chain: forged.chain }), 'the chain names someone else'],
      [await batchOf(sam, 3, events, { chain: [unknownRoot] }), 'chain: unknown certificate key'],
      // One link only: a newcomer's chain waits for joining offline (phase 6).
      [await batchOf(sam, 4, events, { chain: [...sam.chain, sam.chain[0]] }), 'chain: too many links'],
      [{ ...(await batchOf(sam, 5, events)), manifest: '{"v":1}' }, 'bad manifest'],
      ['not a batch', 'not a batch']
    ] as const;
    const out = await (await handleRelay(post(relayBody(cases.slice(0, 4).map(([b]) => b))), deps)).json() as Answer;
    expect(out.batches.map((b) => b.refused)).toEqual(cases.slice(0, 4).map(([, why]) => why));
    const more = await (await handleRelay(post(relayBody(cases.slice(4).map(([b]) => b))), deps)).json() as Answer;
    expect(more.batches.map((b) => b.refused)).toEqual(['bad manifest', 'not a batch']);
    expect(w.calls).toEqual([]);
  });

  it('refuses an event its manifest did not sign and a copy holding NUL, ignores one it does not name, and sends the rest', async () => {
    const good = note(sam);
    const signed = note(sam);
    const nul = note(sam);
    // Postgres cannot keep a NUL, and one would fail the whole call (server/nearbyRelaySmoke.sql), so it is refused alone.
    const nulCopy = { ...nul, payload: { ...(nul.payload as object), text: 'a\u0000b' } };
    const batch = await batchOf(sam, 1, [good, signed, nul], { carrying: [good, { ...signed, payload: { ...(signed.payload as object), text: 'changed' } }, nulCopy, note(sam)] });
    const { deps, w } = setup();
    const out = await (await handleRelay(post(relayBody([batch])), deps)).json() as Answer;
    expect(w.calls.map((c) => c.ids)).toEqual([[good.id]]);
    expect(out.batches[0]!.verdicts).toEqual([
      { id: signed.id, accepted: false, serverSeq: null, reason: 'malformed envelope: not the event its manifest signed' },
      { id: nul.id, accepted: false, serverSeq: null, reason: expect.stringMatching(/^invalid payload: /) },
      { id: good.id, accepted: true, serverSeq: 100, reason: null }
    ]);
  });

  it('refuses, one by one, a signed event under another author, another device or another stream, and sends the rest', async () => {
    // Why: the signature proves only what the key holder signed. A copied key can sign anyone's
    // events, so each must be the manifest's author and device, in the stream the request names.
    const good = note(sam);
    const asAna = note(sam, { actorId: 'ana' });
    const otherDevice = note(sam, { deviceId: 'd-other' });
    const otherStream = note(sam, { streamId: 'L2' });
    const batch = await batchOf(sam, 1, [asAna, otherDevice, otherStream, good]);
    const { deps, w } = setup();
    const out = await (await handleRelay(post(relayBody([batch])), deps)).json() as Answer;
    expect(out.batches[0]!.refused).toBeUndefined();
    expect(w.calls).toEqual([{ author: 'sam', key: sam.key, ids: [good.id], clientVersion: 7 }]);
    expect(out.batches[0]!.verdicts).toEqual([
      { id: asAna.id, accepted: false, serverSeq: null, reason: 'actorId does not match caller' },
      { id: otherDevice.id, accepted: false, serverSeq: null, reason: 'actorId does not match caller' },
      { id: otherStream.id, accepted: false, serverSeq: null, reason: 'malformed envelope: another stream' },
      { id: good.id, accepted: true, serverSeq: 100, reason: null }
    ]);
  });

  it('makes one call per author and key, at most 500 events each, so a request mixing authors gets partial success', async () => {
    const batches = [];
    for (let n = 1; n <= 3; n++) batches.push(await batchOf(sam, n, Array.from({ length: 200 }, () => note(sam))));
    batches.push(await batchOf(ana, 1, [note(ana)]));
    const { deps, w } = setup({}, {
      answer: (who, events) => ({ data: events.map((e) => ({ id: e.id, accepted: who === 'sam', server_seq: who === 'sam' ? 1 : null, reason: who === 'sam' ? null : 'not a member' })), error: null })
    });
    const out = await (await handleRelay(post(relayBody(batches)), deps)).json() as Answer;
    expect(w.calls.map((c) => [c.author, c.ids.length])).toEqual([['sam', 500], ['sam', 100], ['ana', 1]]);
    expect(out.batches[3]!.verdicts![0]).toMatchObject({ accepted: false, reason: 'not a member' });
    expect(out.batches[0]!.verdicts!.every((v) => v.accepted)).toBe(true);
  });

  it('refuses every batch, trying nothing, for a caller who may not read the language, and answers what the batches were', async () => {
    const { deps, w } = setup({}, { may: { data: false, error: null } });
    const out = await (await handleRelay(post(relayBody([await batchOf(sam, 9, [note(sam)])])), deps)).json() as Answer;
    expect(out).toEqual({ batches: [{ key: sam.key, n: 9, refused: 'you cannot read this language' }] });
    expect(w.calls).toEqual([]);
  });

  it('answers LQ001 as 426 for the whole request, and 503 with no key list or a database behind', async () => {
    const batch = await batchOf(sam, 1, [note(sam)]);
    const tooOld = setup({}, { answer: () => ({ data: null, error: { code: 'LQ001', message: 'client too old' } }) });
    const res = await handleRelay(post(relayBody([batch])), tooOld.deps);
    expect(res.status).toBe(426);
    expect(await res.json()).toEqual({ code: 'LQ001', message: 'client too old' });
    expect((await handleRelay(post(relayBody([batch])), setup({ rootKeys: () => new Map() }).deps)).status).toBe(503);
    expect((await handleRelay(post(relayBody([batch])), setup({}, { answer: () => ({ data: null, error: { code: 'PGRST202', message: 'no function' } }) }).deps)).status).toBe(503);
    expect((await handleRelay(post(relayBody([batch])), setup({}, { may: { data: null, error: { code: 'PGRST202', message: 'no function' } } }).deps)).status).toBe(503);
    expect((await handleRelay(post(relayBody([batch])), setup({}, { answer: () => ({ data: null, error: { code: '57014', message: 'timeout' } }) }).deps)).status).toBe(502);
  });

  it('asks for a token, POST, a body it can read, and a language\'s stream', async () => {
    const batch = await batchOf(sam, 1, [note(sam)]);
    const { deps, w } = setup();
    expect((await handleRelay(post(relayBody([batch]), null), deps)).status).toBe(401);
    expect((await handleRelay(post(relayBody([batch]), 'someone-else'), deps)).status).toBe(401);
    expect((await handleRelay(new Request(`https://next.langquest.org${RELAY_PATH}`, { headers: { authorization: `Bearer ${TOKEN}` } }), deps)).status).toBe(405);
    for (const bad of ['{', relayBody([]), relayBody([batch, batch, batch, batch, batch]), relayBody([batch], { clientVersion: -1 }), relayBody([batch], { orgId: '' })]) {
      expect((await handleRelay(post(bad), deps)).status).toBe(400);
    }
    expect((await handleRelay(post(relayBody([batch], { streamId: '_org' })), deps)).status).toBe(400);
    expect((await handleRelay(post(relayBody([batch], { orgId: '_person' })), deps)).status).toBe(400);
    expect(w.calls).toEqual([]);
  });

  it('is routed at its literal path, counts as nearby, and answers 503 where delivery is not set up', async () => {
    const batch = await batchOf(sam, 1, [note(sam)]);
    const { deps } = setup();
    const base = { profileOf: async () => null } as unknown as ApiDeps;
    expect((await handleApi(post(relayBody([batch])), { ...base, relay: deps })).status).toBe(200);
    expect((await handleApi(post(relayBody([batch])), base)).status).toBe(503);
    expect(routeClass('POST', RELAY_PATH)).toBe('nearby');
  });
});
