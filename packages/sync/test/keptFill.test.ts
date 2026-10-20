import { DatabaseSync } from 'node:sqlite';
import {
  emptyLanguageState, foldLanguage, HlcClock, keptVerdict, languageLines, LINES_VERSION, PART_OF_KIND, putEntry, REDUCER_VERSION, withOwnParts,
  type AnyEvent, type LanguageState, type PassageLine
} from '@langquest-next/core';
import { FILLED } from '../src/keptFill';
import { PART_KINDS } from '../src/keptLanguage';
import { MemoryStore } from '../src/memoryStore';
import { SqliteStore, type SqlDriver } from '../src/sqliteStore';
import { keptCheckpointVersion, SyncClient } from '../src/syncClient';
import { FakeServer } from '../src/testing/fakeServer';
import type { EventStore } from '../src/types';

/**
 * Option F (decisions.md 147): a phone's first download of a big language
 * takes what the whole language shares and every passage's line from the
 * server's cut, opens the Map on them, and fills the passages' rows in
 * behind, the person's own first, until every passage's rows are on disk
 * as under decision 143. Why these tests: the Map must stay exact while the
 * fill runs (every line the phone's own reading of rows it holds, or the
 * server's for a passage nothing pulled has touched past the server's
 * lines), and a fill cut short at any point must end where a phone that
 * holds the language whole ends.
 */
type Lang = LanguageState;
let ids = 0;

function sqlite(): EventStore {
  const db = new DatabaseSync(':memory:');
  const driver: SqlDriver = {
    run: async (sql, params = []) => { db.prepare(sql).run(...(params as never[])); },
    all: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as T[],
    transaction: async (fn) => { db.exec('begin'); try { await fn(driver); db.exec('commit'); } catch (e) { db.exec('rollback'); throw e; } }
  };
  let opened: Promise<SqliteStore> | null = null;
  const store = () => (opened ??= SqliteStore.open(driver));
  return new Proxy({} as EventStore, { get: (_t, k) => async (...a: unknown[]) => ((await store()) as unknown as Record<string, (...x: unknown[]) => unknown>)[k as string]!(...a) });
}

let makeStore: () => EventStore = () => new MemoryStore();

interface PhoneOpts { fillPageRows?: number; keepOnDisk?: boolean; checkpointEvery?: number; pullPageSize?: number; store?: EventStore; fillFirst?: () => Iterable<string>; keptFormat?: number; fillBudgetMs?: number }

function phone(server: FakeServer, deviceId: string, actorId: string, opts: PhoneOpts = {}) {
  const store = opts.store ?? makeStore();
  const client = new SyncClient({
    orgId: 'org1', streamId: 'p1', actorId, deviceId, store, transport: server.transportFor(),
    clock: new HlcClock(deviceId, () => ++ids), newId: () => `${deviceId}-${++ids}`,
    ...(opts.keepOnDisk ? { keepOnDisk: true } : {}),
    ...(opts.checkpointEvery ? { checkpointEvery: opts.checkpointEvery } : {}),
    ...(opts.pullPageSize ? { pullPageSize: opts.pullPageSize } : {}),
    ...(opts.fillFirst ? { fillFirst: opts.fillFirst } : {}),
    ...(opts.keptFormat ? { keptFormat: opts.keptFormat } : {}),
    ...(opts.fillBudgetMs !== undefined ? { fillBudgetMs: opts.fillBudgetMs } : {}),
    fillPageRows: opts.fillPageRows ?? 6
  });
  return { client, store };
}

/** The language as a phone kept on disk has it: memory combined with every row kept. */
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
const plain = (l: unknown) => JSON.parse(JSON.stringify(l)) as unknown;

/** Sync, then fill, until nothing is left: what a session's scheduler does while online. */
async function settle(c: SyncClient) {
  for (let i = 0; i < 200; i++) {
    const r = await c.sync();
    if (r.offline) throw new Error('offline');
    if (r.more) continue;
    if (!r.filling) break;
    await c.fillSome();
  }
  await c.settleLines();
}

/** A passage's worth of work by a team: a recording, versions, a review and its answer, a request, a note, a departure. */
async function work(c: SyncClient, tag: string, a: string, b: string) {
  await c.append('v1.RecordingAdded', { recordingId: `r-${tag}`, unitId: a, kind: 'target', cards: [{ hash: `h-${tag}`, durationMs: 1000 }] });
  await c.append('v1.TakeComposed', { takeId: `t-${tag}`, unitId: a, cardHashes: [`h-${tag}`], parentTakeId: null });
  await c.append('v1.TakeSubmitted', { takeId: `t-${tag}` });
  await c.append('v1.ReviewRecorded', { reviewId: `rv-${tag}`, takeId: `t-${tag}`, kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'slower' });
  await c.append('v1.RequestMade', { requestId: `q-${tag}`, unitId: b, what: 'record', profileId: 'r1' });
  await c.append('v1.NoteAdded', { noteId: `n-${tag}`, unitId: b, anchor: { kind: 'passage' }, text: 'hm' });
  await c.append('v1.DepartureRecorded', { departureId: `dep-${tag}`, unitId: b, type: 'skip', kindId: 'peer', reason: 'no peer' });
}

/** A language of `n` passages, each worked on, its files stored, with a flow that reviews. */
async function language(server: FakeServer, n: number) {
  const lead = phone(server, 'dA', 'lead');
  await lead.client.load();
  await lead.client.append('v1.ReviewKindDefined', { kindId: 'peer', name: 'Peer check', produces: false } as never);
  for (let i = 0; i < n; i++) {
    await lead.client.append('v1.UnitAdded', { unitId: `u${String(i).padStart(2, '0')}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${String(i).padStart(3, '0')}` });
  }
  for (let i = 0; i < n; i += 2) await work(lead.client, `w${i}`, `u${String(i).padStart(2, '0')}`, `u${String(i + 1).padStart(2, '0')}`);
  await lead.client.sync();
  for (let i = 0; i < n; i += 2) server.storeBlob('org1', 'p1', `h-w${i}`, 100 + i);
  return lead;
}

const unitsOf = (n: number) => Array.from({ length: n }, (_, i) => `u${String(i).padStart(2, '0')}`);

/** The language as the server has it up to `seq`. */
const foldTo = (server: FakeServer, seq: number) => foldLanguage(server.stream('org1', 'p1').filter((e) => e.serverSeq! <= seq), emptyLanguageState());

/**
 * Every line the phone shows is exact: a passage filled in shows the
 * phone's own reading of what it holds, which is the language as of what
 * it has pulled; one not filled in shows the server's line, which is the
 * language as of the later of what it pulled and what the lines hold at,
 * since nothing it pulled past the lines touched that passage.
 */
async function expectExact(c: SyncClient, store: EventStore, server: FakeServer, units: string[], adopted: Map<string, PassageLine>, linesSeq: number) {
  await c.settleLines();
  const cursor = await store.cursor('org1', 'p1');
  const own = languageLines(await whole(c, store));
  const atCursor = languageLines(foldTo(server, cursor));
  const atLines = languageLines(foldTo(server, Math.max(cursor, linesSeq)));
  const shown = c.passageLines();
  for (const u of units) {
    if (c.isFilled(u)) {
      expect(plain(shown.get(u)), `${u} filled`).toEqual(plain(own.get(u)));
      expect(plain(shown.get(u)), `${u} filled, against the server`).toEqual(plain(atCursor.get(u)));
    } else {
      if (adopted.has(u)) expect(plain(shown.get(u)), `${u} the server's line`).toEqual(plain(adopted.get(u)));
      expect(plain(shown.get(u)), `${u} not filled, against the server`).toEqual(plain(atLines.get(u)));
    }
  }
}

describe.each([['memory', () => new MemoryStore() as EventStore], ['SQLite', sqlite]] as const)('on the %s store', (_name, make) => {
beforeEach(() => { makeStore = make; });

describe('a first download by fill (decisions.md 147)', () => {
  it('opens the Map on the shared part and the lines, then fills every passage in, ending where a phone holding it whole ends', async () => {
    const server = new FakeServer();
    server.serverCut = true;
    await language(server, 20);
    server.makeSnapshot('org1', 'p1');
    const units = unitsOf(20);
    const { client, store } = phone(server, 'dB', 'r1', { keepOnDisk: true, fillBudgetMs: 0 });
    await client.load();
    let firstMap: { recordingsOnDisk: number; rowsCalls: number; recorded: number } | null = null;
    client.subscribe((s) => {
      if (firstMap || !s.lines || Object.keys((s.state as Lang).units).length === 0) return;
      firstMap = { recordingsOnDisk: -1, rowsCalls: server.rowsCalls, recorded: units.filter((u) => s.lines!.get(u).recorded).length };
    });
    const r = await client.sync();
    // The Map was drawn before a single row was asked for, with every recorded passage shown recorded.
    expect(firstMap).toMatchObject({ rowsCalls: 0, recorded: 10 });
    expect(r.filling).toBe(true);
    expect(await store.keptCount('org1', 'p1', 'recording')).toBe(0);
    expect(server.chunkCalls).toBe(0);
    expect(client.fillProgress()).toEqual({ filled: 0, total: 20 });
    await settle(client);
    expect(client.fillProgress()).toBeNull();
    const twin = phone(server, 'dC', 'r2');
    await twin.client.load();
    await twin.client.pull();
    expect(comparable(await whole(client, store))).toEqual(comparable(twin.client.getState()));
    expect(units.map((u) => plain(client.passageLines().get(u)))).toEqual(units.map((u) => plain(languageLines(twin.client.getState()).get(u))));
    expect(await store.keptCount('org1', 'p1', 'recording')).toBe(10);
    expect(await store.keptCount('org1', 'p1', 'file')).toBe(10);
    // The audio rows a phone plans its files from are made on the phone.
    expect(await store.keptCount('org1', 'p1', 'audio')).toBeGreaterThan(0);
    // A restart reads the filled language back, with nothing left to fill.
    const again = phone(server, 'dB', 'r1', { keepOnDisk: true, store });
    await again.client.load();
    expect(again.client.fillProgress()).toBeNull();
    expect(units.every((u) => again.client.isFilled(u))).toBe(true);
  });

  it('fills what a screen opens first, then the person\'s own passages, then the rest', async () => {
    const server = new FakeServer();
    server.serverCut = true;
    await language(server, 20);
    server.makeSnapshot('org1', 'p1');
    const mine = ['u12', 'u13'];
    // A page holds exactly the person's two passages' rows.
    const rows = new Map((await server.transportFor().snapshotHead!('org1', 'p1', REDUCER_VERSION, LINES_VERSION))!.units.map((u) => [u.unitId, u.rows]));
    const { client } = phone(server, 'dB', 'r1', { keepOnDisk: true, fillBudgetMs: 0, fillFirst: () => mine, fillPageRows: rows.get('u12')! + rows.get('u13')! });
    await client.load();
    await client.sync();
    expect(client.isFilled('u06')).toBe(false);
    expect(client.isLoaded('u06')).toBe(false);
    await client.loadUnits(['u06']);
    expect(client.isFilled('u06')).toBe(true);
    expect(client.isLoaded('u06')).toBe(true);
    expect(Object.values(client.getState().takes).map((t) => t.unitId)).toEqual(['u06']);
    // One step with no time to spare takes one page: the person's passages come before the server's order.
    await client.fillSome(0);
    expect(mine.every((u) => client.isFilled(u))).toBe(true);
    expect(client.fillProgress()).toEqual({ filled: 3, total: 20 });
    expect(client.isFilled('u00')).toBe(false);
  });

  it('a fill cut short at any point shows only exact lines, and ends where a phone holding the language whole ends', async () => {
    // A snapshot, then work the pass folded into its lines without a new snapshot, then work past the lines,
    // some of it hanging on takes the phone does not know. Each run is cut at the k-th request for rows.
    const server = new FakeServer();
    server.serverCut = true;
    const lead = await language(server, 16);
    const units = unitsOf(16);
    server.makeSnapshot('org1', 'p1');
    await work(lead.client, 'mid', 'u03', 'u04');
    await lead.client.sync();
    server.writeLines('org1', 'p1');
    const linesSeq = server.lines.get('org1/p1')!.seq;
    const adopted = new Map(server.lines.get('org1/p1')!.byUnit);
    await lead.client.append('v1.ReviewRecorded', { reviewId: 'rv-late', takeId: 't-w8', kindId: 'peer', outcome: 'looks_good', via: 'app' });
    await lead.client.append('v1.TakeArchived', { takeId: 't-w10' });
    await lead.client.append('v1.RecordingAdded', { recordingId: 'r-late', unitId: 'u14', kind: 'target', cards: [{ hash: 'h-late', durationMs: 5 }] });
    await lead.client.sync();
    const twin = phone(server, 'dT', 'r2');
    await twin.client.load();
    await twin.client.pull();
    const truth = twin.client.getState();

    let cuts = 0;
    for (let k = 0; ; k++) {
      server.rowsCalls = 0;
      server.failRowsAfter = k;
      const { client, store } = phone(server, `dK${k}`, 'r1', { keepOnDisk: true, fillBudgetMs: 0, checkpointEvery: 3, pullPageSize: 4 });
      await client.load();
      let interrupted = false;
      try { await settle(client); } catch { interrupted = true; }
      if (!interrupted) break;
      cuts += 1;
      await expectExact(client, store, server, units, adopted, linesSeq);
      // Back online, after a restart: the fill goes on from what it kept.
      server.failRowsAfter = Infinity;
      const again = phone(server, `dK${k}`, 'r1', { keepOnDisk: true, fillBudgetMs: 0, checkpointEvery: 3, pullPageSize: 4, store });
      await again.client.load();
      await expectExact(again.client, store, server, units, adopted, linesSeq);
      await settle(again.client);
      expect(again.client.fillProgress()).toBeNull();
      expect(comparable(await whole(again.client, store)), `cut at ${k}`).toEqual(comparable(truth));
      expect(units.map((u) => plain(again.client.passageLines().get(u))), `cut at ${k}`).toEqual(units.map((u) => plain(languageLines(truth).get(u))));
    }
    expect(cuts).toBeGreaterThan(3);
    // Passages pulled news touched were filled before the news was folded; the take nobody's phone knew was asked of the server.
    expect(server.passageCalls).toBeGreaterThan(0);
  });

  it('keeps the server\'s line for a passage not filled in while the phone records on it offline, and its own once it fills', async () => {
    const server = new FakeServer();
    server.serverCut = true;
    await language(server, 10);
    server.makeSnapshot('org1', 'p1');
    const { client } = phone(server, 'dB', 'r1', { keepOnDisk: true, fillBudgetMs: 0 });
    await client.load();
    await client.sync();
    server.offline = true;
    const before = plain(client.passageLines().get('u05'));
    await client.append('v1.RecordingAdded', { recordingId: 'mine', unitId: 'u05', kind: 'target', cards: [{ hash: 'mine', durationMs: 5 }] });
    await client.settleLines();
    expect(client.isFilled('u05')).toBe(false);
    expect(plain(client.passageLines().get('u05'))).toEqual(before);
    server.offline = false;
    await settle(client);
    expect(client.passageLines().get('u05').worked).toBe(true);
    const lines = languageLines(foldLanguage([...server.stream('org1', 'p1')], emptyLanguageState()));
    expect(plain(client.passageLines().get('u05'))).toEqual(plain(lines.get('u05')));
  });

  it('a flow change past the server\'s lines takes the pass\'s new lines for passages not filled in yet', async () => {
    const server = new FakeServer();
    server.serverCut = true;
    const lead = await language(server, 10);
    server.makeSnapshot('org1', 'p1');
    const { client, store } = phone(server, 'dB', 'r1', { keepOnDisk: true, fillBudgetMs: 0 });
    await client.load();
    await client.sync();
    await lead.client.append('v1.ReviewKindDefined', { kindId: 'peer', name: 'Peer check, renamed', produces: true } as never);
    await lead.client.sync();
    await client.sync();
    // The pass has not run yet: the old lines stand. Once it has, they are taken.
    server.writeLines('org1', 'p1');
    await client.fillSome(0);
    const truth = languageLines(foldLanguage([...server.stream('org1', 'p1')], emptyLanguageState()));
    for (const u of unitsOf(10)) {
      if (!client.isFilled(u)) expect(plain(client.passageLines().get(u))).toEqual(plain(truth.get(u)));
    }
    expect(JSON.parse((await store.meta('fill:org1/p1'))!).stale).toBeNull();
  });

  it('a redaction while the fill runs waits for a snapshot past it, then starts over from the server\'s cut', async () => {
    const server = new FakeServer();
    server.serverCut = true;
    const lead = await language(server, 10);
    server.makeSnapshot('org1', 'p1');
    const { client, store } = phone(server, 'dB', 'r1', { keepOnDisk: true, fillBudgetMs: 0 });
    await client.load();
    await client.sync();
    await client.fillSome(0);
    const target = server.log.find((e) => e.type === 'v1.RecordingAdded' && e.payload.recordingId === 'r-w2')!;
    await lead.client.append('v1.Redacted', { eventId: target.id });
    await lead.client.sync();
    server.makeSnapshot('org1', 'p1');
    await settle(client);
    expect(await store.keptById('org1', 'p1', 'recording', ['r-w2'])).toHaveLength(0);
    expect(comparable(await whole(client, store))).toEqual(comparable(foldLanguage([...server.stream('org1', 'p1')], emptyLanguageState())));
  });
});

describe('a server without the cut (decisions.md 147)', () => {
  it('a server error from the cut, or a server without one, gives the phone the whole snapshot', async () => {
    const server = new FakeServer();
    server.serverCut = true;
    await language(server, 8);
    server.makeSnapshot('org1', 'p1');
    server.headError = 'canceling statement due to statement timeout';
    const { client, store } = phone(server, 'dB', 'r1', { keepOnDisk: true });
    await client.load();
    await settle(client);
    expect(server.chunkCalls).toBeGreaterThan(0);
    expect(client.fillProgress()).toBeNull();
    expect(comparable(await whole(client, store))).toEqual(comparable(foldLanguage([...server.stream('org1', 'p1')], emptyLanguageState())));
  });

  it('a cut gone part-way through a fill (a server rolled back) starts the language over from the whole snapshot, keeping unsent work', async () => {
    const server = new FakeServer();
    server.serverCut = true;
    await language(server, 12);
    server.makeSnapshot('org1', 'p1');
    const { client, store } = phone(server, 'dB', 'r1', { keepOnDisk: true, fillBudgetMs: 0 });
    await client.load();
    await client.sync();
    await client.fillSome(0);
    expect(client.fillProgress()!.filled).toBeLessThan(12);
    server.offline = true;
    await client.append('v1.NoteAdded', { noteId: 'unsent', unitId: 'u03', anchor: { kind: 'passage' }, text: 'mine' });
    server.offline = false;
    server.dropCuts();
    await client.fillSome(0);
    expect(client.fillProgress()).toBeNull();
    await settle(client);
    expect(server.chunkCalls).toBeGreaterThan(0);
    expect(comparable(await whole(client, store))).toEqual(comparable(foldLanguage([...server.stream('org1', 'p1')], emptyLanguageState())));
    expect(server.log.some((e) => e.type === 'v1.NoteAdded' && e.payload.noteId === 'unsent')).toBe(true);
  });
});

describe('a build from before the fill (decisions.md 143, 147)', () => {
  it('drops a partly filled checkpoint it would read as whole, and a filled one from before is kept', async () => {
    const server = new FakeServer();
    server.serverCut = true;
    await language(server, 12);
    server.makeSnapshot('org1', 'p1');
    const store = makeStore();
    const f = phone(server, 'dB', 'r1', { keepOnDisk: true, store, fillBudgetMs: 0 });
    await f.client.load();
    await f.client.sync();
    await f.client.fillSome(0);
    expect(f.client.fillProgress()!.filled).toBeLessThan(12);
    const tagged = JSON.parse((await store.meta('snapshot:org1/p1'))!) as { reducerVersion: number };
    expect(tagged.reducerVersion).toBe(keptCheckpointVersion(REDUCER_VERSION, 2));

    // An update rolled back to a build that keeps rows but knows no fill: it drops the checkpoint and downloads again.
    const e = phone(server, 'dB', 'r1', { keepOnDisk: true, store, keptFormat: 1 });
    await e.client.load();
    expect(await store.cursor('org1', 'p1')).toBe(0);
    await e.client.pull();
    const full = comparable(foldLanguage([...server.stream('org1', 'p1')], emptyLanguageState()));
    expect(comparable(await whole(e.client, store))).toEqual(full);
    expect(JSON.parse((await store.meta('snapshot:org1/p1'))!).reducerVersion).toBe(keptCheckpointVersion(REDUCER_VERSION, 1));

    // Rolled forward: that build's checkpoint has every passage's rows, and is read as it is.
    const chunks = server.chunkCalls;
    const heads = server.headCalls;
    const again = phone(server, 'dB', 'r1', { keepOnDisk: true, store });
    await again.client.load();
    await again.client.sync();
    expect(server.chunkCalls).toBe(chunks);
    expect(server.headCalls).toBe(heads);
    expect(again.client.fillProgress()).toBeNull();
    expect(await store.keptCount('org1', 'p1', FILLED)).toBe(0);
    expect(comparable(await whole(again.client, store))).toEqual(full);
  });
});
});
