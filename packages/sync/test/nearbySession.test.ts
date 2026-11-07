import { createHmac, hkdfSync } from 'node:crypto';
import {
  base64urlEncode, concatBytes, isCounted, NEARBY_OPENING_BYTES, nearbyBytes, openingMaskInput, revocationText, utf8Encode, withMyHolding, type RevocationList
} from '@langquest-next/core/nearby';
import * as v from '../../core/test/nearbyVectors';
import { arrangePlan, mayHandOn, type NearbySessionReport } from '../src/nearbySession';
import { checkOpeningI, checkOpeningR, findTagOf, makeOpeningI, makeOpeningR, openingKeyOf, sessionKeysOf } from '../src/nearbyOpening';
import { parseMessage, encodeMessage, type Message } from '../src/nearbyWire';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSha256, fakeSigner, memoryNearbyAir, memoryNearbyPair, type MemoryFiles, type MemoryNearbyPair } from '../src/testing/memoryNearbyLink';
import type { NearbyLink } from '../src/nearbyLink';
import type { EventStore } from '../src/types';
import { LANG, NOW, ORG, STORES, pageOf, teammate, wallClock, worker, type Teammate } from './nearbyFixtures';
import { keys, newTime, record, SALT, sessionFor, settled, testPhone, unit, type TestPhone } from './nearbyKit';

/**
 * A session between two phones on memory links (docs/nearby-sync-plan.md 5.3, 5.12).
 * Why: a nearby phone is not a server, so nothing a teammate sends may throw out of a
 * session, move a cursor or skip work; a stranger must get silence; and a drop anywhere
 * must resume from the vector with nothing lost or doubled.
 */

const typesOf = (frames: readonly Uint8Array[]) => frames.map((f) => { const p = parseMessage(f); return p.kind === 'message' ? p.message.t : p.kind; });
const idsOf = async (store: EventStore) => (await store.page(ORG, LANG, null, 10_000)).map((l) => l.event.id).sort();

describe.each(STORES)('a session on the %s store', (_name, make) => {
  let server: FakeServer;
  let shelf: MemoryFiles;
  let time: ReturnType<typeof newTime>;
  let ana: Teammate;
  let sam: Teammate;

  beforeEach(async () => {
    server = new FakeServer();
    shelf = new Map();
    time = newTime();
    ana = await teammate('ana');
    sam = await teammate('sam');
  });

  const two = async () => [await testPhone(server, make(), ana, shelf), await testPhone(server, make(), sam, shelf)] as const;
  const pairOf = (o: Partial<Parameters<typeof memoryNearbyPair>[0]> = {}) => memoryNearbyPair({ time, files: shelf, ...o });
  const run = (a: TestPhone, b: TestPhone, pair: MemoryNearbyPair, oa = {}, ob = {}) =>
    settled<[NearbySessionReport, NearbySessionReport]>(time, sessionFor(a, 'i', pair.a, time, oa).run(), sessionFor(b, 'r', pair.b, time, ob).run());

  it('swaps events and files both ways, and both end with the same final summary', async () => {
    const [a, b] = await two();
    await unit(a, 'a1');
    const ah = await record(a, shelf, 'ra');
    await unit(b, 'b1');
    const bh = await record(b, shelf, 'rb');
    const [ra, rb] = await run(a, b, pairOf());
    expect(ra.ended).toEqual({ how: 'done' });
    expect(rb.ended).toEqual({ how: 'done' });
    expect(await idsOf(a.store)).toEqual(await idsOf(b.store));
    expect(ra.got.events).toBe(2);
    expect(rb.got.events).toBe(2);
    expect(a.files.here).toEqual(new Set([ah, bh]));
    expect(b.files.here).toEqual(new Set([ah, bh]));
    expect(ra.files.got).toBe(1);
    expect(ra.finals).toEqual({ mine: rb.finals!.theirs, theirs: rb.finals!.mine });
    expect(ra.finals!.mine).toBe(ra.finals!.theirs);
    expect(ra.peer).toMatchObject({ profileId: 'sam', installKey: sam.key, tag: findTagOf(sam.crypto, keys.kFind, sam.key) });
    expect(ra.changed).toBe(true);
    // Each records the pair in `nearbyPeers`, under the tag from Hello's chain.
    expect(await a.keep.peers()).toEqual([{ tag: ra.peer!.tag, gen: 0, mine: ra.finals!.mine, theirs: ra.finals!.theirs }]);
    // Signing came first: the rows went as batches, so their numbers count on the other side.
    expect(isCounted((await b.client.nearbyHave()).vector, ana.key, 1)).toBe(true);
    // A teammate's rows are nearby, never pending: only the author pushes.
    expect((await b.store.getMany([(await a.store.page(ORG, LANG, null, 1))[0]!.event.id]))[0]?.status).toBe('nearby');
  });

  it('a second session moves nothing', async () => {
    const [a, b] = await two();
    await unit(a, 'a1');
    await record(b, shelf, 'rb');
    await run(a, b, pairOf());
    const [ra, rb] = await run(a, b, pairOf());
    expect(ra.sent).toMatchObject({ batches: 0, claims: 0 });
    expect(rb.sent).toMatchObject({ batches: 0, claims: 0 });
    expect(ra.files.got + rb.files.got).toBe(0);
    expect(ra.changed || rb.changed).toBe(false);
  });

  it('a drop at any message resumes next time with nothing lost or doubled', async () => {
    // Why: a radio can go at any moment, and each page commits whole, so the vector says where to start again.
    const full = async (dropAt?: number) => {
      const [a, b] = await two();
      await unit(a, 'a1');
      await unit(a, 'a2');
      await record(a, shelf, 'ra');
      await unit(b, 'b1');
      await record(b, shelf, 'rb');
      const pair = pairOf({ capacity: 1 });
      if (dropAt !== undefined) pair.dropAt(dropAt);
      const first = await run(a, b, pair);
      return { a, b, first, messages: pair.messages() };
    };
    const whole = await full();
    expect(whole.messages).toBeGreaterThan(10);
    for (let at = 1; at <= whole.messages; at++) {
      const { a, b, first } = await full(at);
      for (const r of first) expect(['dropped', 'done']).toContain(r.ended.how);
      const [ra, rb] = await run(a, b, pairOf());
      expect([ra.ended.how, rb.ended.how]).toEqual(['done', 'done']);
      expect(await idsOf(a.store)).toEqual(await idsOf(b.store));
      expect((await idsOf(a.store)).length).toBe(5);
      expect(a.files.here.size).toBe(2);
      expect(b.files.here.size).toBe(2);
      expect(ra.finals!.mine).toBe(rb.finals!.mine);
    }
  });

  it('both sides fill their queues at once and still finish', async () => {
    const [a, b] = await two();
    for (let i = 0; i < 12; i++) {
      await unit(a, `a${i}`);
      await a.client.signUnsigned({ publicKey: ana.key, sign: ana.crypto.sign, sha256: ana.crypto.sha256, chainFor: () => ana.chain });
      await unit(b, `b${i}`);
      await b.client.signUnsigned({ publicKey: sam.key, sign: sam.crypto.sign, sha256: sam.crypto.sha256, chainFor: () => sam.chain });
    }
    const [ra, rb] = await run(a, b, pairOf({ capacity: 1 }));
    expect(ra.sent.batches).toBe(12);
    expect(rb.sent.batches).toBe(12);
    expect(rb.got.counted).toBe(12);
  });

  it('never awaits the link inside the stream\'s turn: a stuck teammate leaves this phone free to work', async () => {
    const [a, b] = await two();
    for (let i = 0; i < 6; i++) {
      await unit(a, `a${i}`);
      await a.client.signUnsigned({ publicKey: ana.key, sign: ana.crypto.sign, sha256: ana.crypto.sha256, chainFor: () => ana.chain });
    }
    let release!: () => void;
    const stuck = new Promise<void>((r) => { release = r; });
    const inner = b.client.receiveNearby.bind(b.client);
    b.client.receiveNearby = async (page, intake) => { await stuck; return inner(page, intake); };
    const pair = pairOf({ capacity: 1 });
    const sa = sessionFor(a, 'i', pair.a, time).run();
    const sb = sessionFor(b, 'r', pair.b, time).run();
    await time.runFor(1_000);
    // Ana's session is parked on a full queue; her phone still writes.
    const more = await settled(time, unit(a, 'while'));
    expect(more[0]).toBeTruthy();
    release();
    const [ra] = await settled(time, sa, sb);
    expect(ra.ended.how).toBe('done');
  });

  describe('strangers get silence', () => {
    const responderAlone = async (b: TestPhone, link: NearbyLink, seen = new Set<string>()) => {
      let closedAt = -1;
      const close = link.close.bind(link);
      link.close = async () => { if (closedAt < 0) closedAt = time.now(); return close(); };
      const started = time.now();
      const s = sessionFor(b, 'r', link, time, { opening: { kSess: keys.kSess, salt: SALT, kFind: keys.kFind, seen } });
      return { done: s.run(), closedAfter: () => closedAt - started };
    };

    const cases: [string, (pair: MemoryNearbyPair) => Promise<void>][] = [
      ['a wrong key', async (pair) => { await pair.a.sendOpening(makeOpeningI(fakeSigner('x'), openingKeyOf(fakeSigner('x'), new Uint8Array(32).fill(9)), SALT).bytes); }],
      ['random bytes', async (pair) => { await pair.a.sendOpening(fakeSigner('noise').randomBytes(NEARBY_OPENING_BYTES)); }],
      ['bytes after the opening, a few at a time', async (pair) => { for (let i = 0; i < 5; i++) await pair.a.sendOpening(fakeSigner(`n${i}`).randomBytes(NEARBY_OPENING_BYTES)); }],
      ['a silent connection', async () => undefined]
    ];
    it.each(cases)('%s draws zero bytes and the same close', async (_label, act) => {
      const [, b] = await two();
      const pair = pairOf();
      const responder = await responderAlone(b, pair.b);
      await act(pair);
      const [report] = await settled(time, responder.done);
      expect(report.ended).toEqual({ how: 'silent' });
      expect(pair.sent.b).toEqual({ opening: 0, frames: [] });
      expect(responder.closedAfter()).toBe(3_000);
    });

    it('a replayed opening draws zero bytes, though the first drew a reply', async () => {
      const [a, b] = await two();
      const seen = new Set<string>();
      const first = pairOf();
      let recorded: Uint8Array | null = null;
      const send = first.a.sendOpening.bind(first.a);
      first.a.sendOpening = async (bytes) => { recorded = bytes; return send(bytes); };
      await settled(time, sessionFor(a, 'i', first.a, time).run(), sessionFor(b, 'r', first.b, time, { opening: { kSess: keys.kSess, salt: SALT, kFind: keys.kFind, seen } }).run());
      expect(first.sent.b.opening).toBe(NEARBY_OPENING_BYTES);
      const again = pairOf();
      const responder = await responderAlone(b, again.b, seen);
      await again.a.sendOpening(recorded!);
      const [report] = await settled(time, responder.done);
      expect(report.ended).toEqual({ how: 'silent' });
      expect(again.sent.b.opening).toBe(0);
      expect(responder.closedAfter()).toBe(3_000);
    });

    it('a reflected opening is no reply: the initiator says nothing and closes', async () => {
      const [a] = await two();
      const pair = pairOf();
      const s = sessionFor(a, 'i', pair.a, time).run();
      await time.runFor(10);
      const mine = await pair.b.receiveOpening(NEARBY_OPENING_BYTES, 1000);
      await pair.b.sendOpening(mine!);
      const [report] = await settled(time, s);
      expect(report.ended).toEqual({ how: 'silent' });
      expect(pair.sent.a.frames).toEqual([]);
    });

    it('no reply by the deadline is no answer, which the room counts as busy', async () => {
      const [a] = await two();
      const pair = pairOf();
      const [report] = await settled(time, sessionFor(a, 'i', pair.a, time).run());
      expect(report.ended).toEqual({ how: 'no-answer' });
    });

    it('no byte of an opening stays the same across sessions', async () => {
      const openings = Array.from({ length: 8 }, (_v, i) => makeOpeningI(fakeSigner(`o${i}`), openingKeyOf(fakeSigner('k'), keys.kSess), SALT).bytes);
      for (let at = 0; at < NEARBY_OPENING_BYTES; at++) expect(new Set(openings.map((o) => o[at])).size).toBeGreaterThan(1);
    });
  });

  describe('hello', () => {
    it('a removed member gets `bye` `not-member` and no chain', async () => {
      const [a, b] = await two();
      b.people = { privilegesIn: (p) => new Set(p === 'ana' ? [] : ['read_language' as never]), languageListed: () => true };
      const pair = pairOf();
      const [ra, rb] = await run(a, b, pair);
      expect(rb.ended).toEqual({ how: 'said', reason: 'not-member' });
      expect(ra.ended).toEqual({ how: 'heard', reason: 'not-member' });
      expect(typesOf(pair.sent.b.frames)).toEqual(['bye']);
    });

    it('a chain for another organization is refused as identity', async () => {
      const [a, b] = await two();
      a.who = { ...ana, chain: await worker.certify({ installKey: ana.key, profileId: 'ana', deviceId: ana.deviceId }, { orgId: 'org2' }) };
      const pair = pairOf();
      const [ra, rb] = await run(a, b, pair);
      expect(rb.ended).toMatchObject({ how: 'said', reason: 'identity', detail: 'wrong organization' });
      expect(ra.ended).toEqual({ how: 'heard', reason: 'identity' });
    });

    it('a chain naming another phone\'s key fails its proof', async () => {
      const [a, b] = await two();
      const cy = await teammate('cy');
      a.who = { ...ana, chain: cy.chain, deviceId: cy.deviceId };
      const [, rb] = await run(a, b, pairOf());
      expect(rb.ended).toMatchObject({ how: 'said', reason: 'identity', detail: 'bad proof' });
    });

    it('a listed key and person is refused at Hello, and another person on that key is not', async () => {
      const [a, b] = await two();
      await b.keep.saveRevoked(await signedList({ v: 1, kid: 'k1', orgId: ORG, seq: 2, keys: [[ana.key, 'ana', NOW]] }));
      const [, rb] = await run(a, b, pairOf());
      expect(rb.ended).toMatchObject({ how: 'said', reason: 'identity', detail: 'key revoked' });
      await b.keep.saveRevoked(await signedList({ v: 1, kid: 'k1', orgId: ORG, seq: 3, keys: [[ana.key, 'someone-else', NOW]] }));
      const [ra2] = await run(a, b, pairOf());
      expect(ra2.ended.how).toBe('done');
    });

    it('a tag that is not the one heard is not who it seemed', async () => {
      const [a, b] = await two();
      const [ra] = await run(a, b, pairOf(), { heardTag: '000000000000' });
      expect(ra.ended).toMatchObject({ how: 'said', reason: 'identity', detail: 'not the tag heard' });
    });

    it('under an older generation the initiator holds back its hello, so a lure with no chain learns no name', async () => {
      const [a, b] = await two();
      b.who = { ...sam, chain: [] };
      const pair = pairOf();
      const [ra] = await run(a, b, pair, { older: true });
      expect(ra.ended).toMatchObject({ how: 'said', reason: 'identity' });
      expect(typesOf(pair.sent.a.frames)).toEqual(['you-first', 'bye']);
      const ok = await run(a, { ...b, who: sam }, pairOf(), { older: true });
      expect(ok.map((r) => r.ended.how)).toEqual(['done', 'done']);
    });

    it('a range this build shares nothing with ends with protocol, and says a newer app is needed', async () => {
      const [a, b] = await two();
      const pair = pairOf();
      rewrite(pair.a, (m) => (m.t === 'hello' ? { ...m, protocol: { min: 7, max: 9 } } : m));
      const [, rb] = await run(a, b, pair);
      expect(rb.ended).toMatchObject({ how: 'said', reason: 'protocol' });
      expect(rb.newerAppNeeded).toBe(true);
    });

    it('a busy phone opens, then says busy, sealed', async () => {
      const [a, b] = await two();
      const pair = pairOf();
      const [ra, rb] = await run(a, b, pair, {}, { onOpened: () => false });
      expect(rb.ended).toEqual({ how: 'said', reason: 'busy' });
      expect(ra.ended).toEqual({ how: 'heard', reason: 'busy' });
      expect(pair.sent.b.opening).toBe(NEARBY_OPENING_BYTES);
    });
  });

  describe('revocation lists', () => {
    it('the side with the newer list sends it, and the other marks later-dated rows already taken', async () => {
      const [a, b] = await two();
      // Bob's phone gave Sam's two rows, one dated before his key was revoked and one after.
      const bob = await teammate('bob');
      const clock = wallClock();
      const bp = await testPhone(server, make(), bob, shelf, { now: clock.read });
      const early = await unit(bp, 'early');
      clock.now += 60_000;
      const late = await unit(bp, 'late');
      await settled(time, ...(() => { const p = pairOf(); return [sessionFor(bp, 'i', p.a, time).run(), sessionFor(b, 'r', p.b, time).run()]; })());
      expect((await b.store.getMany([early.id, late.id])).map((l) => l.status)).toEqual(['nearby', 'nearby']);
      await a.keep.saveRevoked(await signedList({ v: 1, kid: 'k1', orgId: ORG, seq: 5, keys: [[bob.key, 'bob', clock.now]] }));
      const pair = pairOf();
      const [ra, rb] = await run(a, b, pair);
      expect(typesOf(pair.sent.a.frames)).toContain('revoked');
      expect(rb.revokedTaken).toBe(5);
      expect([ra.ended.how, rb.ended.how]).toEqual(['done', 'done']);
      expect((await b.store.getMany([late.id]))[0]).toMatchObject({ status: 'rejected', rejectReason: 'dated after its key was revoked' });
      expect((await b.store.getMany([early.id]))[0]?.status).toBe('nearby');
      expect((await b.keep.revoked())?.list.seq).toBe(5);
      // Try again does not bring it back.
      expect(await b.client.retryNearby({ people: () => b.people, revoked: (await b.keep.revoked())!.list })).toBe(0);
    });

    it('a newer list naming this partner ends the session', async () => {
      const [a, b] = await two();
      await b.keep.saveRevoked(await signedList({ v: 1, kid: 'k1', orgId: ORG, seq: 5, keys: [[ana.key, 'ana', NOW + 10_000_000]] }));
      const [ra] = await run(a, b, pairOf(), {}, {});
      // Ana passed Sam's Hello under the list Sam held, which revokes her from a date: it names her, and Hello refuses a listed pair.
      expect(ra.ended).toEqual({ how: 'heard', reason: 'identity' });
    });

    it('a forged list is dropped and ends nothing', async () => {
      const [a, b] = await two();
      const forged = { ...(await signedList({ v: 1, kid: 'k1', orgId: ORG, seq: 9, keys: [] })), sig: base64urlEncode(new Uint8Array(64)) };
      await a.keep.saveRevoked(forged);
      // A list this phone holds was checked when it came, so a forged one only gets here by hand.
      const pair = pairOf();
      const [, rb] = await run(a, b, pair);
      expect(rb.revokedDropped).toBe(1);
      expect(rb.ended.how).toBe('done');
    });
  });

  describe('hostile messages never throw out of a session', () => {
    const hostile: [string, (m: Message) => Message | Uint8Array | null, string][] = [
      ['a `__proto__` key in have', (m) => (m.t === 'have' ? raw(JSON.stringify({ ...JSON.parse(new TextDecoder().decode(encodeMessage(m))), vector: JSON.parse(`{"__proto__":{"mark":1,"ahead":[]}}`) })) : m), 'protocol'],
      ['a holdings part over its list cap', (m) => (m.t === 'holdings-end' ? raw(JSON.stringify({ t: 'holdings', key: ana.key, counter: 1, files: Array.from({ length: 8_001 }, () => 'a'.repeat(64)), more: false })) : m), 'protocol'],
      ['bytes that are not UTF-8', (m) => (m.t === 'have' ? new Uint8Array([0xff, 0xfe, 0x00]) : m), 'protocol'],
      ['a message out of its step', (m) => (m.t === 'have' ? { t: 'file-ask', transferId: 'x', hash: 'a'.repeat(64), format: 'm4a' } : m), 'protocol']
    ];
    it.each(hostile)('%s ends with bye', async (_label, change, reason) => {
      const [a, b] = await two();
      await record(a, shelf, 'ra');
      const pair = pairOf();
      rewrite(pair.a, change);
      const [, rb] = await run(a, b, pair);
      expect(rb.ended).toMatchObject({ how: 'said', reason });
    });

    it('a message no phone here knows is ignored, and so are phase 6\'s', async () => {
      const [a, b] = await two();
      await unit(a, 'a1');
      const pair = pairOf();
      let sent = false;
      rewrite(pair.a, (m) => {
        if (m.t !== 'have' || sent) return m;
        sent = true;
        void pair.a.send(utf8Encode(JSON.stringify({ t: 'from-the-future', x: 1 })));
        void pair.a.send(encodeMessage({ t: 'copy-no', reason: 'versions' }));
        return m;
      });
      const [ra, rb] = await run(a, b, pair);
      expect([ra.ended.how, rb.ended.how]).toEqual(['done', 'done']);
      expect(rb.got.events).toBe(1);
    });

    it('events holding member names and garbage are refused one by one, and the rest of the page stands', async () => {
      const [a, b] = await two();
      await unit(a, 'a1');
      const pair = pairOf();
      rewrite(pair.a, (m) => (m.t === 'batch' ? { ...m, events: [...m.events, JSON.parse('{"__proto__":{"x":1},"id":"zz"}'), { id: 7 } as never] } : m));
      const [, rb] = await run(a, b, pair);
      expect(rb.ended.how).toBe('done');
      expect(rb.got.events).toBe(1);
      expect(rb.got.refused).toBe(2);
    });

    it('says busy after a few dozen dropped pages', async () => {
      const [a, b] = await two();
      await unit(a, 'a1');
      const pair = pairOf();
      let flooded = false;
      rewrite(pair.a, (m) => {
        if (m.t !== 'events-done' || flooded) return m;
        flooded = true;
        return m;
      });
      const inner = a.client.nearbyUncounted.bind(a.client);
      a.client.nearbyUncounted = async (them) => [...await inner(them), ...Array.from({ length: 40 }, (_v, i) => ({ key: ana.key, n: 100 + i }))];
      const page = a.client.nearbyBatchPage.bind(a.client);
      a.client.nearbyBatchPage = async (key, n) => (n >= 100 ? pageOf(ana, n, [], { signer: fakeSigner('not-ana') }) : page(key, n));
      const [, rb] = await run(a, b, pair, {}, { tunables: { openCloseMinMs: 3_000, openCloseMaxMs: 3_000, busyAfterDrops: 36 } });
      expect(rb.ended).toMatchObject({ how: 'said', reason: 'busy' });
      expect(rb.got.droppedPages).toBe(36);
    });

    it('counts pages dropped over budget', async () => {
      const [a, b] = await two();
      await unit(a, 'a1');
      await a.client.signUnsigned({ publicKey: ana.key, sign: ana.crypto.sign, sha256: ana.crypto.sha256, chainFor: () => ana.chain });
      await unit(a, 'a2');
      const [, rb] = await run(a, b, pairOf(), {}, { budget: { maxRows: 1, maxBytes: 50_000_000, maxManifestBytes: 50_000_000 } });
      expect(rb.got.overBudget).toBe(1);
      expect(rb.ended.how).toBe('done');
    });
  });

  it('a stop ends with bye stopped, and the next session resumes', async () => {
    const [a, b] = await two();
    await unit(a, 'a1');
    const pair = pairOf();
    const sa = sessionFor(a, 'i', pair.a, time);
    rewrite(pair.a, (m) => { if (m.t === 'have') sa.stop(); return m; });
    const [ra, rb] = await settled(time, sa.run(), sessionFor(b, 'r', pair.b, time).run());
    expect(ra.ended).toEqual({ how: 'said', reason: 'stopped' });
    expect(['heard', 'dropped']).toContain(rb.ended.how);
    const [again] = await run(a, b, pairOf());
    expect(again.ended.how).toBe('done');
    expect(await idsOf(b.store)).toEqual(await idsOf(a.store));
  });

  it('a teammate who goes quiet is stalled out', async () => {
    const [a, b] = await two();
    const pair = pairOf();
    b.client.nearbyHave = () => new Promise(() => undefined);
    void sessionFor(b, 'r', pair.b, time).run();
    const [ra] = await settled(time, sessionFor(a, 'i', pair.a, time).run());
    expect(ra.ended).toEqual({ how: 'stalled' });
  });

  it('a sender that could not send all it knows of says so', async () => {
    const [a, b] = await two();
    a.client.nearbyHoldsLess = async () => true;
    const [, rb] = await run(a, b, pairOf());
    expect(rb.older).toBe(true);
  });

  it('claims what it pulled and the Worker vouched for, to a teammate who has not', async () => {
    server.attester = worker.attestRows;
    const [a, b] = await two();
    const author = await testPhone(server, make(), await teammate('cy'), shelf);
    await unit(author, 'c1');
    await author.client.sync();
    await a.client.sync();
    const [ra, rb] = await run(a, b, pairOf());
    expect(ra.sent.claims).toBe(1);
    expect(rb.got.events).toBe(1);
    expect(rb.ended.how).toBe('done');
  });

  it('passes on a third phone\'s signed holdings, and drops a forged entry alone', async () => {
    const [a, b] = await two();
    const cy = await teammate('cy');
    const dan = await teammate('dan');
    const signedBy = async (who: Teammate, files: string[]) => (await withMyHolding(new Map(), files, { key: who.key, orgId: ORG, streamId: LANG, chain: who.chain, sign: who.crypto.sign, sha256: fakeSha256 })).get(who.key)!;
    const cys = await signedBy(cy, ['c'.repeat(64)]);
    const forged = { ...(await signedBy(dan, ['d'.repeat(64)])), files: ['e'.repeat(64)] };
    await a.keep.saveHoldings(new Map([[cy.key, cys], [dan.key, forged]]));
    const [ra, rb] = await run(a, b, pairOf());
    expect([ra.ended.how, rb.ended.how]).toEqual(['done', 'done']);
    expect(rb.holdings.dropped).toBe(1);
    const held = await b.keep.holdings();
    expect(held.get(cy.key)).toEqual(cys);
    expect(held.has(dan.key)).toBe(false);
  });

  describe('files', () => {
    it('a file whose bytes do not match its name is not kept', async () => {
      const [a, b] = await two();
      await record(a, shelf, 'ra');
      const pair = pairOf({ alterFile: (bytes) => concatBytes(bytes, new Uint8Array([1])) });
      const [, rb] = await run(a, b, pair);
      expect(rb.files.failed).toBe(1);
      expect(b.files.here.size).toBe(0);
      expect([...shelf.keys()].some((k) => k.endsWith('.nearby.part'))).toBe(false);
    });

    it('a file the other does not have is answered no', async () => {
      const [a, b] = await two();
      const hash = await record(a, shelf, 'ra');
      shelf.delete(`${ana.deviceId}/${hash}`);
      const [ra, rb] = await run(a, b, pairOf());
      expect(ra.files.answeredNo).toBe(1);
      expect(rb.files.toldNo).toBe(1);
    });

    it('a phone with no room stops asking, and says so', async () => {
      const [a, b] = await two();
      await record(a, shelf, 'ra');
      b.files.noRoom = true;
      const [, rb] = await run(a, b, pairOf());
      expect(rb.files.noRoom).toBe(true);
      expect(rb.ended.how).toBe('done');
    });

    it('backups stop after the limit when a teammate was waiting, and the pair is not recorded as finished', async () => {
      const [a, b] = await two();
      for (let i = 0; i < 3; i++) await record(a, shelf, `r${i}`);
      const at = { n: 0 };
      b.files.fetchFile = async (file) => { if (at.n++ > 0) await time.sleep(200_000); return { stagingUri: `${sam.deviceId}/${file.hash}.part`, maxBytes: 1e7, minFreeBytes: 0 }; };
      const slow = { openCloseMinMs: 3_000, openCloseMaxMs: 3_000, backupLimitMs: 120_000, stallMs: 1_000_000 };
      const [, rb] = await run(a, b, pairOf(), { tunables: slow }, { otherWaiting: () => true, tunables: slow });
      expect(rb.files.cutBackups).toBe(true);
      expect(rb.files.got).toBeLessThan(3);
      expect(await b.keep.peers()).toEqual([]);
    });
  });

  describe('a pipe, and the link it arranges', () => {
    it('a Bluetooth link leaves out holdings and files, and still moves events', async () => {
      const [a, b] = await two();
      await unit(a, 'a1');
      await record(a, shelf, 'ra');
      const pair = pairOf({ kind: 'bluetooth' });
      const [ra, rb] = await run(a, b, pair);
      expect([ra.ended.how, rb.ended.how]).toEqual(['done', 'done']);
      expect(rb.got.events).toBe(2);
      expect(b.files.here.size).toBe(0);
      const said = [...typesOf(pair.sent.a.frames), ...typesOf(pair.sent.b.frames)];
      for (const t of ['holdings', 'holdings-end', 'file-ask', 'files-done']) expect(said).not.toContain(t);
      expect(said).toContain('host');
      expect(ra.linkKind).toBe('bluetooth');
    });

    it('arranges Wi-Fi Direct, moves files over it, and closes the pipe', async () => {
      const [a, b] = await two();
      await record(a, shelf, 'ra');
      const air = memoryNearbyAir({ time, files: shelf });
      const radios = { directByName: true, band5: false, hotspot: true, joinHotspot: true };
      const pipe = pairOf({ kind: 'bluetooth' });
      const [ra, rb] = await run(a, b, pipe, { arrange: { radio: air.radio('a'), radios } }, { arrange: { radio: air.radio('b'), radios } });
      expect([ra.ended.how, rb.ended.how]).toEqual(['done', 'done']);
      expect(ra.linkKind).toBe('wifi-direct');
      expect(b.files.here.size).toBe(1);
      expect(pipe.closedBy.a || pipe.closedBy.b).toBe(true);
    });

    it('with no ready by the deadline it tries the hotspot, then stays on the pipe', async () => {
      const [a, b] = await two();
      await unit(a, 'a1');
      const air = memoryNearbyAir({ time, files: shelf });
      const radios = { directByName: true, band5: true, hotspot: true, joinHotspot: true };
      const stuck = { neverUp: ['wifi-direct', 'hotspot'] as ('wifi-direct' | 'hotspot')[] };
      const [ra, rb] = await run(a, b, pairOf({ kind: 'bluetooth' }), { arrange: { radio: air.radio('a', {}, stuck), radios } }, { arrange: { radio: air.radio('b', {}, stuck), radios } });
      expect([ra.ended.how, rb.ended.how]).toEqual(['done', 'done']);
      expect(ra.linkKind).toBe('bluetooth');
      expect(rb.got.events).toBe(1);
    });

    it('works out who hosts from both radios, ending with the pipe', () => {
      const all = { directByName: true, band5: true, hotspot: true, joinHotspot: true };
      expect(arrangePlan(all, all)).toEqual([
        { kind: 'wifi-direct', host: 'r', band5: true }, { kind: 'wifi-direct', host: 'r', band5: false }, { kind: 'hotspot', host: 'r', band5: false }, { kind: 'bluetooth', host: 'r', band5: false }
      ]);
      // A disguised phone never joins a hotspot, so the other joins and it hosts.
      expect(arrangePlan(all, { ...all, directByName: false, joinHotspot: false })).toEqual([{ kind: 'hotspot', host: 'r', band5: false }, { kind: 'bluetooth', host: 'r', band5: false }]);
      expect(arrangePlan({ ...all, joinHotspot: false, directByName: false }, { ...all, hotspot: false })).toEqual([{ kind: 'hotspot', host: 'i', band5: false }, { kind: 'bluetooth', host: 'r', band5: false }]);
      // Two disguised phones whose Wi-Fi Direct fails stay on Bluetooth.
      const worn = { directByName: false, band5: false, hotspot: true, joinHotspot: false };
      expect(arrangePlan(worn, worn)).toEqual([{ kind: 'bluetooth', host: 'r', band5: false }]);
    });

    it('hands on a newer generation once the other\'s arrange has come, and the receiver checks it', async () => {
      const [a, b] = await two();
      const sha = (x: Uint8Array) => fakeSigner('h').sha256(x);
      const key5 = new Uint8Array(32).fill(5);
      const key4 = sha(concatBytes(utf8Encode('lq-nearby-gen-v1'), key5));
      const kept: unknown[] = [];
      const ahead = { sessionGen: 4, mine: () => ({ gen: 5, key: base64urlEncode(key5), direct: true, certOrgSeq: 3 }), orgSeqHere: () => 3, keep: async () => undefined };
      const behind = { sessionGen: 4, mine: () => ({ gen: 4, key: base64urlEncode(key4), direct: true, certOrgSeq: 0 }), orgSeqHere: () => 0, keep: async (k: unknown) => { kept.push(k); } };
      const pair = pairOf({ kind: 'bluetooth' });
      const [, rb] = await run(a, b, pair, { generations: ahead }, { generations: behind });
      const said = typesOf(pair.sent.a.frames);
      expect(said.indexOf('discovery-key')).toBeGreaterThan(said.indexOf('arrange'));
      expect(rb.handedKey).toEqual({ gen: 5, key: base64urlEncode(key5) });
      expect(kept).toEqual([{ gen: 5, key: base64urlEncode(key5) }]);
      // A wrong key is refused, and ends nothing.
      const wrong = { ...ahead, mine: () => ({ ...ahead.mine(), key: base64urlEncode(new Uint8Array(32).fill(9)) }) };
      const [, again] = await run(a, b, pairOf({ kind: 'bluetooth' }), { generations: wrong }, { generations: behind });
      expect(again.handedKeyRefused).toBe(1);
      expect(again.ended.how).toBe('done');
    });

    it('hands on only a key the server gave, above the session\'s, from a phone that has seen what made it', () => {
      expect(mayHandOn({ gen: 5, direct: true, certOrgSeq: 3 }, 4, 3)).toBe(true);
      expect(mayHandOn({ gen: 5, direct: false, certOrgSeq: 3 }, 4, 3)).toBe(false);
      expect(mayHandOn({ gen: 4, direct: true, certOrgSeq: 3 }, 4, 3)).toBe(false);
      expect(mayHandOn({ gen: 5, direct: true, certOrgSeq: 3 }, 4, 2)).toBe(false);
    });
  });
});

describe('the opening', () => {
  const crypto = fakeSigner('vectors');
  const fromHex = (h: string) => new Uint8Array(Buffer.from(h, 'hex'));
  const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

  it('golden vectors for both sides', () => {
    const { kOpen, salt, nonceI, ephI, nonceR, ephR, i, r } = v.OPENING;
    const unused = new Uint8Array(32);
    const made = makeOpeningI(crypto, fromHex(kOpen), fromHex(salt), { nonce: fromHex(nonceI), eph: { secret: unused, public: fromHex(ephI) } });
    expect(hex(made.bytes)).toBe(i);
    expect(checkOpeningI(crypto, fromHex(kOpen), fromHex(salt), made.bytes)).toEqual({ nonce: fromHex(nonceI), eph: fromHex(ephI) });
    const reply = makeOpeningR(crypto, fromHex(kOpen), fromHex(salt), made.bytes, { nonce: fromHex(nonceR), eph: { secret: unused, public: fromHex(ephR) } });
    expect(hex(reply.bytes)).toBe(r);
    expect(checkOpeningR(crypto, fromHex(kOpen), fromHex(salt), made.bytes, reply.bytes)).toEqual({ nonce: fromHex(nonceR), eph: fromHex(ephR) });
    // Bound to the salt, and to `i`'s whole opening.
    expect(checkOpeningI(crypto, fromHex(kOpen), new Uint8Array(6), made.bytes)).toBeNull();
    expect(checkOpeningR(crypto, fromHex(kOpen), fromHex(salt), reply.bytes, reply.bytes)).toBeNull();
    // `kOpen` from `kSess`, by Node's own HKDF.
    const kSess = new Uint8Array(32).fill(3);
    expect(hex(openingKeyOf(crypto, kSess))).toBe(Buffer.from(hkdfSync('sha256', kSess, new Uint8Array(0), 'lq-nearby-open-v1', 32)).toString('hex'));
    // The mask is what the contract says, worked out by Node.
    const mask = createHmac('sha256', fromHex(kOpen)).update(openingMaskInput('i', fromHex(salt), fromHex(nonceI))).digest();
    expect(hex(made.bytes.slice(32, 64))).toBe(hex(fromHex(ephI).map((x, k) => x ^ mask[k]!)));
  });

  it('both sides derive the same keys, from Node\'s own X25519 and HKDF', () => {
    const iSide = fakeSigner('i-side');
    const rSide = fakeSigner('r-side');
    const kSess = new Uint8Array(32).fill(4);
    const kOpen = openingKeyOf(iSide, kSess);
    const oi = makeOpeningI(iSide, kOpen, SALT);
    const seenI = checkOpeningI(rSide, kOpen, SALT, oi.bytes)!;
    const or = makeOpeningR(rSide, kOpen, SALT, oi.bytes);
    const seenR = checkOpeningR(iSide, kOpen, SALT, oi.bytes, or.bytes)!;
    const t = { ephI: oi.eph, ephR: or.eph, nonceI: oi.nonce, nonceR: or.nonce };
    const ki = sessionKeysOf(iSide, kSess, oi, seenR, t)!;
    const kr = sessionKeysOf(rSide, kSess, or, seenI, t)!;
    expect(ki).toEqual(kr);
    const ss = iSide.x25519(oi.secret, or.eph);
    const th = iSide.sha256(concatBytes(utf8Encode('lq-nearby-th-v1\n'), oi.eph, or.eph, oi.nonce, or.nonce));
    const okm = new Uint8Array(hkdfSync('sha256', concatBytes(ss, kSess), th, 'lq-nearby-keys-v1', 128));
    expect(ki.th).toBe(hex(th));
    expect(ki.first.iToR).toEqual(okm.slice(0, 32));
    expect(ki.wifi.rToI).toEqual(okm.slice(96, 128));
  });

  it('refuses an all-zero shared secret', () => {
    const c = fakeSigner('z');
    expect(sessionKeysOf(c, new Uint8Array(32), { secret: new Uint8Array(32).fill(1) }, { eph: new Uint8Array(32) }, { ephI: new Uint8Array(32), ephR: new Uint8Array(32), nonceI: new Uint8Array(32), nonceR: new Uint8Array(32) })).toBeNull();
  });
});

describe('the memory link holds a phone\'s order rules', () => {
  const time = newTime();
  it('no frame before secure, no opening after it, secure once, and a wrong key closes the link', async () => {
    const pair = memoryNearbyPair({ time });
    await expect(pair.a.send(new Uint8Array(1))).rejects.toThrow(/secure first/);
    await pair.a.secure({ send: new Uint8Array(32).fill(1), receive: new Uint8Array(32).fill(2) });
    await expect(pair.a.secure({ send: new Uint8Array(32), receive: new Uint8Array(32) })).rejects.toThrow(/once/);
    await expect(pair.a.sendOpening(new Uint8Array(1))).rejects.toThrow(/before secure/);
    await pair.b.secure({ send: new Uint8Array(32).fill(2), receive: new Uint8Array(32).fill(9) });
    await pair.a.send(new Uint8Array([1]));
    await expect(pair.b.receive()).rejects.toThrow(/failed tag/);
    await expect(pair.a.send(new Uint8Array([1]))).rejects.toThrow(/dropped/);
  });
});

async function signedList(list: RevocationList) {
  const text = revocationText(list);
  return { text, kid: list.kid, sig: await fakeSigner('worker:k1').sign(nearbyBytes('revoked', text)) };
}

function raw(text: string): Uint8Array {
  return utf8Encode(text);
}

/** Changes what one end sends, message by message, as a hostile phone would. */
function rewrite(link: NearbyLink, change: (m: Message) => Message | Uint8Array | null): void {
  const send = link.send.bind(link);
  link.send = async (bytes) => {
    const parsed = parseMessage(bytes);
    if (parsed.kind !== 'message') return send(bytes);
    const out = change(parsed.message);
    if (out === null) return;
    return send(out instanceof Uint8Array ? out : encodeMessage(out));
  };
}
