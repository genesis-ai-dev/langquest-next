import fc from 'fast-check';
import { emptyLanguageState, foldLanguage, keptVerdict, newCommandId, PART_OF_KIND, putEntry, withOwnParts, type LanguageState } from '@langquest-next/core';
import { FILE, PART_KINDS } from '../src/keptLanguage';
import { FakeServer } from '../src/testing/fakeServer';
import { foldDigest } from '../src/testing/fleet/fleet';
import { memoryNearbyPair, type MemoryFiles } from '../src/testing/memoryNearbyLink';
import { LANG, ORG, STORES, teammate, worker, type Teammate } from './nearbyFixtures';
import { newTime, record, sessionFor, settled, testPhone, type TestPhone } from './nearbyKit';

/**
 * Nearby converges (docs/nearby-sync-plan.md section 8, the Property row). Why: a nearby
 * phone is not a server (5.1), so however work is split among phones, whichever pairs meet
 * in whatever order, and whatever links drop mid-session, once every phone has reached the
 * server each one must fold to exactly what the server's log folds to (PLAN.md invariant 2),
 * with nothing left nearby. Without delivery only an author sends its own work up, so every
 * phone reaches the server at the end, in an order the run picks, and some go to town on the
 * way. From phase 4 (section 6), after a full round of exchanges any one phone alone reaching
 * the server leaves it holding every event any phone made, for authors within their budget.
 */

type Step =
  | { t: 'work'; phone: number; what: 'unit' | 'record' | 'note' | 'withdraw' | 'take' | 'review' }
  | { t: 'pair'; a: number; b: number; dropAt: number | null }
  | { t: 'town'; phone: number };

const PHONES = 4;

const step: fc.Arbitrary<Step> = fc.oneof(
  { weight: 4, arbitrary: fc.record({ t: fc.constant('work' as const), phone: fc.nat(PHONES - 1), what: fc.constantFrom('unit', 'record', 'note', 'withdraw', 'take', 'review') as fc.Arbitrary<'unit'> }) },
  { weight: 3, arbitrary: fc.record({ t: fc.constant('pair' as const), a: fc.nat(PHONES - 1), b: fc.nat(PHONES - 1), dropAt: fc.option(fc.integer({ min: 1, max: 40 }), { freq: 3 }) }) },
  { weight: 1, arbitrary: fc.record({ t: fc.constant('town' as const), phone: fc.nat(PHONES - 1) }) }
);

/** The language as a phone that keeps it on disk has it: memory and every kept row combined. */
async function whole(p: TestPhone, kept: boolean): Promise<LanguageState> {
  const live = p.client.getState() as LanguageState;
  if (!kept) return live;
  const s = withOwnParts(structuredClone(live));
  for (const kind of PART_KINDS) for (const row of await p.store.keptAll(ORG, LANG, kind)) putEntry(s, PART_OF_KIND.get(kind)!, row.id, JSON.parse(row.json));
  for (const row of await p.store.keptAll(ORG, LANG, FILE)) {
    const k = JSON.parse(row.json) as LanguageState['blobs'][string];
    const here = s.blobs[row.id];
    s.blobs[row.id] = here ? keptVerdict(k, here) : k;
  }
  return s;
}

/** Sync until this phone has nothing more to send or pull. */
async function toTown(p: TestPhone): Promise<void> {
  for (let i = 0; i < 20; i++) {
    const r = await p.client.sync();
    if (!r.more) return;
  }
}

// SQLite runs the store's real SQL, at half the runs, to stay well inside the unit timeout.
const RUNS: Record<string, number> = { memory: 200, SQLite: 100 };

describe.each(STORES)('nearby converges on the %s store', (name, make) => {
  let people: Teammate[];
  beforeAll(async () => {
    people = await Promise.all(Array.from({ length: PHONES }, (_, i) => teammate(`p${i}`)));
  });

  it('any split of work, any pairings in any order with drops, then trips to town: every phone folds to the server\'s log, with nothing nearby', async () => {
    // Across the runs, so a property that never moved anything between phones cannot pass.
    const moved = { events: 0, files: 0, ends: {} as Record<string, number> };
    const runs = Number(process.env['NEARBY_RUNS'] ?? RUNS[name]);
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 2, max: PHONES }),
      fc.array(step, { minLength: 1, maxLength: 24 }),
      fc.array(fc.nat(PHONES - 1), { minLength: 0, maxLength: 3 }),
      fc.boolean(),
      async (n, steps, firstToTown, keepOdd) => {
        const server = new FakeServer();
        server.attester = (orgId, streamId, rows) => worker.attestRows(orgId, streamId, rows);
        const shelf: MemoryFiles = new Map();
        const time = newTime();
        const kept = (i: number) => keepOdd && i % 2 === 1;
        const phones: TestPhone[] = [];
        for (let i = 0; i < n; i++) phones.push(await testPhone(server, make(), people[i]!, shelf, kept(i) ? { keepOnDisk: true, checkpointEvery: 3 } : {}));
        // What each phone made, so later work can point at it: some of it only another phone has.
        const units: string[] = ['u0'];
        const takes: string[] = [];
        const notes = new Map<number, string[]>();
        let serial = 0;
        for (const s of steps) {
          if (s.t === 'work') {
            const p = phones[s.phone % n]!;
            const by = p.who.profileId;
            const id = (what: string) => newCommandId(by, `${what}${++serial}`);
            const unitId = units[serial % units.length]!;
            if (s.what === 'unit') {
              const u = id('u');
              units.push(u);
              await p.client.append('v1.UnitAdded', { unitId: u, parentUnitId: null, kind: 'passage', label: u, order: u });
            } else if (s.what === 'record') {
              await record(p, shelf, `r${++serial}`, unitId);
            } else if (s.what === 'note') {
              const noteId = id('n');
              notes.set(s.phone % n, [...(notes.get(s.phone % n) ?? []), noteId]);
              await p.client.append('v1.NoteAdded', { noteId, unitId, anchor: { kind: 'passage' }, text: 'a note' });
            } else if (s.what === 'withdraw') {
              const mine = notes.get(s.phone % n) ?? [];
              if (mine.length > 0) await p.client.append('v1.NoteWithdrawn', { noteId: mine.shift()! });
            } else if (s.what === 'take') {
              const takeId = id('t');
              takes.push(takeId);
              await p.client.append('v1.TakeComposed', { takeId, unitId, cardHashes: [`c${serial}`], parentTakeId: null });
              await p.client.append('v1.TakeSubmitted', { takeId });
            } else if (takes.length > 0) {
              await p.client.append('v1.ReviewRecorded', { reviewId: id('rv'), takeId: takes[serial % takes.length]!, kindId: 'peer', outcome: serial % 2 ? 'looks_good' : 'needs_changes', via: 'app' });
            }
          } else if (s.t === 'pair') {
            const a = phones[s.a % n]!;
            const b = phones[s.b % n]!;
            if (a === b) continue;
            const pair = memoryNearbyPair({ time, files: shelf });
            if (s.dropAt !== null) pair.dropAt(s.dropAt);
            const [ra, rb] = await settled(time, sessionFor(a, 'i', pair.a, time).run(), sessionFor(b, 'r', pair.b, time).run());
            moved.events += ra.got.events + rb.got.events;
            moved.files += ra.files.got + rb.files.got;
            moved.ends[ra.ended.how] = (moved.ends[ra.ended.how] ?? 0) + 1;
          } else {
            await toTown(phones[s.phone % n]!);
          }
        }
        // Everyone reaches the server: some first, then all, twice, so the last to push is pulled by the first.
        for (const i of firstToTown) await toTown(phones[i % n]!);
        for (let round = 0; round < 2; round++) for (const p of phones) await toTown(p);

        const expected = foldDigest(foldLanguage(server.stream(ORG, LANG), emptyLanguageState()));
        for (const [i, p] of phones.entries()) {
          const view = await p.client.inspect();
          expect({ phone: i, nearby: view.nearby, pending: view.pending.length }).toEqual({ phone: i, nearby: 0, pending: 0 });
          expect({ phone: i, digest: foldDigest(await whole(p, kept(i))) }).toEqual({ phone: i, digest: expected });
        }
      }
    ), { numRuns: runs });
    expect(moved.events).toBeGreaterThan(runs / 4);
    expect(moved.files).toBeGreaterThan(0);
    expect(moved.ends['dropped']).toBeGreaterThan(0);
    expect(moved.ends['done']).toBeGreaterThan(0);
  });

  it('phase 4: after a full round of exchanges, any one phone alone reaching the server leaves it every event any phone made, and then every phone folds to it', async () => {
    // Files are the fleet's to check (fleet.test.ts, delivery through a teammate): these phones have no uploader.
    const runs = Math.ceil(Number(process.env['NEARBY_RUNS'] ?? RUNS[name]) / 2);
    let delivered = 0;
    await fc.assert(fc.asyncProperty(
      fc.integer({ min: 2, max: PHONES }),
      fc.array(fc.record({ phone: fc.nat(PHONES - 1), what: fc.constantFrom('unit', 'record', 'note', 'take') as fc.Arbitrary<'unit'> }), { minLength: 1, maxLength: 16 }),
      fc.array(fc.record({ a: fc.nat(PHONES - 1), b: fc.nat(PHONES - 1), dropAt: fc.option(fc.integer({ min: 1, max: 40 }), { freq: 2 }) }), { maxLength: 6 }),
      fc.nat(PHONES - 1),
      fc.boolean(),
      async (n, work, earlier, carrierAt, keepOdd) => {
        const server = new FakeServer();
        server.relaying = true;
        server.attester = (orgId, streamId, rows) => worker.attestRows(orgId, streamId, rows);
        const shelf: MemoryFiles = new Map();
        const time = newTime();
        const kept = (i: number) => keepOdd && i % 2 === 1;
        const phones: TestPhone[] = [];
        for (let i = 0; i < n; i++) phones.push(await testPhone(server, make(), people[i]!, shelf, kept(i) ? { keepOnDisk: true, checkpointEvery: 3 } : {}));
        let serial = 0;
        const units = ['u0'];
        for (const w of work) {
          const p = phones[w.phone % n]!;
          const id = (what: string) => newCommandId(p.who.profileId, `${what}${++serial}`);
          const unitId = units[serial % units.length]!;
          if (w.what === 'unit') {
            const u = id('u');
            units.push(u);
            await p.client.append('v1.UnitAdded', { unitId: u, parentUnitId: null, kind: 'passage', label: u, order: u });
          } else if (w.what === 'record') await record(p, shelf, `r${++serial}`, unitId);
          else if (w.what === 'note') await p.client.append('v1.NoteAdded', { noteId: id('n'), unitId, anchor: { kind: 'passage' }, text: 'a note' });
          else {
            const takeId = id('t');
            await p.client.append('v1.TakeComposed', { takeId, unitId, cardHashes: [`c${serial}`], parentTakeId: null });
          }
        }
        const pairUp = async (a: TestPhone, b: TestPhone, dropAt: number | null) => {
          const pair = memoryNearbyPair({ time, files: shelf });
          if (dropAt !== null) pair.dropAt(dropAt);
          await settled(time, sessionFor(a, 'i', pair.a, time).run(), sessionFor(b, 'r', pair.b, time).run());
        };
        // Some meetings that drop, then a full round: every pair twice, so all each holds reaches all.
        for (const e of earlier) if (e.a % n !== e.b % n) await pairUp(phones[e.a % n]!, phones[e.b % n]!, e.dropAt);
        for (let pass = 0; pass < 2; pass++) for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) await pairUp(phones[a]!, phones[b]!, null);

        const made = new Set<string>();
        for (const p of phones) for (const l of [...(await p.client.inspect()).pending, ...(await p.store.nearbyPage(ORG, LANG, null, 10_000))]) made.add(l.event.id);
        const carrier = phones[carrierAt % n]!;
        await toTown(carrier);
        const onServer = new Set(server.stream(ORG, LANG).map((e) => e.id));
        expect([...made].filter((id) => !onServer.has(id))).toEqual([]);
        delivered += server.stream(ORG, LANG).filter((e) => e.actorId !== carrier.who.profileId).length;

        for (let round = 0; round < 2; round++) for (const p of phones) await toTown(p);
        const expected = foldDigest(foldLanguage(server.stream(ORG, LANG), emptyLanguageState()));
        for (const [i, p] of phones.entries()) {
          expect({ phone: i, nearby: (await p.client.inspect()).nearby }).toEqual({ phone: i, nearby: 0 });
          expect({ phone: i, digest: foldDigest(await whole(p, kept(i))) }).toEqual({ phone: i, digest: expected });
        }
      }
    ), { numRuns: runs });
    // Across the runs, so a property where nobody delivered anything cannot pass.
    expect(delivered).toBeGreaterThan(0);
  });
});
