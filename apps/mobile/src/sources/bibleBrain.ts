// Bible Brain through our Worker (docs/reference-material.md, "The Worker's
// Bible routes"). The key stays on the server; the phone sends the person's
// Supabase access token, as the reports client does. JSON answers that do
// not change (a chapter's text, FCBH's timestamps, a Bible's books) are kept
// on the device, so text keeps working offline once seen. Audio links expire
// and are never kept; their bytes go through offline.ts, and only when the
// Worker says the fileset may be kept.
//
// No React Native here: the cache and fetch are given, so tests run it
// against a small fake Worker.

type Testaments = { OT?: string; NT?: string };

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
  books: { book: string; name: string; chapters: number; testament: 'OT' | 'NT' }[];
  copyright: { text?: string; audio?: string };
  /** `/download` allowed for our key: phones may keep it. */
  offline: { text: boolean; audio: boolean };
}

export interface BibleLanguage { code: string; name: string; autonym?: string; bibles: number }
interface AudioLink { url: string; durationMs?: number; bytes?: number; expiresAt: string; offline: boolean }
type VerseText = [number, number, string];

/** Why an answer did not come: no connection, Bible Brain not set up on the server (or its routes not deployed), nothing there, or signed out. */
type BibleErrorKind = 'offline' | 'unavailable' | 'not_found' | 'signed_out' | 'failed';

export class BibleError extends Error {
  override name = 'BibleError';
  constructor(message: string, readonly kind: BibleErrorKind, readonly status: number | null = null) {
    super(message);
  }
}

/** A small key-value store for JSON text (AsyncStorage in the app, a Map in tests). */
export interface JsonCache {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

interface BibleBrainServer {
  /** The Worker's origin without a trailing slash; '' for the page's own origin. */
  baseUrl: string;
  token(): Promise<string | null>;
  fetch?: typeof fetch;
}

/** Every key this client writes starts with this, so a listing finds them. */
export const CACHE_PREFIX = 'biblebrain:';

/** A Bible's detail is asked again after this long when connected: FCBH may withdraw `/download`. */
const DETAIL_FRESH_MS = 24 * 60 * 60 * 1000;

export class BibleBrainClient {
  constructor(private readonly server: BibleBrainServer, private readonly cache: JsonCache, private readonly now: () => number = Date.now) {}

  private async ask<T>(path: string): Promise<T> {
    const token = await this.server.token();
    if (!token) throw new BibleError('Sign in again to reach Bible Brain.', 'signed_out', 401);
    let res: Response;
    try {
      res = await (this.server.fetch ?? fetch)(`${this.server.baseUrl}/api/bible/${path}`, { headers: { authorization: `Bearer ${token}` } });
    } catch {
      throw new BibleError('No connection.', 'offline');
    }
    const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
    if (res.status === 503) throw new BibleError('Bible Brain is not set up on the server yet.', 'unavailable', 503);
    if (res.status === 404) {
      // A route that is not deployed answers 404 without our JSON shape; an empty chapter answers with it.
      if (!body || typeof body !== 'object' || !('error' in body)) throw new BibleError('Bible Brain is not available on this server yet.', 'unavailable', 404);
      throw new BibleError(body.error ?? 'Not found.', 'not_found', 404);
    }
    if (res.status === 401 || res.status === 403) throw new BibleError('Sign in again to reach Bible Brain.', 'signed_out', res.status);
    if (!res.ok || !body) throw new BibleError(body?.error ?? `The server answered ${res.status}.`, 'failed', res.status);
    return body;
  }

  /** Kept answers first; a miss asks the Worker and keeps what it says. */
  private async kept<T>(key: string, path: string): Promise<T> {
    const hit = await this.cache.get(CACHE_PREFIX + key).catch(() => null);
    if (hit) {
      try { return (JSON.parse(hit) as { v: T }).v; } catch { /* a damaged entry is asked again */ }
    }
    const v = await this.ask<T>(path);
    await this.cache.set(CACHE_PREFIX + key, JSON.stringify({ v, at: this.now() })).catch(() => undefined);
    return v;
  }

  /** Ask the Worker when connected and keep the answer; offline, the last answer kept. */
  private async fresh<T>(key: string, path: string, maxAgeMs = 0): Promise<T> {
    const raw = await this.cache.get(CACHE_PREFIX + key).catch(() => null);
    let held: { v: T; at: number } | null = null;
    if (raw) { try { held = JSON.parse(raw); } catch { held = null; } }
    if (held && maxAgeMs > 0 && this.now() - held.at < maxAgeMs) return held.v;
    try {
      const v = await this.ask<T>(path);
      await this.cache.set(CACHE_PREFIX + key, JSON.stringify({ v, at: this.now() })).catch(() => undefined);
      return v;
    } catch (e) {
      if (held && e instanceof BibleError && (e.kind === 'offline' || e.kind === 'unavailable')) return held.v;
      throw e;
    }
  }

  languages(q: string): Promise<BibleLanguage[]> {
    return this.fresh<{ languages: BibleLanguage[] }>(`languages:${q.toLowerCase()}`, `languages?q=${encodeURIComponent(q)}`).then((r) => r.languages);
  }

  bibles(lang: string): Promise<BibleSummary[]> {
    return this.fresh<{ bibles: BibleSummary[] }>(`bibles:${lang}`, `bibles?lang=${encodeURIComponent(lang)}`).then((r) => r.bibles);
  }

  bible(bibleId: string): Promise<BibleDetail> {
    return this.fresh<{ bible: BibleDetail }>(`bible:${bibleId}`, `bibles/${encodeURIComponent(bibleId)}`, DETAIL_FRESH_MS).then((r) => r.bible);
  }

  /** The last detail this phone saw, without asking. */
  async keptBible(bibleId: string): Promise<BibleDetail | null> {
    const raw = await this.cache.get(`${CACHE_PREFIX}bible:${bibleId}`).catch(() => null);
    if (!raw) return null;
    try { return (JSON.parse(raw) as { v: { bible: BibleDetail } }).v.bible; } catch { return null; }
  }

  text(filesetId: string, book: string, chapter: number): Promise<VerseText[]> {
    return this.kept<{ verses: VerseText[] }>(textKey(filesetId, book, chapter), `text/${encodeURIComponent(filesetId)}/${book}/${chapter}`).then((r) => r.verses);
  }

  /** FCBH's verse starts for a chapter's audio; null when FCBH has none. Kept either way. */
  async timestamps(filesetId: string, book: string, chapter: number): Promise<{ verse: number; seconds: number }[] | null> {
    const key = `timestamps:${filesetId}:${book}:${chapter}`;
    try {
      return (await this.kept<{ rows: { verse: number; seconds: number }[] }>(key, `timestamps/${encodeURIComponent(filesetId)}/${book}/${chapter}`)).rows;
    } catch (e) {
      if (e instanceof BibleError && e.kind === 'not_found') {
        await this.cache.set(CACHE_PREFIX + key, JSON.stringify({ v: { rows: [] }, at: this.now() })).catch(() => undefined);
        return null;
      }
      throw e;
    }
  }

  /** A signed link to a chapter's MP3 (never kept: it expires). `offline` asks for a link through `/download`. */
  audio(filesetId: string, book: string, chapter: number, opts: { offline?: boolean } = {}): Promise<AudioLink> {
    return this.ask<AudioLink>(`audio/${encodeURIComponent(filesetId)}/${book}/${chapter}${opts.offline ? '?offline=1' : ''}`);
  }
}

export const textKey = (filesetId: string, book: string, chapter: number) => `text:${filesetId}:${book}:${chapter}`;

/** Plain words for a failure, for the reader's state line. */
export function bibleErrorText(e: unknown): string {
  if (e instanceof BibleError) {
    switch (e.kind) {
      case 'offline': return "You're offline, and this isn't on this device yet.";
      case 'unavailable': return "Bible Brain isn't available on this server yet.";
      case 'not_found': return 'Not in this Bible.';
      case 'signed_out': return 'Sign in again to reach Bible Brain.';
      default: return e.message;
    }
  }
  return 'Something went wrong. Try again.';
}
