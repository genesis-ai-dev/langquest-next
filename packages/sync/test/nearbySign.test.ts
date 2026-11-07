import { eventDigest, isCounted, newCommandId, parseBatchManifest, type BatchManifest, type LanguageState } from '@langquest-next/core';
import { signerFor, signerOf, ORG, LANG, NOW, STORES, phone, rowOf, session, teammate, vectorOf, worker, type Teammate } from './nearbyFixtures';
import { MemoryStore } from '../src/memoryStore';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSha256, fakeSigner } from '../src/testing/memoryNearbyLink';
import type { EventStore } from '../src/types';

const unit = (i: number | string) => ({ unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${i}` });
const manifestsOf = async (store: EventStore): Promise<BatchManifest[]> => {
  const out: BatchManifest[] = [];
  for (const { key, n } of await store.batchKeys(ORG, LANG)) {
    const [row] = await store.batchesAfter(ORG, LANG, key, n - 1, 1);
    out.push(parseBatchManifest(row!.manifest, session)!);
  }
  return out.sort((a, b) => a.n - b.n);
};

describe.each(STORES)('signing on the %s store', (_name, make) => {
  let sam: Teammate;
  beforeEach(async () => { sam = await teammate('sam'); });

  async function samsPhone(store = make(), server = new FakeServer()) {
    const client = phone(server, store, sam);
    await client.load();
    return { client, store, server };
  }

  it('signs this device\'s pending rows, and one commit writes the rows, the manifest, the counter and its own vector entry', async () => {
    const { client, store } = await samsPhone();
    const a = await client.append('v1.UnitAdded', unit(1));
    const b = await client.append('v1.UnitAdded', unit(2));

    expect(await client.signUnsigned(signerOf(sam))).toEqual({ batches: 1, events: 2, unbound: 0, noCertificate: 0, unsafeNumber: false });

    const [m] = await manifestsOf(store);
    expect(m).toMatchObject({ key: sam.key, actorId: 'sam', deviceId: 'd-sam', n: 1, floor: 0 });
    expect(m!.events).toEqual([[a.id, await eventDigest(a, fakeSha256)], [b.id, await eventDigest(b, fakeSha256)]]);
    expect((await rowOf(store, a.id))!).toMatchObject({ status: 'pending', via: { batch: 1, key: sam.key } });
    expect(await store.meta(`nearbyCount:${ORG}/${LANG}:${sam.key}`)).toBe('1');
    // Without its own entry a phone's summary could never equal a teammate's who holds all its work.
    expect(isCounted(await vectorOf(client), sam.key, 1)).toBe(true);
    const [row] = await store.batchesAfter(ORG, LANG, sam.key, 0, 1);
    expect(row).toMatchObject({ firstHlc: a.hlc, actorId: 'sam', deviceId: 'd-sam' });
    expect(JSON.parse(row!.chain)).toEqual(sam.chain);
    // Signing changes no status: the row still goes up as pending.
    expect((await client.inspect()).pending).toHaveLength(2);
    expect(await client.pendingCount()).toBe(2);
  });

  it('one author to a batch: a shared phone signs each person under one key, with their own chain, and one counter', async () => {
    const crypto = fakeSigner('shared');
    const store = make();
    const server = new FakeServer();
    const samHere: Teammate = { ...sam, deviceId: 'shared', key: crypto.publicKey, crypto, chain: await worker.certify({ installKey: crypto.publicKey, profileId: 'sam', deviceId: 'shared' }, { orgId: ORG }) };
    const anaHere = { ...await teammate('ana', 'shared', 'shared') };
    const s = phone(server, store, samHere);
    await s.load();
    const a = phone(server, store, anaHere);
    await a.load();
    await s.append('v1.UnitAdded', unit(1));
    await a.append('v1.UnitAdded', unit(2));
    await s.append('v1.UnitAdded', unit(3));

    const out = await s.signUnsigned(signerFor(crypto, { sam: samHere.chain, ana: anaHere.chain }));
    expect(out).toMatchObject({ batches: 2, events: 3 });
    const manifests = await manifestsOf(store);
    expect(manifests.map((m) => [m.n, m.actorId, m.events.length])).toEqual([[1, 'sam', 2], [2, 'ana', 1]]);
  });

  it('leaves out and counts anyone with no certificate here and unbound rows, and leaves redactions and external values uncounted', async () => {
    const { client, store } = await samsPhone();
    const ana = await teammate('ana', 'd-sam');
    const onHerPhone = phone(new FakeServer(), store, ana);
    await onHerPhone.load();
    const old = (await client.appendMany([{ id: 'old-id:0', type: 'v1.UnitAdded', payload: unit('old') }]))[0]!;
    const hers = await onHerPhone.append('v1.UnitAdded', unit('hers'));
    const redaction = await client.append('v1.Redacted', { eventId: 'x', reason: 'r' } as never);
    const external = await client.append('v1.ExternalValueSet', { key: 'k', value: 'v' } as never);
    const mine = await client.append('v1.UnitAdded', unit('mine'));

    const out = await client.signUnsigned(signerOf(sam));
    expect(out).toEqual({ batches: 1, events: 1, unbound: 1, noCertificate: 1, unsafeNumber: false });
    const [m] = await manifestsOf(store);
    expect(m!.events.map(([id]) => id)).toEqual([mine.id]);
    for (const left of [old, hers, redaction, external]) expect((await rowOf(store, left.id))!.via).toBeUndefined();
    // Counted once however many times a batch comes round them.
    expect((await client.signUnsigned(signerOf(sam)))).toMatchObject({ batches: 0, unbound: 1, noCertificate: 1 });
  });

  it('a row of another device is not this device\'s to sign', async () => {
    const store = make();
    const { client } = await samsPhone(store);
    const server = new FakeServer();
    const elsewhere = phone(server, store, { profileId: 'sam', deviceId: 'd-other' });
    await elsewhere.load();
    await elsewhere.append('v1.UnitAdded', unit(1));
    expect(await client.signUnsigned(signerOf(sam))).toMatchObject({ batches: 0, unbound: 0, noCertificate: 0 });
  });

  it('a chain for another key, device or person counts as no certificate, since every phone would refuse it', async () => {
    const { client, store } = await samsPhone();
    await client.append('v1.UnitAdded', unit(1));
    const ana = await teammate('ana');
    expect(await client.signUnsigned(signerFor(sam.crypto, { sam: ana.chain }))).toMatchObject({ batches: 0, noCertificate: 1 });
    const device = await worker.certify({ installKey: sam.key, profileId: 'sam', deviceId: 'd-else' }, { orgId: ORG });
    expect(await client.signUnsigned(signerFor(sam.crypto, { sam: device }))).toMatchObject({ batches: 0, noCertificate: 1 });
    expect(await store.batchKeys(ORG, LANG)).toEqual([]);
  });

  it('closes a batch at 200 events', async () => {
    const { client, store } = await samsPhone();
    await client.appendMany(Array.from({ length: 205 }, (_, i) => ({ type: 'v1.UnitAdded' as const, payload: unit(i) })));
    expect(await client.signUnsigned(signerOf(sam))).toMatchObject({ batches: 2, events: 205 });
    expect((await manifestsOf(store)).map((m) => m.events.length)).toEqual([200, 5]);
    expect(await store.meta(`nearbyCount:${ORG}/${LANG}:${sam.key}`)).toBe('2');
  });

  it('closes a batch at 512 KiB of event text, so a page always fits in a message', async () => {
    const { client, store } = await samsPhone();
    // Close to the 64 KiB an event may hold, in three-byte characters so that characters and bytes differ.
    const label = '€'.repeat(20_000);
    await client.appendMany(Array.from({ length: 10 }, (_, i) => ({ type: 'v1.UnitAdded' as const, payload: { ...unit(i), label } })));
    await client.signUnsigned(signerOf(sam));
    const sizes = (await manifestsOf(store)).map((m) => m.events.length);
    expect(sizes).toEqual([8, 2]);
    const page = await client.nearbyBatchPage(sam.key, 1);
    expect(JSON.stringify(page!.events).length).toBeLessThan(1024 * 1024);
  });

  it('refuses a number that is not a safe integer, and signs nothing under it', async () => {
    const { client, store } = await samsPhone();
    const row = await client.append('v1.UnitAdded', unit(1));
    await store.setMeta(`nearbyCount:${ORG}/${LANG}:${sam.key}`, String(Number.MAX_SAFE_INTEGER));
    expect(await client.signUnsigned(signerOf(sam))).toMatchObject({ batches: 0, unsafeNumber: true });
    expect((await rowOf(store, row.id))!.via).toBeUndefined();
  });

  it('a row that fails to sign under a store error stays unsigned as a whole', async () => {
    const { client, store } = await samsPhone();
    const row = await client.append('v1.UnitAdded', unit(1));
    const failing = { ...signerOf(sam), sign: () => Promise.reject(new Error('keystore locked')) };
    await expect(client.signUnsigned(failing)).rejects.toThrow('keystore locked');
    expect((await rowOf(store, row.id))!.via).toBeUndefined();
    expect(await store.batchKeys(ORG, LANG)).toEqual([]);
    expect(await store.meta(`nearbyCount:${ORG}/${LANG}:${sam.key}`)).toBeUndefined();
  });
});

describe.each(STORES)('the floor and the end of a sync, on the %s store', (_name, make) => {
  let sam: Teammate;
  beforeEach(async () => { sam = await teammate('sam'); });

  it('a batch goes once nothing speaks for it, each signer\'s newest stays, and the floor moves and travels in an empty batch', async () => {
    const server = new FakeServer();
    const store = make();
    const client = phone(server, store, sam);
    await client.load();
    await client.append('v1.UnitAdded', unit(1));
    await client.signUnsigned(signerOf(sam));
    await client.append('v1.UnitAdded', unit(2));
    await client.signUnsigned(signerOf(sam));
    expect((await store.batchKeys(ORG, LANG)).map((b) => b.n)).toEqual([1, 2]);

    // Offline nothing settles.
    server.offline = true;
    await client.sync();
    expect((await store.batchKeys(ORG, LANG)).map((b) => b.n)).toEqual([1, 2]);
    server.offline = false;

    await client.sync();
    expect((await store.batchKeys(ORG, LANG)).map((b) => b.n)).toEqual([2]);
    expect(await store.meta(`nearbyFloor:${ORG}/${LANG}:${sam.key}`)).toBe('2');

    // The next signing carries it, with no events, and it speaks for itself too.
    expect(await client.signUnsigned(signerOf(sam))).toMatchObject({ batches: 1, events: 0 });
    const newest = (await manifestsOf(store)).at(-1)!;
    expect(newest).toMatchObject({ n: 3, floor: 3, events: [] });
    expect((await store.batchesAfter(ORG, LANG, sam.key, 2, 1))[0]!.firstHlc).toBeNull();

    // And that is the end of it: another sync does not start another empty batch.
    await client.sync();
    expect(await client.signUnsigned(signerOf(sam))).toMatchObject({ batches: 0 });
    expect((await store.batchKeys(ORG, LANG)).map((b) => b.n)).toEqual([3]);
  });

  it('a floor stays below the lowest batch still holding a row, and an empty batch does not claim past it', async () => {
    // Two people on one phone, one key: Ana's row stays pending while Sam's session syncs, because only its author sends it.
    const crypto = fakeSigner('shared');
    const server = new FakeServer();
    const store = make();
    const samHere = await teammate('sam', 'shared', 'shared');
    const anaHere = await teammate('ana', 'shared', 'shared');
    const samClient = phone(server, store, samHere);
    await samClient.load();
    const anaClient = phone(server, store, anaHere);
    await anaClient.load();
    const signer = signerFor(crypto, { sam: samHere.chain, ana: anaHere.chain });

    await samClient.append('v1.UnitAdded', unit(1));
    await samClient.signUnsigned(signer);
    await anaClient.append('v1.UnitAdded', unit(2));
    await samClient.signUnsigned(signer);
    await samClient.append('v1.UnitAdded', unit(3));
    await samClient.signUnsigned(signer);

    await samClient.sync();
    // Batch 2 holds Ana's row, so the floor stops below it. Batch 1 is gone; batch 3, the newest, stays.
    expect(await store.meta(`nearbyFloor:${ORG}/${LANG}:${crypto.publicKey}`)).toBe('1');
    expect((await store.batchKeys(ORG, LANG)).map((b) => b.n)).toEqual([2, 3]);

    expect(await samClient.signUnsigned(signer)).toMatchObject({ batches: 1, events: 0 });
    expect((await manifestsOf(store)).at(-1)).toMatchObject({ n: 4, floor: 1, events: [] });

    await anaClient.sync();
    await samClient.sync();
    expect(await store.meta(`nearbyFloor:${ORG}/${LANG}:${crypto.publicKey}`)).toBe('4');
    expect(await samClient.signUnsigned(signer)).toMatchObject({ batches: 1, events: 0 });
    expect((await manifestsOf(store)).at(-1)).toMatchObject({ n: 5, floor: 5 });
  });

  it('a floor that moved waits when the signed-in person has no certificate here', async () => {
    const server = new FakeServer();
    const store = make();
    const client = phone(server, store, sam);
    await client.load();
    await client.append('v1.UnitAdded', unit(1));
    await client.signUnsigned(signerOf(sam));
    await client.sync();
    expect(await client.signUnsigned(signerFor(sam.crypto, {}))).toMatchObject({ batches: 0 });
    expect((await store.batchKeys(ORG, LANG)).map((b) => b.n)).toEqual([1]);
    expect(await client.signUnsigned(signerOf(sam))).toMatchObject({ batches: 1 });
  });

  it('a refused row of this person keeps no batch: the refusal clears its via, so retry signs it again later', async () => {
    const server = new FakeServer();
    const store = make();
    const client = phone(server, store, sam);
    await client.load();
    const row = await client.append('v1.UnitAdded', unit(1));
    await client.signUnsigned(signerOf(sam));
    server.authorize = () => 'may not emit this';
    await client.sync();
    expect(await rowOf(store, row.id)).toMatchObject({ status: 'rejected' });
    expect((await rowOf(store, row.id))!.via).toBeUndefined();

    server.authorize = () => null;
    expect(await client.retryRejected()).toBe(1);
    const out = await client.signUnsigned(signerOf(sam));
    expect(out).toMatchObject({ batches: 1, events: 1 });
    expect((await rowOf(store, row.id))!.via).toMatchObject({ batch: 2 });
  });

  it('a refused nearby row still speaks, because Try again can return it, and its manifest stays', async () => {
    const server = new FakeServer();
    const store = make();
    const client = phone(server, store, sam);
    await client.load();
    const ana = await teammate('ana');
    const key = ana.key;
    const event = { id: newCommandId('ana', 'x:0'), type: 'v1.UnitAdded', orgId: ORG, streamId: LANG, actorId: 'ana', deviceId: ana.deviceId, hlc: `${String(NOW).padStart(15, '0')}:000000:${ana.deviceId}`, payload: unit(1) } as const;
    await store.commit({
      events: [{ event: event as never, status: 'rejected', rejectReason: 'not allowed', via: { batch: 1, key } }],
      batches: [1, 2].map((n) => ({ orgId: ORG, streamId: LANG, key, n, deviceId: ana.deviceId, actorId: 'ana', firstHlc: null, manifest: '{}', sig: 's', chain: '[]' }))
    });
    await client.sync();
    expect((await store.batchKeys(ORG, LANG)).map((b) => b.n)).toEqual([1, 2]);
    await store.commit({ events: [{ event: event as never, status: 'confirmed' }] });
    await client.sync();
    expect((await store.batchKeys(ORG, LANG)).map((b) => b.n)).toEqual([2]);
    // A teammate's floor is theirs to state: this phone wrote none for them.
    expect(await store.meta(`nearbyFloor:${ORG}/${LANG}:${key}`)).toBeUndefined();
  });

  it('a phone holding no manifest reads nothing at the end of a sync', async () => {
    const server = new FakeServer();
    const store = new MemoryStore();
    const client = phone(server, store, sam);
    await client.load();
    const walks = vi.spyOn(store, 'nearbyPage');
    await client.sync();
    expect(walks).not.toHaveBeenCalled();
  });
});

describe.each(STORES)('what a phone sends, on the %s store', (_name, make) => {
  let sam: Teammate;
  beforeEach(async () => { sam = await teammate('sam'); });

  it('names the batches the other has not counted, lowest first, and a page holds its manifest and what it may carry', async () => {
    const store = make();
    const client = phone(new FakeServer(), store, sam);
    await client.load();
    const a = await client.append('v1.UnitAdded', unit(1));
    const b = await client.append('v1.UnitAdded', unit(2));
    await client.signUnsigned(signerOf(sam));
    await client.append('v1.UnitAdded', unit(3));
    await client.signUnsigned(signerOf(sam));

    expect(await client.nearbyUncounted(new Map())).toEqual([{ key: sam.key, n: 1 }, { key: sam.key, n: 2 }]);
    expect(await client.nearbyUncounted(new Map([[sam.key, { mark: 1, ahead: [] }]]))).toEqual([{ key: sam.key, n: 2 }]);
    expect(await client.nearbyUncounted(new Map([[sam.key, { mark: 0, ahead: [[1, 2]] }]]))).toEqual([]);

    const page = await client.nearbyBatchPage(sam.key, 1);
    expect(page!.events.map((e) => e.id)).toEqual([a.id, b.id]);
    expect(page!.events.every((e) => !('serverSeq' in e))).toBe(true);
    expect(page!.chain).toEqual(sam.chain);
    expect(await client.nearbyBatchPage(sam.key, 9)).toBeNull();
  });

  it('sends the manifest with no events once a row is confirmed, so its floor travels, and a confirmed row goes by claim instead', async () => {
    const server = new FakeServer();
    const store = make();
    const client = phone(server, store, sam);
    await client.load();
    await client.append('v1.UnitAdded', unit(1));
    await client.signUnsigned(signerOf(sam));
    await client.sync();
    const page = await client.nearbyBatchPage(sam.key, 1);
    expect(page!.events).toEqual([]);
    expect(parseBatchManifest(page!.manifest, session)!.events).toHaveLength(1);
  });

  it('skips a redacted row', async () => {
    const server = new FakeServer();
    const store = make();
    const client = phone(server, store, sam);
    await client.load();
    const a = await client.append('v1.UnitAdded', unit(1));
    await client.signUnsigned(signerOf(sam));
    (client.getState() as LanguageState).redactions[a.id] = true;
    expect((await client.nearbyBatchPage(sam.key, 1))!.events).toEqual([]);
  });

  it('says what Have says: cursor, claims mark and vector, and whether its log starts past theirs', async () => {
    const server = new FakeServer();
    const store = make();
    const client = phone(server, store, sam, { checkpointEvery: 1 });
    await client.load();
    expect(await client.nearbyHave()).toEqual({ cursor: 0, claimedSeq: 0, vector: new Map() });
    expect(await client.nearbyHoldsLess({ cursor: 0, claimedSeq: 0 })).toBe(false);
    await client.append('v1.UnitAdded', unit(1));
    await client.append('v1.UnitAdded', unit(2));
    await client.sync();
    await client.sync();
    expect((await client.nearbyHave()).cursor).toBe(2);
    expect(await client.nearbyHoldsLess({ cursor: 0, claimedSeq: 0 })).toBe(true);
    expect(await client.nearbyHoldsLess({ cursor: 2, claimedSeq: 0 })).toBe(false);
    expect(await client.nearbyHoldsLess({ cursor: 0, claimedSeq: 2 })).toBe(false);
  });

  it('claims what the Worker vouched for, past what they have been told of, in serverSeq order and stripped', async () => {
    const server = new FakeServer();
    const store = make();
    const client = phone(server, store, sam);
    await client.load();
    await client.appendMany([1, 2, 3].map((i) => ({ type: 'v1.UnitAdded' as const, payload: unit(i) })));
    await client.sync();
    await client.pull();
    const rows = await store.confirmedAfter(ORG, LANG, 0, 10);
    const att = await Promise.all(rows.slice(0, 2).map(async (l) => [l.event.id, await eventDigest(l.event, fakeSha256), l.event.serverSeq!] as [string, string, number]));
    const signed = await worker.attest({ orgId: ORG, streamId: LANG, rows: att });
    await store.commit({ attests: [{ orgId: ORG, streamId: LANG, lastSeq: 2, text: signed.text, kid: signed.kid, sig: signed.sig }, { orgId: ORG, streamId: LANG, lastSeq: 9, text: 'bad', kid: 'k1', sig: 's' }] });

    const collect = async (them: { cursor: number; claimedSeq: number }) => {
      const out: string[][] = [];
      for await (const page of client.nearbyClaimPages(them)) out.push(page.events.map((e) => e.id));
      return out;
    };
    // Only what is attested: the third row waits for the Worker, even though it is confirmed here.
    expect(await collect({ cursor: 0, claimedSeq: 0 })).toEqual([[rows[0]!.event.id, rows[1]!.event.id]]);
    expect(await collect({ cursor: 1, claimedSeq: 0 })).toEqual([[rows[1]!.event.id]]);
    expect(await collect({ cursor: 0, claimedSeq: 2 })).toEqual([]);

    const pages = [];
    for await (const page of client.nearbyClaimPages({ cursor: 0, claimedSeq: 0 })) pages.push(page);
    expect(pages[0]!.events.every((e) => !('serverSeq' in e))).toBe(true);
    expect(pages[0]).toMatchObject({ t: 'claims', text: signed.text, kid: 'k1', sig: signed.sig });
  });

  it('claims close at 512 KiB, under the same attestation', async () => {
    const server = new FakeServer();
    const store = make();
    const client = phone(server, store, sam);
    await client.load();
    const label = '€'.repeat(20_000);
    await client.appendMany(Array.from({ length: 10 }, (_, i) => ({ type: 'v1.UnitAdded' as const, payload: { ...unit(i), label } })));
    await client.sync();
    const rows = await store.confirmedAfter(ORG, LANG, 0, 10);
    const att = await Promise.all(rows.map(async (l) => [l.event.id, await eventDigest(l.event, fakeSha256), l.event.serverSeq!] as [string, string, number]));
    const signed = await worker.attest({ orgId: ORG, streamId: LANG, rows: att });
    await store.commit({ attests: [{ orgId: ORG, streamId: LANG, lastSeq: 10, text: signed.text, kid: signed.kid, sig: signed.sig }] });
    const sizes: number[] = [];
    for await (const page of client.nearbyClaimPages({ cursor: 0, claimedSeq: 0 })) sizes.push(page.events.length);
    expect(sizes).toEqual([8, 2]);
  });
});
