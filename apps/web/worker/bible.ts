/**
 * Bible Brain through our server (docs/reference-material.md, "The Worker's
 * Bible routes"). Phones never see the key: every answer is built here from
 * Faith Comes By Hearing's API and checked not to carry it. Audio is handed
 * out only as a signed MP3 (or WebM) link, never an HLS playlist, because
 * FCBH's playlists embed the key in their segment URLs.
 *
 * Answers are cached with the Workers Cache API under our own URLs (route
 * and parameters, never the caller's token or the key): languages, Bibles,
 * text, timestamps and copyright for a day; audio links for a few hours,
 * since FCBH signs them for about a day.
 */

const DBP = 'https://4.dbt.io/api';
/** Our own cache namespace; bump to drop every cached answer. */
const CACHE_ROOT = 'https://bible-cache.langquest.internal/v1';
const DAY = 86_400;
const AUDIO_TTL = 3 * 3600;

type Testament = 'OT' | 'NT';
export type Testaments = { OT?: string; NT?: string };

export interface BibleSummary {
  bibleId: string;
  name: string;
  abbreviation: string;
  language: string;
  languageName: string;
  text: Testaments;
  audio: Testaments;
  timestamps: { OT: boolean; NT: boolean };
}

export interface BibleDetail extends BibleSummary {
  books: { book: string; name: string; chapters: number; testament: Testament }[];
  copyright: { text?: string; audio?: string };
  offline: { text: boolean; audio: boolean };
}

/** The part of the Workers Cache API we use (`caches.default`). */
export interface ResponseCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, response: Response): Promise<void>;
}

export interface BibleDeps {
  /** The Worker secret BIBLE_BRAIN_ACCESS_KEY; optional, so a deploy never waits for it (decision 51). */
  key: string | undefined;
  /** The profile a Supabase access token belongs to, or null. */
  profileOf(token: string): Promise<string | null>;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  cache?: ResponseCache | null;
  waitUntil?: (p: Promise<unknown>) => void;
  now?: () => number;
}

/** One fileset as FCBH lists it under a Bible. */
export interface DbpFileset {
  id: string;
  type: string;
  size: string;
  codec?: string;
  container?: string;
  bitrate?: string;
}

class Answer extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const notFound = (what = 'That is not in Bible Brain.') => new Answer(404, what);
const upstreamFailed = () => new Answer(502, 'Bible Brain did not answer just now. Try again.');

// ---- choosing filesets -----------------------------------------------------------------------

/** Which testaments a fileset's size code covers (C complete, OT, NT, and portions like NTP or NTOTP). */
export function coverage(size: string): { OT: boolean; NT: boolean; whole: boolean } {
  const s = (size ?? '').toUpperCase();
  if (s === 'C') return { OT: true, NT: true, whole: true };
  return { OT: s.includes('OT'), NT: s.includes('NT'), whole: s === 'OT' || s === 'NT' };
}

const isOpus = (f: DbpFileset) => /opus/i.test(f.id) || /opus/i.test(f.codec ?? '') || /webm/i.test(f.container ?? '');
const kbps = (f: DbpFileset) => Number(/(\d+)/.exec(f.bitrate ?? '')?.[1] ?? (/16$/.test(f.id) ? 16 : 64));

/**
 * The text and audio filesets to use per testament: plain text, and audio
 * that is a file (never a stream, whose playlists carry the key), preferring
 * whole testaments, then MP3 over opus (FCBH's opus16 files have no
 * timestamps), then non-drama, then the higher bitrate.
 */
export function chooseFilesets(filesets: DbpFileset[]): { text: Testaments; audio: Testaments } {
  const text: Testaments = {};
  const audio: Testaments = {};
  for (const t of ['OT', 'NT'] as const) {
    const texts = filesets.filter((f) => f.type === 'text_plain' && coverage(f.size)[t]);
    const tBest = [...texts].sort((a, b) => Number(coverage(b.size).whole) - Number(coverage(a.size).whole) || (a.id < b.id ? -1 : 1))[0];
    if (tBest) text[t] = tBest.id;
    const audios = filesets.filter((f) => (f.type === 'audio' || f.type === 'audio_drama') && coverage(f.size)[t]);
    const score = (f: DbpFileset) => [Number(coverage(f.size).whole), Number(!isOpus(f)), Number(f.type === 'audio'), kbps(f)];
    const aBest = [...audios].sort((a, b) => {
      const [x, y] = [score(a), score(b)];
      for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return y[i]! - x[i]!;
      return a.id < b.id ? -1 : 1;
    })[0];
    if (aBest) audio[t] = aBest.id;
  }
  return { text, audio };
}

/** Every fileset FCBH lists under a Bible, from all of its buckets (`dbp-prod`, `dbp-vid`). */
const allFilesets = (filesets: unknown): DbpFileset[] =>
  filesets && typeof filesets === 'object' ? Object.values(filesets as Record<string, DbpFileset[]>).flat().filter((f) => f && typeof f.id === 'string') : [];

/** Bible ids start with the language's three letters: ENGESV is the ESV. */
export const abbreviationOf = (bibleId: string) => (bibleId.length > 3 ? bibleId.slice(3) : bibleId);

/** `[verseStart, verseEnd, text]` rows from FCBH's verses; a bridge (38–39) is one row. */
export function versesOf(rows: unknown): [number, number, string][] {
  if (!Array.isArray(rows)) return [];
  const out: [number, number, string][] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const start = Number(r['verse_start']);
    const end = r['verse_end'] === null || r['verse_end'] === undefined ? start : Number(r['verse_end']);
    if (!Number.isInteger(start) || !Number.isInteger(end) || typeof r['verse_text'] !== 'string') continue;
    out.push([start, Math.max(start, end), (r['verse_text'] as string).trim()]);
  }
  return out;
}

/** When a CloudFront signed link stops working (`Expires`, in seconds). */
export function expiryOf(link: string, fallbackMs: number): number {
  try {
    const s = Number(new URL(link).searchParams.get('Expires'));
    return Number.isFinite(s) && s > 0 ? s * 1000 : fallbackMs;
  } catch {
    return fallbackMs;
  }
}

/** A link we may hand to a phone: https, an MP3 or WebM file, nothing that names the key. */
function mediaLink(path: unknown, key: string): string | null {
  if (typeof path !== 'string' || leaks(path, key)) return null;
  try {
    const u = new URL(path);
    if (u.protocol !== 'https:' || !/\.(mp3|webm)$/i.test(u.pathname)) return null;
    if (u.searchParams.has('key')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const leaks = (text: string, key: string) => key.length > 0 && (text.includes(key) || text.includes(encodeURIComponent(key)));

// ---- the handler -----------------------------------------------------------------------------

const ID = /^[A-Za-z0-9_-]{2,40}$/;
const BOOK = /^[A-Z0-9]{3}$/;

export async function handleBible(request: Request, deps: BibleDeps): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/bible/, '');
  const route = matchRoute(path);
  if (!route) return json(404, { error: 'Not found.' });
  if (request.method !== 'GET') return json(405, { error: 'Only GET is supported.' });
  const token = /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  const profileId = token ? await deps.profileOf(token) : null;
  if (!profileId) return json(401, { error: 'Sign in again.' });
  const key = deps.key?.trim();
  if (!key) return json(503, { error: 'Bible Brain is not set up on this server yet.' });

  const bible = new BibleBrain(key, deps);
  try {
    const { body, maxAge } = await bible.answer(route, url.searchParams);
    return bible.respond(200, body, maxAge);
  } catch (e) {
    if (e instanceof Answer) return bible.respond(e.status, { error: e.message }, 0);
    console.error('bible:', e instanceof Error ? e.message : 'failed');
    return bible.respond(502, { error: 'Bible Brain did not answer just now. Try again.' }, 0);
  }
}

type Route =
  | { name: 'languages' }
  | { name: 'bibles' }
  | { name: 'bible'; bibleId: string }
  | { name: 'text' | 'audio' | 'timestamps'; fileset: string; book: string; chapter: number };

function matchRoute(path: string): Route | null {
  if (path === '/languages') return { name: 'languages' };
  if (path === '/bibles') return { name: 'bibles' };
  let m = /^\/bibles\/([^/]+)$/.exec(path);
  if (m) return ID.test(m[1]!) ? { name: 'bible', bibleId: m[1]! } : null;
  m = /^\/(text|audio|timestamps)\/([^/]+)\/([^/]+)\/(\d{1,3})$/.exec(path);
  if (m && ID.test(m[2]!) && BOOK.test(m[3]!) && Number(m[4]) >= 1) {
    return { name: m[1] as 'text' | 'audio' | 'timestamps', fileset: m[2]!, book: m[3]!, chapter: Number(m[4]) };
  }
  return null;
}

function json(status: number, body: unknown, maxAge = 0): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': maxAge > 0 ? `private, max-age=${maxAge}` : 'private, no-store' }
  });
}

class BibleBrain {
  private readonly fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  private readonly now: () => number;

  constructor(private readonly key: string, private readonly deps: BibleDeps) {
    this.fetchImpl = deps.fetch ?? ((u, i) => fetch(u, i));
    this.now = deps.now ?? Date.now;
  }

  /** The last line of defence: nothing that names the key leaves this Worker. */
  respond(status: number, body: unknown, maxAge: number): Response {
    const text = JSON.stringify(body);
    if (leaks(text, this.key)) return json(502, { error: 'Bible Brain answered with something we cannot pass on.' });
    return json(status, body, maxAge);
  }

  async answer(route: Route, q: URLSearchParams): Promise<{ body: unknown; maxAge: number }> {
    switch (route.name) {
      case 'languages': return { body: { languages: await this.languages(q.get('q') ?? '') }, maxAge: 3600 };
      case 'bibles': return { body: { bibles: await this.bibles(q.get('lang') ?? '') }, maxAge: 3600 };
      case 'bible': return { body: { bible: await this.bible(route.bibleId) }, maxAge: 3600 };
      case 'text': return { body: { verses: await this.text(route.fileset, route.book, route.chapter) }, maxAge: 3600 };
      case 'timestamps': {
        const rows = await this.timestamps(route.fileset, route.book, route.chapter);
        if (!rows) throw notFound('Bible Brain has no timestamps for this chapter.');
        return { body: { rows }, maxAge: 3600 };
      }
      case 'audio': {
        const a = await this.audio(route.fileset, route.book, route.chapter);
        return { body: a, maxAge: Math.max(0, Math.min(3600, Math.floor((Date.parse(a.expiresAt) - this.now()) / 1000) - 3600)) };
      }
    }
  }

  // ---- upstream and cache --------------------------------------------------------------------

  /** One call to FCBH. 200 gives the JSON; any other status is returned without its body. */
  private async dbp(path: string, query: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
    const u = new URL(`${DBP}${path}`);
    u.searchParams.set('v', '4');
    for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
    u.searchParams.set('key', this.key);
    let res: Response;
    try {
      res = await this.fetchImpl(u.toString(), { headers: { accept: 'application/json' } });
    } catch {
      throw upstreamFailed();
    }
    if (!res.ok) return { status: res.status, body: null };
    try {
      return { status: 200, body: await res.json() };
    } catch {
      throw upstreamFailed();
    }
  }

  private async dbpData(path: string, query: Record<string, string> = {}): Promise<unknown> {
    const r = await this.dbp(path, query);
    if (r.status === 404) throw notFound();
    if (r.status !== 200) throw upstreamFailed();
    return (r.body as { data?: unknown })?.data;
  }

  /** A value cached under our own URL for `ttl` seconds (or the seconds `ttl` gives for it); null is cached too. */
  private async cached<T>(name: string, ttl: number | ((v: T) => number), make: () => Promise<T>): Promise<T> {
    const cache = this.deps.cache;
    const req = new Request(`${CACHE_ROOT}/${name}`);
    if (cache) {
      const hit = await cache.match(req).catch(() => undefined);
      if (hit) return (await hit.json()) as T;
    }
    const value = await make();
    const seconds = typeof ttl === 'function' ? ttl(value) : ttl;
    const text = JSON.stringify(value ?? null);
    if (cache && seconds > 0 && !leaks(text, this.key)) {
      const put = cache.put(req, new Response(text, { headers: { 'content-type': 'application/json', 'cache-control': `max-age=${seconds}` } })).catch(() => undefined);
      if (this.deps.waitUntil) this.deps.waitUntil(put);
      else await put;
    }
    return value;
  }

  // ---- routes ----------------------------------------------------------------------------------

  private async languages(query: string) {
    const q = query.trim();
    if (q.length < 2 || q.length > 60) throw new Answer(400, 'Search with at least two letters, or a language code.');
    return this.cached(`languages/${encodeURIComponent(q.toLowerCase())}`, DAY, async () => {
      const rows: Record<string, unknown>[] = [];
      if (/^[a-z]{3}$/i.test(q)) {
        const exact = await this.dbp('/languages', { language_code: q.toLowerCase() });
        if (exact.status === 200) rows.push(...arr((exact.body as { data?: unknown }).data));
      }
      const found = await this.dbp(`/languages/search/${encodeURIComponent(q)}`);
      if (found.status === 200) rows.push(...arr((found.body as { data?: unknown }).data));
      else if (found.status !== 404 && rows.length === 0) throw upstreamFailed();
      const byCode = new Map<string, { code: string; name: string; autonym?: string; bibles: number }>();
      for (const r of rows) {
        const code = typeof r['iso'] === 'string' ? r['iso'] : '';
        if (!/^[a-z]{3}$/.test(code)) continue;
        const bibles = Number(r['bibles'] ?? 0) || 0;
        const seen = byCode.get(code);
        if (seen) {
          seen.bibles = Math.max(seen.bibles, bibles);
          continue;
        }
        const autonym = typeof r['autonym'] === 'string' && r['autonym'] ? r['autonym'] : undefined;
        byCode.set(code, { code, name: String(r['name'] ?? code), ...(autonym ? { autonym } : {}), bibles });
      }
      const code = q.toLowerCase();
      return [...byCode.values()].filter((l) => l.bibles > 0)
        .sort((a, b) => Number(b.code === code) - Number(a.code === code) || b.bibles - a.bibles || (a.name < b.name ? -1 : 1))
        .slice(0, 50);
    });
  }

  /** Every fileset FCBH has timestamps for (`GET /timestamps`), cached a day. */
  private timestamped(): Promise<string[]> {
    return this.cached('timestamped', DAY, async () => {
      const r = await this.dbp('/timestamps');
      if (r.status !== 200) return [];
      const list = Array.isArray(r.body) ? r.body : arr((r.body as { data?: unknown })?.data);
      return (list as unknown[]).map((x) => (typeof x === 'string' ? x : (x as { fileset_id?: unknown })?.fileset_id)).filter((x): x is string => typeof x === 'string');
    });
  }

  private async summaryOf(b: Record<string, unknown>, stamped: Set<string>): Promise<BibleSummary | null> {
    const bibleId = typeof b['abbr'] === 'string' ? b['abbr'] : '';
    if (!ID.test(bibleId)) return null;
    const { text, audio } = chooseFilesets(allFilesets(b['filesets']));
    return {
      bibleId,
      name: String(b['name'] ?? b['vname'] ?? bibleId),
      abbreviation: abbreviationOf(bibleId),
      language: String(b['iso'] ?? ''),
      languageName: String(b['language'] ?? b['iso'] ?? ''),
      text,
      audio,
      timestamps: { OT: !!audio.OT && stamped.has(audio.OT), NT: !!audio.NT && stamped.has(audio.NT) }
    };
  }

  private async bibles(lang: string): Promise<BibleSummary[]> {
    if (!/^[a-z]{3}$/.test(lang)) throw new Answer(400, 'Name a language by its ISO 639-3 code (fra).');
    return this.cached(`bibles/${lang}`, DAY, async () => {
      const stamped = new Set(await this.timestamped());
      const out: BibleSummary[] = [];
      for (let page = 1; page <= 5; page++) {
        const r = await this.dbp('/bibles', { language_code: lang, limit: '100', page: String(page) });
        if (r.status === 404) break;
        if (r.status !== 200) throw upstreamFailed();
        const body = r.body as { data?: unknown; meta?: { pagination?: { last_page?: number; total_pages?: number } } };
        for (const b of arr(body.data)) {
          const s = await this.summaryOf(b, stamped);
          if (s && (s.text.OT || s.text.NT || s.audio.OT || s.audio.NT)) out.push(s);
        }
        const last = Number(body.meta?.pagination?.last_page ?? body.meta?.pagination?.total_pages ?? 1);
        if (page >= last) break;
      }
      return out;
    });
  }

  private async bible(bibleId: string): Promise<BibleDetail> {
    return this.cached(`bible/${bibleId}`, DAY, async () => {
      const data = await this.dbpData(`/bibles/${encodeURIComponent(bibleId)}`);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw notFound();
      const b = data as Record<string, unknown>;
      const summary = await this.summaryOf({ ...b, abbr: b['abbr'] ?? bibleId }, new Set(await this.timestamped()));
      if (!summary) throw notFound();
      // FCBH marks the deuterocanon 'AP'; it is listed with the Old Testament.
      const listed = arr(b['books']).flatMap((x) => {
        const book = String(x['book_id'] ?? '');
        const chapters = Array.isArray(x['chapters']) ? (x['chapters'] as unknown[]).filter((c) => Number.isInteger(Number(c))).length : 0;
        if (!BOOK.test(book) || chapters === 0) return [];
        return [{ book, name: String(x['name'] ?? book), chapters, testament: (x['testament'] === 'NT' ? 'NT' : 'OT') as Testament, raw: x['testament'] }];
      });
      const books = listed.map(({ raw: _raw, ...x }) => x);
      // Probe with a book the testament's fileset surely has (not the deuterocanon).
      const firstOf = (t: Testament) => listed.find((x) => x.raw === t)?.book;
      const allowed = async (sets: Testaments) => {
        const ids = (['OT', 'NT'] as const).flatMap((t) => (sets[t] ? [[sets[t]!, t] as const] : []));
        if (ids.length === 0) return false;
        for (const [id, t] of ids) {
          const book = firstOf(t);
          if (!book || !(await this.offlineAllowed(id, book, 1))) return false;
        }
        return true;
      };
      const pick = (sets: Testaments) => sets.NT ?? sets.OT;
      const [textCopy, audioCopy] = await Promise.all([pick(summary.text), pick(summary.audio)].map((id) => (id ? this.copyright(id) : Promise.resolve(undefined))));
      return {
        ...summary,
        books,
        copyright: { ...(textCopy ? { text: textCopy } : {}), ...(audioCopy ? { audio: audioCopy } : {}) },
        offline: { text: await allowed(summary.text), audio: await allowed(summary.audio) }
      };
    });
  }

  private copyright(fileset: string): Promise<string | undefined> {
    return this.cached(`copyright/${fileset}`, DAY, async () => {
      const r = await this.dbp(`/bibles/filesets/${encodeURIComponent(fileset)}/copyright`);
      if (r.status !== 200) return undefined;
      const c = (r.body as { copyright?: { copyright?: unknown } })?.copyright?.copyright;
      return typeof c === 'string' && c.trim() ? c.trim() : undefined;
    }).then((v) => v ?? undefined);
  }

  /**
   * Whether `/download` answers for our key, probed once per fileset (with the
   * chapter at hand) and cached a day. Only a refusal (401/403) says no; a
   * missing chapter says nothing about the fileset.
   */
  private async offlineAllowed(fileset: string, book: string, chapter: number): Promise<boolean> {
    const known = await this.knownOffline(fileset);
    if (known !== undefined) return known;
    const r = await this.dbp(`/download/${encodeURIComponent(fileset)}/${book}/${chapter}`);
    if (r.status === 200) return this.rememberOffline(fileset, true);
    if (r.status === 401 || r.status === 403) return this.rememberOffline(fileset, false);
    return false;
  }

  private async knownOffline(fileset: string): Promise<boolean | undefined> {
    const cache = this.deps.cache;
    if (!cache) return undefined;
    const hit = await cache.match(new Request(`${CACHE_ROOT}/offline/${fileset}`)).catch(() => undefined);
    return hit ? Boolean(await hit.json()) : undefined;
  }

  private async rememberOffline(fileset: string, allowed: boolean): Promise<boolean> {
    return this.cached(`offline/${fileset}`, DAY, async () => allowed);
  }

  private text(fileset: string, book: string, chapter: number) {
    return this.cached(`text/${fileset}/${book}/${chapter}`, DAY, async () => {
      const verses = versesOf(await this.dbpData(`/bibles/filesets/${encodeURIComponent(fileset)}/${book}/${chapter}`));
      if (verses.length === 0) throw notFound('Bible Brain has no text for this chapter.');
      return verses;
    });
  }

  private timestamps(fileset: string, book: string, chapter: number) {
    return this.cached(`timestamps/${fileset}/${book}/${chapter}`, DAY, async () => {
      const r = await this.dbp(`/timestamps/${encodeURIComponent(fileset)}/${book}/${chapter}`);
      if (r.status === 404) return null;
      if (r.status !== 200) throw upstreamFailed();
      const rows = arr((r.body as { data?: unknown })?.data).flatMap((x) => {
        const verse = Number(x['verse_start']);
        const seconds = Number(x['timestamp']);
        return Number.isInteger(verse) && Number.isFinite(seconds) ? [{ verse, seconds }] : [];
      });
      return rows.length ? rows : null;
    });
  }

  private audio(fileset: string, book: string, chapter: number) {
    type Audio = { url: string; durationMs?: number; bytes?: number; expiresAt: string; offline: boolean };
    return this.cached<Audio>(`audio/${fileset}/${book}/${chapter}`, (a) => Math.min(AUDIO_TTL, Math.floor((Date.parse(a.expiresAt) - this.now()) / 1000) - 3600), async () => {
      const path = `${encodeURIComponent(fileset)}/${book}/${chapter}`;
      let row: Record<string, unknown> | undefined;
      let offline = false;
      // Whether /download is allowed is learnt from the request itself the first time.
      const known = await this.knownOffline(fileset);
      if (known !== false) {
        const r = await this.dbp(`/download/${path}`);
        if (r.status === 200) {
          row = arr((r.body as { data?: unknown })?.data)[0];
          offline = true;
          if (known === undefined) await this.rememberOffline(fileset, true);
        } else if (r.status === 401 || r.status === 403) {
          await this.rememberOffline(fileset, false);
        }
      }
      if (!row) {
        offline = false;
        row = arr(await this.dbpData(`/bibles/filesets/${path}`))[0];
      }
      if (!row) throw notFound('Bible Brain has no audio for this chapter.');
      const url = mediaLink(row['path'], this.key);
      if (!url) throw notFound('Bible Brain has no audio file for this chapter that can be passed on.');
      const duration = Number(row['duration']);
      const bytes = Number(row['filesize_in_bytes']);
      return {
        url,
        ...(Number.isFinite(duration) && duration > 0 ? { durationMs: Math.round(duration * 1000) } : {}),
        ...(Number.isFinite(bytes) && bytes > 0 ? { bytes } : {}),
        expiresAt: new Date(expiryOf(url, this.now() + 6 * 3600_000)).toISOString(),
        offline
      };
    });
  }
}

const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : []);
