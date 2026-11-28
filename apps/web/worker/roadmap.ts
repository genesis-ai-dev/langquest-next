import { UI_LANGUAGES, type UiLanguage } from '@langquest-next/core';
import { roadmapItems, roadmapPage, UUID } from './roadmapPage';

/**
 * The public roadmap's three addresses (roadmapPage.ts, docs/roadmap.md): the page, an item's picture, and
 * what a reader sends. Anyone may send, signed out: a vote on an item with words and an email if they wrote
 * them, or a suggestion. Spam meets three limits: a per-address rate limit on the Worker (ROADMAP_RATE_LIMIT,
 * no address kept), a field people never see that only a script fills, and the database's cap on sends a day
 * (`ops_roadmap_send`).
 */

export interface RoadmapDeps {
  /** `ops_roadmap_list()`; throws when the database cannot be asked. */
  list(): Promise<unknown>;
  /** `ops_roadmap_picture(id)`: a data URL, or null. */
  picture(id: string): Promise<string | null>;
  /** `ops_roadmap_send(...)`: ok, not_found or full. */
  send(row: RoadmapSend): Promise<string>;
  /** Whether this address may send now. */
  allowed(request: Request): Promise<boolean>;
  language(request: Request): UiLanguage;
}

export interface RoadmapSend {
  item: string | null;
  importance: 0 | 1 | 2 | 3;
  words: string | null;
  email: string | null;
  language: UiLanguage;
}

export const WORDS_MAX = 2000;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const LANGUAGES = new Set<string>(UI_LANGUAGES.map((l) => l.code));
/** The longest body a send may have: the words, an email and a little JSON. */
export const BODY_MAX = 12_000;

/** What the page sent, checked: a send, `trap` when the hidden field was filled, or null. */
export function parseSend(input: unknown): RoadmapSend | 'trap' | null {
  if (typeof input !== 'object' || input === null) return null;
  const s = input as { item?: unknown; importance?: unknown; words?: unknown; email?: unknown; language?: unknown; website?: unknown };
  const item = s.item === null || s.item === undefined ? null : typeof s.item === 'string' && UUID.test(s.item) ? s.item : undefined;
  const words = s.words === undefined || s.words === null ? '' : typeof s.words === 'string' ? s.words.trim() : undefined;
  const email = s.email === undefined || s.email === null ? '' : typeof s.email === 'string' ? s.email.trim() : undefined;
  if (item === undefined || words === undefined || email === undefined || words.length > WORDS_MAX) return null;
  if (email && (email.length > 254 || !EMAIL.test(email))) return null;
  if (typeof s.importance !== 'number' || ![0, 1, 2, 3].includes(s.importance)) return null;
  if (typeof s.language !== 'string' || !LANGUAGES.has(s.language)) return null;
  // A suggestion is its words.
  if (item === null && !words) return null;
  if (typeof s.website === 'string' && s.website !== '') return 'trap';
  return { item, importance: s.importance as RoadmapSend['importance'], words: words || null, email: email || null, language: s.language as UiLanguage };
}

/** A picture kept as a data URL, as its bytes and type; null when it is not one. */
export function pictureBytes(dataUrl: string): { type: string; bytes: Uint8Array } | null {
  const m = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!m) return null;
  const raw = atob(m[2]!);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return { type: m[1]!, bytes };
}

const plain = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } });

/** Answers `/roadmap` and the paths under it; null for any other path. */
export async function handleRoadmap(request: Request, deps: RoadmapDeps): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname === '/roadmap' || url.pathname === '/roadmap/') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405);
    const language = deps.language(request);
    const data = await deps.list().then((d) => d, (e: unknown) => { console.error('ops_roadmap_list:', e instanceof Error ? e.message : String(e)); return undefined; });
    return roadmapPage(language, data === undefined ? null : roadmapItems(data));
  }
  const pic = /^\/roadmap\/p\/([0-9a-f-]{36})$/.exec(url.pathname);
  if (pic) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return plain(405);
    if (!UUID.test(pic[1]!)) return plain(404);
    const kept = await deps.picture(pic[1]!).catch(() => undefined);
    if (kept === undefined) return plain(503);
    const p = kept ? pictureBytes(kept) : null;
    if (!p) return plain(404);
    // The page asks for it by its version (?v=), so a changed picture has a new address.
    return new Response(p.bytes, { headers: { 'content-type': p.type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' } });
  }
  if (url.pathname === '/roadmap/send') {
    if (request.method !== 'POST') return plain(405);
    if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return plain(415);
    const text = await request.text();
    if (text.length > BODY_MAX) return plain(413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return plain(400); }
    const send = parseSend(body);
    if (!send) return plain(400);
    if (!(await deps.allowed(request))) return plain(429);
    // A script filled the field no person sees: it is told it worked, and nothing is kept.
    if (send === 'trap') return plain(204);
    const answer = await deps.send(send).catch((e: unknown) => { console.error('ops_roadmap_send:', e instanceof Error ? e.message : String(e)); return 'error'; });
    return plain(answer === 'ok' ? 204 : answer === 'not_found' ? 404 : answer === 'full' ? 429 : 503);
  }
  if (url.pathname.startsWith('/roadmap/')) return plain(404);
  return null;
}
