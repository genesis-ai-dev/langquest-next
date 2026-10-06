import { handleApi, type ApiDeps } from '../worker/api';
import { chooseFilesets, coverage, versesOf, type BibleDeps, type DbpFileset, type ResponseCache } from '../worker/bible';

/**
 * The Worker's Bible routes (docs/reference-material.md) against a fake
 * Bible Brain. The fake checks the key on every call, the way FCBH does, and
 * every answer is checked not to carry it.
 */

const KEY = 'sekret-key-123';
const NOW = Date.parse('2026-10-05T12:00:00Z');
const EXPIRES = Math.floor(NOW / 1000) + 40 * 3600;
const signed = (file: string) => `https://cdn.example/audio/${file}?x-amz-transaction=1&Expires=${EXPIRES}&Signature=abc&Key-Pair-Id=K`;

const ESV_FILESETS: DbpFileset[] = [
  { id: 'ENGESVN1DA-opus16', type: 'audio', size: 'NT', codec: 'opus', container: 'webm', bitrate: '16kbps' },
  { id: 'ENGESVN2DA', type: 'audio_drama', size: 'NT', codec: 'mp3', container: 'mp3', bitrate: '64kbps' },
  { id: 'ENGESVO1DA', type: 'audio', size: 'OT', codec: 'mp3', container: 'mp3', bitrate: '64kbps' },
  { id: 'ENGESVN1DA', type: 'audio', size: 'NT', codec: 'mp3', container: 'mp3', bitrate: '64kbps' },
  { id: 'ENGESVO1SA', type: 'audio_stream', size: 'OT' },
  { id: 'ENGESVO_ET', type: 'text_plain', size: 'OT' },
  { id: 'ENGESVN_ET', type: 'text_plain', size: 'NT' },
  { id: 'ENGESVN_ET-json', type: 'text_json', size: 'NT' }
];
/** Like the WEB: text for both testaments, audio (drama) for the New Testament only. */
const WEB_FILESETS: DbpFileset[] = [
  { id: 'ENGWEBN2DA', type: 'audio_drama', size: 'NT', codec: 'mp3', container: 'mp3' },
  { id: 'ENGWEBN2SA', type: 'audio_drama_stream', size: 'NT', codec: 'mp3' },
  { id: 'ENGWEBO_ET', type: 'text_plain', size: 'OT' },
  { id: 'ENGWEBN_ET', type: 'text_plain', size: 'NT' }
];
const BOOKS = [
  { book_id: 'GEN', name: 'Genesis', chapters: [1, 2, 3], testament: 'OT' },
  { book_id: 'MAT', name: 'Matthew', chapters: [1, 2], testament: 'NT' },
  { book_id: 'FRT', name: 'Front', chapters: [], testament: '' }
];

type Upstream = { calls: string[]; fetch: NonNullable<BibleDeps['fetch']>; overrides: Map<string, () => Response> };

function bibleBrain(): Upstream {
  const calls: string[] = [];
  const overrides = new Map<string, () => Response>();
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  const status = (n: number) => new Response(JSON.stringify({ error: { message: 'x', status_code: n } }), { status: n });
  const fetch = async (raw: string) => {
    const url = new URL(raw);
    if (url.searchParams.get('key') !== KEY || url.searchParams.get('v') !== '4') return status(401);
    const path = url.pathname.replace(/^\/api/, '');
    calls.push(path);
    const o = overrides.get(path);
    if (o) return o();
    const audioRow = (fs: string, book: string, ch: string) => ({ book_id: book, chapter_start: Number(ch), path: signed(`${fs}_${book}_${ch}.mp3`), duration: 342, filesize_in_bytes: 2765464 });
    let m: RegExpExecArray | null;
    if (path === '/languages' && url.searchParams.get('language_code') === 'eng') return ok({ data: [{ iso: 'eng', name: 'English', autonym: 'English', bibles: 40 }] });
    if (path === '/languages/search/eng') return ok({ data: [{ iso: 'eng', name: 'English: USA', bibles: 3 }, { iso: 'enm', name: 'Middle English', bibles: 1 }, { iso: 'xxx', name: 'None', bibles: 0 }] });
    if (path === '/timestamps') return ok([{ fileset_id: 'ENGESVO1DA' }, { fileset_id: 'ENGWEBN2DA' }]);
    if (path === '/bibles' && url.searchParams.get('language_code') === 'eng') {
      return ok({
        data: [
          { abbr: 'ENGESV', name: 'English Standard Version®', iso: 'eng', language: 'English', filesets: { 'dbp-prod': ESV_FILESETS } },
          { abbr: 'ENGWEB', name: 'World English Bible', iso: 'eng', language: 'English', filesets: { 'dbp-prod': WEB_FILESETS } },
          { abbr: 'ENGVID', name: 'Video only', iso: 'eng', language: 'English', filesets: { 'dbp-vid': [{ id: 'ENGVIDP2DV', type: 'video_stream', size: 'NTP' }] } }
        ],
        meta: { pagination: { last_page: 1 } }
      });
    }
    if ((m = /^\/bibles\/(ENGESV|ENGWEB)$/.exec(path))) {
      return ok({ data: { abbr: m[1], name: m[1] === 'ENGESV' ? 'English Standard Version®' : 'World English Bible', iso: 'eng', language: 'English: USA', books: BOOKS, filesets: { 'dbp-prod': m[1] === 'ENGESV' ? ESV_FILESETS : WEB_FILESETS } } });
    }
    if ((m = /^\/bibles\/filesets\/([^/]+)\/copyright$/.exec(path))) return ok({ id: m[1], copyright: { copyright: `© ${m[1]} holder` } });
    if ((m = /^\/download\/([^/]+)\/([A-Z0-9]{3})\/(\d+)$/.exec(path))) {
      // The ESV's text and OT audio may be downloaded; its NT audio and the WEB may not.
      if (!['ENGESVO_ET', 'ENGESVN_ET', 'ENGESVO1DA'].includes(m[1]!)) return status(403);
      if (m[1]!.endsWith('_ET')) return ok({ data: [{ verse_start: 1, verse_end: 1, verse_text: 'x' }] });
      return ok({ data: [audioRow(m[1]!, m[2]!, m[3]!)] });
    }
    if ((m = /^\/bibles\/filesets\/([^/]+)\/([A-Z0-9]{3})\/(\d+)$/.exec(path))) {
      const [, fs, book, ch] = m;
      if (fs!.endsWith('_ET')) {
        if ((fs!.includes('O_') && book !== 'GEN') || (fs!.includes('N_') && book !== 'MAT')) return ok({ data: [] });
        return ok({ data: [
          { book_id: book, chapter: Number(ch), verse_start: 1, verse_end: 1, verse_text: 'In the beginning. ' },
          { book_id: book, chapter: Number(ch), verse_start: 38, verse_end: 39, verse_text: 'A bridge.' },
          { book_id: book, chapter: Number(ch), verse_start: 40, verse_end: null, verse_text: 'No end.' }
        ] });
      }
      if (fs === 'ENGWEBN2DA' && book !== 'MAT') return status(404);
      if (fs === 'ENGESVO1SA') return ok({ data: [{ path: `https://cdn.example/x.m3u8?key=${KEY}` }] });
      return ok({ data: [audioRow(fs!, book!, ch!)] });
    }
    if ((m = /^\/timestamps\/([^/]+)\/([A-Z0-9]{3})\/(\d+)$/.exec(path))) {
      if (m[1] === 'ENGESVO1DA') return ok({ data: [{ verse_start: '0', timestamp: 0 }, { verse_start: '1', timestamp: 8.76 }, { verse_start: '2', timestamp: 9.96 }] });
      if (m[1] === 'NOPE') return status(404);
      return ok({ data: [] });
    }
    return status(404);
  };
  return { calls, fetch, overrides };
}

class MemoryCache implements ResponseCache {
  readonly store = new Map<string, { body: string; maxAge: number }>();
  async match(req: Request) {
    const hit = this.store.get(req.url);
    return hit ? new Response(hit.body) : undefined;
  }
  async put(req: Request, res: Response) {
    this.store.set(req.url, { body: await res.text(), maxAge: Number(/max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1]) });
  }
}

/** Every body any test saw, to check none names the key. */
const seen: string[] = [];

function setup(opts: { key?: string | undefined; cache?: MemoryCache } = {}) {
  const up = bibleBrain();
  const cache = opts.cache ?? new MemoryCache();
  const deps: ApiDeps = {
    profileOf: async (t) => (t === 'good' ? 'p1' : null),
    reports: async () => null,
    bible: { key: 'key' in opts ? opts.key : KEY, fetch: up.fetch, cache, now: () => NOW }
  };
  const call = async (path: string, token: string | null = 'good', init: { origin?: string; method?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (token) headers['authorization'] = `Bearer ${token}`;
    if (init.origin) headers['origin'] = init.origin;
    const res = await handleApi(new Request(`https://next.langquest.org${path}`, { method: init.method ?? 'GET', headers }), deps);
    const text = await res.text();
    seen.push(text, JSON.stringify([...res.headers]));
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };
  return { up, cache, call };
}

describe('choosing filesets', () => {
  it('reads FCBH size codes, whole and partial', () => {
    expect(coverage('C')).toEqual({ OT: true, NT: true, whole: true });
    expect(coverage('NT')).toEqual({ OT: false, NT: true, whole: true });
    expect(coverage('NTOTP')).toEqual({ OT: true, NT: true, whole: false });
    expect(coverage('S')).toEqual({ OT: false, NT: false, whole: false });
  });

  it('prefers plain text, and non-drama MP3 audio files over drama, opus and streams', () => {
    expect(chooseFilesets(ESV_FILESETS)).toEqual({ text: { OT: 'ENGESVO_ET', NT: 'ENGESVN_ET' }, audio: { OT: 'ENGESVO1DA', NT: 'ENGESVN1DA' } });
    // MP3 drama beats opus non-drama: FCBH's opus files have no timestamps.
    expect(chooseFilesets([{ id: 'X-opus16', type: 'audio', size: 'NT', codec: 'opus' }, { id: 'XN2DA', type: 'audio_drama', size: 'NT', codec: 'mp3' }]).audio).toEqual({ NT: 'XN2DA' });
    expect(chooseFilesets([{ id: 'FRNTLS', type: 'text_plain', size: 'C' }]).text).toEqual({ OT: 'FRNTLS', NT: 'FRNTLS' });
  });

  it('gives an NT-only Bible no Old Testament audio', () => {
    expect(chooseFilesets(WEB_FILESETS)).toEqual({ text: { OT: 'ENGWEBO_ET', NT: 'ENGWEBN_ET' }, audio: { NT: 'ENGWEBN2DA' } });
  });

  it('turns verse bridges into one [start, end, text] row', () => {
    expect(versesOf([{ verse_start: 38, verse_end: 39, verse_text: 'b' }, { verse_start: '40', verse_end: null, verse_text: ' c ' }, { verse_start: 'x', verse_text: 'bad' }]))
      .toEqual([[38, 39, 'b'], [40, 40, 'c']]);
  });
});

describe('the Bible routes', () => {
  afterAll(() => {
    expect(seen.length).toBeGreaterThan(20);
    for (const text of seen) expect(text).not.toContain(KEY);
  });

  it('refuses a missing or bad token before anything else, and never calls Bible Brain', async () => {
    const { up, call } = setup();
    expect((await call('/api/bible/bibles?lang=eng', null)).status).toBe(401);
    expect((await call('/api/bible/text/ENGESVO_ET/GEN/1', 'forged')).status).toBe(401);
    expect(up.calls).toEqual([]);
  });

  it('answers 503 with a plain error when the Worker has no key', async () => {
    for (const key of [undefined, '', '  ']) {
      const { up, call } = setup({ key });
      const res = await call('/api/bible/languages?q=eng');
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ error: expect.any(String) });
      expect(up.calls).toEqual([]);
    }
  });

  it('knows only its routes, GET, and well-formed ids', async () => {
    const { call } = setup();
    expect((await call('/api/bible/other')).status).toBe(404);
    expect((await call('/api/bible/text/ENGESVO_ET/gen/1')).status).toBe(404);
    expect((await call('/api/bible/text/ENGESVO_ET/GEN/1', 'good', { method: 'POST' })).status).toBe(405);
    expect((await call('/api/bible/bibles?lang=English')).status).toBe(400);
    expect((await call('/api/bible/languages?q=e')).status).toBe(400);
  });

  it('finds languages by code or name, one row per ISO code, the exact code first', async () => {
    const { call } = setup();
    const res = await call('/api/bible/languages?q=eng');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ languages: [{ code: 'eng', name: 'English', autonym: 'English', bibles: 40 }, { code: 'enm', name: 'Middle English', bibles: 1 }] });
  });

  it('lists a language\'s Bibles with their filesets per testament and FCBH timestamps', async () => {
    const { call } = setup();
    const res = await call('/api/bible/bibles?lang=eng');
    expect(res.body.bibles).toEqual([
      { bibleId: 'ENGESV', name: 'English Standard Version®', abbreviation: 'ESV', language: 'eng', languageName: 'English',
        text: { OT: 'ENGESVO_ET', NT: 'ENGESVN_ET' }, audio: { OT: 'ENGESVO1DA', NT: 'ENGESVN1DA' }, timestamps: { OT: true, NT: false } },
      { bibleId: 'ENGWEB', name: 'World English Bible', abbreviation: 'WEB', language: 'eng', languageName: 'English',
        text: { OT: 'ENGWEBO_ET', NT: 'ENGWEBN_ET' }, audio: { NT: 'ENGWEBN2DA' }, timestamps: { OT: false, NT: true } }
    ]);
  });

  it('describes one Bible: books, copyright, and whether /download allows its text and audio', async () => {
    const { call } = setup();
    const esv = (await call('/api/bible/bibles/ENGESV')).body.bible;
    expect(esv.books).toEqual([{ book: 'GEN', name: 'Genesis', chapters: 3, testament: 'OT' }, { book: 'MAT', name: 'Matthew', chapters: 2, testament: 'NT' }]);
    expect(esv.copyright).toEqual({ text: '© ENGESVN_ET holder', audio: '© ENGESVN1DA holder' });
    // Text allowed in both testaments; NT audio refused, so audio is not offline.
    expect(esv.offline).toEqual({ text: true, audio: false });
    const web = (await call('/api/bible/bibles/ENGWEB')).body.bible;
    expect(web.audio).toEqual({ NT: 'ENGWEBN2DA' });
    expect(web.offline).toEqual({ text: false, audio: false });
    expect((await call('/api/bible/bibles/ENGNONE')).status).toBe(404);
  });

  it('reads a chapter\'s text as rows, bridges as one row', async () => {
    const { call } = setup();
    const res = await call('/api/bible/text/ENGESVO_ET/GEN/1');
    expect(res.body).toEqual({ verses: [[1, 1, 'In the beginning.'], [38, 39, 'A bridge.'], [40, 40, 'No end.']] });
    expect(res.headers.get('cache-control')).toMatch(/^private/);
    expect((await call('/api/bible/text/ENGESVO_ET/MAT/1')).status).toBe(404);
  });

  it('hands out a /download link when the fileset allows it, else a streaming link, never the key', async () => {
    const { up, call } = setup();
    const ot = (await call('/api/bible/audio/ENGESVO1DA/GEN/1')).body;
    expect(ot).toEqual({ url: signed('ENGESVO1DA_GEN_1.mp3'), durationMs: 342_000, bytes: 2765464, expiresAt: new Date(EXPIRES * 1000).toISOString(), offline: true });
    expect(up.calls).toContain('/download/ENGESVO1DA/GEN/1');
    const nt = (await call('/api/bible/audio/ENGESVN1DA/MAT/1')).body;
    expect(nt.offline).toBe(false);
    expect(nt.url).toBe(signed('ENGESVN1DA_MAT_1.mp3'));
    expect(up.calls).toEqual(expect.arrayContaining(['/download/ENGESVN1DA/MAT/1', '/bibles/filesets/ENGESVN1DA/MAT/1']));
  });

  it('has no Genesis audio for an NT-only Bible', async () => {
    const { call } = setup();
    expect((await call('/api/bible/audio/ENGWEBN2DA/GEN/1')).status).toBe(404);
    expect((await call('/api/bible/audio/ENGWEBN2DA/MAT/1')).body.offline).toBe(false);
  });

  it('never passes on a playlist or anything that names the key', async () => {
    const { up, call } = setup();
    const hls = await call('/api/bible/audio/ENGESVO1SA/GEN/1');
    expect(hls.status).toBe(404);
    // Bible Brain echoing the key anywhere in what we would pass on is refused outright.
    up.overrides.set('/bibles/filesets/ENGESVO_ET/GEN/2', () => new Response(JSON.stringify({ data: [{ verse_start: 1, verse_end: 1, verse_text: `see ?key=${KEY}` }] }), { status: 200 }));
    expect((await call('/api/bible/text/ENGESVO_ET/GEN/2')).status).toBe(502);
    up.overrides.set('/bibles/filesets/ENGESVN_ET/copyright', () => new Response(JSON.stringify({ copyright: { copyright: `key ${KEY}` } }), { status: 200 }));
    expect((await call('/api/bible/bibles/ENGESV')).status).toBe(502);
    up.overrides.set('/download/ENGESVO1DA/GEN/3', () => new Response(JSON.stringify({ data: [{ path: `https://cdn.example/a.mp3?key=${KEY}` }] }), { status: 200 }));
    expect((await call('/api/bible/audio/ENGESVO1DA/GEN/3')).status).toBe(404);
  });

  it('answers FCBH\'s verse timestamps, and 404 when it has none', async () => {
    const { call } = setup();
    expect((await call('/api/bible/timestamps/ENGESVO1DA/GEN/1')).body).toEqual({ rows: [{ verse: 0, seconds: 0 }, { verse: 1, seconds: 8.76 }, { verse: 2, seconds: 9.96 }] });
    expect((await call('/api/bible/timestamps/ENGBERO1DA/GEN/1')).status).toBe(404);
    expect((await call('/api/bible/timestamps/NOPE/GEN/1')).status).toBe(404);
  });

  it('caches under its own URLs without the token: a day for text, a few hours for audio, and probes /download once per fileset', async () => {
    const cache = new MemoryCache();
    const first = setup({ cache });
    await first.call('/api/bible/text/ENGESVO_ET/GEN/1');
    await first.call('/api/bible/audio/ENGESVN1DA/MAT/1');
    await first.call('/api/bible/timestamps/ENGBERO1DA/GEN/1');
    const keys = [...cache.store.keys()];
    expect(keys.every((k) => !k.includes('good') && !k.includes(KEY))).toBe(true);
    expect(cache.store.get(keys.find((k) => k.endsWith('/text/ENGESVO_ET/GEN/1'))!)!.maxAge).toBe(86_400);
    const audio = cache.store.get(keys.find((k) => k.endsWith('/audio/ENGESVN1DA/MAT/1'))!)!.maxAge;
    expect(audio).toBeGreaterThan(3600);
    expect(audio).toBeLessThanOrEqual(3 * 3600);
    expect(JSON.parse(cache.store.get(keys.find((k) => k.endsWith('/offline/ENGESVN1DA'))!)!.body)).toBe(false);

    const second = setup({ cache });
    await second.call('/api/bible/text/ENGESVO_ET/GEN/1', 'good');
    await second.call('/api/bible/timestamps/ENGBERO1DA/GEN/1');
    await second.call('/api/bible/audio/ENGESVN1DA/MAT/2');
    // A known refusal skips /download and goes straight to the streaming link.
    expect(second.up.calls).toEqual(['/bibles/filesets/ENGESVN1DA/MAT/2']);
  });

  it('lets a local development origin call it, and nobody else', async () => {
    const { call } = setup();
    expect((await call('/api/bible/text/ENGESVO_ET/GEN/1', 'good', { origin: 'http://localhost:8081' })).headers.get('access-control-allow-origin')).toBe('http://localhost:8081');
    expect((await call('/api/bible/text/ENGESVO_ET/GEN/1', 'good', { origin: 'https://evil.example' })).headers.get('access-control-allow-origin')).toBeNull();
  });
});
