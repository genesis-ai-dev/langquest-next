import { access } from './auth';
import { withDiag } from './db';
import type { Env } from './env';
import { page, SECURITY_HEADERS } from './page';
import { settle, type Section } from './section';
import { cloudflareSection } from './sources/cloudflare';
import { diagSections, errorText, lookup, SCREENSHOT_SQL } from './sources/diag';
import { expoSection } from './sources/expo';
import { codeSection } from './sources/github';
import { supabaseSection } from './sources/supabase';
import { vercelSection } from './sources/vercel';

/**
 * admin.langquest.org (docs/admin.md): the page, and its API for staff.
 * Every /api/* call checks the sign-in first; nothing here writes anywhere.
 */

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...SECURITY_HEADERS } });

/** A provider's answer, kept a minute per isolate so a few people reloading do not spend its rate limit; Refresh skips it. */
const kept = new Map<string, { until: number; value: Promise<Section> }>();
function memo(key: string, fresh: boolean, run: () => Promise<Section>): Promise<Section> {
  const hit = kept.get(key);
  if (!fresh && hit && hit.until > Date.now()) return hit.value;
  const value = run();
  kept.set(key, { until: Date.now() + 60_000, value });
  value.then((s) => { if (s.state === 'error') kept.delete(key); }, () => kept.delete(key));
  return value;
}

const PROVIDERS: Record<string, (env: Env) => Promise<Section>> = {
  code: (env) => codeSection(env),
  cloudflare: (env) => cloudflareSection(env),
  supabase: (env) => supabaseSection(env),
  vercel: (env) => vercelSection(env),
  expo: (env) => expoSection(env)
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'Only GET' }, 405);
  if (!url.pathname.startsWith('/api/')) {
    if (url.pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': 'text/plain' } });
    if (url.pathname === '/favicon.ico') return new Response(null, { status: 404 });
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    return page({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY }, nonce);
  }

  if (env.ADMIN_RATE_LIMIT) {
    const { success } = await env.ADMIN_RATE_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
    if (!success) return json({ error: 'Too many requests; wait a minute.' }, 429);
  }
  const who = await access(request, env);
  if (!who.ok) return json({ error: who.error, ...(who.profileId ? { profileId: who.profileId } : {}) }, who.status);

  const fresh = url.searchParams.get('fresh') === '1';
  const section = url.pathname.slice('/api/'.length);
  if (section === 'me') return json({ profileId: who.profileId });
  if (section === 'diag') {
    try {
      return json(await withDiag(env.DIAG_DATABASE_URL, diagSections));
    } catch (e) {
      // The connection itself failed: every diag section says so.
      const failed = { state: 'error', alerts: [], error: `Could not reach the database as diag_reader: ${errorText(e)}`, checkedAt: new Date().toISOString() };
      return json({ jobs: failed, clients: failed, database: failed, v2: failed, feedback: failed });
    }
  }
  if (section === 'lookup') {
    const q = (url.searchParams.get('q') ?? '').trim();
    if (!q || q.length > 120) return json({ error: 'Type an error code, an install id or a name.' }, 400);
    try {
      return json(await withDiag(env.DIAG_DATABASE_URL, (query) => lookup(query, q)));
    } catch (e) {
      return json({ error: errorText(e) }, 502);
    }
  }
  const shot = /^feedback\/([^/]+)\/screenshot$/.exec(section);
  if (shot) {
    if (!UUID.test(shot[1]!)) return json({ error: 'Not a feedback id' }, 400);
    try {
      const bytes = await withDiag(env.DIAG_DATABASE_URL, (query) => query<Uint8Array | null>(SCREENSHOT_SQL, [shot[1]!]));
      if (!bytes) return json({ error: 'No screenshot' }, 404);
      return new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=300', ...SECURITY_HEADERS } });
    } catch (e) {
      return json({ error: errorText(e) }, 502);
    }
  }
  const provider = PROVIDERS[section];
  if (provider) return json(await memo(section, fresh, () => settle(section, () => provider(env))));
  return json({ error: 'Not found' }, 404);
}

export default {
  fetch: (request, env) => handle(request, env)
} satisfies ExportedHandler<Env>;
