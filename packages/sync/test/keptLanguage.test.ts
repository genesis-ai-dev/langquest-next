import { DatabaseSync } from 'node:sqlite';
import {
  buildIndexes, derivePassage, HlcClock, keptVerdict, languageLines, PART_OF_KIND, putEntry, updatesFor, withOwnParts, type LanguageState
} from '@langquest-next/core';
import { PART_KINDS } from '../src/keptLanguage';
import { MemoryStore } from '../src/memoryStore';
import { SqliteStore, type SqlDriver } from '../src/sqliteStore';
import type { EventStore } from '../src/types';
import { SyncClient } from '../src/syncClient';
import { LanguageFiles } from '../src/languageFiles';
import { FakeServer } from '../src/testing/fakeServer';

/**
 * A big language keeps each passage's records (recordings, versions,
 * reviews, notes, requests and the rest) and the file verdicts on the
 * phone, not in memory, and holds in memory only the passages a screen has
 * open, with a line per passage for lists (decisions.md 110). Why these tests: memory must shrink without the
 * phone's language ever differing from what folding everything in memory
 * gives, whatever order things arrive in, and without losing anything to a
 * dropped link, an old checkpoint or a redaction.
 */
type Lang = LanguageState;
let ids = 0;

/** node:sqlite, the test twin of the phone's driver: the kept table's SQL runs for real. */
function sqlite(): EventStore {
  const db = new DatabaseSync(':memory:');
  const driver: SqlDriver = {
    run: async (sql, params = []) => { db.prepare(sql).run(...(params as never[])); },
    all: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as T[],
    transaction: async (fn) => { db.exec('begin'); try { await fn(driver); db.exec('commit'); } catch (e) { db.exec('rollback'); throw e; } }
  };
  let opened: Promise<SqliteStore> | null = null;
  const store = () => (opened ??= SqliteStore.open(driver));
  // Every method waits for the schema, so the store can be handed over at once.
  return new Proxy({} as EventStore, { get: (_t, k) => async (...a: unknown[]) => ((await store()) as unknown as Record<string, (...x: unknown[]) => unknown>)[k as string]!(...a) });
}

/** Each test runs on both stores: the memory twin, and SQLite as the phone runs it. */
let makeStore: () => EventStore = () => new MemoryStore();

function phone(server: FakeServer, deviceId: string, actorId: string, opts: { keepOnDisk?: boolean; checkpointEvery?: number; store?: EventStore; build?: string } = {}) {
  const store = opts.store ?? makeStore();
  const client = new SyncClient({
    orgId: 'org1', streamId: 'p1', actorId, deviceId, store, transport: server.transportFor(),
    clock: new HlcClock(deviceId, () => ++ids), newId: () => `${deviceId}-${++ids}`,
    ...(opts.keepOnDisk ? { keepOnDisk: true } : {}),
    ...(opts.checkpointEvery ? { checkpointEvery: opts.checkpointEvery } : {}),
    ...(opts.build ? { build: opts.build } : {})
  });
  return { client, store };
}

/** The language as a phone that keeps records on disk has it: memory combined with everything kept. */
async function whole(c: SyncClient, store: EventStore): Promise<Lang> {
  const s = withOwnParts(structuredClone(c.getState()) as Lang);
  for (const kind of PART_KINDS) {
    for (const row of await store.keptAll('org1', 'p1', kind)) putEntry(s, PART_OF_KIND.get(kind)!, row.id, JSON.parse(row.json));
  }
  for (const row of await store.keptAll('org1', 'p1', 'file')) {
    const kept = JSON.parse(row.json) as Lang['blobs'][string];
    const here = s.blobs[row.id];
    s.blobs[row.id] = here ? keptVerdict(kept, here) : kept;
  }
  return s;
}
const comparable = (s: Lang) => ({ ...s, appliedEventIds: {} });

/**
 * A round of everything a team does to a few passages, from one phone:
 * versions, reviews and their answers, requests and withdrawals,
 * departures and undos, notes with voice, key-term ties, releases, study
 * marks, verse marks, references. Some arrive before what they hang on.
 */
async function work(c: SyncClient, tag: string, units: string[]) {
  const [a, b] = units as [string, string];
  await c.append('v1.TakeComposed', { takeId: `t-${tag}`, unitId: a, cardHashes: [`c-${tag}`], parentTakeId: null });
  await c.append('v1.TakeSubmitted', { takeId: `t-${tag}` });
  await c.append('v1.ReviewRecorded', { reviewId: `rv-${tag}`, takeId: `t-${tag}`, kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'slower', commentBlobHash: `cv-${tag}` });
  await c.append('v1.TakeComposed', { takeId: `t2-${tag}`, unitId: a, cardHashes: [`c2-${tag}`], parentTakeId: `t-${tag}` });
  await c.append('v1.TakeSubmitted', { takeId: `t2-${tag}` });
  await c.append('v1.ResponseRecorded', { takeId: `t2-${tag}`, respondsToTakeId: `t-${tag}`, note: 'slowed down' });
  await c.append('v1.TakeComposed', { takeId: `d-${tag}`, unitId: b, cardHashes: [`dc-${tag}`], parentTakeId: null });
  await c.append('v1.RequestMade', { requestId: `q-${tag}`, unitId: a, what: 'review', kindId: 'community', profileId: 'lead' });
  await c.append('v1.RequestMade', { requestId: `q2-${tag}`, unitId: b, what: 'record', profileId: 'r1', noteBlobHash: `qv-${tag}` });
  await c.append('v1.RequestWithdrawn', { requestId: `q2-${tag}` });
  await c.append('v1.DepartureUndone', { departureId: `dep-${tag}` });
  await c.append('v1.DepartureRecorded', { departureId: `dep-${tag}`, unitId: b, type: 'skip', kindId: 'peer', reason: 'no peer' });
  await c.append('v1.NoteAdded', { noteId: `n-${tag}`, unitId: b, anchor: { kind: 'passage' }, text: 'hm', blobHash: `nv-${tag}` });
  await c.append('v1.KeyTermLinked', { takeId: `t2-${tag}`, termId: 'logos', note: 'word' });
  await c.append('v1.VersionReleased', { takeId: `t2-${tag}`, channel: 'web', live: true });
  await c.append('v1.StudyStepMarked', { unitId: a, guideId: 'fia:g1', stepId: 's1', done: true });
  await c.append('v1.CardVerseSet', { unitId: a, hash: `c2-${tag}`, mark: 'next' });
  await c.append('v1.PassageReferenceLinked', { unitId: a, itemId: 'bsb', linked: true });
  await c.append('v1.ReferencesUsed', { unitId: a, reviewId: `rv-${tag}`, items: [{ itemId: 'bsb', name: 'BSB', kind: 'source', opened: true }] });
  // Archived before it was ever composed (another phone's compose arrives later), and an undo of a departure nobody made.
  await c.append('v1.TakeArchived', { takeId: `late-${tag}` });
  await c.append('v1.DepartureUndone', { departureId: `never-${tag}` });
}

/** Each passage's line, a lists' view, compared by value. */
function linesOf(lines: { get(u: string): unknown }, units: string[]) {
  return Object.fromEntries(units.map((u) => [u, JSON.parse(JSON.stringify(lines.get(u)))]));
}

/** A language with `n` passages, each with a recording whose file the server stored. */
async function language(server: FakeServer, n: number) {
  const lead = phone(server, 'dA', 'lead');
  await lead.client.load();
  for (let i = 0; i < n; i++) {
    await lead.client.append('v1.UnitAdded', { unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${String(i).padStart(3, '0')}` });
    await lead.client.append('v1.RecordingAdded', { recordingId: `r${i}`, unitId: `u${i}`, kind: 'target', cards: [{ hash: `h${i}`, durationMs: 1000 + i }] });
  }
  await lead.client.sync();
  for (let i = 0; i < n; i++) server.storeBlob('org1', 'p1', `h${i}`, 100 + i);
  return lead;
}

describe.each([['memory', () => new MemoryStore() as EventStore], ['SQLite', sqlite]] as const)('on the %s store', (_name, make) => {
beforeEach(() => { makeStore = make; });

describe('a language that keeps its recordings on disk', () => {
  it('opens from a server snapshot holding no recordings in memory until a passage opens', async () => {
    const server = new FakeServer();
    await language(server, 40);
    server.makeSnapshot('org1', 'p1');
    server.chunkChars = 500;
    const { client, store } = phone(server, 'dB', 'r1', { keepOnDisk: true });
    await client.load();
    await client.pull();
    const s = client.getState();
    expect(Object.keys(s.units)).toHaveLength(40);
    expect(Object.keys(s.recordings)).toHaveLength(0);
    // Every passage's line is there before any list asks, worked out from disk.
    expect(await store.keptCount('org1', 'p1', 'line')).toBe(40);
    expect(client.passageLines().get('u7').worked).toBe(true);
    expect(Object.keys(s.blobs)).toHaveLength(0);
    expect(await store.keptCount('org1', 'p1', 'recording')).toBe(40);
    expect(await store.keptCount('org1', 'p1', 'file')).toBe(40);

    await client.loadUnits(['u3', 'u4']);
    expect(Object.keys(client.getState().recordings).sort()).toEqual(['r3', 'r4']);
    expect(Object.keys(client.getState().blobs).sort()).toEqual(['h3', 'h4']);
    expect(client.getState().blobs['h3']).toMatchObject({ stored: true, size: 103 });
  });

  it('agrees with a phone that keeps everything in memory, through checkpoints, in any order', async () => {
    const server = new FakeServer();
    await language(server, 30);
    const onDisk = phone(server, 'dB', 'r1', { keepOnDisk: true, checkpointEvery: 7 });
    const inMemory = phone(server, 'dC', 'r2', { checkpointEvery: 7 });
    await onDisk.client.load();
    await inMemory.client.load();
    await onDisk.client.loadUnits(['u1']);
    for (let round = 0; round < 3; round++) {
      // Work arrives from someone else, and from this phone, between checkpoints.
      const other = phone(server, `dX${round}`, `t${round}`);
      await other.client.load();
      await other.client.sync();
      for (let i = 0; i < 5; i++) {
        await other.client.append('v1.RecordingAdded', { recordingId: `x${round}-${i}`, unitId: `u${(round * 7 + i) % 30}`, kind: 'target', cards: [{ hash: `x${round}-${i}`, durationMs: 5 }] });
      }
      await other.client.sync();
      server.storeBlob('org1', 'p1', `x${round}-0`, 7);
      await onDisk.client.append('v1.RecordingAdded', { recordingId: `mine${round}`, unitId: 'u1', kind: 'target', cards: [{ hash: `m${round}`, durationMs: 9 }] });
      for (let k = 0; k < 3; k++) { await onDisk.client.sync(); await inMemory.client.sync(); }
    }
    expect(comparable(await whole(onDisk.client, onDisk.store))).toEqual(comparable(inMemory.client.getState()));
    // Memory holds the open passage's recordings, not the language's.
    const inMemoryNow = Object.values(onDisk.client.getState().recordings);
    expect(inMemoryNow.length).toBeLessThan(10);
    expect(inMemoryNow.every((r) => r.unitId === 'u1')).toBe(true);
  });

  it('keeps versions, reviews, notes and requests per passage, and agrees with memory on every passage and line', async () => {
    const server = new FakeServer();
    await language(server, 12);
    await (async () => {
      const lead = phone(server, 'dL', 'lead');
      await lead.client.load();
      await lead.client.sync();
      await lead.client.append('v1.FlowSelected', { flowId: 'f', name: 'F' });
      await lead.client.append('v1.FlowStepSet', { stepId: 'f/s1', order: 's0', kindIds: ['peer'], checkpoint: false });
      await lead.client.append('v1.FlowStepSet', { stepId: 'f/s2', order: 's1', kindIds: ['community'], checkpoint: true });
      await lead.client.sync();
    })();
    const onDisk = phone(server, 'dB', 'r1', { keepOnDisk: true, checkpointEvery: 9 });
    const inMemory = phone(server, 'dC', 'r2', { checkpointEvery: 9 });
    await onDisk.client.load();
    await inMemory.client.load();
    await onDisk.client.loadUnits(['u2']);
    for (let round = 0; round < 4; round++) {
      const other = phone(server, `dX${round}`, `t${round}`);
      await other.client.load();
      await other.client.sync();
      await work(other.client, `x${round}`, [`u${round}`, `u${round + 4}`]);
      await other.client.sync();
      server.storeBlob('org1', 'p1', `nv-x${round}`, 50);
      // This phone works on the passage it has open, and on one it does not.
      await work(onDisk.client, `m${round}`, ['u2', `u${round + 8}`]);
      for (let k = 0; k < 3; k++) { await onDisk.client.sync(); await inMemory.client.sync(); }
      // The other phone's compose of the take archived first, a round later.
      if (round > 0) {
        await other.client.append('v1.TakeComposed', { takeId: `late-x${round - 1}`, unitId: 'u11', cardHashes: ['lc'], parentTakeId: null });
        await other.client.sync();
      }
    }
    for (let k = 0; k < 3; k++) { await onDisk.client.sync(); await inMemory.client.sync(); }
    const full = inMemory.client.getState();
    expect(comparable(await whole(onDisk.client, onDisk.store))).toEqual(comparable(full));

    // Memory holds the open passage's versions and what came since the last checkpoint, not the language's.
    // (A take archived before anyone composed it has no passage yet and waits in memory.)
    const takesHere = Object.values(onDisk.client.getState().takes);
    expect(takesHere.filter((t) => t.unitId !== 'u2' && t.unitId !== '').length).toBeLessThanOrEqual(2);
    expect(Object.keys(full.takes).length).toBeGreaterThan(takesHere.length + 5);

    // Every passage's line, as lists read it, is memory's.
    await onDisk.client.settleLines();
    const units = Object.keys(full.units);
    expect(linesOf(onDisk.client.passageLines(), units)).toEqual(linesOf(languageLines(full), units));
    expect([...onDisk.client.passageLines().worked()].sort()).toEqual([...languageLines(full).worked()].sort());

    // A screen that reads a few passages from disk reads them as memory would.
    const view = await onDisk.client.withPassages(['u1', 'u5', 'u9']);
    const idx = buildIndexes(full);
    for (const u of ['u1', 'u5', 'u9']) expect(derivePassage(view, u)).toEqual(derivePassage(full, u, idx));
    expect(updatesFor(view, 'lead').filter((x) => ['u1', 'u5', 'u9'].includes(x.unitId)))
      .toEqual(updatesFor(full, 'lead').filter((x) => ['u1', 'u5', 'u9'].includes(x.unitId)));

    // Opening a passage brings its whole record back.
    await onDisk.client.loadUnits(['u5']);
    expect(onDisk.client.isLoaded('u5')).toBe(true);
    expect(derivePassage(onDisk.client.getState(), 'u5')).toEqual(derivePassage(full, 'u5', idx));
  });

  it('a list reads each passage as the state shows it, without waiting for its line to be worked out', async () => {
    // Why: the web UI suite read the Map as soon as the language showed, and
    // lines worked out a moment later said "Not started" for recorded passages.
    const server = new FakeServer();
    await language(server, 8);
    const other = phone(server, 'dX', 't9');
    await other.client.load();
    await other.client.sync();
    await work(other.client, 'a', ['u1', 'u2']);
    await other.client.sync();
    // A new phone folds the log: everything is in memory, so lines read off it at once.
    const fresh = phone(server, 'dB', 'r1', { keepOnDisk: true, checkpointEvery: 5 });
    await fresh.client.load();
    await fresh.client.sync();
    const units = Object.keys(fresh.client.getState().units);
    const truth = async () => linesOf(languageLines(await whole(fresh.client, fresh.store)), units);
    expect(linesOf(fresh.client.passageLines(), units)).toEqual(await truth());
    // With the passages on disk, a change from elsewhere to one not open shows in its line when the pull is shown.
    expect(await fresh.store.keptCount('org1', 'p1', 'take')).toBeGreaterThan(0);
    await other.client.append('v1.ReviewRecorded', { reviewId: 'late', takeId: 't2-a', kindId: 'peer', outcome: 'looks_good', via: 'app' });
    await other.client.sync();
    await fresh.client.sync();
    expect(fresh.client.isLoaded('u1')).toBe(false);
    expect(linesOf(fresh.client.passageLines(), units)).toEqual(await truth());
  });

  it('works out every line again when the flow changes, and after a restart owes none it forgot', async () => {
    const server = new FakeServer();
    await language(server, 6);
    const store = makeStore();
    const a = phone(server, 'dB', 'r1', { keepOnDisk: true, checkpointEvery: 4, store });
    await a.client.load();
    await a.client.sync();
    await work(a.client, 'w', ['u1', 'u2']);
    await a.client.sync();
    await a.client.settleLines();
    expect(a.client.passageLines().get('u1').steps).toHaveLength(0);
    await a.client.append('v1.FlowSelected', { flowId: 'f', name: 'F' });
    await a.client.append('v1.FlowStepSet', { stepId: 'f/s1', order: 's0', kindIds: ['peer'], checkpoint: false });
    await a.client.sync();
    await a.client.settleLines();
    expect(a.client.passageLines().get('u1').steps).toHaveLength(1);
    expect(a.client.passageLines().get('u1').done).toBe(false);
    // Work, then a checkpoint prunes its events before the lines were worked out: they are still owed after a restart.
    await a.client.append('v1.ReviewRecorded', { reviewId: 'ok', takeId: 't2-w', kindId: 'peer', outcome: 'looks_good', via: 'app' });
    for (let i = 0; i < 5; i++) await a.client.append('v1.UnitAdded', { unitId: `z${i}`, parentUnitId: null, kind: 'passage', label: 'Z', order: `z${i}` });
    await a.client.sync();
    const b = phone(server, 'dB', 'r1', { keepOnDisk: true, store });
    await b.client.load();
    await b.client.settleLines();
    expect(b.client.passageLines().get('u1').done).toBe(true);
    expect(linesOf(b.client.passageLines(), ['u1', 'u2'])).toEqual(linesOf(languageLines(await whole(b.client, store)), ['u1', 'u2']));
  });

  it('works out every line again under a new build of the app, and only then', async () => {
    const server = new FakeServer();
    await language(server, 6);
    const store = makeStore();
    const units = ['u1', 'u2', 'u4'];
    const a = phone(server, 'dB', 'r1', { keepOnDisk: true, checkpointEvery: 4, store, build: 'one' });
    await a.client.load();
    await a.client.sync();
    await work(a.client, 'w', ['u1', 'u2']);
    await a.client.sync();
    await a.client.settleLines();
    const truth = linesOf(a.client.passageLines(), units);
    // u4's line as an earlier build's code might have read it. Nothing since touched u4.
    const kept = (await store.keptAll('org1', 'p1', 'line')).find((r) => r.unitId === 'u4')!;
    await store.commit({ kept: { orgId: 'org1', streamId: 'p1', upsert: [{ ...kept, kind: 'line', json: JSON.stringify({ ...JSON.parse(kept.json), takes: 99 }) }] } });
    const same = phone(server, 'dB', 'r1', { keepOnDisk: true, store, build: 'one' });
    await same.client.load();
    await same.client.settleLines();
    expect(same.client.passageLines().get('u4').takes, 'the same build trusts the lines it kept').toBe(99);
    const next = phone(server, 'dB', 'r1', { keepOnDisk: true, store, build: 'two' });
    await next.client.load();
    await next.client.settleLines();
    expect(linesOf(next.client.passageLines(), units)).toEqual(truth);
    expect(linesOf(next.client.passageLines(), units)).toEqual(linesOf(languageLines(await whole(next.client, store)), units));
  });

  it('a dropped link resumes from the pieces already here, and nothing half-read is kept', async () => {
    const server = new FakeServer();
    await language(server, 40);
    server.makeSnapshot('org1', 'p1');
    server.chunkChars = 400;
    server.failChunkAfter = 5;
    const { client, store } = phone(server, 'dB', 'r1', { keepOnDisk: true });
    await client.load();
    expect((await client.sync()).offline).toBe(true);
    expect(await store.keptCount('org1', 'p1', 'recording')).toBe(0);
    const before = server.chunkCalls;
    server.failChunkAfter = Infinity;
    await client.pull();
    const total = Math.ceil(JSON.stringify(server.snapshots.get('org1/p1')!.state).length / 400);
    expect(server.chunkCalls - before).toBe(total - 5);
    expect(await store.keptCount('org1', 'p1', 'recording')).toBe(40);
    expect(Object.keys(client.getState().units)).toHaveLength(40);
  });

  it('tells a screen when the passage it waits for is ready, even one with nothing on disk', async () => {
    // Why: a passage's screen waits until its passage is in memory; on the
    // web a new language's passages had nothing on disk, nothing changed in
    // memory, nobody was told, and the screen waited for ever.
    const server = new FakeServer();
    await language(server, 3);
    const { client } = phone(server, 'dB', 'r1', { keepOnDisk: true });
    await client.load();
    await client.sync();
    let told = 0;
    client.subscribe(() => { told += 1; });
    expect(client.isLoaded('u1')).toBe(false);
    await client.loadUnits(['u1']);
    expect(client.isLoaded('u1')).toBe(true);
    expect(told).toBeGreaterThan(0);
  });

  it('two syncs at once (the scheduler and "Sync now") download the language once, whole', async () => {
    // Why: a UI test caught a phone showing recorded passages as not started after its first download:
    // the scheduler's sync and a manual one each downloaded the snapshot, and each cleared the other's rows.
    const server = new FakeServer();
    await language(server, 30);
    server.makeSnapshot('org1', 'p1');
    server.chunkChars = 300;
    for (let round = 0; round < 8; round++) {
      // A network that answers after a moment, in any order.
      const direct = server.transportFor();
      let seed = round + 1;
      const later = () => new Promise<void>((r) => setTimeout(r, (seed = (seed * 48271) % 2147483647) % 4));
      const transport = Object.fromEntries(Object.entries(direct).map(([k, f]) => [k, async (...a: unknown[]) => { await later(); return (f as (...x: unknown[]) => unknown)(...a); }])) as unknown as typeof direct;
      const store = makeStore();
      const client = new SyncClient({
        orgId: 'org1', streamId: 'p1', actorId: 'r1', deviceId: `dS${round}`, store, transport,
        clock: new HlcClock(`dS${round}`, () => ++ids), newId: () => `dS${round}-${++ids}`, keepOnDisk: true
      });
      await client.load();
      const results = await Promise.allSettled([client.sync(), client.sync(), client.sync()]);
      expect(results.map((r) => r.status), `round ${round}`).toEqual(['fulfilled', 'fulfilled', 'fulfilled']);
      await client.sync();
      expect(await store.keptCount('org1', 'p1', 'recording'), `round ${round}`).toBe(30);
      expect(await store.keptCount('org1', 'p1', 'audio'), `round ${round}`).toBe(30);
      expect(await store.keptCount('org1', 'p1', 'line'), `round ${round}`).toBe(30);
      await client.loadUnits(['u7']);
      expect(Object.keys(client.getState().recordings), `round ${round}`).toEqual(['r7']);
      // A session closed while its first download goes on, and the language opened again on the same phone.
      const again = makeStore();
      const first = new SyncClient({ orgId: 'org1', streamId: 'p1', actorId: 'r1', deviceId: `dT${round}`, store: again, transport, keepOnDisk: true });
      await first.load();
      const going = first.sync();
      const reopened = new SyncClient({ orgId: 'org1', streamId: 'p1', actorId: 'r1', deviceId: `dT${round}`, store: again, transport, keepOnDisk: true });
      await reopened.load();
      await Promise.all([going, reopened.sync()]);
      expect(await again.keptCount('org1', 'p1', 'recording'), `round ${round}, reopened`).toBe(30);
      await reopened.loadUnits(['u7']);
      expect(Object.keys(reopened.getState().recordings), `round ${round}, reopened`).toEqual(['r7']);
    }
  });

  it('a first download cut short while its rows are written leaves nothing the next open trusts', async () => {
    // Why: a first download writes its rows in place (moving them took a test
    // phone 200 s for Koro Miyan); a phone that dies part-way must not read them.
    const server = new FakeServer();
    await language(server, 30);
    server.makeSnapshot('org1', 'p1');
    server.chunkChars = 300;
    const store = makeStore();
    let kept = 0;
    const dying = new Proxy(store, { get: (t, k) => {
      const v = (t as unknown as Record<string, unknown>)[k as string];
      if (k !== 'commit') return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      return async (batch: { kept?: { upsert?: unknown[] } }) => {
        if (batch.kept?.upsert?.length && ++kept === 2) throw new Error('the phone died');
        return (v as (b: unknown) => Promise<void>).call(t, batch);
      };
    } });
    const a = phone(server, 'dB', 'r1', { keepOnDisk: true, store: dying });
    await a.client.load();
    await expect(a.client.pull()).rejects.toThrow('the phone died');
    expect(await store.keptCount('org1', 'p1', 'recording')).toBeGreaterThan(0);
    const b = phone(server, 'dB', 'r1', { keepOnDisk: true, store });
    await b.client.load();
    expect(await store.keptCount('org1', 'p1', 'recording')).toBe(0);
    await b.client.pull();
    expect(await store.keptCount('org1', 'p1', 'recording')).toBe(30);
    expect(await store.keptCount('org1', 'p1', 'line')).toBe(30);
  });

  it('moves a checkpoint from before onto disk the first time it opens', async () => {
    const server = new FakeServer();
    await language(server, 20);
    const store = makeStore();
    const old = phone(server, 'dB', 'r1', { store, checkpointEvery: 5 });
    await old.client.load();
    await old.client.pull();
    const full = comparable(old.client.getState());
    expect(Object.keys(full.recordings)).toHaveLength(20);
    const updated = phone(server, 'dB', 'r1', { store, keepOnDisk: true });
    await updated.client.load();
    expect(Object.keys(updated.client.getState().recordings)).toHaveLength(0);
    expect(await store.keptCount('org1', 'p1', 'recording')).toBe(20);
    expect(comparable(await whole(updated.client, store))).toEqual(full);
    await updated.client.settleLines();
    expect(linesOf(updated.client.passageLines(), Object.keys(full.units))).toEqual(linesOf(languageLines(full), Object.keys(full.units)));
  });

  it('a recording redacted after it went to disk disappears once the new snapshot arrives', async () => {
    const server = new FakeServer();
    const lead = await language(server, 10);
    server.makeSnapshot('org1', 'p1');
    const { client, store } = phone(server, 'dB', 'r1', { keepOnDisk: true });
    await client.load();
    await client.pull();
    expect((await store.keptById('org1', 'p1', 'recording', ['r2']))).toHaveLength(1);
    const target = server.log.find((e) => e.type === 'v1.RecordingAdded' && e.payload.recordingId === 'r2')!;
    await lead.client.append('v1.Redacted', { eventId: target.id });
    await lead.client.sync();
    server.makeSnapshot('org1', 'p1');
    await client.pull();
    await client.pull();
    expect(await store.keptById('org1', 'p1', 'recording', ['r2'])).toHaveLength(0);
    expect(await store.keptCount('org1', 'p1', 'recording')).toBe(9);
    await client.loadUnits(['u2']);
    expect(client.getState().recordings['r2']).toBeUndefined();
  });
});

describe('file planning for a language kept on disk', () => {
  it('still sends a recording made here whose file never went up, after the recording went to disk', async () => {
    // Why: the recording's event can reach the server before its audio does.
    // If the checkpoint then moves the recording to disk, a planner that
    // looked only in memory would never send the file: lost audio.
    const server = new FakeServer();
    await language(server, 12);
    const { client, store } = phone(server, 'dB', 't1', { keepOnDisk: true, checkpointEvery: 3 });
    await client.load();
    await client.sync();
    await client.append('v1.RecordingAdded', { recordingId: 'mine', unitId: 'u7', kind: 'target', cards: [{ hash: 'unsent', durationMs: 3 }] });
    await client.sync();
    // More work arrives, a checkpoint takes the recording to disk, and memory lets it go.
    const other = phone(server, 'dX', 't2');
    await other.client.load();
    for (let i = 0; i < 6; i++) await other.client.append('v1.UnitAdded', { unitId: `n${i}`, parentUnitId: null, kind: 'passage', label: `N${i}`, order: `z${i}` });
    await other.client.sync();
    await client.sync();
    expect(client.getState().recordings['mine']).toBeUndefined();
    expect(await store.keptById('org1', 'p1', 'recording', ['mine'])).toHaveLength(1);

    const files = new LanguageFiles(client, store, 'org1', 'p1');
    const present = new Set(['unsent', 'h2']);
    expect((await files.upload(present)).map((r) => r.hash)).toEqual(['unsent']);
    expect(await files.hasRecording('mine')).toBe(true);
    // The passage this person recorded in is theirs to keep offline.
    expect([...(await files.scope('t1'))]).toContain('u7');
    // Kept offline: the stored files of u2 and u7 come down, with the server's size; the unsent one cannot.
    const down = await files.download(new Set(), new Set(['u2', 'u7']));
    expect(down.map((r) => r.hash)).toEqual(['h2', 'h7']);
    expect(files.sizeOf('h2')).toBe(102);
    // Room: h2 may go once u2 is not kept; the unsent file never may.
    expect((await files.evictable(present, new Set(['u7']))).map((r) => r.hash)).toEqual(['h2']);
    expect(await files.evictable(present, new Set(['u2', 'u7']))).toEqual([]);
    const counts = await files.byUnit(['u2', 'u7'], present, 't1', new Set());
    expect(counts.get('u2')).toMatchObject({ audio: 1, here: 1 });
    expect(counts.get('u7')).toMatchObject({ audio: 2, here: 1, toFetch: 1, reason: 'worked' });
    expect(await files.lost(['unsent'])).toMatchObject({ unsent: 1, unitIds: ['u7'] });
  });

  it('still sends a voice note made here after its note went to disk, and plans a passage\'s files without its records', async () => {
    const server = new FakeServer();
    await language(server, 8);
    const { client, store } = phone(server, 'dB', 't1', { keepOnDisk: true, checkpointEvery: 3 });
    await client.load();
    await client.sync();
    await client.append('v1.NoteAdded', { noteId: 'n1', unitId: 'u3', anchor: { kind: 'passage' }, blobHash: 'voice' });
    await client.sync();
    const other = phone(server, 'dX', 't2');
    await other.client.load();
    for (let i = 0; i < 4; i++) await other.client.append('v1.UnitAdded', { unitId: `n${i}`, parentUnitId: null, kind: 'passage', label: `N${i}`, order: `z${i}` });
    await other.client.sync();
    await client.sync();
    expect(client.getState().notes['n1']).toBeUndefined();
    expect(await store.keptById('org1', 'p1', 'note', ['n1'])).toHaveLength(1);
    const files = new LanguageFiles(client, store, 'org1', 'p1');
    expect(await files.upload(new Set(['voice']))).toEqual([{ hash: 'voice', format: 'm4a', unitId: 'u3' }]);
    server.storeBlob('org1', 'p1', 'voice', 9);
    await client.sync();
    await client.sync();
    // Kept offline: the passage's recording and its voice note, read from the file list alone.
    expect((await files.download(new Set(), new Set(['u3']))).map((r) => r.hash).sort()).toEqual(['h3', 'voice']);
  });
});
});
