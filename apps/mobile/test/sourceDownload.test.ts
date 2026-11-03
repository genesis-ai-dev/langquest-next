import { afterEach } from 'vitest';

/**
 * Keeping a source's chapter on the phone (src/sources/offline.ts download
 * and purgeFileset): a file earns its place in the store only by hashing to
 * what is expected; a withdrawn fileset's files go. Faked: the platform,
 * the file system, the blob store and AsyncStorage.
 */
const fake = vi.hoisted(() => {
  const state = {
    platform: 'ios',
    storage: new Map<string, string>(),
    /** What a download puts in the staged file, by URL. */
    served: new Map<string, string>(),
    staged: new Map<string, { content: string; deleted: boolean; movedTo?: string }>(),
    events: [] as string[]
  };
  return state;
});

vi.mock('react-native', () => ({ Platform: { get OS() { return fake.platform; } } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => fake.storage.get(k) ?? null,
    setItem: async (k: string, v: string) => { fake.storage.set(k, v); },
    removeItem: async (k: string) => { fake.storage.delete(k); }
  }
}));
vi.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `id${++n}` };
});
vi.mock('expo-file-system', () => {
  class File {
    readonly name: string;
    constructor(_dir: unknown, name: string) { this.name = name; }
    static async downloadFileAsync(url: string, f: File) {
      const content = fake.served.get(url);
      if (content === undefined) throw new Error(`no such file ${url}`);
      fake.staged.set(f.name, { content, deleted: false });
    }
    async bytes() { return new TextEncoder().encode(fake.staged.get(this.name)!.content); }
    delete() { fake.staged.get(this.name)!.deleted = true; }
    move(dest: { name: string }) { fake.staged.get(this.name)!.movedTo = dest.name; }
  }
  return { File, Paths: { cache: 'cache' } };
});
vi.mock('../src/sync/blobs', () => ({
  BlobStore: { hashOf: async (bytes: Uint8Array) => `h:${new TextDecoder().decode(bytes)}` },
  getBlobStore: async () => null
}));
vi.mock('../src/library/docStore', () => ({ loadDocs: async () => new Map() }));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: () => undefined }));
vi.mock('../src/diagnostics/diagnostics', () => ({
  diagnostics: { record: () => undefined, audio: () => undefined, expected: () => undefined },
  flushDiagnostics: async () => undefined,
  timedTransfer: (_dir: unknown, _where: unknown, run: (t: object) => unknown) => run({})
}));
vi.mock('../src/recording/recorderState', () => ({ isRecording: () => false }));
vi.mock('../src/sources/bibleBrain', () => ({ BibleError: class extends Error {} }));
vi.mock('../src/sources/store', () => ({ bibleBrain: null }));
vi.mock('../src/reports/reportsServer', () => ({ reportsServer: { baseUrl: '', token: async () => 'tok' } }));

interface FakeStore {
  present: Map<string, number>;
  removed: { hash: string; format: string }[];
  fileFor(ref: { hash: string }): { name: string; exists: boolean };
  markPresent(hash: string, bytes: number): void;
  putVerified(ref: { hash: string }, bytes: Uint8Array): Promise<void>;
  remove(refs: { hash: string; format: string }[]): void;
  has(hash: string): boolean;
}

function fakeStore(over: { destExists?: boolean } = {}): FakeStore {
  const store: FakeStore = {
    present: new Map(),
    removed: [],
    fileFor: (ref) => ({ name: `store/${ref.hash}`, exists: over.destExists ?? false }),
    markPresent: (hash, bytes) => { store.present.set(hash, bytes); },
    putVerified: async (ref, bytes) => { store.present.set(ref.hash, bytes.byteLength); },
    remove: (refs) => { store.removed.push(...refs); },
    has: (hash) => store.present.has(hash)
  };
  return store;
}

async function offline() {
  vi.resetModules();
  return import('../src/sources/offline');
}

const index = () => JSON.parse(fake.storage.get('source-audio:index') ?? '{}') as Record<string, { hash: string; bytes: number; format?: string; fileset?: string }>;

beforeEach(() => {
  fake.platform = 'ios';
  fake.storage.clear();
  fake.served.clear();
  fake.staged.clear();
});
afterEach(() => vi.unstubAllGlobals());

describe('download on a phone', () => {
  it('a file that hashes to what was expected is moved into the store and entered in the index', async () => {
    const { download, ensureIndex, keptAudio } = await offline();
    const store = fakeStore();
    fake.served.set('https://x/a.mp3', 'abc');
    await download(store as never, 'lib:h:abc', 'https://x/a.mp3', { expectHash: 'h:abc', format: 'mp3' });
    expect([...fake.staged.values()]).toEqual([{ content: 'abc', deleted: false, movedTo: 'store/h:abc' }]);
    expect(store.present.get('h:abc')).toBe(3);
    expect(index()['lib:h:abc']).toMatchObject({ hash: 'h:abc', bytes: 3, format: 'mp3' });
    await ensureIndex();
    expect(keptAudio(store as never, 'lib:h:abc')).toEqual({ hash: 'h:abc', format: 'mp3' });
    expect(keptAudio(store as never, 'lib:other')).toBeNull();
    expect(keptAudio(null, 'lib:h:abc')).toBeNull();
  });

  it('a file whose bytes hash to something else is deleted, never stored or indexed, and the download fails', async () => {
    const { download } = await offline();
    const store = fakeStore();
    fake.served.set('https://x/a.mp3', 'tampered');
    await expect(download(store as never, 'lib:h:abc', 'https://x/a.mp3', { expectHash: 'h:abc' })).rejects.toThrow('hash mismatch for lib:h:abc');
    expect([...fake.staged.values()]).toEqual([{ content: 'tampered', deleted: true }]);
    expect(store.present.size).toBe(0);
    expect(index()).toEqual({});
  });

  it('with no expected hash (Bible Brain) the file is kept under the hash it has, remembering its fileset', async () => {
    const { download } = await offline();
    const store = fakeStore();
    fake.served.set('https://x/b', 'xyz');
    await download(store as never, 'bb:F:GEN:1', 'https://x/b', { fileset: 'F' });
    expect(index()['bb:F:GEN:1']).toMatchObject({ hash: 'h:xyz', fileset: 'F', format: 'mp3' });
  });

  it('a file the store already has is not moved over it: the staged copy is dropped', async () => {
    const { download } = await offline();
    const store = fakeStore({ destExists: true });
    fake.served.set('https://x/a', 'abc');
    await download(store as never, 'k', 'https://x/a', {});
    expect([...fake.staged.values()]).toEqual([{ content: 'abc', deleted: true }]);
    expect(index()['k']).toMatchObject({ hash: 'h:abc' });
  });

  it('a failed transfer leaves nothing indexed', async () => {
    const { download } = await offline();
    await expect(download(fakeStore() as never, 'k', 'https://x/missing', {})).rejects.toThrow('no such file');
    expect(index()).toEqual({});
  });

  it('tells screens when a file arrives', async () => {
    const { download, onSourceFiles } = await offline();
    let told = 0;
    const off = onSourceFiles(() => { told += 1; });
    fake.served.set('u', 'abc');
    await download(fakeStore() as never, 'k', 'u', {});
    off();
    await download(fakeStore() as never, 'k2', 'u', {});
    expect(told).toBe(1);
  });
});

describe('download in a browser', () => {
  /** What the page asked the Worker for, with the bearer it sent. */
  const asked: string[] = [];
  const worker = (files: Record<string, string>) => vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    asked.push(`${path} ${(init?.headers as Record<string, string> | undefined)?.authorization ?? '-'}`);
    return path in files ? new Response(files[path]) : new Response('no', { status: 403 });
  });
  beforeEach(() => { asked.length = 0; });

  it('asks the Worker for the library link (the page may not read the source itself, decisions.md 200) and stores the bytes verified', async () => {
    fake.platform = 'web';
    const { download } = await offline();
    const store = fakeStore();
    worker({ '/api/source-audio?url=https%3A%2F%2Fx%2Fok': 'abc' });
    await download(store as never, 'k', 'https://x/ok', { expectHash: 'h:abc' });
    expect(store.present.get('h:abc')).toBe(3);
    expect(asked).toEqual(['/api/source-audio?url=https%3A%2F%2Fx%2Fok Bearer tok']);
    await expect(download(store as never, 'k2', 'https://x/no', {})).rejects.toThrow('Download failed (403)');
    await expect(download(store as never, 'k3', 'https://x/ok', { expectHash: 'h:other' })).rejects.toThrow('hash mismatch for k3');
  });

  it('asks the Worker for a Bible Brain chapter by fileset, book and chapter, never its signed link', async () => {
    fake.platform = 'web';
    const { download } = await offline();
    const store = fakeStore();
    worker({ '/api/bible/file/ENGESVO1DA/GEN/1': 'gen' });
    await download(store as never, 'bb:ENGESVO1DA:GEN:1', 'https://cdn.example/signed.mp3', { fileset: 'ENGESVO1DA', webPath: '/api/bible/file/ENGESVO1DA/GEN/1' });
    expect(index()['bb:ENGESVO1DA:GEN:1']).toMatchObject({ hash: 'h:gen', fileset: 'ENGESVO1DA' });
    expect(asked).toEqual(['/api/bible/file/ENGESVO1DA/GEN/1 Bearer tok']);
  });

  it('a phone still downloads from the link itself', async () => {
    const { download } = await offline();
    fake.served.set('https://x/phone', 'p');
    worker({});
    await download(fakeStore() as never, 'k', 'https://x/phone', { webPath: '/api/bible/file/F/GEN/1' });
    expect(asked).toEqual([]);
    expect(index()['k']).toMatchObject({ hash: 'h:p' });
  });
});

describe('purgeFileset', () => {
  it('removes the files of the withdrawn fileset only, and forgets them', async () => {
    const { download, purgeFileset } = await offline();
    const store = fakeStore();
    fake.served.set('u1', 'one');
    fake.served.set('u2', 'two');
    fake.served.set('u3', 'three');
    await download(store as never, 'bb:F:GEN:1', 'u1', { fileset: 'F' });
    await download(store as never, 'bb:F:GEN:2', 'u2', { fileset: 'F' });
    await download(store as never, 'lib:three', 'u3', {});
    expect(await purgeFileset(store as never, 'F')).toBe(2);
    expect(store.removed.map((r) => r.hash).sort()).toEqual(['h:one', 'h:two']);
    expect(Object.keys(index())).toEqual(['lib:three']);
    expect(await purgeFileset(store as never, 'F')).toBe(0);
  });
});
