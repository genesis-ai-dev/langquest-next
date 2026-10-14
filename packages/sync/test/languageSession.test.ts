import { HlcClock, type BlobRef } from '@langquest-next/core';
import { LanguageSession, type LanguageSessionOptions, type LocalFiles } from '../src/languageSession';
import { MemoryStore } from '../src/memoryStore';
import { FakeServer } from '../src/testing/fakeServer';

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

describe('LanguageSession: one language kept and moved (decisions.md 103)', () => {
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
    expect(session.unsent().map((r) => r.hash)).toEqual(['h1']);
    session.triggerUpload();
    await until(() => uploaded.includes('h1'));
    await session.sync();
    await until(() => session.unsent().length === 0);
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
