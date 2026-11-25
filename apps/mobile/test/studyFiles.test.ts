import type { StudyGuide } from '../src/study/guides';

// A tiny disk: names to contents, their sizes and when they were written, the room left, and which addresses the network refuses.
const disk = new Map<string, string>();
const sizes = new Map<string, number>();
const times = new Map<string, number>();
const room = { free: 10 * 1024 * 1024 * 1024 };
const net = { down: new Set<string>(), refused: new Map<string, number>(), fetched: [] as string[], hold: null as null | Promise<void> };
// What the phone keeps between runs: each language's wish list, and when the lists were first kept.
const kv = new Map<string, string>();
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => kv.get(k) ?? null,
    setItem: async (k: string, v: string) => { kv.set(k, v); },
    getAllKeys: async () => [...kv.keys()],
    multiGet: async (keys: string[]) => keys.map((k) => [k, kv.get(k) ?? null])
  }
}));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../src/diagnostics/report', () => ({ noteExpected: () => {} }));
// How each failed download is tallied: what the caller's own `classify` says, else `status` (the status decides).
const tallied: string[] = [];
vi.mock('../src/diagnostics/diagnostics', () => ({
  timedTransfer: async (_dir: string, _where: unknown, run: () => Promise<unknown>, classify?: (e: unknown) => string | undefined) => {
    try { return await run(); } catch (e) { tallied.push(classify?.(e) ?? 'status'); throw e; }
  }
}));
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
    move(dest: File) { disk.set(dest.name, disk.get(this.name) ?? ''); disk.delete(this.name); times.set(dest.name, Date.now()); }
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

const guide = (urls: { step?: string; photo?: string; film?: string; term?: string }): StudyGuide => ({
  id: 'g', pattern: 'FIA', about: '', source: '', passage: 'Luke 1:1–4',
  steps: [{ id: 's1', title: 'Hear', purpose: '', text: '', audio: { ...(urls.step ? { url: urls.step } : {}), seconds: 30 } }],
  resources: [{ ref: 'm1', kind: 'media', title: 'Pictures', media: [
    ...(urls.photo ? [{ id: 'p', kind: 'photo' as const, title: '', caption: '', url: urls.photo }] : []),
    ...(urls.film ? [{ id: 'f', kind: 'video' as const, title: '', caption: '', url: urls.film }] : [])
  ] }],
  glossary: urls.term ? { t1: { term: 'Theophilus', audioUrl: urls.term } } : {}
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('study files kept for offline (decisions.md 61)', () => {
  beforeEach(() => {
    disk.clear(); sizes.clear(); times.clear(); kv.clear(); room.free = 10 * 1024 * 1024 * 1024;
    net.down.clear(); net.refused.clear(); net.fetched = []; net.hold = null; tallied.length = 0; vi.resetModules(); vi.useRealTimers();
  });

  // Study files are public addresses fetched with no sign-in: a 403 from FIA's file store is a file it lacks,
  // and tallied as a refused sign-in it raised the ops dashboard's sign-in line (LAN-318).
  it('a file its source refuses is tallied as not there, not as a refused sign-in', async () => {
    vi.useFakeTimers();
    const f = await import('../src/study/studyFiles');
    net.refused.set('https://x/gone.jpg', 403);
    net.refused.set('https://x/missing.jpg', 404);
    net.refused.set('https://x/busy.jpg', 503);
    f.setStudyWanted(new Map([['mat13', ['https://x/gone.jpg', 'https://x/missing.jpg', 'https://x/busy.jpg']]]), true, { orgId: 'o', languageId: 'l' }, ['mat13']);
    await vi.advanceTimersByTimeAsync(10);
    expect(tallied.sort()).toEqual(['notFound', 'notFound', 'status']);
    expect(f.studyFailure(new Error('Unable to download a file: response has status 403'))).toBe('notFound');
    expect(f.studyFailure(new Error('Unable to download a file: response has status: 503'))).toBeUndefined();
    expect(f.studyFailure(new Error('timed out'))).toBeUndefined();
  });

  // Matthew 13 stayed amber at "Only 19 of 23 files": its guide named files FIA's file store answers 403 for (Carl, 2026-11-20).
  it('a file its source refuses is not counted as one to come, and is not asked for again for a day', async () => {
    vi.useFakeTimers();
    const f = await import('../src/study/studyFiles');
    net.refused.set('https://x/gone.mp3', 403);
    net.refused.set('https://x/missing.jpg', 404);
    const want = new Map([['mat13', ['https://x/a.mp3', 'https://x/gone.mp3', 'https://x/missing.jpg']]]);
    f.setStudyWanted(want, true, null, ['mat13']);
    await vi.advanceTimersByTimeAsync(10);
    expect(f.studyCounts('mat13')).toEqual({ here: 1, total: 1, refused: 2 });
    // Its recordings are here and the one file that can come has: the passage is ready, and the two are named.
    const { withStudy } = await import('../src/sync/offlineText');
    (await import('../src/sources/referenceCounts')).publishReference({ known: new Set(['mat13']) });
    const audio = { reason: 'chosen' as const, audio: 0, here: 0, toFetch: 0, bytesToFetch: 0, notSent: 0, ready: true };
    expect(withStudy(audio, 'mat13')).toMatchObject({ ready: true, studyHere: 1, studyTotal: 1, studyRefused: 2 });
    // Not asked again in minutes, as a failed one is.
    net.fetched = [];
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1010);
    f.setStudyWanted(new Map(want), true, null, ['mat13', 'other']);
    await vi.advanceTimersByTimeAsync(10);
    expect(net.fetched).toEqual([]);
    // A day on it is asked again; once the source has it, it comes and counts again.
    net.refused.clear();
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    f.setStudyWanted(new Map(want), true, null, ['mat13']);
    await vi.advanceTimersByTimeAsync(10);
    expect(net.fetched.sort()).toEqual(['https://x/gone.mp3', 'https://x/missing.jpg']);
    expect(f.studyCounts('mat13')).toEqual({ here: 3, total: 3, refused: 0 });
  });

  it('a failure that says nothing about the file is tried again in minutes, and still counts as to come', async () => {
    vi.useFakeTimers();
    const f = await import('../src/study/studyFiles');
    for (const [url, status] of [['https://x/busy.jpg', 503], ['https://x/slow.jpg', 408], ['https://x/limit.jpg', 429]] as const) net.refused.set(url, status);
    net.down.add('https://x/offline.jpg');
    f.setStudyWanted(new Map([['mat16', ['https://x/busy.jpg', 'https://x/slow.jpg', 'https://x/limit.jpg', 'https://x/offline.jpg']]]), true, null, ['mat16']);
    await vi.advanceTimersByTimeAsync(10);
    expect(f.studyCounts('mat16')).toEqual({ here: 0, total: 4, refused: 0 });
    // Android and iPhones word it a little apart.
    expect(f.refusedBy(new Error('Unable to download a file: response has status 403'))).toBe(true);
    expect(f.refusedBy(new Error('Unable to download a file: response has status: 500'))).toBe(false);
    expect(f.refusedBy(new Error('timed out'))).toBe(false);
  });

  it('takes step audio, pictures and glossary audio along, but not films', async () => {
    const { studyUrls } = await import('../src/study/studyFiles');
    expect(studyUrls(guide({ step: 'https://x/a.mp3', photo: 'https://x/p.jpg', film: 'https://x/f.mp4', term: 'https://x/t.mp3' })).sort())
      .toEqual(['https://x/a.mp3', 'https://x/p.jpg', 'https://x/t.mp3']);
  });

  it('downloads what a kept passage wants while online, and plays the local copy after', async () => {
    const f = await import('../src/study/studyFiles');
    const urls = ['https://x/a.mp3', 'https://x/p.jpg'];
    expect(f.studyUri(urls[0])).toBe(urls[0]);
    f.setStudyWanted(new Map([['luke1', urls]]), true);
    await settle();
    expect(f.studyCounts('luke1')).toEqual({ here: 2, total: 2, refused: 0 });
    expect(f.studyUri(urls[0])).toMatch(/^file:\/\/\/documents\/study\/.+\.mp3$/);
    expect(f.studyCounts('other')).toEqual({ here: 0, total: 0, refused: 0 });
  });

  // The 2026-11-24 review (item 20): a team's own guide names its files by hash; they count too, so the passage is not ready without them.
  it('counts the files a team\'s guide names by hash with the rest, as the download ahead tells them', async () => {
    const f = await import('../src/study/studyFiles');
    f.setStudyWanted(new Map([['luke1', ['https://x/a.mp3']]]), false);
    f.countStoredStudyFiles((unitId) => (unitId === 'luke1' ? { here: 1, total: 3 } : { here: 0, total: 0 }));
    expect(f.studyCounts('luke1')).toEqual({ here: 1, total: 4, refused: 0 });
    expect(f.studyCounts('other')).toEqual({ here: 0, total: 0, refused: 0 });
  });

  it('offline, it counts what is missing and fetches nothing', async () => {
    const f = await import('../src/study/studyFiles');
    f.setStudyWanted(new Map([['luke1', ['https://x/a.mp3']]]), false);
    await settle();
    expect(net.fetched).toEqual([]);
    expect(f.studyCounts('luke1')).toEqual({ here: 0, total: 1, refused: 0 });
  });

  it('a dead link is not retried on every pass', async () => {
    const f = await import('../src/study/studyFiles');
    net.down.add('https://x/dead.jpg');
    const want = new Map([['luke1', ['https://x/dead.jpg']]]);
    f.setStudyWanted(want, true);
    await settle();
    f.setStudyWanted(want, true);
    await settle();
    expect(net.fetched).toEqual(['https://x/dead.jpg']);
    expect([...disk.keys()].some((n) => n.endsWith('.part'))).toBe(false);
  });

  it('a wish list sent again mid-download does not start the same file twice', async () => {
    // Why: the prefetcher re-sends on every fold; a second start into the same staging file broke both.
    const f = await import('../src/study/studyFiles');
    let release!: () => void;
    net.hold = new Promise((r) => { release = r; });
    const want = new Map([['luke1', ['https://x/a.mp3', 'https://x/p.jpg', 'https://x/m.jpg']]]);
    f.setStudyWanted(want, true);
    f.setStudyWanted(new Map(want), true);
    f.setStudyWanted(new Map(want), true);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(net.fetched.sort()).toEqual(['https://x/a.mp3', 'https://x/m.jpg', 'https://x/p.jpg']);
    expect(f.studyCounts('luke1')).toEqual({ here: 3, total: 3, refused: 0 });
  });

  it('a failed file is tried again later without anyone asking', async () => {
    vi.useFakeTimers();
    const f = await import('../src/study/studyFiles');
    net.down.add('https://x/p.jpg');
    f.setStudyWanted(new Map([['luke1', ['https://x/p.jpg']]]), true);
    await vi.advanceTimersByTimeAsync(10);
    expect(f.studyCounts('luke1').here).toBe(0);
    net.down.clear();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1010);
    expect(f.studyCounts('luke1').here).toBe(1);
  });

  it('a download that never answers is given up, so the others still come', async () => {
    vi.useFakeTimers();
    const f = await import('../src/study/studyFiles');
    net.hold = new Promise(() => {});
    f.setStudyWanted(new Map([['luke1', ['https://x/stuck.jpg']]]), true);
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000 + 10);
    net.hold = null;
    f.setStudyWanted(new Map([['luke1', ['https://x/stuck.jpg', 'https://x/ok.jpg']]]), true);
    await vi.advanceTimersByTimeAsync(10);
    expect(f.hasStudyFile('https://x/ok.jpg')).toBe(true);
  });

  // A kept passage showed "On this device" before its guide had been looked up, then turned amber (Carl, 2026-11-20).
  it('knows a passage only once its guide has been looked up, found or not', async () => {
    const f = await import('../src/study/studyFiles');
    expect(f.studyKnown('luke1')).toBe(false);
    // Looked up, with a guide: its files are wanted. Looked up, with none: nothing to fetch. Still loading: not known.
    f.setStudyWanted(new Map([['luke1', ['https://x/a.mp3']]]), false, null, ['luke1', 'luke2']);
    expect(f.studyKnown('luke1')).toBe(true);
    expect(f.studyKnown('luke2')).toBe(true);
    expect(f.studyKnown('luke3')).toBe(false);
    // Left out, the passages on the wish list are the ones looked up.
    f.setStudyWanted(new Map([['luke3', []]]), false);
    expect(f.studyKnown('luke3')).toBe(true);
    expect(f.studyKnown('luke1')).toBe(false);
  });

  it('the same wishes handed over again tell nobody, so the download buttons do not all redraw after every change', async () => {
    // Why: the prefetcher hands its list over after every change to the language, and every button listens.
    vi.useFakeTimers();
    const f = await import('../src/study/studyFiles');
    let told = 0;
    f.onStudyFiles(() => { told += 1; });
    const want = () => new Map([['luke1', ['https://x/a.mp3', 'https://x/p.jpg']]]);
    const later = () => vi.advanceTimersByTimeAsync(f.STUDY_NEWS_MS);
    f.setStudyWanted(want(), false, null, ['luke1', 'luke2']);
    expect(told).toBe(1);
    f.setStudyWanted(want(), false, null, ['luke2', 'luke1']);
    await later();
    expect(told).toBe(1);
    // One more passage looked up, a different list, or the connection changing is news.
    f.setStudyWanted(want(), false, null, ['luke1', 'luke2', 'luke3']);
    expect(told).toBe(2);
    await later();
    f.setStudyWanted(new Map([['luke1', ['https://x/a.mp3']]]), false, null, ['luke1', 'luke2', 'luke3']);
    expect(told).toBe(3);
    await later();
    f.setStudyWanted(new Map([['luke1', ['https://x/a.mp3']]]), true, null, ['luke1', 'luke2', 'luke3']);
    await later();
    expect(told).toBeGreaterThan(3);
    expect(net.fetched).toEqual(['https://x/a.mp3']);
  });

  // A book's passages bring over a thousand study files, and each arrival redrew every download button on screen (LAN-316).
  it('tells of a burst of arrivals at once and then at most twice a second', async () => {
    vi.useFakeTimers();
    const f = await import('../src/study/studyFiles');
    let told = 0;
    f.onStudyFiles(() => { told += 1; });
    const urls = Array.from({ length: 40 }, (_, i) => `https://x/${i}.jpg`);
    f.setStudyWanted(new Map([['luke1', urls]]), true, null, ['luke1']);
    // The new wish list is told at once; the 40 arrivals after it are gathered.
    expect(told).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.studyCounts('luke1').here).toBe(40);
    expect(told).toBe(1);
    const before = f.studyRevision();
    await vi.advanceTimersByTimeAsync(f.STUDY_NEWS_MS);
    expect(told).toBe(2);
    expect(f.studyRevision()).toBe(before + 1);
  });

  it("says a passage's study files are coming down only while they are", async () => {
    const f = await import('../src/study/studyFiles');
    let release!: () => void;
    net.hold = new Promise((r) => { release = r; });
    f.setStudyWanted(new Map([['luke1', ['https://x/a.mp3', 'https://x/p.jpg', 'https://x/m.jpg']], ['luke2', []]]), true, null, ['luke1', 'luke2']);
    // Two at a time: the third waits its turn, and the passage is coming down all the while.
    expect(f.studyComing('luke1')).toBe(true);
    expect(f.studyComing('luke2')).toBe(false);
    expect(f.studyComing('other')).toBe(false);
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(f.studyCounts('luke1').here).toBe(3);
    expect(f.studyComing('luke1')).toBe(false);
  });

  it('a file that failed and waits to be tried again is not coming down, nor is anything offline', async () => {
    const f = await import('../src/study/studyFiles');
    net.down.add('https://x/dead.jpg');
    f.setStudyWanted(new Map([['luke1', ['https://x/dead.jpg']]]), true, null, ['luke1']);
    await settle();
    expect(f.studyComing('luke1')).toBe(false);
    f.setStudyWanted(new Map([['luke2', ['https://x/a.mp3']]]), false, null, ['luke2']);
    expect(f.studyComing('luke2')).toBe(false);
  });

  it('a kept passage is ready only when its guide is known and its files are here', async () => {
    const f = await import('../src/study/studyFiles');
    const { withStudy, offlineWords } = await import('../src/sync/offlineText');
    // Its reference audio is worked out, and it has none: this is about its study guide.
    (await import('../src/sources/referenceCounts')).publishReference({ known: new Set(['luke1', 'luke2']) });
    const audio = { reason: 'chosen' as const, audio: 1, here: 1, toFetch: 0, bytesToFetch: 0, notSent: 0, ready: true };
    // Its guide has not been looked up: its recordings are here, and it is not called ready. Nothing is coming down, so its row says checking.
    expect(withStudy(audio, 'luke1')).toMatchObject({ ready: false, studyUnknown: true, studyTotal: 0 });
    expect(offlineWords(withStudy(audio, 'luke1'))).toBe('Checking this device…');
    // Looked up, one file wanted and not here: not ready, and no longer unknown.
    f.setStudyWanted(new Map([['luke1', ['https://x/a.mp3']]]), false, null, ['luke1', 'luke2']);
    expect(withStudy(audio, 'luke1')).toMatchObject({ ready: false, studyUnknown: false, studyHere: 0, studyTotal: 1 });
    // Looked up and it has no guide: ready on its recordings.
    expect(withStudy(audio, 'luke2')).toMatchObject({ ready: true, studyUnknown: false, studyTotal: 0 });
    expect(offlineWords(withStudy(audio, 'luke2'))).toBe('On this device');
    expect(offlineWords(withStudy(audio, 'luke1'))).toBe('Downloading for offline');
    // The person's own work takes its study guide too.
    expect(withStudy({ ...audio, reason: 'asked' }, 'luke1')).toMatchObject({ ready: false, studyTotal: 1 });
    // Not kept: nothing of its study guide is counted.
    expect(withStudy({ ...audio, reason: null, ready: false }, 'luke1')).toMatchObject({ ready: false, studyTotal: 0, studyUnknown: false });
  });
});

// Reference audio is counted with the rest of a passage's reference material (decision amended 2026-11-23).
describe("a kept passage's reference audio", () => {
  beforeEach(() => { disk.clear(); vi.resetModules(); vi.useRealTimers(); });
  const audio = { reason: 'chosen' as const, audio: 1, here: 1, toFetch: 0, bytesToFetch: 0, notSent: 0, ready: true };

  it('keeps a passage from being ready until it is worked out and here', async () => {
    const r = await import('../src/sources/referenceCounts');
    const { withStudy, offlineWords } = await import('../src/sync/offlineText');
    const f = await import('../src/study/studyFiles');
    f.setStudyWanted(new Map(), false, null, ['luke1']);
    // Not worked out yet: its recordings are here, and it is not called ready.
    expect(withStudy(audio, 'luke1')).toMatchObject({ ready: false, refUnknown: true });
    expect(offlineWords(withStudy(audio, 'luke1'))).toBe('Checking this device…');
    // Two chapters wanted, one here: not ready, and counted.
    r.publishReference({ wanted: new Map([['luke1', ['bb:F:LUK:1', 'bb:F:LUK:2']]]), known: new Set(['luke1']), here: new Set(['bb:F:LUK:1']) });
    expect(withStudy(audio, 'luke1')).toMatchObject({ ready: false, refUnknown: false, refHere: 1, refTotal: 2 });
    r.referenceArrived('bb:F:LUK:2');
    expect(withStudy(audio, 'luke1')).toMatchObject({ ready: true, refHere: 2, refTotal: 2 });
    // Not kept: nothing of its reference audio is counted.
    expect(withStudy({ ...audio, reason: null, ready: false }, 'luke1')).toMatchObject({ refHere: 0, refTotal: 0, refUnknown: false });
  });

  it('a chapter that cannot come does not keep the passage from being ready, and is named', async () => {
    const r = await import('../src/sources/referenceCounts');
    const { withStudy } = await import('../src/sync/offlineText');
    (await import('../src/study/studyFiles')).setStudyWanted(new Map(), false, null, ['luke1']);
    r.publishReference({
      wanted: new Map([['luke1', ['a', 'b', 'c']]]), known: new Set(['luke1']), here: new Set(['a']),
      missing: new Map([['b', 'full'], ['c', 'unavailable']])
    });
    expect(r.referenceCounts('luke1')).toEqual({ here: 1, total: 1, full: 1, unavailable: 1 });
    expect(withStudy(audio, 'luke1')).toMatchObject({ ready: true, refFull: 1, refUnavailable: 1 });
  });

  it('says a passage is coming down only while a chapter of it is', async () => {
    const r = await import('../src/sources/referenceCounts');
    r.publishReference({ wanted: new Map([['luke1', ['a', 'b']], ['luke2', ['c']]]), known: new Set(['luke1', 'luke2']), coming: new Set(['b']) });
    expect(r.referenceComing('luke1')).toBe(true);
    expect(r.referenceComing('luke2')).toBe(false);
    r.referenceArrived('b');
    expect(r.referenceComing('luke1')).toBe(false);
    r.forgetReference();
    expect(r.referenceKnown('luke1')).toBe(false);
  });

  it('tells screens at once after a quiet spell, then at most twice a second', async () => {
    vi.useFakeTimers();
    const r = await import('../src/sources/referenceCounts');
    let told = 0;
    r.onReferenceFiles(() => { told += 1; });
    r.publishReference({ known: new Set(['luke1']) });
    expect(told).toBe(1);
    for (let i = 0; i < 20; i++) r.referenceArrived(`k${i}`);
    expect(told).toBe(1);
    await vi.advanceTimersByTimeAsync(r.REFERENCE_NEWS_MS);
    expect(told).toBe(2);
  });
});

// Study files were never cleared: a book let go kept its pictures and step audio for good (Carl, 2026-11-23).
describe('study files a phone clears (decision 2026-11-23-study-files-are-cleared-when-no-kept-passage-needs-them.md)', () => {
  const MB = 1024 * 1024;
  const A = 'https://x/a.jpg';
  const B = 'https://x/b.jpg';
  const alpha = { orgId: 'o', languageId: 'alpha' };
  const beta = { orgId: 'o', languageId: 'beta' };
  const flush = async () => { for (let i = 0; i < 8; i++) await settle(); };
  beforeEach(() => {
    disk.clear(); sizes.clear(); times.clear(); kv.clear(); room.free = 10 * 1024 * 1024 * 1024;
    net.down.clear(); net.refused.clear(); net.fetched = []; net.hold = null; vi.resetModules(); vi.useRealTimers();
  });

  it('clears a let-go passage\'s files when the device is short of room, and keeps the kept passage\'s', async () => {
    const f = await import('../src/study/studyFiles');
    f.setStudyWanted(new Map([['luke1', [A]], ['luke2', [B]]]), true, alpha, ['luke1', 'luke2'], true);
    await flush();
    expect(f.hasStudyFile(A) && f.hasStudyFile(B)).toBe(true);
    room.free = 100 * MB;
    f.setStudyWanted(new Map([['luke1', [A]]]), true, alpha, ['luke1'], true);
    await flush();
    expect(f.hasStudyFile(B)).toBe(false);
    expect(f.hasStudyFile(A)).toBe(true);
    expect(disk.size).toBe(1);
  });

  it('keeps them while the device has room and they fit the room spared for them, and clears them past it', async () => {
    const f = await import('../src/study/studyFiles');
    f.setStudyWanted(new Map([['luke1', [A]], ['luke2', [B]]]), true, alpha, ['luke1', 'luke2'], true);
    await flush();
    f.setStudyWanted(new Map([['luke1', [A]]]), true, alpha, ['luke1'], true);
    await flush();
    expect(f.hasStudyFile(B)).toBe(true);
    // 300 MB of files no kept passage needs is past the 256 MB spared for them.
    for (const name of disk.keys()) sizes.set(name, 300 * MB);
    f.setStudyWanted(new Map([['luke1', [A]]]), true, alpha, ['luke1'], false);
    f.setStudyWanted(new Map([['luke1', [A]]]), true, alpha, ['luke1'], true);
    await flush();
    expect(f.hasStudyFile(B)).toBe(false);
    expect(f.hasStudyFile(A)).toBe(true);
  });

  it('keeps a file another language on this phone still needs, by that language\'s saved list', async () => {
    const f = await import('../src/study/studyFiles');
    f.setStudyWanted(new Map([['luke2', [B]]]), true, beta, ['luke2'], true);
    await flush();
    f.setStudyWanted(new Map([['luke1', [A]], ['luke2', [B]]]), true, alpha, ['luke1', 'luke2'], true);
    await flush();
    room.free = 100 * MB;
    f.setStudyWanted(new Map([['luke1', [A]]]), true, alpha, ['luke1'], true);
    await flush();
    expect(f.hasStudyFile(B)).toBe(true);
    expect(kv.get('study-files:wants:o/beta')).toBeDefined();
  });

  it('clears nothing while a kept passage\'s guide is not looked up yet: the list may not name all it needs', async () => {
    const f = await import('../src/study/studyFiles');
    f.setStudyWanted(new Map([['luke1', [A]], ['luke2', [B]]]), true, alpha, ['luke1', 'luke2'], true);
    await flush();
    room.free = 100 * MB;
    f.setStudyWanted(new Map([['luke1', [A]]]), true, alpha, ['luke1'], false);
    await flush();
    expect(f.hasStudyFile(B)).toBe(true);
  });

  it('never clears a file from before this build kept the lists: a language not opened since may need it', async () => {
    kv.set('study-files:since', String(Date.now()));
    const f = await import('../src/study/studyFiles');
    f.setStudyWanted(new Map([['luke2', [B]]]), true, alpha, ['luke2'], true);
    await flush();
    for (const name of disk.keys()) times.set(name, 1);
    room.free = 100 * MB;
    f.setStudyWanted(new Map(), true, alpha, [], true);
    await flush();
    expect(f.hasStudyFile(B)).toBe(true);
  });
});
