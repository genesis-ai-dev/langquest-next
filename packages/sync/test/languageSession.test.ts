import { HlcClock, type BlobRef } from '@langquest-next/core';
import { LanguageSession, type LanguageSessionOptions, type LocalFiles } from '../src/languageSession';
import { Diagnostics, MemoryDiagStore } from '../src/diagnostics';
import { MemoryStore } from '../src/memoryStore';
import { SyncClient } from '../src/syncClient';
import { FakeServer } from '../src/testing/fakeServer';
import type { EventPayloads, EventType } from '@langquest-next/core';

let remoteIds = 1000;
/** Someone else's phone: one event, sent at once. */
async function from<T extends EventType>(server: FakeServer, actorId: string, type: T, payload: EventPayloads[T]) {
  const c = new SyncClient({
    orgId: 'org1', streamId: 'luke', actorId, deviceId: `d-${actorId}`, store: new MemoryStore(), transport: server.transportFor(),
    clock: new HlcClock(`d-${actorId}`, () => (remoteIds += 1)), newId: () => `x${(remoteIds += 1)}`
  });
  await c.load();
  await c.append(type, payload);
  await c.push();
}

/** A phone's files in memory: what is here, how big, and who asked to be told of changes. */
function memoryFiles(): LocalFiles & { put(hash: string, size: number): void; reclaimed: string[][] } {
  const sizes = new Map<string, number>();
  const listeners = new Set<() => void>();
  const reclaimed: string[][] = [];
  return {
    reclaimed,
    put(hash, size) { sizes.set(hash, size); for (const l of listeners) l(); },
    snapshot: () => new Set(sizes.keys()),
    sizes: () => sizes,
    sizeOf: (hash) => sizes.get(hash),
    formatOf: (hash) => (sizes.has(hash) ? 'm4a' : undefined),
    reclaim: (evictable) => { reclaimed.push(evictable.map((r) => r.hash)); },
    onChange: (l) => { listeners.add(l); return () => { listeners.delete(l); }; }
  };
}

async function until(ok: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

function phone(over: Partial<LanguageSessionOptions> = {}) {
  const server = new FakeServer();
  const store = new MemoryStore();
  const files = memoryFiles();
  const uploaded: string[] = [];
  const wall = { t: 0 };
  const open = () => LanguageSession.open({
    orgId: 'org1', languageId: 'luke', actorId: 'akol', deviceId: 'phone', store, transport: server.transportFor(), files,
    upload: async (ref: BlobRef) => { uploaded.push(ref.hash); server.storeBlob('org1', 'luke', ref.hash, files.sizeOf(ref.hash) ?? 0); },
    download: async () => {},
    limits: { minFreeBytes: 0, maxTotalBytes: Number.MAX_SAFE_INTEGER },
    client: { clock: new HlcClock('phone', () => (wall.t += 1)), newId: () => `e${(wall.t += 1)}` },
    ...over
  });
  return { server, store, files, uploaded, open };
}

const unit = (label: string) => ({ unitId: label, parentUnitId: null, kind: 'passage', label, order: 'a' });

describe('LanguageSession: one language kept and moved (decisions.md 104)', () => {
  it('a write is pending until a sync, and the status says what the server answered', async () => {
    const { open } = phone();
    const session = await open();
    await session.append('v1.UnitAdded', unit('Luke 1'));
    await until(() => session.status.pending === 1);
    expect(session.state.units['Luke 1']).toBeDefined();
    expect(session.status.online).toBeNull();

    await session.sync();
    await until(() => session.status.pending === 0);
    expect(session.status).toMatchObject({ online: true, pulled: true, refused: null, tooOld: false, lastSync: 'pushed 1, pulled 1, rejected 0' });
    session.close();
  });

  it('offline is said as offline, and the work waits', async () => {
    const { server, open } = phone();
    const session = await open();
    server.offline = true;
    await session.append('v1.UnitAdded', unit('Luke 1'));
    await session.sync();
    expect(session.status).toMatchObject({ online: false, pulled: false, lastSync: 'offline' });
    await until(() => session.status.pending === 1);
    session.close();
  });

  it('tells subscribers only when something they can see changed', async () => {
    const { open } = phone();
    const session = await open();
    session.start();
    let told = 0;
    session.subscribe(() => { told += 1; });
    await session.sync();
    const after = told;
    // Up to date again: same answer, nothing new to tell.
    await session.sync();
    await new Promise((r) => setTimeout(r, 10));
    expect(told).toBe(after);
    session.close();
  });

  it('units kept offline are remembered for the next session', async () => {
    const { open } = phone();
    const first = await open();
    await first.keepOffline('Luke 2', true);
    expect([...first.status.keptUnits]).toEqual(['Luke 2']);
    first.close();
    const second = await open();
    expect([...second.status.keptUnits]).toEqual(['Luke 2']);
    second.close();
  });

  it("uploads this person's recording once started, and the server's confirmation clears it", async () => {
    const { files, uploaded, open } = phone();
    const session = await open();
    session.start();
    files.put('h1', 10);
    await session.append('v1.RecordingAdded', { recordingId: 'r1', unitId: 'Luke 1', kind: 'target', cards: [{ hash: 'h1', durationMs: 1000, format: 'm4a' }] });
    expect((await session.unsent()).map((r) => r.hash)).toEqual(['h1']);
    session.triggerUpload();
    await until(() => uploaded.includes('h1'));
    await session.sync();
    let left = 1;
    await until(() => { void session.unsent().then((u) => { left = u.length; }); return left === 0; });
    session.close();
  });

  it('says a passage is uploading only while its file is going up, and keeps what waits for other screens (decisions.md 166)', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const { files, store, open } = phone({ upload: async () => { await gate; } });
    const session = await open();
    session.start();
    files.put('h1', 10);
    await session.append('v1.UnitAdded', unit('Luke 1'));
    await session.append('v1.RecordingAdded', { recordingId: 'r1', unitId: 'Luke 1', kind: 'target', cards: [{ hash: 'h1', durationMs: 1000, format: 'm4a' }] });
    expect(session.status.uploading.size).toBe(0);
    session.triggerUpload();
    await until(() => session.status.uploading.has('Luke 1'));
    expect(session.status.uploads.get('Luke 1')).toEqual({ waiting: 1, of: 1 });
    expect(await store.meta('files-waiting:org1/luke')).toBe('1');
    release();
    await until(() => session.status.uploading.size === 0);
    await until(() => session.status.uploads.size === 0);
    await until(() => session.status.sent.some((e) => e.unitId === 'Luke 1' && e.files === 1));
    let saved: string | null = null;
    await until(() => { void store.meta('files-waiting:org1/luke').then((v) => { saved = v ?? null; }); return saved === '0'; });
    session.close();
  });

  it('says each time the server answers a sync, and not when it does not (decisions.md 166)', async () => {
    let now = 5_000;
    let ids = 0;
    const answered: number[] = [];
    // The app's clock (`now`) says when; the event clock only orders events.
    const { server, open } = phone({
      client: { clock: new HlcClock('phone', () => (ids += 1)), newId: () => `e${(ids += 1)}`, now: () => now },
      onAnswered: (at) => answered.push(at)
    });
    const session = await open();
    await session.sync();
    now = 7_000;
    // Nothing new: still told, since how recently it answered is the point.
    await session.sync();
    now = 9_000;
    server.offline = true;
    await session.sync();
    expect(answered).toEqual([5_000, 7_000]);
    session.close();
  });

  it('after close nothing more is said', async () => {
    const { open } = phone();
    const session = await open();
    let told = 0;
    session.subscribe(() => { told += 1; });
    session.close();
    await session.sync().catch(() => {});
    expect(told).toBe(0);
  });
});

describe('LanguageSession: commands, waking and what settles', () => {
  it('a command and a batch go in as one write each, and the counts follow', async () => {
    const { open } = phone();
    const session = await open();
    await session.run([{ id: 'c1', type: 'v1.UnitAdded', payload: unit('Luke 1') }]);
    await session.appendMany([{ type: 'v1.UnitAdded', payload: unit('Luke 2') }, { type: 'v1.UnitAdded', payload: unit('Luke 3') }]);
    await session.run([]);
    await session.appendMany([]);
    await until(() => session.status.pending === 3);
    expect(Object.keys(session.state.units).sort()).toEqual(['Luke 1', 'Luke 2', 'Luke 3']);
    expect((await session.inspect()).pending).toHaveLength(3);
    session.close();
  });

  it('a sync that leaves nothing of its own to send is the moment to send diagnostics', async () => {
    const settled: number[] = [];
    const { open } = phone({ onSettled: ({ blobsWanted }) => settled.push(blobsWanted) });
    const session = await open();
    await session.sync();
    await until(() => settled.length === 1);
    expect(settled).toEqual([0]);
    session.close();
  });

  it('a sync that throws says so, and leaves online where it was', async () => {
    const { open } = phone({ aroundSync: async () => { throw new Error('boom'); } });
    const session = await open();
    await session.sync();
    expect(session.status).toMatchObject({ lastSync: 'error: boom', online: null });
    session.close();
  });

  it('woken, it syncs; a membership change sends refused work again', async () => {
    const { open } = phone();
    const session = await open();
    session.start();
    session.wake();
    await until(() => session.status.online === true);
    await session.membershipChanged();
    await session.refresh();
    expect(session.status.refused).toBeNull();
    session.close();
  });

  it('a unit no longer kept is let go', async () => {
    const { open } = phone();
    const session = await open();
    await session.keepOffline('Luke 2', true);
    await session.keepOffline('Luke 2', false);
    expect([...session.status.keptUnits]).toEqual([]);
    session.close();
  });
});

describe('LanguageSession: what tells a screen to redraw', () => {
  it('a write still on its way to disk tells nobody; only the fold changing does', async () => {
    // Why: the app redraws on every status change. Saying "saving" and then
    // "saved" around each commit redrew it twice per commit, and on a 2 GB
    // phone that was most of a 46-second first open of a big language.
    const { open } = phone();
    const session = await open();
    session.start();
    const seen: string[] = [];
    session.subscribe(() => { seen.push(Object.keys(session.status).sort().join(',')); });
    const before = session.status.revision;
    for (let i = 0; i < 5; i++) await session.append('v1.UnitAdded', unit(`Luke ${i + 2}`));
    await until(() => session.status.revision >= before + 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(seen.every((keys) => !keys.split(',').includes('saving'))).toBe(true);
    session.close();
  });
});

describe('LanguageSession: a language kept on disk (decisions.md 143)', () => {
  it('counts what is offline from the phone\'s table, and sends a recording made here', async () => {
    const { files, uploaded, open } = phone({ keepOnDisk: true });
    const session = await open();
    session.start();
    files.put('h1', 10);
    await session.append('v1.RecordingAdded', { recordingId: 'r1', unitId: 'Luke 1', kind: 'target', cards: [{ hash: 'h1', durationMs: 1000, format: 'm4a' }] });
    await until(() => session.status.keptOffline !== null && session.status.scope.has('Luke 1'));
    expect(session.status.keptOffline?.get('Luke 1')).toMatchObject({ audio: 1, here: 1, reason: 'worked' });
    expect(await session.hasRecording('r1')).toBe(true);
    session.triggerUpload();
    await until(() => uploaded.includes('h1'));
    await session.loadUnits(['Luke 1']);
    expect(session.state.recordings['r1']).toBeDefined();
    session.close();
  });
});

describe('LanguageSession: lists of passages read lines (decisions.md 143)', () => {
  /** A passage recorded by akol, reviewed by lead with feedback, and asked of akol again; another merely drafted. */
  async function team(session: LanguageSession, server: FakeServer) {
    await session.append('v1.UnitAdded', unit('Luke 1'));
    await session.append('v1.UnitAdded', unit('Luke 2'));
    await session.append('v1.TakeComposed', { takeId: 't1', unitId: 'Luke 1', cardHashes: ['c1'], parentTakeId: null });
    await session.append('v1.TakeSubmitted', { takeId: 't1' });
    await session.append('v1.TakeComposed', { takeId: 'd2', unitId: 'Luke 2', cardHashes: ['c2'], parentTakeId: null });
    await session.append('v1.KeyTermLinked', { takeId: 't1', termId: 'logos' });
    await session.sync();
    await from(server, 'lead', 'v1.ReviewRecorded', { reviewId: 'r1', takeId: 't1', kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'slower' });
    await from(server, 'lead', 'v1.RequestMade', { requestId: 'q1', unitId: 'Luke 1', what: 'record', profileId: 'akol' });
    await session.sync();
  }

  for (const keepOnDisk of [false, true]) {
    it(`Map, My Work and the Inbox read the same from lines (${keepOnDisk ? 'kept on disk' : 'kept in memory'})`, async () => {
      const { server, open } = phone(keepOnDisk ? { keepOnDisk: true } : {});
      const session = await open();
      session.start();
      await team(session, server);
      await session.client.settleLines();
      await until(() => session.status.lines.get('Luke 1').awaitingResponse.length === 1);
      const line = session.status.lines.get('Luke 1');
      expect(line).toMatchObject({ recorded: true, latest: { n: 1, by: 'akol' } });
      expect(line.people).toEqual(['akol', 'lead']);
      expect(session.status.lines.get('Luke 2')).toMatchObject({ recorded: false, drafting: true, draftsBy: { akol: expect.any(String) } });
      expect([...session.status.lines.worked()].sort()).toEqual(['Luke 1', 'Luke 2']);
      // The Inbox: lead's review of akol's version, and lead's request.
      expect((await session.updatesFor('akol')).map((u) => u.id).sort()).toEqual(['request:q1', 'review:r1']);
      expect(await session.updatesFor('nobody')).toEqual([]);
      expect(await session.passagesLinkingTerm('logos')).toEqual(['Luke 1']);
      expect(await session.passageOfTake('d2')).toBe('Luke 2');
      session.close();
    });
  }

  it('reads an Inbox passage from disk again only when its line changed', async () => {
    const { server, store, open } = phone({ keepOnDisk: true });
    const session = await open();
    session.start();
    await team(session, server);
    await session.client.settleLines();
    await session.updatesFor('akol');
    let reads = 0;
    const keptByUnit = store.keptByUnit.bind(store);
    store.keptByUnit = (...a) => { reads += 1; return keptByUnit(...a); };
    await session.updatesFor('akol');
    expect(reads).toBe(0);
    await from(server, 'lead', 'v1.RequestWithdrawn', { requestId: 'q1' });
    await session.sync();
    await session.client.settleLines();
    reads = 0;
    expect((await session.updatesFor('akol')).map((u) => u.id).sort()).toEqual(['request:q1', 'review:r1']);
    expect(reads).toBe(1);
    session.close();
  });
});

describe('LanguageSession: when diagnostics may go', () => {
  const recording = { recordingId: 'r1', unitId: 'Luke 1', kind: 'target' as const, cards: [{ hash: 'h1', durationMs: 1000, format: 'm4a' as const }] };

  it('an upload that fails every time holds diagnostics back only until it has been tried', async () => {
    // Why: uploads retry forever, and diagnostics waited for them to finish.
    // One recording the server always refused stopped every delivery from
    // that phone, the one phone support most needed to hear from.
    const settled: number[] = [];
    let recording_ = true;
    const tried: string[] = [];
    const { files, open } = phone({
      upload: async (ref) => { tried.push(ref.hash); throw new Error('http 500'); },
      isDeferred: () => recording_,
      onSettled: ({ blobsWanted }) => settled.push(blobsWanted)
    });
    const session = await open();
    session.start();
    files.put('h1', 10);
    await session.append('v1.RecordingAdded', recording);
    // The worker counts the file on a pass, and its first pass after a change
    // waits out a 2 s debounce: waiting for that raced `until`'s own 2 s. Run
    // the pass now; while recording it only counts the file and holds it.
    session.triggerUpload();
    await until(() => session.status.pendingUp === 1);
    // Still recording: the upload has not had its turn, so nothing goes.
    await session.sync();
    await new Promise((r) => setTimeout(r, 20));
    expect(tried).toEqual([]);
    expect(settled).toEqual([]);

    recording_ = false;
    session.triggerUpload();
    await until(() => tried.length === 1);
    await session.sync();
    await until(() => settled.length === 1);
    expect(session.status.pendingUp).toBe(1);
    session.close();
  });

  it('a refusal is an answer: diagnostics go though the work cannot', async () => {
    // Why: a refused phone keeps its outbox for good (invariant 1), so
    // "outbox empty" never came, and its diagnostics, which say why, never went.
    const settled: number[] = [];
    const { server, open } = phone({ onSettled: ({ blobsWanted }) => settled.push(blobsWanted) });
    const session = await open();
    await session.append('v1.UnitAdded', unit('Luke 1'));
    server.refuse = 'not a member';
    await session.sync();
    expect(settled).toEqual([0]);
    session.close();
  });

  it('never while offline', async () => {
    const settled: number[] = [];
    const { server, open } = phone({ onSettled: ({ blobsWanted }) => settled.push(blobsWanted) });
    const session = await open();
    server.offline = true;
    await session.sync();
    await new Promise((r) => setTimeout(r, 20));
    expect(settled).toEqual([]);
    session.close();
  });
});

describe('LanguageSession: uploads keep moving while sync runs again and again', () => {
  /** A store like a browser's: one lock for every read and write, each a few ms. */
  function lockedStore() {
    const inner = new MemoryStore();
    let lock: Promise<unknown> = Promise.resolve();
    const exclusive = <T,>(fn: () => Promise<T>): Promise<T> => {
      const next = lock.then(async () => { await new Promise((r) => setTimeout(r, 8)); return fn(); });
      lock = next.catch(() => {});
      return next;
    };
    return new Proxy(inner, {
      get: (t, k) => {
        const v = (t as unknown as Record<string, unknown>)[k as string];
        return typeof v === 'function' ? (...a: unknown[]) => exclusive(() => (v as (...x: unknown[]) => Promise<unknown>).apply(t, a)) : v;
      }
    });
  }

  for (const keepOnDisk of [false, true]) {
    it(`a recording goes up between syncs (${keepOnDisk ? 'kept on disk' : 'kept in memory'})`, async () => {
      // Why: an upload waits while a pull runs. A work list read from the
      // phone's table each time waited behind the sync's own writes, and by
      // then the next sync had started: on the web UI tests, whose probe
      // syncs again and again, a recording made offline never went up.
      const { files, uploaded, open } = phone({ store: lockedStore(), keepOnDisk });
      const session = await open();
      session.start();
      files.put('h1', 10);
      await session.append('v1.RecordingAdded', { recordingId: 'r1', unitId: 'Luke 1', kind: 'target', cards: [{ hash: 'h1', durationMs: 1000, format: 'm4a' }] });
      const started = Date.now();
      while (!uploaded.includes('h1') && Date.now() - started < 3000) await session.sync();
      session.close();
      expect(uploaded).toContain('h1');
    });
  }
});

describe('LanguageSession: the open record', () => {
  it('times a first open from opening to the first full pull, once', async () => {
    // Why: "the language takes forever to open" was the report support could
    // least answer: offline spells, a snapshot and folds all looked alike.
    const diagStore = new MemoryDiagStore();
    const wall = { t: 0 };
    let id = 0;
    const diag = new Diagnostics({ store: diagStore, newId: () => `d${++id}`, now: () => wall.t });
    const { server, open } = phone({
      client: { clock: new HlcClock('phone', () => (wall.t += 1)), newId: () => `e${(wall.t += 1)}`, diag, now: () => wall.t }
    });
    const session = await open();
    server.offline = true;
    await session.sync();
    server.offline = false;
    wall.t += 60_000;
    await session.sync();
    await session.sync();
    await diag.settle();
    const opens = diagStore.records.filter((r) => r.kind === 'open');
    expect(opens).toHaveLength(1);
    expect(opens[0]).toMatchObject({ orgId: 'org1', streamId: 'luke', t: { cold: 'yes' }, n: { syncs: 2, pulled: 0 } });
    expect(opens[0]!.n.ms).toBeGreaterThanOrEqual(60_000);
    expect(diagStore.records.find((r) => r.kind === 'load')?.t.reason).toBe('open');
    session.close();
  });
});

describe('LanguageSession: its part of the device record', () => {
  it('counts recordings waiting to go up and how long the oldest has waited since it was recorded', async () => {
    // Why: "my recordings never upload" needs how many and since when, and a
    // phone restarted since must not reset the age.
    const wall = { t: 0 };
    const { files, open } = phone({
      upload: async () => { throw new Error('http 500'); },
      client: { clock: new HlcClock('phone', () => wall.t), newId: () => `e${(wall.t += 1)}`, now: () => wall.t }
    });
    const session = await open();
    expect(session.probe()).toEqual({ uploadsWaiting: 0 });
    files.put('h1', 10);
    await session.append('v1.RecordingAdded', { recordingId: 'r1', unitId: 'Luke 1', kind: 'target', cards: [{ hash: 'h1', durationMs: 1000, format: 'm4a' }] });
    wall.t += 90 * 60_000;
    expect(session.probe()).toMatchObject({ uploadsWaiting: 1, oldestUnsentMin: 90 });
    session.close();
  });
});
