import { HlcClock, type BlobRef } from '@langquest-next/core';
import { FILE_NEWS_MS, LanguageSession, type LocalFiles } from '../src/languageSession';
import { MemoryStore } from '../src/memoryStore';
import { FakeServer } from '../src/testing/fakeServer';

/** A phone's files that count how often they are copied, read in place, and reclaimed. */
function countingFiles() {
  const live = new Map<string, number>();
  const listeners = new Set<() => void>();
  const counts = { copies: 0, views: 0, reclaims: 0 };
  let version = 0;
  const files: LocalFiles & { arrive(hash: string): void } = {
    arrive(hash) { live.set(hash, 10); version++; for (const l of listeners) l(); },
    snapshot: () => { counts.copies++; return new Set(live.keys()); },
    presentView: () => { counts.views++; return new Set(live.keys()) as ReadonlySet<string>; },
    get version() { return version; },
    sizes: () => live,
    sizeOf: (hash) => live.get(hash),
    formatOf: () => 'm4a',
    reclaim: () => { counts.reclaims++; },
    onChange: (l) => { listeners.add(l); return () => { listeners.delete(l); }; }
  };
  return { files, counts };
}

async function until(ok: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function openWith(files: LocalFiles) {
  const wall = { t: 0 };
  return LanguageSession.open({
    orgId: 'org1', languageId: 'luke', actorId: 'akol', deviceId: 'phone', store: new MemoryStore(), transport: new FakeServer().transportFor(), files,
    upload: async (_ref: BlobRef) => {}, download: async () => {},
    limits: { minFreeBytes: 0, maxTotalBytes: Number.MAX_SAFE_INTEGER },
    client: { clock: new HlcClock('phone', () => (wall.t += 1)), newId: () => `e${(wall.t += 1)}` }
  });
}

describe('LanguageSession: files arriving (performance-audit-app.md R2)', () => {
  it('tells screens which files are here once per window, however many arrive in it', async () => {
    const { files, counts } = countingFiles();
    const session = await openWith(files);
    session.start();
    const seen = new Set<ReadonlySet<string>>();
    session.subscribe(() => { seen.add(session.status.present); });
    const copiesAtStart = counts.copies;
    seen.clear();
    for (let i = 0; i < 300; i++) files.arrive(`h${i}`);
    // Nothing is copied or published while the burst lasts.
    expect(counts.copies).toBe(copiesAtStart);
    expect(session.status.present.size).toBe(0);
    await until(() => session.status.present.size === 300);
    await new Promise((r) => setTimeout(r, FILE_NEWS_MS + 50));
    // One copy for the window, one new set for screens.
    expect(counts.copies - copiesAtStart).toBe(1);
    expect([...seen].filter((p) => p.size > 0).length).toBe(1);
    session.close();
  });

  it('reclaims once at the end of a burst, not once per file, and at once after a quiet spell', async () => {
    const { files, counts } = countingFiles();
    const session = await openWith(files);
    session.start();
    // start() reclaims, once its plan is read (decisions.md 140); a burst right after it is gathered into one more pass at the window's end.
    await until(() => counts.reclaims === 1);
    const atStart = counts.reclaims;
    for (let i = 0; i < 300; i++) files.arrive(`h${i}`);
    expect(counts.reclaims).toBe(atStart);
    await until(() => counts.reclaims === atStart + 1);
    await new Promise((r) => setTimeout(r, FILE_NEWS_MS + 50));
    expect(counts.reclaims).toBe(atStart + 1);
    // Quiet for a window: the next change is answered without waiting for one, only for the plan.
    files.arrive('late');
    await until(() => counts.reclaims === atStart + 2);
    session.close();
  });

  it('closing stops the timers', async () => {
    const { files, counts } = countingFiles();
    const session = await openWith(files);
    session.start();
    files.arrive('a');
    files.arrive('b');
    session.close();
    const copies = counts.copies;
    const reclaims = counts.reclaims;
    await new Promise((r) => setTimeout(r, FILE_NEWS_MS + 100));
    expect(counts.copies).toBe(copies);
    expect(counts.reclaims).toBe(reclaims);
  });
});
