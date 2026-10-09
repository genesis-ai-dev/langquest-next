import type { ResponseCache } from './bible';

/**
 * `GET /api/languoids`: every language and region, in the shape the
 * language explorer reads (apps/mobile/public/languages.html, served at
 * /languages; docs/languoids.md). It is public reference data, built from
 * Glottolog, so no sign-in is needed. The database builds it in one call
 * (`languoid_explorer`); the answer is cached for an hour under our own URL,
 * since it changes only when a Glottolog release is loaded.
 */

const CACHE_KEY = 'https://languoid-cache.langquest.internal/v1/explorer';
const HOUR = 3600;

export interface LanguoidDeps {
  /** The explorer's tables, from `languoid_explorer()` with the service role. */
  load(): Promise<unknown>;
  cache?: ResponseCache | null;
  waitUntil?: (p: Promise<unknown>) => void;
}

const json = (status: number, body: string, cacheControl: string) =>
  new Response(body, { status, headers: { 'content-type': 'application/json', 'cache-control': cacheControl } });

export async function handleLanguoids(request: Request, deps: LanguoidDeps): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return json(405, JSON.stringify({ error: 'Only GET is supported.' }), 'no-store');
  }
  const key = new Request(CACHE_KEY);
  const hit = deps.cache ? await deps.cache.match(key).catch(() => undefined) : undefined;
  if (hit) return json(200, await hit.text(), `public, max-age=${HOUR / 4}`);
  let body: string;
  try {
    body = JSON.stringify(await deps.load());
  } catch {
    return json(502, JSON.stringify({ error: 'The language list could not be read just now. Try again.' }), 'no-store');
  }
  if (deps.cache) {
    const put = deps.cache.put(key, json(200, body, `max-age=${HOUR}`)).catch(() => undefined);
    if (deps.waitUntil) deps.waitUntil(put);
    else await put;
  }
  return json(200, body, `public, max-age=${HOUR / 4}`);
}
