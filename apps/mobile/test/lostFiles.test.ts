/**
 * Files a phone deletes behind the app's back (decisions.md 92): the file
 * store writes down what it keeps, notices what goes missing at startup and
 * while in use, and never mistakes its own deletions for a loss. Run on the
 * web store, whose files are an in-memory folder here.
 */
import { MemoryFileLedger, type KeptFile } from '@langquest-next/sync';
import type { WebFiles } from '../src/webFiles';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-crypto', async () => {
  const { createHash } = await import('node:crypto');
  return {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: async (_algorithm: string, data: Uint8Array) => Uint8Array.from(createHash('sha256').update(data).digest()).buffer
  };
});
vi.mock('expo-file-system', () => ({ Directory: class {}, File: class {}, Paths: { document: null, availableDiskSpace: 0 } }));
vi.mock('expo-file-system/legacy', () => ({ readDirectoryAsync: async () => [] }));
vi.mock('../src/store', () => ({ getFileLedger: async () => null }));
vi.mock('../src/wake', () => ({ onWake: () => () => undefined }));

const { BlobStore } = await import('../src/blobs');

/** A browser folder in memory; `hold` makes the next listing wait until released. */
function folder() {
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  let hold: Promise<void> | null = null;
  const web: WebFiles = {
    list: async () => {
      if (hold) await hold;
      return [...files].map(([name, bytes]) => ({ name, size: bytes.byteLength }));
    },
    read: async (name) => files.get(name) ?? null,
    write: async (name, bytes) => { files.set(name, bytes); },
    remove: async (name) => { files.delete(name); },
    clear: async () => { files.clear(); }
  };
  const holdNextListing = () => { let release = () => {}; hold = new Promise<void>((r) => { release = () => { hold = null; r(); }; }); return release; };
  return { files, web, holdNextListing };
}

const bytes = (s: string) => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;

/** A fresh start of the app on the same folder and ledger. */
async function start(web: WebFiles, ledger: MemoryFileLedger) {
  const store = new BlobStore(web, ledger);
  await store.init();
  await store.settle();
  return store;
}

describe('noticing files the device lost (decisions.md 92)', () => {
  it('writes down what is already here the first time, without calling it lost', async () => {
    const { files, web } = folder();
    files.set(`${'a'.repeat(64)}.wav`, bytes('one'));
    files.set(`${'b'.repeat(64)}.m4a`, bytes('two'));
    const ledger = new MemoryFileLedger();
    const store = await start(web, ledger);
    expect(ledger.keptFiles).toEqual(new Map([['a'.repeat(64), 'wav'], ['b'.repeat(64), 'm4a']]));
    expect(await store.lostFiles()).toEqual([]);
  });

  it('a file gone while the app was closed is lost at the next start', async () => {
    const { files, web } = folder();
    const ledger = new MemoryFileLedger();
    const first = await start(web, ledger);
    const kept = await first.ingestBytes(bytes('a recording'), 'wav');
    const other = await first.ingestBytes(bytes('another'), 'm4a');
    await first.settle();
    expect([...ledger.keptFiles.keys()].sort()).toEqual([kept.hash, other.hash].sort());

    files.delete(`${kept.hash}.wav`);
    const second = await start(web, ledger);
    expect((await second.lostFiles()).map((l) => [l.hash, l.format])).toEqual([[kept.hash, 'wav']]);
    expect(second.has(kept.hash)).toBe(false);
    expect([...ledger.keptFiles.keys()]).toEqual([other.hash]);

    // Seen: the alert goes, and the next start does not raise it again.
    await second.lostSeen([kept.hash]);
    expect(await second.lostFiles()).toEqual([]);
    const third = await start(web, ledger);
    expect(await third.lostFiles()).toEqual([]);
  });

  it('a file gone while the app is open is found when the folder is looked at again', async () => {
    const { files, web } = folder();
    const ledger = new MemoryFileLedger();
    const store = await start(web, ledger);
    const a = await store.ingestBytes(bytes('kept a while'), 'wav');
    const b = await store.ingestBytes(bytes('kept too'), 'jpg');
    await store.settle();
    let heard = 0;
    store.onLost(() => { heard++; });
    let changed = 0;
    store.onChange(() => { changed++; });

    files.delete(`${b.hash}.jpg`);
    store.recheck(true);
    await store.settle();
    expect((await store.lostFiles()).map((l) => l.hash)).toEqual([b.hash]);
    // Off the index, so kept passages download it again and nothing tries to play or send it.
    expect(store.has(b.hash)).toBe(false);
    expect(store.has(a.hash)).toBe(true);
    expect(heard).toBe(1);
    expect(changed).toBe(1);
  });

  it('looks again at most every ten minutes unless asked to now', async () => {
    const { files, web } = folder();
    const ledger = new MemoryFileLedger();
    const store = await start(web, ledger);
    const a = await store.ingestBytes(bytes('soon gone'), 'wav');
    await store.settle();
    files.delete(`${a.hash}.wav`);
    // Arriving files ask for a look; the store looked at startup, so this one waits.
    await store.ingestBytes(bytes('new'), 'wav');
    store.recheck();
    await store.settle();
    expect(await store.lostFiles()).toEqual([]);
    store.recheck(true);
    await store.settle();
    expect((await store.lostFiles()).map((l) => l.hash)).toEqual([a.hash]);
  });

  it('a file that arrives while the folder is being listed is not lost', async () => {
    const { web, holdNextListing } = folder();
    const ledger = new MemoryFileLedger();
    const store = await start(web, ledger);
    const release = holdNextListing();
    store.recheck(true);
    // Written and indexed after the listing was read, so the listing cannot have it.
    const late = await store.ingestBytes(bytes('just recorded'), 'wav');
    release();
    await store.settle();
    expect(await store.lostFiles()).toEqual([]);
    expect(store.has(late.hash)).toBe(true);
  });

  it('files the store deletes itself are never lost, and are crossed out before they go', async () => {
    const { files, web } = folder();
    const order: string[] = [];
    const ledger = new (class extends MemoryFileLedger {
      override async forget(hashes: readonly string[]) {
        // Still on disk when the ledger forgets them: a crash here leaves a stray file, never a false alarm.
        for (const h of hashes) order.push(`forget ${h} ${[...files.keys()].some((n) => n.startsWith(h)) ? 'present' : 'gone'}`);
        await super.forget(hashes);
      }
      override async keep(list: readonly KeptFile[]) { await super.keep(list); }
    })();
    const store = await start(web, ledger);
    const a = await store.ingestBytes(bytes('a source chapter'), 'mp3');
    const b = await store.ingestBytes(bytes('an evictable recording, larger'), 'wav');
    await store.settle();

    store.remove([{ hash: a.hash, format: 'mp3' }]);
    expect(store.has(a.hash)).toBe(false);
    store.reclaim([{ hash: b.hash, format: 'wav' }], { minFreeBytes: 0, maxTotalBytes: 0 });
    await store.settle();
    expect(order).toEqual([`forget ${a.hash} present`, `forget ${b.hash} present`]);
    expect(files.size).toBe(0);

    store.recheck(true);
    await store.settle();
    const again = await start(web, ledger);
    expect(await store.lostFiles()).toEqual([]);
    expect(await again.lostFiles()).toEqual([]);
  });

  it('reclaims largest first, only as much as it must', async () => {
    const { files, web } = folder();
    const ledger = new MemoryFileLedger();
    const store = await start(web, ledger);
    const small = await store.ingestBytes(bytes('s'), 'wav');
    const big = await store.ingestBytes(bytes('b'.repeat(100)), 'wav');
    const mid = await store.ingestBytes(bytes('m'.repeat(50)), 'wav');
    const all = [small, big, mid].map((f) => ({ hash: f.hash, format: 'wav' as const }));
    // 151 bytes held, at most 60 allowed: the 100-byte file is enough.
    expect(store.reclaim(all, { minFreeBytes: 0, maxTotalBytes: 60 })).toEqual([big.hash]);
    expect(store.reclaim(all, { minFreeBytes: 0, maxTotalBytes: 60 })).toEqual([]);
    await store.settle();
    expect([...files.keys()].sort()).toEqual([`${small.hash}.wav`, `${mid.hash}.wav`].sort());
  });

  it('without a ledger the store works as before and reports nothing', async () => {
    const { files, web } = folder();
    const store = new BlobStore(web, null);
    await store.init();
    const a = await store.ingestBytes(bytes('x'), 'wav');
    files.delete(`${a.hash}.wav`);
    store.recheck(true);
    await store.settle();
    expect(await store.lostFiles()).toEqual([]);
  });
});
