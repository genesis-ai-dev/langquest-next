import { createHash } from 'node:crypto';
import { canonicalJson } from '@langquest-next/core';

/**
 * The phone's library documents (src/library/docStore.ts): named by the hash
 * of their text, queued in an outbox until the server has them. Faked: the
 * server functions, AsyncStorage, the file system and the hash function.
 */
const fake = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'web',
  /** The browser's files, when `os` is web: null when it cannot read them, and writes refused when `writes` is false. */
  web: { files: new Map<string, Uint8Array>(), writes: true, reads: true },
  storage: new Map<string, string>(),
  disk: new Map<string, string>(),
  put: vi.fn<(orgId: string, text: string) => Promise<{ data: string | null; error: { message: string } | null }>>(),
  get: vi.fn<(orgId: string, hashes: string[]) => Promise<{ data: { hash: string; body: string }[] | null; error: { message: string } | null }>>()
}));

vi.mock('react-native', () => ({ Platform: { get OS() { return fake.os; } } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => fake.storage.get(k) ?? null,
    setItem: async (k: string, v: string) => { fake.storage.set(k, v); },
    removeItem: async (k: string) => { fake.storage.delete(k); }
  }
}));
vi.mock('expo-crypto', () => ({
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digestStringAsync: async (_alg: string, text: string) => createHash('sha256').update(text).digest('hex')
}));
vi.mock('expo-file-system', () => ({
  Paths: { document: 'doc' },
  Directory: class { exists = true; constructor(..._p: unknown[]) {} create() {} },
  File: class {
    readonly path: string;
    constructor(_dir: unknown, name: string) { this.path = name; }
    get exists() { return fake.disk.has(this.path); }
    async text() { return fake.disk.get(this.path)!; }
    write(text: string) { fake.disk.set(this.path, text); }
    delete() { fake.disk.delete(this.path); }
  }
}));
vi.mock('../src/web/webFiles', () => ({
  // Safari before 26 opens the origin file system but has no createWritable; a private window may refuse it all.
  webFiles: () => ({
    read: async (name: string) => { if (!fake.web.reads) throw new DOMException('no file system', 'SecurityError'); return fake.web.files.get(name) ?? null; },
    write: async (name: string, bytes: Uint8Array) => { if (!fake.web.writes) throw new TypeError('createWritable is not a function'); fake.web.files.set(name, bytes); },
    remove: async (name: string) => { fake.web.files.delete(name); }
  })
}));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: vi.fn() }));
vi.mock('../src/server/library', () => ({ putDocument: fake.put, getDocuments: fake.get }));

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const versification = { format: 'versification@1' as const, code: 'eng', name: 'eng', maxVerses: { MAL: [14] }, mappedVerses: {} };

async function store() {
  vi.resetModules();
  return import('../src/library/docStore');
}

/** A timing document that depends on the versification (so deps are filled in by prepareDoc). */
function timing(v: string) {
  return {
    format: 'timing@1' as const, book: 'MAL', chapter: 1, versification: v,
    audio: { sha256: sha('audio'), durationMs: 1000 }, introEndMs: 0, segments: [{ verseStart: 1, verseEnd: 1, startMs: 0, endMs: 900 }],
    source: 'manual' as const, deps: [] as string[]
  };
}

const OUTBOX = 'library-outbox:org1';
const queued = () => JSON.parse(fake.storage.get(OUTBOX) ?? '[]') as string[];

beforeEach(() => {
  fake.os = 'ios';
  fake.web = { files: new Map(), writes: true, reads: true };
  fake.storage.clear();
  fake.disk.clear();
  fake.put.mockReset();
  fake.get.mockReset();
  // The server names a document by the hash of the text it was sent.
  fake.put.mockImplementation(async (_org, text) => ({ data: sha(text), error: null }));
});

describe('prepareDoc and hashOf', () => {
  it('hashes the canonical text with the dependencies filled in', async () => {
    const { prepareDoc, hashOf } = await store();
    const v = await prepareDoc(versification);
    const t = await prepareDoc(timing(v.hash));
    expect(t.doc.deps).toEqual([v.hash]);
    expect(t.text).toBe(canonicalJson(t.doc));
    expect(t.hash).toBe(sha(t.text));
    expect(await hashOf('abc')).toBe(sha('abc'));
  });

  it('refuses a document that is not valid', async () => {
    const { prepareDoc } = await store();
    await expect(prepareDoc({ ...versification, code: '' })).rejects.toThrow('a versification needs a code and a name');
  });
});

describe('keepNewDoc', () => {
  it('refuses text that does not hash to its name, and queues nothing', async () => {
    const { keepNewDoc, prepareDoc } = await store();
    const v = await prepareDoc(versification);
    await expect(keepNewDoc('org1', v.text, sha('something else'))).rejects.toThrow('did not match its name');
    expect(queued()).toEqual([]);
  });

  it('queues a document once, keeps it on disk, and tells listeners', async () => {
    const { keepNewDoc, prepareDoc, onDocs, cachedDoc } = await store();
    const v = await prepareDoc(versification);
    let told = 0;
    const off = onDocs(() => { told += 1; });
    await keepNewDoc('org1', v.text, v.hash);
    await keepNewDoc('org1', v.text, v.hash);
    off();
    expect(queued()).toEqual([v.hash]);
    expect(fake.disk.get(`${v.hash}.json`)).toBe(v.text);
    expect(cachedDoc(v.hash)).toMatchObject({ code: 'eng' });
    expect(cachedDoc(null)).toBeNull();
    expect(told).toBe(2);
  });
});

describe('flushOutbox', () => {
  async function two() {
    const s = await store();
    const v = await s.prepareDoc(versification);
    const t = await s.prepareDoc(timing(v.hash));
    return { ...s, v, t };
  }

  it('with nothing queued asks the server nothing', async () => {
    const { flushOutbox } = await two();
    expect(await flushOutbox('org1')).toBe(0);
    expect(fake.put).not.toHaveBeenCalled();
  });

  it('sends a document after the ones it depends on, whatever order they were queued in', async () => {
    const { flushOutbox, keepNewDoc, v, t } = await two();
    await keepNewDoc('org1', t.text, t.hash);
    await keepNewDoc('org1', v.text, v.hash);
    expect(await flushOutbox('org1')).toBe(2);
    expect(fake.put.mock.calls.map(([, text]) => sha(text))).toEqual([v.hash, t.hash]);
    expect(queued()).toEqual([]);
  });

  it('a hash the server names differently is an error, and the document stays queued', async () => {
    const { flushOutbox, keepNewDoc, v } = await two();
    await keepNewDoc('org1', v.text, v.hash);
    fake.put.mockResolvedValue({ data: sha('other'), error: null });
    await expect(flushOutbox('org1')).rejects.toThrow('The server named the document differently.');
    expect(queued()).toEqual([v.hash]);
  });

  it('a failure keeps what was not sent and drops what was', async () => {
    const { flushOutbox, keepNewDoc, v, t } = await two();
    await keepNewDoc('org1', v.text, v.hash);
    await keepNewDoc('org1', t.text, t.hash);
    fake.put.mockImplementation(async (_org, text) =>
      sha(text) === t.hash ? { data: null, error: { message: 'offline' } } : { data: sha(text), error: null });
    await expect(flushOutbox('org1')).rejects.toThrow('offline');
    expect(queued()).toEqual([t.hash]);
    // The next flush sends only the one left.
    fake.put.mockClear();
    fake.put.mockImplementation(async (_org, text) => ({ data: sha(text), error: null }));
    expect(await flushOutbox('org1')).toBe(1);
    expect(fake.put).toHaveBeenCalledTimes(1);
    expect(queued()).toEqual([]);
  });

  it('a document this phone cannot read stays queued, and the others still go', async () => {
    const { flushOutbox, keepNewDoc, v } = await two();
    await keepNewDoc('org1', v.text, v.hash);
    const lost = sha('lost');
    fake.storage.set(OUTBOX, JSON.stringify([lost, v.hash]));
    expect(await flushOutbox('org1')).toBe(1);
    expect(queued()).toEqual([lost]);
  });

  it('reads a queued document back from disk when memory has forgotten it', async () => {
    const { keepNewDoc, v } = await two();
    await keepNewDoc('org1', v.text, v.hash);
    const again = await store();
    expect(await again.flushOutbox('org1')).toBe(1);
    expect(fake.put).toHaveBeenCalledWith('org1', v.text);
  });

  it('a damaged file on disk is deleted, not sent', async () => {
    const { keepNewDoc, v } = await two();
    await keepNewDoc('org1', v.text, v.hash);
    fake.disk.set(`${v.hash}.json`, 'not the document');
    const again = await store();
    expect(await again.flushOutbox('org1')).toBe(0);
    expect(fake.disk.has(`${v.hash}.json`)).toBe(false);
    expect(queued()).toEqual([v.hash]);
  });
});

describe('loadDocs', () => {
  it('fetches a missing document and what it depends on, keeping each, and ignores a body that is not its name', async () => {
    const s = await store();
    const v = await s.prepareDoc(versification);
    const t = await s.prepareDoc(timing(v.hash));
    const again = await store();
    const bodies: Record<string, string> = { [t.hash]: t.text, [v.hash]: v.text };
    fake.get.mockImplementation(async (_org, hashes) => ({ data: hashes.filter((h) => bodies[h]).map((h) => ({ hash: h, body: bodies[h]! })), error: null }));
    const out = await again.loadDocs('org1', [t.hash, null, undefined, t.hash]);
    expect([...out.keys()].sort()).toEqual([t.hash, v.hash].sort());
    expect(fake.disk.has(`${v.hash}.json`)).toBe(true);
    fake.get.mockClear();
    // Second time: from memory, no request.
    await again.loadDocs('org1', [t.hash]);
    expect(fake.get).not.toHaveBeenCalled();

    const third = await store();
    fake.get.mockResolvedValue({ data: [{ hash: v.hash, body: 'forged' }], error: null });
    fake.disk.clear();
    expect((await third.loadDocs('org1', [v.hash])).size).toBe(0);
  });

  it('offline it still returns what is on disk, then reports the failure', async () => {
    const s = await store();
    const v = await s.prepareDoc(versification);
    await s.keepNewDoc('org1', v.text, v.hash);
    const again = await store();
    fake.get.mockRejectedValue(new Error('offline'));
    await expect(again.loadDocs('org1', [v.hash, sha('missing')])).rejects.toThrow('offline');
    // The one it had is now in memory for the screens.
    expect(again.cachedDoc(v.hash)).not.toBeNull();
  });

  it('deps: false fetches only the documents named', async () => {
    const s = await store();
    const v = await s.prepareDoc(versification);
    const t = await s.prepareDoc(timing(v.hash));
    const again = await store();
    fake.get.mockResolvedValue({ data: [{ hash: t.hash, body: t.text }], error: null });
    const out = await again.loadDocs('org1', [t.hash], { deps: false });
    expect([...out.keys()]).toEqual([t.hash]);
    expect(fake.get).toHaveBeenCalledTimes(1);
  });
});

describe('a browser that cannot keep files (LAN-194)', () => {
  it('still shows every document fetched, from memory, and tells the screens', async () => {
    const s = await store();
    const v = await s.prepareDoc(versification);
    const t1 = await s.prepareDoc(timing(v.hash));
    const t2 = await s.prepareDoc({ ...timing(v.hash), chapter: 2 });
    fake.os = 'web';
    fake.web.writes = false;
    const again = await store();
    const heard = vi.fn();
    again.onDocs(heard);
    const bodies: Record<string, string> = { [t1.hash]: t1.text, [t2.hash]: t2.text, [v.hash]: v.text };
    fake.get.mockImplementation(async (_org, hashes) => ({ data: hashes.filter((h) => bodies[h]).map((h) => ({ hash: h, body: bodies[h]! })), error: null }));
    const out = await again.loadDocs('org1', [t1.hash, t2.hash]);
    expect([...out.keys()].sort()).toEqual([t1.hash, t2.hash, v.hash].sort());
    expect(again.cachedDoc(t2.hash)).not.toBeNull();
    expect(heard).toHaveBeenCalled();
    // Fetched documents are not put in the page's saved keys: the server has them.
    expect([...fake.storage.keys()].filter((k) => k.startsWith('library-doc:'))).toEqual([]);
  });

  it('keeps a document made here in the saved keys, and sends it after a reload', async () => {
    fake.os = 'web';
    fake.web.writes = false;
    const s = await store();
    const v = await s.prepareDoc(versification);
    await s.keepNewDoc('org1', v.text, v.hash);
    expect(fake.storage.get(`library-doc:${v.hash}`)).toBe(v.text);
    // A reload: memory is empty, the file system still refuses.
    fake.web.reads = false;
    const again = await store();
    expect(await again.flushOutbox('org1')).toBe(1);
    expect(queued()).toEqual([]);
  });
});
