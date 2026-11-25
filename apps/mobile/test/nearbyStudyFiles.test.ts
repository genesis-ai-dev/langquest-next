// Study files a teammate's phone hands over by address (src/study/nearbyStudyFiles.native.ts, 2026-11-24):
// FIA's guides name their media only by web address, so they come on the teammate's word, what a kept
// passage needs first, within the folder's spare room for the rest, and are fetched again once online.
// A tiny disk: names to contents, their sizes and when they were written, the room left, and which addresses the network refuses.
const disk = new Map<string, string>();
const sizes = new Map<string, number>();
const times = new Map<string, number>();
const room = { free: 10 * 1024 * 1024 * 1024 };
const net = { down: new Set<string>(), refused: new Map<string, number>(), fetched: [] as string[], hold: null as null | Promise<void> };
// What the phone keeps between runs: each language's wish list, and when the lists were first kept.
const kv = new Map<string, string>();
/** Each file's leading bytes, where a test sets them. */
const raw = new Map<string, Uint8Array>();
const kvFails = { set: false };
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => kv.get(k) ?? null,
    setItem: async (k: string, v: string) => { if (kvFails.set) throw new Error('storage full'); kv.set(k, v); },
    getAllKeys: async () => [...kv.keys()],
    multiGet: async (keys: string[]) => keys.map((k) => [k, kv.get(k) ?? null])
  }
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: () => {} }));
vi.mock('../src/diagnostics/diagnostics', () => ({ timedTransfer: async (_dir: string, _where: unknown, run: () => Promise<unknown>) => run() }));
vi.mock('expo-file-system', () => {
  class File {
    name: string;
    constructor(dir: { path: string } | string, name?: string) {
      this.name = name ?? String(dir);
    }
    get uri() { return `file:///documents/study/${this.name}`; }
    get exists() { return disk.has(this.name); }
    get size() { return sizes.get(this.name) ?? 1; }
    get modificationTime() { return times.get(this.name) ?? 0; }
    delete() { disk.delete(this.name); }
    move(dest: File) { disk.set(dest.name, disk.get(this.name) ?? ''); disk.delete(this.name); times.set(dest.name, Date.now()); if (raw.has(this.name)) { raw.set(dest.name, raw.get(this.name)!); raw.delete(this.name); } }
    async bytes() { return raw.get(this.name) ?? new TextEncoder().encode(disk.get(this.name) ?? ''); }
    static async downloadFileAsync(url: string, dest: File) {
      net.fetched.push(url);
      if (net.hold) await net.hold;
      if (net.down.has(url)) throw new Error('offline');
      // What expo-file-system says when the server answers with an error status.
      const status = net.refused.get(url);
      if (status) throw new Error(`Unable to download a file: response has status: ${status}`);
      disk.set(dest.name, url);
      return dest;
    }
  }
  class Directory {
    path = 'study';
    get exists() { return true; }
    create() {}
    list() { return [...disk.keys()].map((n) => new File(this, n)); }
  }
  return { File, Directory, Paths: { document: 'file:///documents', get availableDiskSpace() { return room.free; } } };
});

vi.mock('../src/sync/blobsModel', () => ({ RECORDING_RESERVE_BYTES: 500 * 1024 * 1024 }));
const cover = { worn: false };
vi.mock('../src/shell/appCovered', () => ({ wornNow: () => cover.worn }));

const settle = () => new Promise((r) => setTimeout(r, 0));
const MB = 1024 * 1024;

async function load() {
  const folder = await import('../src/study/studyFiles');
  const { nearbyStudyLinks: links } = await import('../src/study/nearbyStudyFiles.native');
  return { folder, links };
}

/** How a file of each kind begins. */
const LEADS: Record<string, number[]> = { mp3: [0x49, 0x44, 0x33, 4], jpg: [0xff, 0xd8, 0xff, 0xe0] };

/** A teammate's file arriving: native wrote it to the staging name the address was given. */
async function give(links: Awaited<ReturnType<typeof load>>['links'], url: string, size = MB, lead?: number[]) {
  const stage = links.stage(url);
  if (!stage) return false;
  const name = stage.stagingUri.replace('file:///documents/study/', '');
  disk.set(name, `teammate's ${url}`);
  raw.set(name, new Uint8Array(lead ?? LEADS[url.slice(url.lastIndexOf('.') + 1)] ?? []));
  sizes.set(name, size);
  await links.adopt(url, stage.stagingUri, size);
  return true;
}

describe('study files from a teammate\'s phone', () => {
  beforeEach(() => {
    disk.clear(); sizes.clear(); times.clear(); kv.clear(); raw.clear(); room.free = 10 * 1024 * 1024 * 1024; kvFails.set = false;
    net.down.clear(); net.refused.clear(); net.fetched = []; net.hold = null; vi.resetModules(); vi.useRealTimers();
    cover.worn = false;
  });

  // The security review's (2026-11-24): bytes no hash holds to anything are shown and played by the phone's own decoders.
  it('refuses bytes that are not a file of the address\'s kind, or larger than a teammate\'s file may be, and keeps no note of them', async () => {
    const { folder, links } = await load();
    folder.setStudyWanted(new Map([['luke1', ['https://fia.bible/a.mp3', 'https://fia.bible/b.jpg']]]), false, null, ['luke1']);
    links.lacking(['https://fia.bible/a.mp3', 'https://fia.bible/b.jpg']);
    await expect(give(links, 'https://fia.bible/a.mp3', MB, [0x4d, 0x5a, 0x90, 0])).rejects.toThrow();
    await expect(give(links, 'https://fia.bible/b.jpg', 9 * MB)).rejects.toThrow();
    expect(folder.hasStudyFile('https://fia.bible/a.mp3')).toBe(false);
    expect(folder.hasStudyFile('https://fia.bible/b.jpg')).toBe(false);
    expect(kv.get('study-files:nearby') ?? '[]').toBe('[]');
    expect(links.stage('https://fia.bible/a.mp3')!.maxBytes).toBeLessThanOrEqual(8 * MB);
  });

  it('writes the address down before the file takes its name: if it cannot, the file is not kept', async () => {
    const { folder, links } = await load();
    folder.setStudyWanted(new Map([['luke1', ['https://fia.bible/a.mp3']]]), false, null, ['luke1']);
    links.lacking(['https://fia.bible/a.mp3']);
    kvFails.set = true;
    await expect(give(links, 'https://fia.bible/a.mp3')).rejects.toThrow();
    expect(folder.hasStudyFile('https://fia.bible/a.mp3')).toBe(false);
  });

  it('a phone under a cover takes only what its own kept passages need (decision 171)', async () => {
    const { folder, links } = await load();
    folder.setStudyWanted(new Map([['luke1', ['https://fia.bible/a.mp3']]]), false, null, ['luke1']);
    cover.worn = true;
    expect(links.lacking(['https://fia.bible/z.jpg', 'https://fia.bible/a.mp3'])).toEqual(['https://fia.bible/a.mp3']);
    expect(links.stage('https://fia.bible/z.jpg')).toBeNull();
    expect(links.stage('https://fia.bible/a.mp3')).not.toBeNull();
  });

  it('lists what a kept passage needs first, takes it under its address, and serves it on', async () => {
    const { folder, links } = await load();
    folder.setStudyWanted(new Map([['luke1', ['https://fia.bible/a.mp3']]]), false, null, ['luke1']);
    expect(links.lacking(['https://fia.bible/z.jpg', 'https://fia.bible/a.mp3'])).toEqual(['https://fia.bible/a.mp3', 'https://fia.bible/z.jpg']);
    expect(await give(links, 'https://fia.bible/a.mp3')).toBe(true);
    // The guide's screen finds it as if this phone had downloaded it.
    expect(folder.studyUri('https://fia.bible/a.mp3')).toMatch(/^file:\/\/\/documents\/study\//);
    expect(links.held(['https://fia.bible/a.mp3', 'https://fia.bible/z.jpg'])).toEqual(['https://fia.bible/a.mp3']);
    expect(links.serve('https://fia.bible/a.mp3')).toMatchObject({ uri: folder.studyUri('https://fia.bible/a.mp3') });
    expect(links.serve('https://fia.bible/z.jpg')).toBeNull();
    expect(JSON.parse(kv.get('study-files:nearby')!)).toEqual(['https://fia.bible/a.mp3']);
  });

  it('takes files no kept passage needs only while the spare room lasts, and none when the phone is short of room', async () => {
    const { folder, links } = await load();
    folder.setStudyWanted(new Map([['luke1', ['https://fia.bible/a.mp3']]]), false, null, ['luke1']);
    // 255 MB of files no kept passage needs are here already.
    disk.set('old.jpg', 'x');
    sizes.set('old.jpg', 255 * MB);
    vi.resetModules();
    const again = await load();
    again.folder.setStudyWanted(new Map([['luke1', ['https://fia.bible/a.mp3']]]), false, null, ['luke1']);
    again.links.lacking(['https://fia.bible/b.jpg', 'https://fia.bible/c.jpg', 'https://fia.bible/a.mp3']);
    expect(await give(again.links, 'https://fia.bible/b.jpg', 2 * MB)).toBe(true);
    // The spare room is gone: another the passages do not need waits, and one they need still comes.
    expect(again.links.stage('https://fia.bible/c.jpg')).toBeNull();
    expect(await give(again.links, 'https://fia.bible/a.mp3')).toBe(true);
    room.free = 100 * MB;
    expect(again.links.stage('https://fia.bible/d.mp3')).toBeNull();
    void links;
  });

  // The 2026-11-24 review (item 22): a kept passage's files have their own room, bounded too.
  it('takes what a kept passage needs after the spare room is used, within a room of its own', async () => {
    const { folder, links } = await load();
    const spare = Array.from({ length: 32 }, (_, i) => `https://fia.bible/x${i}.jpg`);
    const need = Array.from({ length: 65 }, (_, i) => `https://fia.bible/n${i}.jpg`);
    folder.setStudyWanted(new Map([['luke1', need]]), false, null, ['luke1']);
    links.lacking([...spare, ...need]);
    // Files on a teammate's word no kept passage needs take the whole spare room (32 of 8 MB).
    for (const url of spare) expect(await give(links, url, 8 * MB)).toBe(true);
    expect(links.stage('https://fia.bible/y.jpg')).toBeNull();
    // A kept passage's still come, to a room of their own: 63 of 8 MB, then at most what is left.
    for (const url of need.slice(0, 63)) expect(await give(links, url, 8 * MB)).toBe(true);
    expect(links.stage(need[63]!)!.maxBytes).toBe(8 * MB);
    expect(await give(links, need[63]!, 8 * MB)).toBe(true);
    expect(links.stage(need[64]!)).toBeNull();
    // A later session works it out again from the files here, and finds the same.
    links.lacking(need);
    expect(links.stage(need[64]!)).toBeNull();
  });

  // The 2026-11-24 review (item 23): the count is worked out from the files here, so one the folder's clearing deleted no longer counts.
  it('counts only the teammates\' files still here, so room comes back once the folder clears one', async () => {
    const { folder, links } = await load();
    folder.setStudyWanted(new Map([['luke1', ['https://fia.bible/a.mp3']]]), false, null, ['luke1']);
    const spare = Array.from({ length: 32 }, (_, i) => `https://fia.bible/x${i}.jpg`);
    links.lacking(spare);
    for (const url of spare) expect(await give(links, url, 8 * MB)).toBe(true);
    expect(links.stage('https://fia.bible/y.jpg')).toBeNull();
    // The folder's clearing deletes one.
    const name = folder.studyFolder.nameOf(spare[0]!);
    disk.delete(name);
    folder.studyFolder.present.delete(name);
    links.lacking(['https://fia.bible/y.jpg']);
    expect(links.stage('https://fia.bible/y.jpg')).not.toBeNull();
  });

  it('a file staged for one address never becomes another\'s', async () => {
    const { links } = await load();
    links.lacking([]);
    const stage = links.stage('https://fia.bible/a.mp3')!;
    await expect(links.adopt('https://fia.bible/b.mp3', stage.stagingUri, MB)).rejects.toThrow();
  });

  it('once online, each is fetched again from its address, and one its source refuses goes', async () => {
    const { folder, links } = await load();
    const urls = ['https://fia.bible/a.mp3', 'https://fia.bible/gone.jpg'];
    folder.setStudyWanted(new Map([['luke1', urls]]), false, null, ['luke1']);
    links.lacking(urls);
    for (const url of urls) await give(links, url);
    net.refused.set('https://fia.bible/gone.jpg', 404);
    // Offline: nothing is fetched.
    await new Promise((r) => setTimeout(r, folder.STUDY_NEWS_MS + 50));
    expect(net.fetched).toEqual([]);
    // Online: the folder's news, told at most every STUDY_NEWS_MS, sets it going.
    folder.setStudyWanted(new Map([['luke1', urls]]), true, null, ['luke1']);
    await new Promise((r) => setTimeout(r, folder.STUDY_NEWS_MS + 50));
    for (let i = 0; i < 20 && kv.get('study-files:nearby') !== '[]'; i++) await settle();
    expect(net.fetched).toEqual(expect.arrayContaining(urls));
    expect(JSON.parse(kv.get('study-files:nearby')!)).toEqual([]);
    // The source's copy replaced the teammate's, and the refused one is gone.
    expect([...disk.values()]).toContain('https://fia.bible/a.mp3');
    expect(folder.hasStudyFile('https://fia.bible/gone.jpg')).toBe(false);
    expect(folder.hasStudyFile('https://fia.bible/a.mp3')).toBe(true);
  });

  // The 2026-11-24 review (P12): online, only what a kept passage needs is fetched again; the rest goes once the wish list is whole.
  it('once online, fetches again only what a kept passage needs and lets the rest go', async () => {
    const { folder, links } = await load();
    const need = 'https://fia.bible/a.mp3';
    const spare = 'https://fia.bible/other.jpg';
    folder.setStudyWanted(new Map([['luke1', [need]]]), false, null, ['luke1']);
    links.lacking([need, spare]);
    expect(await give(links, need)).toBe(true);
    expect(await give(links, spare)).toBe(true);
    folder.setStudyWanted(new Map([['luke1', [need]]]), true, { orgId: 'o', languageId: 'l' }, ['luke1'], true);
    await new Promise((r) => setTimeout(r, folder.STUDY_NEWS_MS + 50));
    for (let i = 0; i < 20 && kv.get('study-files:nearby') !== '[]'; i++) await settle();
    expect(net.fetched).toContain(need);
    expect(net.fetched).not.toContain(spare);
    expect(folder.hasStudyFile(spare)).toBe(false);
    expect(JSON.parse(kv.get('study-files:nearby')!)).toEqual([]);
  });
});
