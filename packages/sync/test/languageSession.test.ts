import { HlcClock, type BlobRef } from '@langquest-next/core';
import { LanguageSession, type LanguageSessionOptions, type LocalFiles } from '../src/languageSession';
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

describe('LanguageSession: a language kept on disk (decisions.md 108)', () => {
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

describe('LanguageSession: lists of passages read lines (decisions.md 108)', () => {
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
