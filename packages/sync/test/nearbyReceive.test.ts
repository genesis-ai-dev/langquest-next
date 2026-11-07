import { encodeHlc, foldLanguage, emptyLanguageState, isCounted, manifestText, nearbyBytes, newCommandId, parseVector, REDUCER_VERSION, type AnyEvent, type LanguageState, type NearbyVia, type RevocationList } from '@langquest-next/core';
import {
  LANG, NOW, ORG, STORES, claimsOf, eventBy, everyone, intakeFor, manifestOf, pageOf, phone, recordingBy, rowOf, signerOf, statusOf, teammate, unitBy, vectorOf, wallClock, watched, type Teammate
} from './nearbyFixtures';
import { MemoryStore } from '../src/memoryStore';
import { LANGUAGE_MATERIALIZER } from '../src/syncClient';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSigner } from '../src/testing/memoryNearbyLink';
import type { EventStore, LocalEvent } from '../src/types';

/**
 * Taking events from a teammate's phone (docs/nearby-sync-plan.md 5.3, 5.4 and 5.12).
 * Why these tests: a nearby phone is not a server, so a page can never move a cursor,
 * confirm anything or delete anything. Only a verified manifest moves the vector, and it
 * counts a number only when this phone holds all that number speaks for: a teammate who
 * could close a number by leaving events out could hide work from the whole team.
 */
const stateOf = (c: { getState(): unknown }) => c.getState() as LanguageState;

describe.each(STORES)('receiving a batch on the %s store', (_name, make) => {
  let sam: Teammate;
  let ana: Teammate;
  let mine: Teammate;
  let store: EventStore;
  let server: FakeServer;

  beforeEach(async () => {
    sam = await teammate('sam');
    ana = await teammate('ana');
    mine = await teammate('me');
    store = make();
    server = new FakeServer();
  });

  async function myPhone(o: Parameters<typeof phone>[3] = {}) {
    const client = phone(server, store, mine, o);
    await client.load();
    return client;
  }

  it('keeps and folds a whole batch as nearby, counts its number, and neither confirms anything nor moves the cursor', async () => {
    const client = await myPhone();
    const a = unitBy(sam, 'u1');
    const b = recordingBy(sam, 'r1');
    const receipt = await client.receiveNearby(await pageOf(sam, 1, [a, b]), intakeFor());

    expect(receipt).toEqual({ outcome: 'taken', kept: 2, refused: [], counted: true });
    expect(await rowOf(store, a.id)).toMatchObject({ status: 'nearby', via: { batch: 1, key: sam.key } });
    expect(stateOf(client).units['u1']).toBeDefined();
    expect(isCounted(await vectorOf(client), sam.key, 1)).toBe(true);
    // Rule 1 and rule 2 of section 5.1.
    expect(await store.cursor(ORG, LANG)).toBe(0);
    expect(await store.pendingCount(ORG, LANG)).toBe(0);
    const [held] = await store.batchesAfter(ORG, LANG, sam.key, 0, 1);
    expect(held).toMatchObject({ key: sam.key, n: 1, actorId: 'sam', firstHlc: a.hlc });
    expect(JSON.parse(held!.chain)).toEqual(sam.chain);
    expect((await client.inspect()).nearby).toBe(2);
    expect((await client.inspect()).total).toBe(2);
  });

  it('the rows survive a load, folded from the log', async () => {
    const client = await myPhone();
    await client.receiveNearby(await pageOf(sam, 1, [unitBy(sam, 'u1')]), intakeFor());
    await client.load();
    expect(stateOf(client).units['u1']).toBeDefined();
  });

  it('removes a serverSeq a sender left on, or a refold past a checkpoint would skip the row', async () => {
    // Trap: `foldLog`'s `after` skips a copy with a serverSeq at or below the checkpoint. An undefined property survives in MemoryStore too.
    const client = await myPhone();
    const withSeq = { ...unitBy(sam, 'u1'), serverSeq: 1 } as AnyEvent;
    const withUndefined = { ...unitBy(sam, 'u2'), serverSeq: undefined } as unknown as AnyEvent;
    await client.receiveNearby(await pageOf(sam, 1, [withSeq, withUndefined]), intakeFor());
    for (const e of [withSeq, withUndefined]) expect('serverSeq' in (await rowOf(store, e.id))!.event).toBe(false);

    await store.commit({ meta: { [`snapshot:${ORG}/${LANG}`]: JSON.stringify({ orgId: ORG, streamId: LANG, reducerVersion: REDUCER_VERSION, serverSeq: 5, state: emptyLanguageState() }), [`snapshotSeq:${ORG}/${LANG}`]: `${REDUCER_VERSION}:5` } });
    await client.load();
    expect(stateOf(client).units['u1']).toBeDefined();
    expect(stateOf(client).units['u2']).toBeDefined();
  });

  describe('what never passes', () => {
    const nothingWritten = async (client: Awaited<ReturnType<typeof phone>>, ids: string[], key: string) => {
      expect((await store.getMany(ids))).toEqual([]);
      expect(isCounted(await vectorOf(client), key, 1)).toBe(false);
      expect(await store.batchKeys(ORG, LANG)).toEqual([]);
    };

    it('a forged manifest: signed by someone other than its key', async () => {
      const client = await myPhone();
      const e = unitBy(sam, 'u1');
      const page = await pageOf(sam, 1, [e], { signer: ana.crypto });
      expect(await client.receiveNearby(page, intakeFor())).toMatchObject({ outcome: 'dropped', reason: 'bad signature', kept: 0, counted: false });
      await nothingWritten(client, [e.id], sam.key);
    });

    it('a tampered manifest: one byte changed after signing', async () => {
      const client = await myPhone();
      const e = unitBy(sam, 'u1');
      const page = await pageOf(sam, 1, [e]);
      const tampered = { ...page, manifest: page.manifest.replace('"floor":0', '"floor":1') };
      expect(await client.receiveNearby(tampered, intakeFor())).toMatchObject({ outcome: 'dropped', reason: 'bad signature' });
      await nothingWritten(client, [e.id], sam.key);
    });

    it('the wrong key: another signer\'s chain, or a chain for another key', async () => {
      const client = await myPhone();
      const e = unitBy(sam, 'u1');
      const page = await pageOf(sam, 1, [e], { chain: ana.chain });
      expect(await client.receiveNearby(page, intakeFor())).toMatchObject({ outcome: 'dropped', reason: 'the chain names someone else' });
      await nothingWritten(client, [e.id], sam.key);
    });

    it('the wrong author: a manifest naming someone the chain does not', async () => {
      const client = await myPhone();
      const samOnAna = { ...ana, key: ana.key, profileId: 'sam' };
      const e = eventBy(samOnAna, 'v1.UnitAdded', { unitId: 'u1', parentUnitId: null, kind: 'passage', label: 'x', order: 'a' }, { id: newCommandId('sam', 'x:0') });
      const page = await pageOf(samOnAna, 1, [e]);
      expect(await client.receiveNearby(page, intakeFor())).toMatchObject({ outcome: 'dropped', reason: 'the chain names someone else' });
      expect(await store.getMany([e.id])).toEqual([]);
    });

    it('a chain the Worker did not sign, whatever it claims', async () => {
      const client = await myPhone();
      const forger = fakeSigner('forger');
      const body = sam.chain[0]!.body;
      const forged = [{ kind: 'worker@1' as const, kid: 'k1', body: body as never, sig: await forger.sign(new Uint8Array(1)) }];
      const page = await pageOf(sam, 1, [unitBy(sam, 'u1')], { chain: forged });
      expect(await client.receiveNearby(page, intakeFor())).toMatchObject({ outcome: 'dropped', reason: 'chain: bad certificate signature' });
    });

    it('a manifest for another stream, a broken one, and an unsafe number', async () => {
      const client = await myPhone();
      const e = unitBy(sam, 'u1');
      expect(await client.receiveNearby(await pageOf(sam, 1, [e], { manifest: { streamId: 'other' } }), intakeFor())).toMatchObject({ outcome: 'dropped', reason: 'bad manifest' });
      expect(await client.receiveNearby({ t: 'batch', manifest: 'nope', sig: 's', chain: sam.chain, events: [] }, intakeFor())).toMatchObject({ outcome: 'dropped', reason: 'bad manifest' });
      expect(await client.receiveNearby(await pageOf(sam, 2 ** 53, [e]), intakeFor())).toMatchObject({ outcome: 'dropped', reason: 'bad manifest' });
    });

    it('checks no signature for a number already counted', async () => {
      const client = await myPhone();
      const page = await pageOf(sam, 1, [unitBy(sam, 'u1')]);
      await client.receiveNearby(page, intakeFor());
      const verify = vi.fn(() => true);
      expect(await client.receiveNearby(page, intakeFor({ verify }))).toMatchObject({ outcome: 'ignored', counted: true });
      expect(verify).not.toHaveBeenCalled();
    });

    it('another manifest for an open number: the first signature stays', async () => {
      const client = await myPhone();
      const a = unitBy(sam, 'u1');
      const b = unitBy(sam, 'u2');
      const c = unitBy(sam, 'u3');
      await client.receiveNearby(await pageOf(sam, 1, [a, b], { carrying: [a] }), intakeFor());
      expect(await client.receiveNearby(await pageOf(sam, 1, [c]), intakeFor())).toMatchObject({ outcome: 'dropped', reason: 'another manifest holds this number' });
      expect(await store.getMany([c.id])).toEqual([]);
    });

    it('hostile events cost themselves and not the page', async () => {
      const client = await myPhone();
      const good = unitBy(sam, 'u1');
      const [u2, u3, u4] = [unitBy(sam, 'u2'), unitBy(sam, 'u3'), unitBy(sam, 'u4')];
      const names = { ...u2, payload: JSON.parse('{"unitId":"u2","parentUnitId":null,"kind":"passage","label":"x","order":"a","__proto__":{"polluted":1}}') } as AnyEvent;
      const nul = { ...u3, payload: { ...u3.payload, label: 'x\u0000y' } } as AnyEvent;
      const noPayload = { ...u4, payload: null } as unknown as AnyEvent;
      const page = await pageOf(sam, 1, [good, u2, u3, u4], { carrying: [good, names, nul, noPayload] });
      const receipt = await client.receiveNearby(page, intakeFor());
      expect(receipt.outcome).toBe('taken');
      expect(receipt.kept).toBe(1);
      expect(stateOf(client).units['u1']).toBeDefined();
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
      // An event no digest can stand for takes the mismatch path, and holds its number open.
      expect(receipt.refused.map((r) => r.reason)).toEqual(['digest mismatch', 'digest mismatch', 'digest mismatch']);
      expect(receipt.counted).toBe(false);
    });

    it('a signer who signed a bad event closes only their own number, and the event stays out', async () => {
      const client = await myPhone();
      const named = unitBy(sam, 'u2', { id: newCommandId('sam', 'bad:0') });
      const bad = { ...named, payload: { ...named.payload, kind: 7 } } as unknown as AnyEvent;
      const receipt = await client.receiveNearby(await pageOf(sam, 1, [bad]), intakeFor());
      expect(receipt).toMatchObject({ kept: 0, counted: true });
      expect(receipt.refused[0]).toMatchObject({ id: bad.id, retry: false });
      expect(await store.getMany([bad.id])).toEqual([]);
    });

    it('an event the manifest does not name is refused, and holds nothing', async () => {
      const client = await myPhone();
      const named = unitBy(sam, 'u1');
      const extra = unitBy(sam, 'u2');
      const receipt = await client.receiveNearby(await pageOf(sam, 1, [named], { carrying: [named, extra, named] }), intakeFor());
      expect(receipt).toMatchObject({ kept: 1, counted: true });
      expect(receipt.refused).toEqual([{ id: extra.id, reason: 'not in the manifest', retry: false }]);
      expect(await store.getMany([extra.id])).toEqual([]);
    });

    it('a signed event by someone else is refused for good, and counts as here', async () => {
      const client = await myPhone();
      const notTheirs = unitBy(ana, 'u1');
      const receipt = await client.receiveNearby(await pageOf(sam, 1, [notTheirs]), intakeFor());
      expect(receipt).toMatchObject({ kept: 0, counted: true });
      expect(receipt.refused[0]).toMatchObject({ retry: false, reason: "not the signer's event" });
      expect(await store.getMany([notTheirs.id])).toEqual([]);
    });
  });

  describe('a number stays open until the batch is whole', () => {
    it('a subset still checks: its rows are kept and folded, the number stays open, and the rest closes it', async () => {
      const client = await myPhone();
      const [a, b, c] = [unitBy(sam, 'u1'), unitBy(sam, 'u2'), unitBy(sam, 'u3')];
      expect(await client.receiveNearby(await pageOf(sam, 1, [a!, b!, c!], { carrying: [b!] }), intakeFor())).toMatchObject({ kept: 1, counted: false });
      expect(stateOf(client).units['u2']).toBeDefined();
      expect(isCounted(await vectorOf(client), sam.key, 1)).toBe(false);
      // Passing on what it holds without closing it for the next phone.
      expect((await client.nearbyBatchPage(sam.key, 1))!.events.map((e) => e.id)).toEqual([b!.id]);

      expect(await client.receiveNearby(await pageOf(sam, 1, [a!, b!, c!], { carrying: [a!, c!] }), intakeFor())).toMatchObject({ kept: 2, counted: true });
      expect(isCounted(await vectorOf(client), sam.key, 1)).toBe(true);
    });

    it('a manifest with no events counts only when every id is already here', async () => {
      const client = await myPhone();
      const [a, b] = [unitBy(sam, 'u1'), unitBy(sam, 'u2')];
      await client.receiveNearby(await pageOf(sam, 1, [a!], { carrying: [a!] }), intakeFor());
      expect(await client.receiveNearby(await pageOf(sam, 2, [a!, b!], { carrying: [] }), intakeFor())).toMatchObject({ kept: 0, counted: false });
      expect(isCounted(await vectorOf(client), sam.key, 2)).toBe(false);
      await client.receiveNearby(await pageOf(sam, 3, [b!]), intakeFor());
      expect(await client.receiveNearby(await pageOf(sam, 2, [a!, b!], { carrying: [] }), intakeFor())).toMatchObject({ kept: 0, counted: true });
      expect(isCounted(await vectorOf(client), sam.key, 2)).toBe(true);
    });

    it('a manifest of nothing at all counts', async () => {
      const client = await myPhone();
      expect(await client.receiveNearby(await pageOf(sam, 1, []), intakeFor())).toMatchObject({ outcome: 'taken', kept: 0, counted: true });
    });

    it('a digest mismatch never closes an id', async () => {
      const client = await myPhone();
      const real = unitBy(sam, 'u1');
      const tampered = { ...real, payload: { ...real.payload, label: 'changed' } } as AnyEvent;
      const page = await pageOf(sam, 1, [real], { carrying: [tampered] });
      const receipt = await client.receiveNearby(page, intakeFor());
      expect(receipt).toMatchObject({ kept: 0, counted: false });
      expect(receipt.refused).toEqual([{ id: real.id, reason: 'digest mismatch', retry: false }]);
      expect(await store.getMany([real.id])).toEqual([]);
      expect(isCounted(await vectorOf(client), sam.key, 1)).toBe(false);
      // The real copy still gets in, and counts.
      expect(await client.receiveNearby(await pageOf(sam, 1, [real]), intakeFor())).toMatchObject({ kept: 1, counted: true });
    });

    it('a row here under another digest does not close it either', async () => {
      const client = await myPhone();
      const real = unitBy(sam, 'u1');
      await store.commit({ receive: [{ event: { ...real, hlc: encodeHlc(NOW - 5, 0, sam.deviceId) } as AnyEvent, status: 'nearby', via: { batch: 1, key: sam.key } }] });
      expect(await client.receiveNearby(await pageOf(sam, 2, [real], { carrying: [] }), intakeFor())).toMatchObject({ kept: 0, counted: false });
    });

    it('a row here under a later batch of the same signer counts: a restamp moved it', async () => {
      const client = await myPhone();
      const before = unitBy(sam, 'u1');
      const after = { ...before, hlc: encodeHlc(NOW + 99, 0, sam.deviceId) } as AnyEvent;
      await client.receiveNearby(await pageOf(sam, 2, [after]), intakeFor());
      expect(await client.receiveNearby(await pageOf(sam, 1, [before], { carrying: [] }), intakeFor())).toMatchObject({ kept: 0, counted: true });
    });

    it('a row here under another signer\'s later batch does not', async () => {
      const client = await myPhone();
      const before = unitBy(sam, 'u1');
      const after = { ...before, hlc: encodeHlc(NOW + 99, 0, sam.deviceId) } as AnyEvent;
      await store.commit({ receive: [{ event: after, status: 'nearby', via: { batch: 9, key: ana.key } }] });
      expect(await client.receiveNearby(await pageOf(sam, 1, [before], { carrying: [] }), intakeFor())).toMatchObject({ counted: false });
    });

    it('a redacted id counts as here, and is not kept', async () => {
      const client = await myPhone();
      const gone = unitBy(sam, 'u1');
      stateOf(client).redactions[gone.id] = true;
      expect(await client.receiveNearby(await pageOf(sam, 1, [gone], { carrying: [] }), intakeFor())).toMatchObject({ counted: true });
      expect(await client.receiveNearby(await pageOf(sam, 2, [gone]), intakeFor())).toMatchObject({ counted: true, kept: 0 });
      expect(await store.getMany([gone.id])).toEqual([]);
    });

    it('a retry refusal leaves the number open and writes no row, and a later fold lets it in', async () => {
      const client = await myPhone();
      const e = unitBy(sam, 'u1');
      const page = await pageOf(sam, 1, [e]);
      const receipt = await client.receiveNearby(page, intakeFor({ people: () => everyone([]) }));
      expect(receipt).toMatchObject({ outcome: 'taken', kept: 0, counted: false });
      expect(receipt.refused[0]).toMatchObject({ id: e.id, retry: true });
      expect(await store.getMany([e.id])).toEqual([]);
      expect(isCounted(await vectorOf(client), sam.key, 1)).toBe(false);

      expect(await client.receiveNearby(page, intakeFor())).toMatchObject({ kept: 1, counted: true });
    });

    it('a refusal for good counts as here, and writes no row', async () => {
      const client = await myPhone();
      const redaction = eventBy(sam, 'v1.Redacted', { eventId: 'x', reason: 'r' } as never);
      const receipt = await client.receiveNearby(await pageOf(sam, 1, [redaction]), intakeFor());
      expect(receipt).toMatchObject({ kept: 0, counted: true });
      expect(receipt.refused[0]).toMatchObject({ retry: false });
      expect(await store.getMany([redaction.id])).toEqual([]);
    });

    it('a certificate newer than this phone\'s fold can let in what its fold would refuse', async () => {
      // Why: someone added last week is not turned away. The page's own chain goes to whoever answers `people`.
      const client = await myPhone();
      const e = unitBy(sam, 'u1');
      const seen: (string | undefined)[] = [];
      const people = (verdict?: { ok: boolean; holder?: { profileId: string } }) => {
        seen.push(verdict?.holder?.profileId);
        return verdict?.holder?.profileId === 'sam' ? everyone() : everyone([]);
      };
      expect(await client.receiveNearby(await pageOf(sam, 1, [e]), intakeFor({ people }))).toMatchObject({ kept: 1, counted: true });
      expect(seen).toContain('sam');
    });
  });

  describe('the vector', () => {
    it('gaps stay open: a number above a gap goes in a range, and the gap fills later', async () => {
      const client = await myPhone();
      await client.receiveNearby(await pageOf(sam, 1, [unitBy(sam, 'u1')]), intakeFor());
      await client.receiveNearby(await pageOf(sam, 3, [unitBy(sam, 'u3')]), intakeFor());
      expect((await vectorOf(client)).get(sam.key)).toEqual({ mark: 1, ahead: [[3, 3]] });
      await client.receiveNearby(await pageOf(sam, 2, [unitBy(sam, 'u2')]), intakeFor());
      expect((await vectorOf(client)).get(sam.key)).toEqual({ mark: 3, ahead: [] });
    });

    it('a floor moves only its signer\'s mark, and moves it even while the number itself stays open', async () => {
      const client = await myPhone();
      await client.receiveNearby(await pageOf(ana, 1, [unitBy(ana, 'u0')]), intakeFor());
      const missing = unitBy(sam, 'u1');
      const receipt = await client.receiveNearby(await pageOf(sam, 7, [missing], { floor: 5, carrying: [] }), intakeFor());
      expect(receipt.counted).toBe(false);
      expect((await vectorOf(client)).get(sam.key)).toEqual({ mark: 5, ahead: [] });
      expect((await vectorOf(client)).get(ana.key)).toEqual({ mark: 1, ahead: [] });
    });

    it('a floor below the mark changes nothing', async () => {
      const client = await myPhone();
      await client.receiveNearby(await pageOf(sam, 7, [], { floor: 7 }), intakeFor());
      await client.receiveNearby(await pageOf(sam, 8, [], { floor: 2 }), intakeFor());
      expect((await vectorOf(client)).get(sam.key)).toEqual({ mark: 8, ahead: [] });
    });

    it('ranges past their cap record nothing new, though the rows are kept', async () => {
      const client = await myPhone();
      const intake = intakeFor({ maxRanges: 2 });
      await client.receiveNearby(await pageOf(sam, 3, [unitBy(sam, 'a')]), intake);
      await client.receiveNearby(await pageOf(sam, 6, [unitBy(sam, 'b')]), intake);
      const nine = unitBy(sam, 'c');
      expect(await client.receiveNearby(await pageOf(sam, 9, [nine]), intake)).toMatchObject({ kept: 1, counted: true });
      expect(await statusOf(store, nine.id)).toBe('nearby');
      expect((await vectorOf(client)).get(sam.key)).toEqual({ mark: 0, ahead: [[3, 3], [6, 6]] });
      // What fills or extends a range still counts.
      await client.receiveNearby(await pageOf(sam, 4, [unitBy(sam, 'd')]), intake);
      expect((await vectorOf(client)).get(sam.key)).toEqual({ mark: 0, ahead: [[3, 4], [6, 6]] });
    });

    it('is written as parseVector reads it, and lives in device meta', async () => {
      const client = await myPhone();
      await client.receiveNearby(await pageOf(sam, 1, []), intakeFor());
      const raw = await store.meta(`nearbyVector:${ORG}/${LANG}`);
      expect(parseVector(JSON.parse(raw!), { maxRanges: 32 })?.get(sam.key)).toEqual({ mark: 1, ahead: [] });
    });

    it('a bad vector row costs re-sends, and nothing else', async () => {
      const client = await myPhone();
      await store.setMeta(`nearbyVector:${ORG}/${LANG}`, '{not json');
      expect(await vectorOf(client)).toEqual(new Map());
      await store.setMeta(`nearbyVector:${ORG}/${LANG}`, '{"short":{"mark":1,"ahead":[]}}');
      expect(await vectorOf(client)).toEqual(new Map());
    });
  });

  describe('what is kept of a manifest', () => {
    it('keeps it when a row was kept, or when it is the signer\'s newest here, and otherwise not', async () => {
      const client = await myPhone();
      const [a, b] = [unitBy(sam, 'u1'), unitBy(sam, 'u2')];
      await client.receiveNearby(await pageOf(sam, 5, [a!]), intakeFor());
      // Older, and every row already here.
      await client.receiveNearby(await pageOf(sam, 2, [a!]), intakeFor());
      expect((await store.batchKeys(ORG, LANG)).map((x) => x.n)).toEqual([5]);
      // Newer, with no row of its own: its floor must travel on.
      await client.receiveNearby(await pageOf(sam, 6, [a!], { floor: 1 }), intakeFor());
      expect((await store.batchKeys(ORG, LANG)).map((x) => x.n)).toEqual([5, 6]);
      // Older, with a row.
      await client.receiveNearby(await pageOf(sam, 3, [b!]), intakeFor());
      expect((await store.batchKeys(ORG, LANG)).map((x) => x.n)).toEqual([3, 5, 6]);
    });
  });

  describe('a phone\'s own key', () => {
    it('a manifest it signed, coming back, moves its counter, and a number another key states never does', async () => {
      const client = phone(server, store, sam);
      await client.load();
      const countKey = `nearbyCount:${ORG}/${LANG}:${sam.key}`;
      await client.receiveNearby(await pageOf(ana, 40, [unitBy(ana, 'u1')]), intakeFor({ ownKey: sam.key }));
      expect(await store.meta(countKey)).toBeUndefined();

      await client.receiveNearby(await pageOf(sam, 4, [unitBy(sam, 'u2')]), intakeFor({ ownKey: sam.key }));
      expect(await store.meta(countKey)).toBe('4');
      await client.receiveNearby(await pageOf(sam, 2, [unitBy(sam, 'u3')]), intakeFor({ ownKey: sam.key }));
      expect(await store.meta(countKey)).toBe('4');

      await client.append('v1.UnitAdded', { unitId: 'u4', parentUnitId: null, kind: 'passage', label: 'x', order: 'a' });
      await client.signUnsigned(signerOf(sam));
      expect((await store.batchKeys(ORG, LANG)).map((b) => b.n)).toContain(5);
    });

    it('a row of its own that comes back stays pending and keeps its place', async () => {
      const client = phone(server, store, sam);
      await client.load();
      const own = await client.append('v1.UnitAdded', { unitId: 'u1', parentUnitId: null, kind: 'passage', label: 'x', order: 'a' });
      await client.signUnsigned(signerOf(sam));
      const page = await client.nearbyBatchPage(sam.key, 1);
      expect(page!.events).toHaveLength(1);
      await store.commit({ meta: { [`nearbyVector:${ORG}/${LANG}`]: '{}' } });
      expect(await client.receiveNearby(page!, intakeFor({ ownKey: sam.key }))).toMatchObject({ kept: 0, counted: true });
      expect(await rowOf(store, own.id)).toMatchObject({ status: 'pending', via: { batch: 1, key: sam.key } });
    });
  });

  describe('a row already here', () => {
    it('is not downgraded, whatever its status', async () => {
      // Trap: `putOn`'s upsert overwrites status. A nearby copy must never turn a confirmed, pending or refused row back.
      const client = await myPhone();
      const [confirmed, pending, rejected] = [unitBy(sam, 'u1'), unitBy(sam, 'u2'), unitBy(sam, 'u3')];
      await store.commit({ events: [
        { event: { ...confirmed!, serverSeq: 1 } as AnyEvent, status: 'confirmed' },
        { event: pending!, status: 'pending' },
        { event: rejected!, status: 'rejected', rejectReason: 'no' }
      ] });
      await client.load();
      const receipt = await client.receiveNearby(await pageOf(sam, 1, [confirmed!, pending!, rejected!]), intakeFor());
      expect(receipt).toMatchObject({ kept: 0, counted: true });
      expect(await rowOf(store, confirmed!.id)).toMatchObject({ status: 'confirmed' });
      expect((await rowOf(store, confirmed!.id))!.via).toBeUndefined();
      expect(await rowOf(store, pending!.id)).toMatchObject({ status: 'pending' });
      expect(await rowOf(store, rejected!.id)).toMatchObject({ status: 'rejected', rejectReason: 'no' });
      expect(await store.pendingCount(ORG, LANG)).toBe(1);
    });

    it('the same id in another stream is here, and takes nothing from this one', async () => {
      // `events.id` is unique across streams: a row planted here under an id the server later sends in another stream would block it.
      const client = await myPhone();
      const e = unitBy(sam, 'u1');
      await store.commit({ events: [{ event: { ...e, streamId: 'other' } as AnyEvent, status: 'confirmed' }] });
      expect(await client.receiveNearby(await pageOf(sam, 1, [e]), intakeFor())).toMatchObject({ kept: 0, counted: false });
      expect(await rowOf(store, e.id)).toMatchObject({ status: 'confirmed' });
      expect(stateOf(client).units['u1']).toBeUndefined();
    });
  });

  describe('the door\'s facts', () => {
    it('two events on one page cannot both take a slot', async () => {
      const client = await myPhone();
      const recordingId = newCommandId('sam', 'r1');
      const first = eventBy(sam, 'v1.RecordingAdded', { recordingId, unitId: 'u1', kind: 'target', cards: [{ hash: 'h1', durationMs: 5 }] });
      const second = eventBy(sam, 'v1.RecordingAdded', { recordingId, unitId: 'u1', kind: 'target', cards: [{ hash: 'h2', durationMs: 5 }] });
      const receipt = await client.receiveNearby(await pageOf(sam, 1, [first, second]), intakeFor());
      expect(receipt).toMatchObject({ kept: 1, counted: true });
      expect(receipt.refused[0]).toMatchObject({ id: second.id, retry: false });
    });

    it('a slot taken in the fold refuses the next, for good', async () => {
      const client = await myPhone();
      const recordingId = newCommandId('sam', 'r1');
      await client.receiveNearby(await pageOf(sam, 1, [eventBy(sam, 'v1.RecordingAdded', { recordingId, unitId: 'u1', kind: 'target', cards: [{ hash: 'h1', durationMs: 5 }] })]), intakeFor());
      const again = eventBy(sam, 'v1.RecordingAdded', { recordingId, unitId: 'u1', kind: 'target', cards: [{ hash: 'h2', durationMs: 5 }] });
      const receipt = await client.receiveNearby(await pageOf(sam, 2, [again]), intakeFor());
      expect(receipt).toMatchObject({ kept: 0, counted: true });
      expect(await store.getMany([again.id])).toEqual([]);
    });

    it('a withdrawal from someone other than the author is refused for good, by what the fold knows', async () => {
      const client = await myPhone();
      const reviewId = newCommandId('sam', 'rv1');
      await client.receiveNearby(await pageOf(sam, 1, [eventBy(sam, 'v1.ReviewRecorded', { reviewId, takeId: 't1', kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'slower' })]), intakeFor());
      const receipt = await client.receiveNearby(await pageOf(ana, 1, [eventBy(ana, 'v1.ReviewWithdrawn', { reviewId })]), intakeFor());
      expect(receipt).toMatchObject({ kept: 0, counted: true });
      expect(receipt.refused[0]).toMatchObject({ reason: 'a review is withdrawn only by its author', retry: false });
      expect(stateOf(client).withdrawnReviews[reviewId]).toBeUndefined();
    });
  });

  describe('clocks', () => {
    it('receives a clock within 5 minutes of this phone\'s', async () => {
      const wall = wallClock();
      const client = await myPhone({ now: wall.read });
      const near = unitBy(sam, 'u1', { at: NOW + 60_000 });
      const receipt = await client.receiveNearby(await pageOf(sam, 1, [near]), intakeFor());
      expect(receipt.farAhead).toBeUndefined();
      const next = await client.append('v1.UnitAdded', { unitId: 'u2', parentUnitId: null, kind: 'passage', label: 'x', order: 'a' });
      expect(next.hlc > near.hlc).toBe(true);
    });

    it('keeps a stamp far ahead but does not take on its clock, and names the author for the screen', async () => {
      // Traps: a bad clock would spread to the whole team; and M's 2035 stamp would win every register.
      const wall = wallClock();
      const client = await myPhone({ now: wall.read });
      const far = unitBy(sam, 'u1', { at: NOW + 365 * 24 * 3_600_000 });
      const receipt = await client.receiveNearby(await pageOf(sam, 1, [far]), intakeFor());
      expect(receipt).toMatchObject({ kept: 1, counted: true, farAhead: { actorId: 'sam', hlc: far.hlc } });
      expect(await statusOf(store, far.id)).toBe('nearby');
      expect(client.nearbyFarAhead).toEqual([{ actorId: 'sam', hlc: far.hlc }]);
      const next = await client.append('v1.UnitAdded', { unitId: 'u2', parentUnitId: null, kind: 'passage', label: 'x', order: 'a' });
      expect(next.hlc < far.hlc).toBe(true);
      // Nor was it kept for the next launch.
      expect((await store.meta(`hlc:${mine.deviceId}`))! < far.hlc).toBe(true);
    });

    it('a phone whose own clock already ran ahead compares with its last stamp, so this stamp is not far', async () => {
      const wall = wallClock(NOW + 3_000_000_000);
      const client = await myPhone({ now: wall.read });
      await client.append('v1.UnitAdded', { unitId: 'u0', parentUnitId: null, kind: 'passage', label: 'x', order: 'a' });
      wall.now = NOW;
      const receipt = await client.receiveNearby(await pageOf(sam, 1, [unitBy(sam, 'u1', { at: NOW + 3_000_000_000 })]), intakeFor());
      expect(receipt.farAhead).toBeUndefined();
    });
  });

  describe('a revoked key', () => {
    const listOf = (who: Teammate, at: number): RevocationList => ({ v: 1, kid: 'k1', orgId: ORG, seq: 1, keys: [[who.key, who.profileId, at]] });

    it('earlier work is accepted, and later work refused one by one, and the number closes', async () => {
      const client = await myPhone();
      const before = unitBy(sam, 'u1', { at: NOW - 10 });
      const after = unitBy(sam, 'u2', { at: NOW + 10 });
      const receipt = await client.receiveNearby(await pageOf(sam, 1, [before, after]), intakeFor({ revoked: listOf(sam, NOW) }));
      expect(receipt).toMatchObject({ kept: 1, counted: true });
      expect(receipt.refused[0]).toMatchObject({ id: after.id, reason: 'dated after its key was revoked', retry: false });
      expect(await statusOf(store, before.id)).toBe('nearby');
      expect(await store.getMany([after.id])).toEqual([]);
    });

    it('another person on that key is not refused', async () => {
      const client = await myPhone();
      const list: RevocationList = { v: 1, kid: 'k1', orgId: ORG, seq: 1, keys: [[sam.key, 'someone-else', NOW - 1_000]] };
      expect(await client.receiveNearby(await pageOf(sam, 1, [unitBy(sam, 'u1')]), intakeFor({ revoked: list }))).toMatchObject({ kept: 1 });
    });

    it('with no list, nothing is refused', async () => {
      const client = await myPhone();
      expect(await client.receiveNearby(await pageOf(sam, 1, [unitBy(sam, 'u1')]), intakeFor())).toMatchObject({ kept: 1 });
    });
  });

  it('takes the stream\'s turn: pages at once run one at a time, and each commits whole', async () => {
    const client = await myPhone();
    const pages = await Promise.all([1, 2, 3].map(async (n) => pageOf(sam, n, [unitBy(sam, `u${n}`)])));
    const out = await Promise.all(pages.map((p) => client.receiveNearby(p, intakeFor())));
    expect(out.every((r) => r.counted)).toBe(true);
    expect((await vectorOf(client)).get(sam.key)).toEqual({ mark: 3, ahead: [] });
  });

  it('a store that fails leaves the fold as the log says, and the error is the caller\'s', async () => {
    const w = watched(store);
    const client = phone(server, w.store, mine);
    await client.load();
    const page = await pageOf(sam, 1, [unitBy(sam, 'u1')]);
    w.fail.commit = (b) => !!b.receive?.length;
    await expect(client.receiveNearby(page, intakeFor())).rejects.toThrow('disk full');
    expect(stateOf(client).units['u1']).toBeUndefined();
    expect(isCounted(await vectorOf(client), sam.key, 1)).toBe(false);
  });

  it('refuses to take a page before the fold is loaded', async () => {
    const client = phone(server, store, mine);
    await expect(client.receiveNearby(await pageOf(sam, 1, []), intakeFor())).rejects.toThrow('call load() first');
  });

  it('asks the server for nothing, offline or not', async () => {
    const client = await myPhone();
    const pulls = server.pullCalls;
    server.offline = true;
    expect(await client.receiveNearby(await pageOf(sam, 1, [unitBy(sam, 'u1')]), intakeFor())).toMatchObject({ kept: 1 });
    expect(server.pullCalls).toBe(pulls);
  });
});

describe.each(STORES)('receiving claims on the %s store', (_name, make) => {
  let sam: Teammate;
  let mine: Teammate;
  let store: EventStore;
  let server: FakeServer;

  beforeEach(async () => {
    sam = await teammate('sam');
    mine = await teammate('me');
    store = make();
    server = new FakeServer();
  });

  async function myPhone() {
    const client = phone(server, store, mine);
    await client.load();
    return client;
  }
  /** An old event the server holds: its id names nobody. */
  const oldUnit = (name: string, who: Teammate = sam) => unitBy(who, name, { id: `${name}-old:0` });

  it('folds what the Worker vouched for as nearby, with via naming the claimer, and moves only the claims mark', async () => {
    const client = await myPhone();
    const peerKey = fakeSigner('claimer').publicKey;
    const e = oldUnit('u1');
    const receipt = await client.receiveNearby(await claimsOf([e], () => 12), intakeFor({ peerKey }));
    expect(receipt).toMatchObject({ outcome: 'taken', kept: 1, counted: false });
    const via: NearbyVia = { claim: { key: peerKey, seq: 12 } };
    expect(await rowOf(store, e.id)).toMatchObject({ status: 'nearby', via });
    // The seq goes in via: a row holding one is skipped on refold, and its copy here is not confirmed.
    expect('serverSeq' in (await rowOf(store, e.id))!.event).toBe(false);
    expect(await store.meta(`nearbyClaimed:${ORG}/${LANG}`)).toBe('12');
    expect((await client.nearbyHave()).claimedSeq).toBe(12);
    // Pulled events and claims never move the vector; nor the cursor.
    expect(await vectorOf(client)).toEqual(new Map());
    expect(await store.cursor(ORG, LANG)).toBe(0);
    expect(stateOf(client).units['u1']).toBeDefined();
  });

  it('a mark does not go back', async () => {
    const client = await myPhone();
    await client.receiveNearby(await claimsOf([oldUnit('u1')], () => 12), intakeFor());
    await client.receiveNearby(await claimsOf([oldUnit('u2')], () => 3), intakeFor());
    expect((await client.nearbyHave()).claimedSeq).toBe(12);
  });

  it('a claim with no valid attestation is refused', async () => {
    const client = await myPhone();
    const e = oldUnit('u1');
    const page = await claimsOf([e], () => 1);
    const forged = await fakeSigner('forger').sign(nearbyBytes('attest', page.text));
    expect(await client.receiveNearby({ ...page, sig: forged }, intakeFor())).toMatchObject({ outcome: 'dropped', reason: 'bad attestation' });
    expect(await client.receiveNearby({ ...page, text: page.text.replace('org1', 'org2') }, intakeFor())).toMatchObject({ outcome: 'dropped', reason: 'bad attestation' });
    expect(await client.receiveNearby({ ...page, text: 'nope' }, intakeFor())).toMatchObject({ outcome: 'dropped', reason: 'bad attestation' });
    expect(await client.receiveNearby(page, intakeFor({ rootKeys: new Map() }))).toMatchObject({ outcome: 'dropped', reason: 'unknown attestation key' });
    expect(await store.getMany([e.id])).toEqual([]);
    expect(await store.meta(`nearbyClaimed:${ORG}/${LANG}`)).toBeUndefined();
  });

  it('an event not in its rows, or a digest or seq that is not, is refused and moves no mark', async () => {
    const client = await myPhone();
    const attested = oldUnit('u1');
    const other = oldUnit('u2');
    const changed = { ...attested, payload: { ...attested.payload, label: 'changed' } } as AnyEvent;
    const wrongSeq = { ...attested, serverSeq: 99 } as AnyEvent;
    const receipt = await client.receiveNearby(await claimsOf([attested], () => 5, [other, changed, wrongSeq]), intakeFor());
    expect(receipt).toMatchObject({ kept: 0 });
    expect(receipt.refused.map((r) => r.reason)).toEqual(['not attested', 'digest mismatch', 'digest mismatch']);
    expect(await store.getMany([attested.id, other.id])).toEqual([]);
    expect(await store.meta(`nearbyClaimed:${ORG}/${LANG}`)).toBeUndefined();
  });

  it('a subset of the attested rows is fine, and a seq on the wire must match', async () => {
    const client = await myPhone();
    const [a, b] = [oldUnit('u1'), oldUnit('u2')];
    const receipt = await client.receiveNearby(await claimsOf([a, b], (_e, at) => at + 1, [{ ...b, serverSeq: 2 } as AnyEvent]), intakeFor());
    expect(receipt).toMatchObject({ kept: 1 });
    expect((await client.nearbyHave()).claimedSeq).toBe(2);
    expect('serverSeq' in (await rowOf(store, b.id))!.event).toBe(false);
  });

  it('a door refusal at steps 9 to 11 cannot happen: the server already held it, and a reviewer added since is not refused', async () => {
    const client = await myPhone();
    const review = eventBy(sam, 'v1.ReviewWithdrawn', { reviewId: 'somebody-elses' }, { id: 'old-review:0' });
    const notListed = { privilegesIn: () => new Set<never>(), languageListed: () => false };
    const receipt = await client.receiveNearby(await claimsOf([review, oldUnit('u1')], (_e, at) => at + 1), intakeFor({ people: () => notListed }));
    expect(receipt).toMatchObject({ kept: 2 });
    expect(receipt.refused).toEqual([]);
  });

  it('steps 1 to 8 and 12 still hold under a claim', async () => {
    const client = await myPhone();
    const redaction = eventBy(sam, 'v1.Redacted', { eventId: 'x', reason: 'r' } as never, { id: 'old-redaction:0' });
    const wrongStream = { ...oldUnit('u1'), streamId: 'other' } as AnyEvent;
    const someoneElses = unitBy(sam, 'u3', { id: newCommandId('ana', 'x:0') });
    const taken = eventBy(sam, 'v1.RecordingAdded', { recordingId: 'r1', unitId: 'u1', kind: 'target', cards: [{ hash: 'h', durationMs: 5 }] }, { id: 'old-take:0' });
    const takenAgain = eventBy(sam, 'v1.RecordingAdded', { recordingId: 'r1', unitId: 'u1', kind: 'target', cards: [{ hash: 'i', durationMs: 5 }] }, { id: 'old-take:1' });
    const receipt = await client.receiveNearby(await claimsOf([redaction, wrongStream, someoneElses, taken, takenAgain], (_e, at) => at + 1), intakeFor());
    expect(receipt).toMatchObject({ kept: 1 });
    expect(receipt.refused.map((r) => r.id).sort()).toEqual([redaction.id, wrongStream.id, someoneElses.id, takenAgain.id].sort());
    // Refused for good: one that came with a good digest still moves the mark, since asking again changes nothing.
    expect((await client.nearbyHave()).claimedSeq).toBe(5);
  });

  it('a row already here stays, whichever way it came', async () => {
    const client = await myPhone();
    const e = unitBy(sam, 'u1');
    await client.receiveNearby(await pageOf(sam, 1, [e]), intakeFor());
    const before = await rowOf(store, e.id);
    expect(await client.receiveNearby(await claimsOf([e], () => 4), intakeFor())).toMatchObject({ kept: 0 });
    expect(await rowOf(store, e.id)).toEqual(before);
    expect((await client.nearbyHave()).claimedSeq).toBe(4);

    const differentClock = { ...oldUnit('u2'), hlc: encodeHlc(NOW + 5, 0, sam.deviceId) } as AnyEvent;
    await store.commit({ events: [{ event: { ...differentClock, hlc: encodeHlc(NOW - 5, 0, sam.deviceId) } as AnyEvent, status: 'pending' }] });
    expect(await client.receiveNearby(await claimsOf([differentClock], () => 5), intakeFor())).toMatchObject({ kept: 0 });
    expect((await rowOf(store, differentClock.id))!.status).toBe('pending');
  });

  it('a batch whose every row came by claim counts, and keeps no manifest unless it is the signer\'s newest', async () => {
    const client = await myPhone();
    const e = unitBy(sam, 'u1');
    await client.receiveNearby(await claimsOf([e], () => 4), intakeFor());
    await client.receiveNearby(await pageOf(sam, 9, []), intakeFor());
    expect(await client.receiveNearby(await pageOf(sam, 2, [e], { carrying: [] }), intakeFor())).toMatchObject({ kept: 0, counted: true });
    expect((await store.batchKeys(ORG, LANG)).map((b) => b.n)).toEqual([9]);
  });

  it('a claim is first-hand: a row held by claim goes on by neither claim nor batch', async () => {
    // A receiver stores no attestation, so a row it holds by claim goes nowhere by claim, and carries no batch either.
    const client = await myPhone();
    const e = unitBy(sam, 'u1');
    await client.receiveNearby(await claimsOf([e], () => 4), intakeFor());
    expect(await client.nearbyNextClaims({ cursor: 0, claimedSeq: 0 })).toBeNull();
    expect(await store.attestedUpTo(ORG, LANG)).toEqual([]);
  });
});

describe.each(STORES)('the budget per signer on the %s store', (_name, make) => {
  let sam: Teammate;
  let ana: Teammate;
  let mine: Teammate;
  let store: EventStore;
  let server: FakeServer;

  beforeEach(async () => {
    sam = await teammate('sam');
    ana = await teammate('ana');
    mine = await teammate('me');
    store = make();
    server = new FakeServer();
  });
  const budget = (maxRows: number, maxBytes = 50_000_000) => ({ maxRows, maxBytes });
  const units = (who: Teammate, n: number, tag = 'u') => Array.from({ length: n }, (_, i) => unitBy(who, `${tag}${i}`));
  async function myPhone() {
    const client = phone(server, store, mine);
    await client.load();
    return client;
  }

  it('drops an over-budget page before any signature work, with its number left open, and writes nothing', async () => {
    const client = await myPhone();
    await client.receiveNearby(await pageOf(sam, 1, units(sam, 3)), intakeFor({ budget: budget(3) }));
    const more = unitBy(sam, 'x');
    const verify = vi.fn(() => true);
    const receipt = await client.receiveNearby(await pageOf(sam, 2, [more]), intakeFor({ budget: budget(3), verify }));
    expect(receipt).toMatchObject({ outcome: 'dropped', overBudget: true, kept: 0, counted: false });
    expect(verify).not.toHaveBeenCalled();
    expect(await store.getMany([more.id])).toEqual([]);
    expect(isCounted(await vectorOf(client), sam.key, 2)).toBe(false);
  });

  it('holds per signer, and by bytes too', async () => {
    const client = await myPhone();
    await client.receiveNearby(await pageOf(sam, 1, units(sam, 3)), intakeFor({ budget: budget(3) }));
    expect(await client.receiveNearby(await pageOf(ana, 1, [unitBy(ana, 'a')]), intakeFor({ budget: budget(3) }))).toMatchObject({ kept: 1 });
    const big = unitBy(sam, 'big');
    expect(await client.receiveNearby(await pageOf(sam, 3, [big]), intakeFor({ budget: budget(100, JSON.stringify(big).length) }))).toMatchObject({ overBudget: true });
  });

  it('a claim flood naming Sam does not stop Sam\'s batches, because claims spend the claimer\'s budget', async () => {
    // Why: a teammate must not be able to spend Sam's budget, or anyone could silence Sam with what the server already holds.
    const client = await myPhone();
    const claimer = fakeSigner('mallory').publicKey;
    const flood = Array.from({ length: 4 }, (_, i) => unitBy(sam, `f${i}`, { id: `flood-${i}:0` }));
    await client.receiveNearby(await claimsOf(flood, (_e, at) => at + 1), intakeFor({ peerKey: claimer, budget: budget(4) }));
    const over = unitBy(sam, 'f9', { id: 'flood-9:0' });
    expect(await client.receiveNearby(await claimsOf([over], () => 9), intakeFor({ peerKey: claimer, budget: budget(4) }))).toMatchObject({ overBudget: true });

    expect(await client.receiveNearby(await pageOf(sam, 1, units(sam, 4)), intakeFor({ budget: budget(4) }))).toMatchObject({ kept: 4, counted: true });
    // Another claimer's claims are not stopped by Mallory's either.
    expect(await client.receiveNearby(await claimsOf([over], () => 9), intakeFor({ peerKey: fakeSigner('honest').publicKey, budget: budget(4) }))).toMatchObject({ kept: 1 });
  });

  it('counts from the store when a session starts, so it holds across sessions', async () => {
    const client = await myPhone();
    await client.receiveNearby(await pageOf(sam, 1, units(sam, 3)), intakeFor({ budget: budget(3) }));
    const later = phone(server, store, mine);
    await later.load();
    await later.startNearbyBudget();
    expect(await later.receiveNearby(await pageOf(sam, 2, [unitBy(sam, 'x')]), intakeFor({ budget: budget(3) }))).toMatchObject({ overBudget: true });
  });

  it('unknown types count, and pass the door as a pull would keep them', async () => {
    const client = await myPhone();
    const future = eventBy(sam, 'v9.FromTheFuture' as never, { thing: 1 } as never);
    expect(await client.receiveNearby(await pageOf(sam, 1, [future]), intakeFor({ budget: budget(1) }))).toMatchObject({ kept: 1, counted: true });
    expect(await statusOf(store, future.id)).toBe('nearby');
    expect(await client.receiveNearby(await pageOf(sam, 2, [unitBy(sam, 'x')]), intakeFor({ budget: budget(1) }))).toMatchObject({ overBudget: true });
  });

  it('an empty manifest still gets through at the budget, so its floor travels', async () => {
    const client = await myPhone();
    await client.receiveNearby(await pageOf(sam, 1, units(sam, 3)), intakeFor({ budget: budget(3) }));
    expect(await client.receiveNearby(await pageOf(sam, 5, [], { floor: 4 }), intakeFor({ budget: budget(3) }))).toMatchObject({ outcome: 'taken', counted: true });
    expect((await vectorOf(client)).get(sam.key)?.mark).toBe(5);
  });

  it('the number stays open over budget, and closes after the rows settle', async () => {
    const client = await myPhone();
    // Sam's phone sends the rows up, and this phone pulls them over its nearby copies.
    const samsPhone = phone(server, new MemoryStore(), sam);
    await samsPhone.load();
    const first = await samsPhone.append('v1.UnitAdded', { unitId: 'u1', parentUnitId: null, kind: 'passage', label: 'x', order: 'a' });
    await samsPhone.signUnsigned(signerOf(sam));
    await samsPhone.append('v1.UnitAdded', { unitId: 'u2', parentUnitId: null, kind: 'passage', label: 'x', order: 'b' });
    await samsPhone.signUnsigned(signerOf(sam));
    const intake = intakeFor({ budget: budget(1) });
    const one = (await samsPhone.nearbyBatchPage(sam.key, 1))!;
    const two = (await samsPhone.nearbyBatchPage(sam.key, 2))!;
    expect(await client.receiveNearby(one, intake)).toMatchObject({ kept: 1, counted: true });
    expect(await client.receiveNearby(two, intake)).toMatchObject({ overBudget: true });
    expect(isCounted(await vectorOf(client), sam.key, 2)).toBe(false);

    await samsPhone.sync();
    await client.sync();
    expect(await rowOf(store, first.id)).toMatchObject({ status: 'confirmed' });
    expect(await store.nearbyCount(ORG, LANG)).toBe(0);
    // Both rows are here now by pull. Its page is whole, with the budget free again.
    expect(await client.receiveNearby(two, intake)).toMatchObject({ outcome: 'taken', kept: 0, counted: true });
    expect(isCounted(await vectorOf(client), sam.key, 2)).toBe(true);
  });
});

describe.each(STORES)('an undo that lands before its target, on the %s store', (_name, make) => {
  let sam: Teammate;
  let mallory: Teammate;
  let mine: Teammate;
  let store: EventStore;
  let server: FakeServer;

  beforeEach(async () => {
    sam = await teammate('sam');
    mallory = await teammate('mallory');
    mine = await teammate('me');
    store = make();
    server = new FakeServer();
  });
  async function myPhone() {
    const client = phone(server, store, mine);
    await client.load();
    return client;
  }
  const oldReview = (who: Teammate, reviewId: string) => eventBy(who, 'v1.ReviewRecorded', { reviewId, takeId: 't1', kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'slower' }, { id: `${reviewId}-event:0` });

  it('a backdated withdrawal of an unbound review is marked refused when the review lands, and the slot opens for the author\'s own', async () => {
    const client = await myPhone();
    const review = oldReview(sam, 'rv-old');
    const forged = eventBy(mallory, 'v1.ReviewWithdrawn', { reviewId: 'rv-old' }, { at: NOW - 100 });
    // Unknown target, unbound: it passes.
    expect(await client.receiveNearby(await pageOf(mallory, 1, [forged]), intakeFor())).toMatchObject({ kept: 1 });
    expect(stateOf(client).withdrawnReviews['rv-old']?.by).toBe('mallory');

    const real = eventBy(sam, 'v1.ReviewWithdrawn', { reviewId: 'rv-old' }, { at: NOW + 100 });
    await client.receiveNearby(await pageOf(sam, 1, [real]), intakeFor());
    // The earliest holds the slot, so the author's real withdrawal counts for nothing yet.
    expect(stateOf(client).withdrawnReviews['rv-old']?.by).toBe('mallory');

    expect(await client.receiveNearby(await claimsOf([review], () => 3), intakeFor())).toMatchObject({ kept: 1 });
    expect(await rowOf(store, forged.id)).toMatchObject({ status: 'rejected', rejectReason: 'a review is withdrawn only by its author', via: { batch: 1, key: mallory.key } });
    expect(await rowOf(store, real.id)).toMatchObject({ status: 'nearby' });
    expect(stateOf(client).withdrawnReviews['rv-old']?.by).toBe('sam');
    expect(stateOf(client).kindReviews['rv-old']).toBeDefined();
  });

  it('a note, the same way', async () => {
    const client = await myPhone();
    const forged = eventBy(mallory, 'v1.NoteWithdrawn', { noteId: 'n-old' });
    await client.receiveNearby(await pageOf(mallory, 1, [forged]), intakeFor());
    const note = eventBy(sam, 'v1.NoteAdded', { noteId: 'n-old', unitId: 'u1', anchor: { kind: 'passage' }, text: 'hm' }, { id: 'n-old-event:0' });
    await client.receiveNearby(await claimsOf([note], () => 3), intakeFor());
    expect(await rowOf(store, forged.id)).toMatchObject({ status: 'rejected' });
    expect(stateOf(client).withdrawnNotes['n-old']).toBeUndefined();
  });

  it('an undo of an override from someone without override_checkpoints, when the override lands, and it can come back', async () => {
    const client = await myPhone();
    const undo = eventBy(mallory, 'v1.DepartureUndone', { departureId: 'dep-old' });
    const noOverride = everyone(['translate', 'review']);
    await client.receiveNearby(await pageOf(mallory, 1, [undo]), intakeFor({ people: () => noOverride }));
    const override = eventBy(sam, 'v1.DepartureRecorded', { departureId: 'dep-old', unitId: 'u1', type: 'override', stepId: 's1', reason: 'r' }, { id: 'dep-old-event:0' });
    await client.receiveNearby(await claimsOf([override], () => 3), intakeFor({ people: () => noOverride }));
    expect(await rowOf(store, undo.id)).toMatchObject({ status: 'rejected', rejectReason: 'undoing an override needs override_checkpoints' });
    expect(stateOf(client).undoneDepartures['dep-old']).toBeUndefined();
    // Reason can change: a fold that learns of the privilege lets it back in on Try again.
    expect(await client.retryNearby({ people: () => everyone() })).toBe(1);
    expect(await statusOf(store, undo.id)).toBe('nearby');
  });

  it('an undo and its target on one page have one author, so the undo stands', async () => {
    const client = await myPhone();
    const reviewId = newCommandId('sam', 'rv:0');
    const withdrawn = eventBy(sam, 'v1.ReviewWithdrawn', { reviewId }, { at: NOW - 5 });
    const review = eventBy(sam, 'v1.ReviewRecorded', { reviewId, takeId: 't1', kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'x' }, { at: NOW });
    expect(await client.receiveNearby(await pageOf(sam, 1, [withdrawn, review]), intakeFor())).toMatchObject({ kept: 2, counted: true });
    expect(await statusOf(store, withdrawn.id)).toBe('nearby');
    expect(stateOf(client).withdrawnReviews[reviewId]?.by).toBe('sam');
  });

  it('a right undo stays, and an ordinary page reads no nearby rows at all', async () => {
    const w = watched(store);
    const client = phone(server, w.store, mine);
    await client.load();
    const real = eventBy(sam, 'v1.ReviewWithdrawn', { reviewId: 'rv-mine' }, { at: NOW - 10 });
    await client.receiveNearby(await pageOf(sam, 1, [real, unitBy(sam, 'u1')]), intakeFor());
    expect(w.calls['nearbyPage']).toBeUndefined();
    await client.receiveNearby(await claimsOf([oldReview(sam, 'rv-mine')], () => 3), intakeFor());
    expect(w.calls['nearbyPage']).toBeGreaterThan(0);
    expect(await statusOf(store, real.id)).toBe('nearby');
  });

  it('a claim of an undo is not judged again: the server held it', async () => {
    const client = await myPhone();
    const claimedUndo = eventBy(mallory, 'v1.ReviewWithdrawn', { reviewId: 'rv-claimed' }, { id: 'undo-old:0' });
    await client.receiveNearby(await claimsOf([claimedUndo], () => 2), intakeFor());
    await client.receiveNearby(await claimsOf([oldReview(sam, 'rv-claimed')], () => 3), intakeFor());
    expect(await statusOf(store, claimedUndo.id)).toBe('nearby');
  });
});

describe.each(STORES)('Try again and a new reducer, on the %s store', (_name, make) => {
  let sam: Teammate;
  let mine: Teammate;
  let store: EventStore;
  let server: FakeServer;

  beforeEach(async () => {
    sam = await teammate('sam');
    mine = await teammate('me');
    store = make();
    server = new FakeServer();
  });
  async function myPhone() {
    const client = phone(server, store, mine);
    await client.load();
    return client;
  }
  const refused = (e: AnyEvent, via: NearbyVia = { batch: 1, key: sam.key }): LocalEvent => ({ event: e, status: 'rejected', rejectReason: 'not allowed', via });

  it('Try again runs the door, and moves a row back to nearby, never pending', async () => {
    const client = await myPhone();
    const e = unitBy(sam, 'u1');
    await store.commit({ events: [refused(e)] });
    await client.load();
    expect(await client.retryNearby({ people: () => everyone() })).toBe(1);
    expect(await rowOf(store, e.id)).toMatchObject({ status: 'nearby', via: { batch: 1, key: sam.key } });
    expect((await rowOf(store, e.id))!.rejectReason).toBeUndefined();
    expect(await store.pendingCount(ORG, LANG)).toBe(0);
    expect(stateOf(client).units['u1']).toBeDefined();
  });

  it('a nearby row naming this person cannot be pushed as them, by retryRejected or Try again', async () => {
    // Trap: its reason reads as UNKNOWN, so `requeue` would have put a forged event in pending.
    const client = phone(server, store, sam);
    await client.load();
    const forged = unitBy(sam, 'u1');
    await store.commit({ events: [refused(forged)] });
    expect(await client.retryRejected()).toBe(0);
    expect(await client.retryNearby({ people: () => everyone() })).toBe(1);
    expect(await store.pendingCount(ORG, LANG)).toBe(0);
    await client.sync();
    expect(server.stream(ORG, LANG)).toEqual([]);
  });

  it('what the door still refuses stays refused', async () => {
    const client = await myPhone();
    const e = unitBy(sam, 'u1');
    await store.commit({ events: [refused(e)] });
    expect(await client.retryNearby({ people: () => everyone([]) })).toBe(0);
    expect(await statusOf(store, e.id)).toBe('rejected');
  });

  it('a claim comes back under the claim\'s rules, so a privilege lost since does not hold it', async () => {
    const client = await myPhone();
    const e = unitBy(sam, 'u1', { id: 'old:0' });
    await store.commit({ events: [refused(e, { claim: { key: sam.key, seq: 3 } })] });
    expect(await client.retryNearby({ people: () => everyone([]) })).toBe(1);
    expect(await statusOf(store, e.id)).toBe('nearby');
  });

  it('rows dated after their key\'s revocation do not come back', async () => {
    const client = await myPhone();
    const e = unitBy(sam, 'u1', { at: NOW + 50 });
    await store.commit({ events: [refused(e)] });
    const revoked: RevocationList = { v: 1, kid: 'k1', orgId: ORG, seq: 1, keys: [[sam.key, 'sam', NOW]] };
    expect(await client.retryNearby({ people: () => everyone(), revoked })).toBe(0);
    expect(await statusOf(store, e.id)).toBe('rejected');
  });

  it('two refused rows cannot both take a slot on the way back', async () => {
    const client = await myPhone();
    const recordingId = newCommandId('sam', 'r1');
    const [a, b] = ['h1', 'h2'].map((hash) => eventBy(sam, 'v1.RecordingAdded', { recordingId, unitId: 'u1', kind: 'target', cards: [{ hash, durationMs: 5 }] }));
    await store.commit({ events: [refused(a!), refused(b!)] });
    expect(await client.retryNearby({ people: () => everyone() })).toBe(1);
  });

  it('a row of the person\'s own, refused with no via, is not this path\'s', async () => {
    const client = phone(server, store, sam);
    await client.load();
    const own = unitBy(sam, 'u1');
    await store.commit({ events: [{ event: own, status: 'rejected', rejectReason: 'not a member' }] });
    expect(await client.retryNearby({ people: () => everyone() })).toBe(0);
    expect(await statusOf(store, own.id)).toBe('rejected');
  });

  const newReducer = () => ({ ...LANGUAGE_MATERIALIZER, version: REDUCER_VERSION + 1 });

  async function underNewReducer() {
    const client = phone(server, store, mine, { materializer: newReducer() as never });
    await client.load();
    return client;
  }

  it('a new reducer runs the door again over nearby rows, once, and marks what it refuses', async () => {
    const client = await myPhone();
    await client.receiveNearby(await pageOf(sam, 1, []), intakeFor());
    const unbound = unitBy(sam, 'u1', { id: 'not-bound:0' });
    const fine = unitBy(sam, 'u2');
    await store.commit({ receive: [{ event: unbound, status: 'nearby', via: { batch: 1, key: sam.key } }, { event: fine, status: 'nearby', via: { batch: 1, key: sam.key } }] });
    // Nothing changed: the same reducer runs nothing.
    expect(await client.nearbyDoorAgain({ people: () => everyone() })).toBe(0);
    expect(await statusOf(store, unbound.id)).toBe('nearby');

    const next = await underNewReducer();
    expect(await next.nearbyDoorAgain({ people: () => everyone() })).toBe(1);
    expect(await rowOf(store, unbound.id)).toMatchObject({ status: 'rejected', via: { batch: 1, key: sam.key } });
    expect(await statusOf(store, fine.id)).toBe('nearby');
    expect(stateOf(next).units['u1']).toBeUndefined();
    expect(stateOf(next).units['u2']).toBeDefined();
    expect(await next.nearbyDoorAgain({ people: () => everyone() })).toBe(0);
  });

  it('runs when the first page arrives, if nothing ran it before', async () => {
    const client = await myPhone();
    await client.receiveNearby(await pageOf(sam, 1, []), intakeFor());
    const unbound = unitBy(sam, 'u1', { id: 'not-bound:0' });
    await store.commit({ receive: [{ event: unbound, status: 'nearby', via: { batch: 1, key: sam.key } }] });
    const next = await underNewReducer();
    await next.receiveNearby(await pageOf(sam, 2, []), intakeFor());
    expect(await statusOf(store, unbound.id)).toBe('rejected');
  });

  it('refuses no counted row: a row at a budget since lowered is not refused for that, nor does its own slot hold it out', async () => {
    const client = await myPhone();
    const recording = recordingBy(sam, 'r1');
    await client.receiveNearby(await pageOf(sam, 1, [recording, unitBy(sam, 'u1')]), intakeFor());
    const next = await underNewReducer();
    expect(await next.nearbyDoorAgain({ people: () => everyone() })).toBe(0);
    expect(await statusOf(store, recording.id)).toBe('nearby');
  });

  it('of two rows holding one slot, what the server wrote keeps it, then the earliest stamp', async () => {
    const client = await myPhone();
    await client.receiveNearby(await pageOf(sam, 1, []), intakeFor());
    const recordingId = newCommandId('sam', 'r1');
    const made = (hash: string, at: number) => eventBy(sam, 'v1.RecordingAdded', { recordingId, unitId: 'u1', kind: 'target', cards: [{ hash, durationMs: 5 }] }, { at });
    const [first, second, confirmed] = [made('h1', NOW + 1), made('h2', NOW + 2), made('h3', NOW + 3)];
    const other = newCommandId('sam', 'r2');
    const [third, fourth] = [
      eventBy(sam, 'v1.RecordingAdded', { recordingId: other, unitId: 'u1', kind: 'target', cards: [{ hash: 'a', durationMs: 5 }] }, { at: NOW + 2 }),
      eventBy(sam, 'v1.RecordingAdded', { recordingId: other, unitId: 'u1', kind: 'target', cards: [{ hash: 'b', durationMs: 5 }] }, { at: NOW + 1 })
    ];
    const viaBatch = { batch: 1, key: sam.key };
    await store.commit({
      events: [{ event: { ...confirmed!, serverSeq: 1 } as AnyEvent, status: 'confirmed' }],
      receive: [{ event: first!, status: 'nearby', via: viaBatch }, { event: second!, status: 'nearby', via: viaBatch }, { event: third!, status: 'nearby', via: viaBatch }, { event: fourth!, status: 'nearby', via: viaBatch }]
    });
    const next = await underNewReducer();
    expect(await next.nearbyDoorAgain({ people: () => everyone() })).toBe(3);
    expect(await statusOf(store, first!.id)).toBe('rejected');
    expect(await statusOf(store, second!.id)).toBe('rejected');
    expect(await statusOf(store, third!.id)).toBe('rejected');
    expect(await statusOf(store, fourth!.id)).toBe('nearby');
    expect(await statusOf(store, confirmed!.id)).toBe('confirmed');
  });

  it('a claim is judged again only as a claim', async () => {
    const client = await myPhone();
    await client.receiveNearby(await pageOf(sam, 1, []), intakeFor());
    const e = unitBy(sam, 'u1', { id: 'old:0' });
    await store.commit({ receive: [{ event: e, status: 'nearby', via: { claim: { key: sam.key, seq: 3 } } }] });
    const next = await underNewReducer();
    expect(await next.nearbyDoorAgain({ people: () => everyone([]) })).toBe(0);
    expect(await statusOf(store, e.id)).toBe('nearby');
  });

  it('a phone with no nearby rows only notes the version', async () => {
    const next = await underNewReducer();
    expect(await next.nearbyDoorAgain({ people: () => everyone() })).toBe(0);
    expect(await store.meta(`nearbyDoorVersion:${ORG}/${LANG}`)).toBe(String(REDUCER_VERSION + 1));
  });
});

describe.each(STORES)('a pull and a restamp, on the %s store', (_name, make) => {
  let sam: Teammate;
  let mine: Teammate;
  let store: EventStore;
  let server: FakeServer;

  beforeEach(async () => {
    sam = await teammate('sam');
    mine = await teammate('me');
    store = make();
    server = new FakeServer();
  });
  async function myPhone(o: Parameters<typeof phone>[3] = {}) {
    const client = phone(server, store, mine, o);
    await client.load();
    return client;
  }
  async function pushedBySam(e: AnyEvent) {
    await server.transportFor().append([e]);
  }

  it('pulling overwrites a nearby row, clears its via and confirms it, and the vector stays', async () => {
    const client = await myPhone();
    const e = unitBy(sam, 'u1');
    await client.receiveNearby(await pageOf(sam, 1, [e]), intakeFor());
    await pushedBySam(e);
    await client.pull();
    const row = await rowOf(store, e.id);
    expect(row).toMatchObject({ status: 'confirmed' });
    expect(row!.via).toBeUndefined();
    expect(row!.event.serverSeq).toBe(1);
    expect(isCounted(await vectorOf(client), sam.key, 1)).toBe(true);
    expect((await client.inspect()).nearby).toBe(0);
  });

  it('a pull refolds when a local row differs, in its clock or in its payload, so the fold takes the server\'s copy', async () => {
    // Trap: the guard in `apply` ignores the server's copy, so the fold would keep the old clock.
    const client = await myPhone();
    const before = eventBy(sam, 'v1.UnitAdded', { unitId: 'u1', parentUnitId: null, kind: 'passage', label: 'old', order: 'a' }, { at: NOW - 100 });
    await client.receiveNearby(await pageOf(sam, 1, [before]), intakeFor());
    expect(stateOf(client).units['u1']!.label).toBe('old');
    const server_copy = { ...before, payload: { ...before.payload, label: 'new' } } as AnyEvent;
    await pushedBySam(server_copy);
    await client.pull();
    expect(stateOf(client).units['u1']!.label).toBe('new');
  });

  it('a phone holding no nearby rows, and that never restamped, reads nothing to compare', async () => {
    const memory = new MemoryStore();
    const client = phone(server, memory, mine);
    await client.load();
    const reads = vi.spyOn(memory, 'getMany');
    await pushedBySam(unitBy(sam, 'u1'));
    await client.pull();
    await pushedBySam(unitBy(sam, 'u2'));
    await client.pull();
    expect(reads).not.toHaveBeenCalled();
  });

  it('a phone that once held nearby rows reads one batch per page, and a same-byte page does not fold again', async () => {
    const memory = new MemoryStore();
    const client = phone(server, memory, mine);
    await client.load();
    const e = unitBy(sam, 'u1');
    await client.receiveNearby(await pageOf(sam, 1, [e]), intakeFor());
    await pushedBySam(e);
    const reads = vi.spyOn(memory, 'getMany');
    const folds = vi.spyOn(memory, 'page');
    await client.pull();
    expect(reads).toHaveBeenCalledTimes(1);
    expect(folds).not.toHaveBeenCalled();
    expect(await rowOf(memory, e.id)).toMatchObject({ status: 'confirmed' });
  });

  it('a restamp clears via, and the row is signed again in a later batch under its new digest', async () => {
    const wall = wallClock(NOW + 3_000_000_000);
    const client = phone(server, store, sam, { now: wall.read });
    await client.load();
    const own = await client.append('v1.UnitAdded', { unitId: 'u1', parentUnitId: null, kind: 'passage', label: 'x', order: 'a' });
    await client.signUnsigned(signerOf(sam));
    expect((await rowOf(store, own.id))!.via).toMatchObject({ batch: 1 });
    server.authorize = (e) => (e.hlc > `${String(NOW + 1_000).padStart(15, '0')}` ? `clock ahead: server time ${NOW}` : null);
    wall.now = NOW + 3_000_000_000;
    await client.push();
    const restamped = await rowOf(store, own.id);
    expect(restamped).toMatchObject({ status: 'pending' });
    expect(restamped!.via).toBeUndefined();
    expect(restamped!.event.hlc).not.toBe(own.hlc);
    expect(await store.meta(`nearbyRestamped:${ORG}/${LANG}`)).toBe('1');

    expect(await client.signUnsigned(signerOf(sam))).toMatchObject({ batches: 1, events: 1 });
    expect((await rowOf(store, own.id))!.via).toMatchObject({ batch: 2, key: sam.key });
    // Batch 1 no longer carries it.
    expect((await client.nearbyBatchPage(sam.key, 1))!.events).toEqual([]);
    expect((await client.nearbyBatchPage(sam.key, 2))!.events.map((e) => e.id)).toEqual([own.id]);
  });

  it('a phone that has ever restamped keeps comparing, after a relaunch, with no nearby rows', async () => {
    await store.setMeta(`nearbyRestamped:${ORG}/${LANG}`, '1');
    const w = watched(store);
    const client = phone(server, w.store, mine);
    await client.load();
    await pushedBySam(unitBy(sam, 'u1'));
    await client.pull();
    expect(w.calls['getMany']).toBe(1);
  });

  it('a pull cannot replace a pending bound row with another actor\'s event: the server refuses the id', async () => {
    const client = phone(server, store, sam);
    await client.load();
    const own = await client.append('v1.UnitAdded', { unitId: 'u1', parentUnitId: null, kind: 'passage', label: 'mine', order: 'a' });
    const mallory = await teammate('mallory');
    const stolen = { ...unitBy(mallory, 'u1'), id: own.id } as AnyEvent;
    const [verdict] = await server.transportFor().append([stolen]);
    expect(verdict).toMatchObject({ accepted: false, reason: expect.stringContaining('malformed envelope') });
    await client.pull();
    expect(await rowOf(store, own.id)).toMatchObject({ status: 'pending' });
    expect((await rowOf(store, own.id))!.event.actorId).toBe('sam');
    await client.sync();
    expect(server.stream(ORG, LANG).map((e) => e.actorId)).toEqual(['sam']);

    // The id a create makes is bound too.
    const take = eventBy(mallory, 'v1.TakeComposed', { takeId: newCommandId('sam', 'take:1'), unitId: 'u1', cardHashes: ['c'], parentTakeId: null }, { id: 'old-looking:0' });
    expect((await server.transportFor().append([take]))[0]).toMatchObject({ accepted: false });
  });

  it.each([['whole in memory', false], ['kept on disk', true]] as const)('a checkpoint right after a pull over a differing copy saves the server\'s, %s', async (_how, keepOnDisk) => {
    // Why: with nothing unconfirmed left the fast path saves the live state, and the guard in `apply` left the old copy in it.
    const client = await myPhone({ keepOnDisk, checkpointEvery: 1 });
    const before = eventBy(sam, 'v1.UnitAdded', { unitId: 'u1', parentUnitId: null, kind: 'passage', label: 'old', order: 'a' }, { at: NOW - 100 });
    await client.receiveNearby(await pageOf(sam, 1, [before]), intakeFor());
    await pushedBySam({ ...before, payload: { ...before.payload, label: 'new' } } as AnyEvent);
    await client.pull();
    const checkpoint = JSON.parse((await store.meta(`snapshot:${ORG}/${LANG}`))!) as { state: LanguageState; serverSeq: number };
    expect(checkpoint.serverSeq).toBe(1);
    expect(checkpoint.state.units['u1']!.label).toBe('new');
    expect(stateOf(client).units['u1']!.label).toBe('new');
  });

  it('a nearby target of a redaction from the server is removed by the refold, and nothing else is', async () => {
    const client = await myPhone();
    const target = unitBy(sam, 'u1');
    const other = unitBy(sam, 'u2');
    await client.receiveNearby(await pageOf(sam, 1, [target, other]), intakeFor());
    const redaction = eventBy(sam, 'v1.Redacted', { eventId: target.id, reason: 'r' } as never);
    await pushedBySam(redaction);
    await client.pull();
    expect(stateOf(client).units['u1']).toBeUndefined();
    expect(stateOf(client).units['u2']).toBeDefined();
    // It holds for a copy arriving later, too: the id counts as here.
    expect(await client.receiveNearby(await pageOf(sam, 2, [target], { carrying: [target] }), intakeFor())).toMatchObject({ kept: 0, counted: true });
  });

  it('a pruned event coming back is folded harmlessly, sits as nearby and blocks the fast path until it settles', async () => {
    // Accepted in the plan: with pulls not feeding the vector, a phone back from town gets it again.
    const client = await myPhone({ checkpointEvery: 2 });
    const a = unitBy(sam, 'u1');
    const b = unitBy(sam, 'u2');
    await pushedBySam(a);
    await pushedBySam(b);
    await client.pull();
    expect(await store.getMany([a.id])).toEqual([]);
    const receipt = await client.receiveNearby(await pageOf(sam, 1, [a]), intakeFor());
    expect(receipt).toMatchObject({ kept: 1, counted: true });
    expect(await rowOf(store, a.id)).toMatchObject({ status: 'nearby' });
    expect(stateOf(client)).toEqual(expect.objectContaining({ units: expect.objectContaining({ u1: expect.anything(), u2: expect.anything() }) }));
    expect(foldLanguage([a, b], emptyLanguageState()).units).toEqual(stateOf(client).units);
    expect(await store.unconfirmedCount(ORG, LANG)).toBe(1);
  });

  it.each(['dropStaleCheckpoint', 'resolvePendingRedaction'])('the vector and the claims mark survive %s', async (how) => {
    const client = await myPhone();
    await client.receiveNearby(await pageOf(sam, 1, [unitBy(sam, 'u1')]), intakeFor());
    await client.receiveNearby(await claimsOf([unitBy(sam, 'u2', { id: 'old:0' })], () => 7), intakeFor());
    await pushedBySam(unitBy(sam, 'u3'));
    await client.pull();
    const before = await client.nearbyHave();
    if (how === 'dropStaleCheckpoint') {
      await store.commit({ meta: {
        [`snapshot:${ORG}/${LANG}`]: JSON.stringify({ orgId: ORG, streamId: LANG, reducerVersion: REDUCER_VERSION - 1, serverSeq: 1, state: emptyLanguageState() }),
        [`snapshotSeq:${ORG}/${LANG}`]: `${REDUCER_VERSION - 1}:1`
      } });
      await client.load();
      expect(await store.cursor(ORG, LANG)).toBe(0);
    } else {
      await store.commit({ meta: { [`redactionPending:${ORG}/${LANG}`]: JSON.stringify({ seq: 1, since: 0 }) } });
      await client.pull();
      expect(await store.meta(`redactionPending:${ORG}/${LANG}`)).toBe('');
    }
    const after = await client.nearbyHave();
    expect(after.vector).toEqual(before.vector);
    expect(after.claimedSeq).toBe(before.claimedSeq);
  });
});

describe('a language kept on disk', () => {
  it.each(STORES)('the door reads rows pruned into a checkpoint, on the %s store', async (_name, make) => {
    const store = make();
    const server = new FakeServer();
    const sam = await teammate('sam');
    const mine = await teammate('me');
    const lead = phone(server, new MemoryStore(), sam);
    await lead.load();
    await lead.append('v1.UnitAdded', { unitId: 'u1', parentUnitId: null, kind: 'passage', label: 'x', order: 'a' });
    const recordingId = newCommandId('sam', 'r1');
    await lead.append('v1.RecordingAdded', { recordingId, unitId: 'u1', kind: 'target', cards: [{ hash: 'h1', durationMs: 5 }] });
    const reviewId = newCommandId('sam', 'rv1');
    await lead.append('v1.ReviewRecorded', { reviewId, takeId: 't1', kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'x' });
    await lead.sync();

    const client = phone(server, store, mine, { keepOnDisk: true, checkpointEvery: 1 });
    await client.load();
    await client.pull();
    // Out of the log and out of memory: only the kept rows know.
    expect(await store.keptById(ORG, LANG, 'recording', [recordingId])).toHaveLength(1);
    expect(stateOf(client).recordings[recordingId]).toBeUndefined();

    const ana = await teammate('ana');
    const again = recordingBy(sam, 'second', 'u1');
    const taken = { ...again, payload: { ...again.payload, recordingId } } as AnyEvent;
    const wrong = eventBy(ana, 'v1.ReviewWithdrawn', { reviewId });
    const receipts = [await client.receiveNearby(await pageOf(sam, 1, [taken]), intakeFor()), await client.receiveNearby(await pageOf(ana, 1, [wrong]), intakeFor())];
    expect(receipts[0]!.refused[0]).toMatchObject({ reason: `recording:${recordingId} is taken`, retry: false });
    expect(receipts[1]!.refused[0]).toMatchObject({ reason: 'a review is withdrawn only by its author', retry: false });
    expect(await store.getMany([taken.id, wrong.id])).toEqual([]);
  });

  it.each(STORES)('a passage not filled in passes, with no call to the server, and no line moves, on the %s store', async (_name, make) => {
    const store = make();
    const server = new FakeServer();
    const sam = await teammate('sam');
    const lead = phone(server, new MemoryStore(), sam);
    await lead.load();
    await lead.append('v1.UnitAdded', { unitId: 'u1', parentUnitId: null, kind: 'passage', label: 'x', order: 'a' });
    await lead.append('v1.RecordingAdded', { recordingId: newCommandId('sam', 'r1'), unitId: 'u1', kind: 'target', cards: [{ hash: 'h1', durationMs: 5 }] });
    await lead.sync();
    server.serverCut = true;
    server.makeSnapshot(ORG, LANG);

    const client = phone(server, store, await teammate('me'), { keepOnDisk: true, fillAtOnceRows: 0, fillPageRows: 1 });
    await client.load();
    await client.pull();
    expect(client.fillProgress()).not.toBeNull();
    expect(client.isFilled('u1')).toBe(false);
    server.offline = true;
    const review = eventBy(sam, 'v1.ReviewRecorded', { reviewId: newCommandId('sam', 'rv'), takeId: 't1', kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'x' });
    const receipt = await client.receiveNearby(await pageOf(sam, 1, [review]), intakeFor());
    expect(receipt).toMatchObject({ kept: 1, counted: true });
    expect(client.isFilled('u1')).toBe(false);
  });
});

it('a phone\'s store gets nothing but its own: a page\'s events are copied, and manifests kept as signed', async () => {
  const store = new MemoryStore();
  const server = new FakeServer();
  const sam = await teammate('sam');
  const client = phone(server, store, await teammate('me'));
  await client.load();
  const e = { ...unitBy(sam, 'u1'), extra: 'field' } as unknown as AnyEvent;
  const page = await pageOf(sam, 1, [e]);
  await client.receiveNearby(page, intakeFor());
  expect('extra' in (await rowOf(store, e.id))!.event).toBe(false);
  expect((await store.batchesAfter(ORG, LANG, sam.key, 0, 1))[0]!.manifest).toBe(manifestText(await manifestOf(sam, 1, [e])));
});

describe('the test doubles', () => {
  it('fakeSigner does what `NearbyCrypto` says, from one name, the same each run', () => {
    const a = fakeSigner('a');
    expect(fakeSigner('a').publicKey).toBe(a.publicKey);
    expect(fakeSigner('b').publicKey).not.toBe(a.publicKey);
    const mine = a.x25519Pair();
    const theirs = fakeSigner('b').x25519Pair();
    expect(mine.public).toHaveLength(32);
    expect(a.x25519(mine.secret, theirs.public)).toEqual(a.x25519(theirs.secret, mine.public));
    expect(a.randomBytes(40)).toHaveLength(40);
    expect(a.randomBytes(8)).not.toEqual(a.randomBytes(8));
    expect(a.hmacSha256(new Uint8Array(32), new Uint8Array(1))).toHaveLength(32);
    expect(a.hkdfSha256(new Uint8Array(32), new Uint8Array(16), 'info', 42)).toHaveLength(42);
    expect(a.verify('not a key', new Uint8Array(1), 'nope')).toBe(false);
  });
});
