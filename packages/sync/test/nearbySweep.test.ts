import { emptyLanguageState, foldLanguage, isCounted, type AnyEvent, type LanguageState } from '@langquest-next/core';
import { FakeServer } from '../src/testing/fakeServer';
import { SimDevice } from '../src/testing/fleet/device';
import { fakeSha256 } from '../src/testing/memoryNearbyLink';
import { shapeTransport } from '../src/testing/shapedTransport';
import { OfflineError, type EventStore, type KnownEvent, type Transport } from '../src/types';
import type { SyncClient } from '../src/syncClient';
import {
  LANG, NOW, ORG, STORES, claimsOf, eventBy, intakeFor, pageOf, phone, recordingBy, rowOf, statusOf, teammate, unitBy, vectorOf, type PhoneOptions, type Teammate
} from './nearbyFixtures';

/**
 * A phone back online asks the server about what it holds for teammates
 * (docs/nearby-sync-plan.md 5.7). Why these tests: a nearby row already inside a checkpoint
 * is never settled by a pull, and a row left nearby holds a language on the slow path for
 * good; but a copy dropped wrongly loses a teammate's work, and a copy dropped without its
 * line and fold being put right is saved as confirmed by the next checkpoint.
 */
const certified = { sha256: fakeSha256 };

const HOW = [['whole in memory', false], ['kept on disk', true]] as const;
const UNITS = ['u1', 'u2'];

describe.each(STORES)('the sweep on the %s store', (_name, make) => {
  describe.each(HOW)('a language %s', (_how, keepOnDisk) => {
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

    const toServer = async (...events: AnyEvent[]) => {
      for (const r of await server.transportFor().append(events)) expect(r.accepted).toBe(true);
    };
    async function myPhone(o: PhoneOptions = {}) {
      const client = phone(server, store, mine, { keepOnDisk, ...o });
      await client.load();
      return client;
    }
    /** Everything the phone knows, whichever passages are in memory. */
    const whole = (client: SyncClient) => client.withPassages(UNITS);
    /** The units first, then a snapshot the phone will adopt, so that what the server holds is at or below its cursor while nearby rows sit here. */
    const units = () => [unitBy(sam, 'u1'), unitBy(sam, 'u2')];
    const adoptable = async (...events: AnyEvent[]) => {
      await toServer(...units(), ...events);
      server.makeSnapshot(ORG, LANG);
    };
    /** An event that says one thing here and another on the server, under one id. */
    const sameId = (name: string, o: { nearbyAt: number; serverAt: number }) => {
      const id = `by:sam:${name}:0`;
      return { onServer: recordingBy(sam, name, 'u1', { id, at: o.serverAt }), nearby: recordingBy(sam, name, 'u2', { id, at: o.nearbyAt }) };
    };

    describe('what the server says', () => {
      it('it has the event past the cursor: nothing, and the next pull confirms it', async () => {
        await toServer(...units());
        const rec = recordingBy(sam, 'r1');
        const t = server.transportFor();
        const pull = t.pull;
        let once = true;
        t.pull = async (...a) => {
          const page = await pull(...a);
          if (once) { once = false; await t.append([rec]); }
          return page;
        };
        const client = await myPhone({ transport: t });
        await client.receiveNearby(await pageOf(sam, 1, [rec]), intakeFor());

        await client.sync();
        expect(server.knownEventsCalls).toBe(1);
        expect(await rowOf(store, rec.id)).toMatchObject({ status: 'nearby', via: { batch: 1, key: sam.key } });

        await client.sync();
        const row = await rowOf(store, rec.id);
        expect(row).toMatchObject({ status: 'confirmed' });
        expect(row!.via).toBeUndefined();
        expect(await store.nearbyCount(ORG, LANG)).toBe(0);
      });

      it('it has the event at or below the cursor: the leftover copy goes, and nothing is lost', async () => {
        const rec = recordingBy(sam, 'r1');
        await adoptable(rec);
        const client = await myPhone();
        await client.receiveNearby(await pageOf(sam, 1, [rec]), intakeFor());
        const other = recordingBy(sam, 'r2');
        await client.receiveNearby(await pageOf(sam, 2, [other]), intakeFor());

        const result = await client.sync();
        expect(result.offline).toBe(false);
        expect(await store.cursor(ORG, LANG)).toBe(server.head(ORG, LANG));
        expect(await rowOf(store, rec.id)).toBeUndefined();
        expect((await whole(client)).recordings[(rec.payload as { recordingId: string }).recordingId]).toBeDefined();
        // Only that row: the other is the author's still to send.
        expect(await statusOf(store, other.id)).toBe('nearby');
      });

      it('same id, a different clock: the copy goes, and the fold is the server\'s', async () => {
        const { onServer, nearby } = sameId('r1', { serverAt: NOW + 5, nearbyAt: NOW - 5 });
        await adoptable(onServer);
        const client = await myPhone();
        await client.receiveNearby(await pageOf(sam, 1, [nearby]), intakeFor());
        const id = (nearby.payload as { recordingId: string }).recordingId;
        expect(client.getState().recordings[id]?.unitId).toBe('u2');

        await client.sync();
        expect(await rowOf(store, nearby.id)).toBeUndefined();
        expect((await whole(client)).recordings[id]?.unitId).toBe('u1');
      });

      it('same id, the same clock and another digest: no answer can show it, so the fold is worked out again whatever the clock says', async () => {
        const { onServer, nearby } = sameId('r1', { serverAt: NOW + 5, nearbyAt: NOW + 5 });
        expect(onServer.hlc).toBe(nearby.hlc);
        await adoptable(onServer);
        const client = await myPhone();
        await client.receiveNearby(await pageOf(sam, 1, [nearby]), intakeFor());

        await client.sync();
        expect(await rowOf(store, nearby.id)).toBeUndefined();
        const id = (nearby.payload as { recordingId: string }).recordingId;
        expect((await whole(client)).recordings[id]?.unitId).toBe('u1');
        expect(client.getState().recordings[id]?.unitId === 'u2').toBe(false);
      });

      it('a claim at or below the cursor goes too, and the mark stays', async () => {
        const rec = recordingBy(sam, 'r1');
        await adoptable(rec);
        const client = await myPhone();
        await client.receiveNearby(await claimsOf([rec], () => 3), intakeFor());
        expect(await rowOf(store, rec.id)).toMatchObject({ status: 'nearby', via: { claim: { seq: 3 } } });

        await client.sync();
        expect(await rowOf(store, rec.id)).toBeUndefined();
        expect((await client.nearbyHave()).claimedSeq).toBe(3);
      });

      it('it does not have it, and a teammate\'s phone claimed it did: refused, naming the phone, folded out, and the claims mark goes back to the cursor', async () => {
        await toServer(...units());
        const rec = recordingBy(sam, 'r1');
        const client = await myPhone();
        const peerKey = intakeFor().peerKey;
        await client.receiveNearby(await claimsOf([rec], () => 12), intakeFor());
        expect((await client.nearbyHave()).claimedSeq).toBe(12);
        const id = (rec.payload as { recordingId: string }).recordingId;
        expect(client.getState().recordings[id]).toBeDefined();

        await client.sync();
        const row = await rowOf(store, rec.id);
        expect(row).toMatchObject({ status: 'rejected', via: { claim: { key: peerKey, seq: 12 } } });
        expect(row!.rejectReason).toContain(peerKey);
        expect(client.getState().recordings[id]).toBeUndefined();
        expect(await client.nearbyHave()).toMatchObject({ claimedSeq: await store.cursor(ORG, LANG), cursor: 2 });
      });

      it('it does not have it, and it is signed by its author: kept', async () => {
        await toServer(...units());
        const rec = recordingBy(sam, 'r1');
        const client = await myPhone();
        await client.receiveNearby(await pageOf(sam, 1, [rec]), intakeFor());

        await client.sync();
        expect(await rowOf(store, rec.id)).toMatchObject({ status: 'nearby', via: { batch: 1, key: sam.key } });
        expect(client.getState().recordings[(rec.payload as { recordingId: string }).recordingId]).toBeDefined();
        expect(server.knownEventsCalls).toBe(1);
      });

      /** A server that holds these ids under whoever it is told, which `FakeServer` itself will not take. */
      const answering = (known: (ids: readonly string[]) => KnownEvent[]): Transport => {
        const t = server.transportFor();
        t.knownEvents = async (_o, _s, ids) => known(ids);
        return t;
      };

      it.each([['at or below the cursor', 1], ['past the cursor', 99]] as const)('it has that id under another author, %s: a batch row is refused, kept with its via, and folded out', async (_where, serverSeq) => {
        await toServer(...units());
        const rec = recordingBy(sam, 'r1');
        const client = await myPhone({ transport: answering((ids) => ids.map((id) => ({ id, serverSeq, hlc: rec.hlc, actorId: 'mallory' }))) });
        await client.receiveNearby(await pageOf(sam, 1, [rec]), intakeFor());

        await client.sync();
        const row = await rowOf(store, rec.id);
        expect(row).toMatchObject({ status: 'rejected', via: { batch: 1, key: sam.key } });
        expect(row!.rejectReason).toContain('another author');
        expect(client.getState().recordings[(rec.payload as { recordingId: string }).recordingId]).toBeUndefined();
        expect(await store.nearbyCount(ORG, LANG)).toBe(0);
        expect(await store.pendingCount(ORG, LANG)).toBe(0);
      });

      it('a claim under another author is not a batch row: at or below the cursor it goes as any copy does', async () => {
        await toServer(...units());
        const rec = recordingBy(sam, 'r1');
        const client = await myPhone({ transport: answering((ids) => ids.map((id) => ({ id, serverSeq: 1, hlc: rec.hlc, actorId: 'mallory' }))) });
        await client.receiveNearby(await claimsOf([rec], () => 7), intakeFor());
        await client.sync();
        expect(await rowOf(store, rec.id)).toBeUndefined();
      });

      it('Try again does not bring back what the sweep refused, because no door here can answer the server', async () => {
        await toServer(...units());
        const [a, b] = [recordingBy(sam, 'r1'), recordingBy(sam, 'r2')];
        const client = await myPhone({ transport: answering((ids) => ids.filter((id) => id === a.id).map((id) => ({ id, serverSeq: 1, hlc: a.hlc, actorId: 'mallory' }))) });
        await client.receiveNearby(await pageOf(sam, 1, [a]), intakeFor());
        await client.receiveNearby(await claimsOf([b], () => 9), intakeFor());
        await client.sync();
        expect(await statusOf(store, a.id)).toBe('rejected');
        expect(await statusOf(store, b.id)).toBe('rejected');

        expect(await client.retryNearby(intakeFor())).toBe(0);
        expect(await statusOf(store, a.id)).toBe('rejected');
        expect(await statusOf(store, b.id)).toBe('rejected');
        expect(await store.pendingCount(ORG, LANG)).toBe(0);
      });
    });

    describe('when it asks', () => {
      it('a phone offline asks nothing and changes nothing', async () => {
        await toServer(...units());
        const rec = recordingBy(sam, 'r1');
        const client = await myPhone();
        await client.sync();
        await client.receiveNearby(await pageOf(sam, 1, [rec]), intakeFor());
        server.offline = true;

        expect((await client.sync()).offline).toBe(true);
        expect(server.knownEventsCalls).toBe(0);
        expect(await statusOf(store, rec.id)).toBe('nearby');
      });

      it('a link lost between pages keeps what the pages before it settled, and the fold follows the log', async () => {
        const recs = Array.from({ length: 501 }, (_, i) => recordingBy(sam, `r${i}`, 'u2'));
        const held = recs.slice(0, 500);
        await adoptable(...held);
        const t = server.transportFor();
        const known = t.knownEvents!;
        let calls = 0;
        t.knownEvents = async (...a) => {
          calls += 1;
          if (calls > 1) throw new OfflineError('fetch failed');
          return known(...a);
        };
        const client = await myPhone({ transport: t });
        await store.commit({ receive: recs.map((event) => ({ event, status: 'nearby' as const, via: { batch: 1, key: sam.key } })) });
        await client.load();

        expect((await client.sync()).offline).toBe(true);
        expect(calls).toBe(2);
        const left = await store.nearbyCount(ORG, LANG);
        expect(left).toBeGreaterThan(0);
        expect(left).toBeLessThan(501);
      });

      it('a null from the database does nothing', async () => {
        const rec = recordingBy(sam, 'r1');
        await adoptable(rec);
        const client = await myPhone({ nearby: certified });
        await client.receiveNearby(await pageOf(sam, 1, [rec]), intakeFor());
        server.knownEventsBehind = true;

        expect((await client.sync()).offline).toBe(false);
        expect(server.knownEventsCalls).toBe(1);
        expect(await statusOf(store, rec.id)).toBe('nearby');
      });

      it('a transport without it syncs as before', async () => {
        await toServer(...units());
        const rec = recordingBy(sam, 'r1');
        const t = server.transportFor();
        delete t.knownEvents;
        const client = await myPhone({ transport: t });
        await client.receiveNearby(await pageOf(sam, 1, [rec]), intakeFor());
        await client.sync();
        expect(await statusOf(store, rec.id)).toBe('nearby');
      });

      it('a phone with no nearby rows makes no call', async () => {
        await toServer(...units());
        const client = await myPhone();
        await client.sync();
        await client.sync();
        expect(server.knownEventsCalls).toBe(0);
      });

      it('asks in pages of 500', async () => {
        await toServer(...units());
        const client = await myPhone();
        const recs = Array.from({ length: 501 }, (_, i) => recordingBy(sam, `r${i}`, 'u2'));
        await store.commit({ receive: recs.map((event) => ({ event, status: 'nearby' as const, via: { batch: 1, key: sam.key } })) });
        await client.load();
        await client.sync();
        expect(server.knownEventsCalls).toBe(2);
        expect(await store.nearbyCount(ORG, LANG)).toBe(501);
      });

      it('waits while there is more to pull', async () => {
        await toServer(...units());
        const rec = recordingBy(sam, 'r1');
        const client = await myPhone({ pullPageSize: 1, pullBudgetMs: 0 });
        await client.receiveNearby(await pageOf(sam, 1, [rec]), intakeFor());
        expect((await client.sync()).more).toBe(true);
        expect(server.knownEventsCalls).toBe(0);
        while ((await client.sync()).more);
        expect(server.knownEventsCalls).toBeGreaterThan(0);
      });
    });

    describe('what follows a drop', () => {
      it('a dropped copy\'s passage gets its line worked out again', async () => {
        // Why: `foldLocal` marks lines only for what is in the log and for refused rows, so a copy that left says nothing.
        const { onServer, nearby } = sameId('r1', { serverAt: NOW + 5, nearbyAt: NOW - 5 });
        await adoptable(onServer);
        const client = await myPhone();
        await client.receiveNearby(await pageOf(sam, 1, [nearby]), intakeFor());
        await client.settleLines();
        expect(client.passageLines().get('u2').worked).toBe(true);

        await client.sync();
        await client.settleLines();
        expect(client.passageLines().get('u2').worked).toBe(false);
        expect(client.passageLines().get('u1').worked).toBe(true);
      });

      it('a checkpoint afterwards holds nothing that was nearby, a copy gone, a row refused or a row kept', async () => {
        // Why: this is the one that cannot be undone. A checkpoint is confirmed for good (5.4).
        const { onServer, nearby } = sameId('gone', { serverAt: NOW + 5, nearbyAt: NOW + 5 });
        await adoptable(onServer);
        const client = await myPhone({ checkpointEvery: 1 });
        await client.receiveNearby(await pageOf(sam, 1, [nearby]), intakeFor());
        const kept = recordingBy(sam, 'kept', 'u2');
        await client.receiveNearby(await pageOf(sam, 2, [kept]), intakeFor());
        const refused = recordingBy(mallory, 'refused', 'u2');
        await client.receiveNearby(await claimsOf([refused], () => 50), intakeFor());
        await client.sync();
        expect(await statusOf(store, refused.id)).toBe('rejected');

        await toServer(unitBy(sam, 'u3'));
        await client.sync();
        expect(await store.cursor(ORG, LANG)).toBe(server.head(ORG, LANG));

        const raw = await store.meta(`snapshot:${ORG}/${LANG}`);
        const checkpoint = JSON.parse(raw!) as { serverSeq: number; state: LanguageState };
        expect(checkpoint.serverSeq).toBe(server.head(ORG, LANG));
        const named = (e: AnyEvent) => (e.payload as { recordingId: string }).recordingId;
        const inCheckpoint = checkpoint.state.recordings;
        expect(inCheckpoint[named(kept)]).toBeUndefined();
        expect(inCheckpoint[named(refused)]).toBeUndefined();
        expect(await store.keptById(ORG, LANG, 'recording', [named(kept), named(refused)])).toEqual([]);
        // The copy that left, whose clock said nothing: the server's says u1, wherever it is kept.
        const fresh = phone(server, store, mine, { keepOnDisk });
        await fresh.load();
        expect((await fresh.withPassages(UNITS)).recordings[named(nearby)]?.unitId).toBe('u1');
        // With the rest settled too, the fast path is open and saves the server's fold alone.
        await toServer(kept);
        await client.sync();
        await toServer(unitBy(sam, 'u4'));
        await client.sync();
        expect(await store.nearbyCount(ORG, LANG)).toBe(0);
        const last = phone(server, store, mine, { keepOnDisk });
        await last.load();
        const state = await last.withPassages(UNITS);
        expect(state.recordings[named(nearby)]?.unitId).toBe('u1');
        expect(state.recordings[named(refused)]).toBeUndefined();
        const onServerFold = foldLanguage([...server.stream(ORG, LANG)], emptyLanguageState());
        expect(Object.keys(state.recordings).sort()).toEqual(Object.keys(onServerFold.recordings).sort());
      });

      it('the fast path, once it opens, does not save a copy whose clock said nothing', async () => {
        // Why the fold is worked out on every drop: with no row left, the next checkpoint saves the live state as confirmed.
        const { onServer, nearby } = sameId('r1', { serverAt: NOW + 5, nearbyAt: NOW + 5 });
        await adoptable(onServer);
        const client = await myPhone({ checkpointEvery: 1 });
        await client.receiveNearby(await pageOf(sam, 1, [nearby]), intakeFor());
        await client.sync();
        expect(await store.nearbyCount(ORG, LANG)).toBe(0);

        await toServer(unitBy(sam, 'u3'));
        await client.sync();
        const id = (nearby.payload as { recordingId: string }).recordingId;
        const fresh = phone(server, store, mine, { keepOnDisk });
        await fresh.load();
        expect((await fresh.withPassages(UNITS)).recordings[id]?.unitId).toBe('u1');
      });

      it('a pruned event coming back sits as nearby, blocks the fast path, inflates the count and changes nothing, until the next sweep', async () => {
        const unit = unitBy(sam, 'u1');
        await toServer(unit, unitBy(sam, 'u2'));
        const client = await myPhone({ checkpointEvery: 1 });
        await client.sync();
        expect(await rowOf(store, unit.id)).toBeUndefined();
        const before = JSON.stringify((await whole(client)).units);
        server.offline = true;

        const receipt = await client.receiveNearby(await pageOf(sam, 1, [unit]), intakeFor());
        expect(receipt).toMatchObject({ kept: 1, counted: true });
        expect(await store.nearbyCount(ORG, LANG)).toBe(1);
        expect(await store.unconfirmedCount(ORG, LANG)).toBe(1);
        expect((await client.inspect()).nearby).toBe(1);
        expect(JSON.stringify((await whole(client)).units)).toBe(before);

        server.offline = false;
        await client.sync();
        expect(await store.nearbyCount(ORG, LANG)).toBe(0);
        expect(JSON.stringify((await whole(client)).units)).toBe(before);
      });
    });

    describe('a number whose ids the sweep found on the server', () => {
      const counted = async (client: SyncClient, n: number) => isCounted(await vectorOf(client), sam.key, n);

      it('closes when every id is here or on the server: a dropped id does not read as missing', async () => {
        const [a, b] = [recordingBy(sam, 'r1'), recordingBy(sam, 'r2')];
        await adoptable(a, b);
        const client = await myPhone({ nearby: certified });
        // A teammate sent only part of it: their copy of the rest was already confirmed.
        const receipt = await client.receiveNearby(await pageOf(sam, 1, [a, b], { carrying: [b] }), intakeFor());
        expect(receipt.counted).toBe(false);

        await client.sync();
        expect(await rowOf(store, b.id)).toBeUndefined();
        expect(await counted(client, 1)).toBe(true);
      });

      it('a row kept alongside counts as here, under its digest', async () => {
        const [a, b] = [recordingBy(sam, 'r1'), recordingBy(sam, 'r2')];
        await adoptable(a);
        const client = await myPhone({ nearby: certified });
        // b here and not sent yet; a dropped: the number is whole as far as this phone can ever tell.
        await client.receiveNearby(await pageOf(sam, 1, [a, b]), intakeFor());
        await store.commit({ meta: { [`nearbyVector:${ORG}/${LANG}`]: '{}' } });

        await client.sync();
        expect(await rowOf(store, a.id)).toBeUndefined();
        expect(await statusOf(store, b.id)).toBe('nearby');
        expect(await counted(client, 1)).toBe(true);
      });

      it('stays open on an id on neither side, so a teammate cannot close it by leaving events out', async () => {
        const [a, b] = [recordingBy(sam, 'r1'), recordingBy(sam, 'r2')];
        await adoptable(a);
        const client = await myPhone({ nearby: certified });
        await client.receiveNearby(await pageOf(sam, 1, [a, b], { carrying: [a] }), intakeFor());

        await client.sync();
        expect(await rowOf(store, a.id)).toBeUndefined();
        expect(await counted(client, 1)).toBe(false);
      });

      it('stays open on an id the server holds under another author', async () => {
        const [a, b] = [recordingBy(sam, 'r1'), recordingBy(sam, 'r2')];
        await adoptable(a);
        const t = server.transportFor();
        const known = t.knownEvents!;
        t.knownEvents = async (o, s, ids) => [...(await known(o, s, ids)) ?? [], ...ids.filter((id) => id === b.id).map((id) => ({ id, serverSeq: 1, hlc: b.hlc, actorId: 'mallory' }))];
        const client = await myPhone({ nearby: certified, transport: t });
        await client.receiveNearby(await pageOf(sam, 1, [a, b], { carrying: [a] }), intakeFor());

        await client.sync();
        expect(await counted(client, 1)).toBe(false);
      });

      it('a digest mismatch never counts: a dropped copy whose clock is not the server\'s leaves the number open, and asks nothing more', async () => {
        const { onServer, nearby } = sameId('r1', { serverAt: NOW + 5, nearbyAt: NOW - 5 });
        await adoptable(onServer);
        const client = await myPhone({ nearby: certified });
        await client.receiveNearby(await pageOf(sam, 1, [nearby, recordingBy(sam, 'r2')], { carrying: [nearby] }), intakeFor());

        await client.sync();
        expect(await rowOf(store, nearby.id)).toBeUndefined();
        expect(await counted(client, 1)).toBe(false);
        expect(server.knownEventsCalls).toBe(1);
      });

      it('a row here under another digest does not close it either', async () => {
        const [a, b] = [recordingBy(sam, 'r1'), recordingBy(sam, 'r2')];
        const otherB = { ...b, hlc: b.hlc.replace(/^\d+/, (w) => String(Number(w) - 1).padStart(15, '0')) } as AnyEvent;
        await adoptable(a);
        const client = await myPhone({ nearby: certified });
        await client.receiveNearby(await pageOf(sam, 1, [a, b], { carrying: [a] }), intakeFor());
        await store.commit({ events: [{ event: otherB, status: 'pending' }] });

        await client.sync();
        expect(await counted(client, 1)).toBe(false);
      });

      it('a member signing many batches of ids nobody has costs one more call, however many', async () => {
        const reals = Array.from({ length: 12 }, (_, i) => recordingBy(sam, `r${i}`));
        await adoptable(...reals);
        const client = await myPhone({ nearby: certified });
        let n = 0;
        for (const real of reals) {
          n += 1;
          const made = Array.from({ length: 199 }, (_, i) => recordingBy(sam, `fake-${n}-${i}`));
          await client.receiveNearby(await pageOf(sam, n, [real, ...made], { carrying: [real] }), intakeFor());
        }

        await client.sync();
        expect(await store.nearbyCount(ORG, LANG)).toBe(0);
        expect(server.knownEventsCalls).toBe(2);
        for (let i = 1; i <= n; i++) expect(await counted(client, i)).toBe(false);
      });

      it('a phone without the platform half sweeps all the same and closes nothing', async () => {
        const [a, b] = [recordingBy(sam, 'r1'), recordingBy(sam, 'r2')];
        await adoptable(a, b);
        const client = await myPhone();
        await client.receiveNearby(await pageOf(sam, 1, [a, b], { carrying: [b] }), intakeFor());
        await client.sync();
        expect(await rowOf(store, b.id)).toBeUndefined();
        expect(await counted(client, 1)).toBe(false);
      });
    });

    describe('an undo that holds a slot when its target is pulled', () => {
      const oldReview = (reviewId: string) => eventBy(sam, 'v1.ReviewRecorded', { reviewId, takeId: 't1', kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'slower' }, { id: `${reviewId}-event:0` });

      it('is not settled by the sweep: the server has not got it, so the table keeps it, and only delivery can say', async () => {
        // A wrong withdrawal of an unbound review passes, because the review is not here.
        const forged = eventBy(mallory, 'v1.ReviewWithdrawn', { reviewId: 'rv-old' }, { at: NOW - 100 });
        const client = await myPhone();
        await client.receiveNearby(await pageOf(mallory, 1, [forged]), intakeFor());
        await toServer(oldReview('rv-old'), eventBy(sam, 'v1.ReviewWithdrawn', { reviewId: 'rv-old' }, { at: NOW + 100 }));

        await client.sync();
        expect(await statusOf(store, forged.id)).toBe('nearby');
        const state = await client.withPassages(UNITS);
        // The slot is still the wrong one, so the author's real withdrawal, pulled from the server, counts for nothing here.
        expect(state.withdrawnReviews['rv-old']?.by).toBe('mallory');
      });

      it('never reaches a checkpoint: the wrong undo is left out, and the author\'s is what is saved', async () => {
        const forged = eventBy(mallory, 'v1.ReviewWithdrawn', { reviewId: 'rv-old' }, { at: NOW - 100 });
        const client = await myPhone({ checkpointEvery: 1 });
        await client.receiveNearby(await pageOf(mallory, 1, [forged]), intakeFor());
        await toServer(oldReview('rv-old'), eventBy(sam, 'v1.ReviewWithdrawn', { reviewId: 'rv-old' }, { at: NOW + 100 }));

        await client.sync();
        const checkpoint = JSON.parse((await store.meta(`snapshot:${ORG}/${LANG}`))!) as { state: LanguageState };
        expect(checkpoint.state.withdrawnReviews['rv-old']?.by).toBe('sam');
      });
    });
  });

});

describe('the lists that wrap a transport', () => {
  // Why: `FakeServer`, `shapeTransport` and `SimDevice.observed` each list the optional methods by hand, and a list that
  // misses one turns its feature off and says nothing: a fleet scenario would pass with no sweep in it.
  const inner = new FakeServer().transportFor();
  const shape = () => shapeTransport(inner, {
    link: () => ({ latencyMs: 0, bytesPerSecond: Infinity, dropRate: 0, online: () => true }),
    now: () => 0, sleep: async () => undefined, random: () => 0.5
  });
  const observed = () => {
    const device = new SimDevice('d', 'a', null as never, null as never, null as never, { time: { now: () => 0 } } as never, null as never);
    return (device as unknown as { observed(t: Transport): Transport }).observed(inner);
  };

  it('FakeServer has what the sweep and claims ask', () => {
    expect(inner.knownEvents).toBeTypeOf('function');
    expect(inner.attest).toBeTypeOf('function');
  });

  it.each([['shapeTransport', shape], ['SimDevice.observed', observed]])('%s keeps every method', async (_name, wrap) => {
    const wrapped = wrap();
    expect(Object.keys(wrapped).sort()).toEqual(Object.keys(inner).sort());
    expect(await wrapped.knownEvents!(ORG, LANG, [])).toEqual([]);
    expect(await wrapped.attest!(ORG, LANG, 0)).toBeNull();
  });

  it('a transport with neither, wrapped, has neither, so a sweep cannot call what is not there', () => {
    const none = new FakeServer().transportFor();
    delete none.knownEvents;
    delete none.attest;
    const wrapped = shapeTransport(none, {
      link: () => ({ latencyMs: 0, bytesPerSecond: Infinity, dropRate: 0, online: () => true }),
      now: () => 0, sleep: async () => undefined, random: () => 0.5
    });
    expect(wrapped.knownEvents).toBeUndefined();
    expect(wrapped.attest).toBeUndefined();
  });
});
