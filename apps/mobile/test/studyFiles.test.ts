import type { StudyGuide } from '../src/study/guides';

// A tiny disk: names to contents, and which addresses the network refuses.
const disk = new Map<string, string>();
const net = { down: new Set<string>(), fetched: [] as string[], hold: null as null | Promise<void> };

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('../src/report', () => ({ noteExpected: () => {} }));
vi.mock('expo-file-system', () => {
  class File {
    name: string;
    constructor(dir: { path: string } | string, name?: string) {
      this.name = name ?? String(dir);
    }
    get uri() { return `file:///documents/study/${this.name}`; }
    get exists() { return disk.has(this.name); }
    delete() { disk.delete(this.name); }
    move(dest: File) { disk.set(dest.name, disk.get(this.name) ?? ''); disk.delete(this.name); }
    static async downloadFileAsync(url: string, dest: File) {
      net.fetched.push(url);
      if (net.hold) await net.hold;
      if (net.down.has(url)) throw new Error('offline');
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
  return { File, Directory, Paths: { document: 'file:///documents' } };
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

describe('study files kept for offline (decisions.md 59)', () => {
  beforeEach(() => { disk.clear(); net.down.clear(); net.fetched = []; net.hold = null; vi.resetModules(); vi.useRealTimers(); });

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
    expect(f.studyCounts('luke1')).toEqual({ here: 2, total: 2 });
    expect(f.studyUri(urls[0])).toMatch(/^file:\/\/\/documents\/study\/.+\.mp3$/);
    expect(f.studyCounts('other')).toEqual({ here: 0, total: 0 });
  });

  it('offline, it counts what is missing and fetches nothing', async () => {
    const f = await import('../src/study/studyFiles');
    f.setStudyWanted(new Map([['luke1', ['https://x/a.mp3']]]), false);
    await settle();
    expect(net.fetched).toEqual([]);
    expect(f.studyCounts('luke1')).toEqual({ here: 0, total: 1 });
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
    expect(f.studyCounts('luke1')).toEqual({ here: 3, total: 3 });
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
});
