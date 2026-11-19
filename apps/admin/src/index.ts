import { access, bearer } from './auth';
import { API_BASE, PAGE_PATH } from './paths';
import { ACTION_BYTES, youtubeCallback } from './youtube';
import { diagConnection, withDiag } from './db';
import type { Env } from './env';
import { page, SECURITY_HEADERS } from './page';
import { alertId, watchKeyOf } from './alertKinds';
import { LEVELS, settle, type Level, type Section } from './section';
import { cloudflareSection } from './sources/cloudflare';
import { diagSections, errorText, lookup, mediaType, PICTURE_SQL, SCREENSHOT_SQL, VOICE_SQL } from './sources/diag';
import { appStoreSection } from './sources/appstore';
import { expoSection } from './sources/expo';
import { googlePlaySection } from './sources/googleplay';
import { codeSection } from './sources/github';
import { videosSection } from './sources/videos';
import { fixesSection } from './sources/fixes';
import { nightlySection } from './sources/nightly';
import { supabaseSection } from './sources/supabase';
import { containerSection } from './sources/container';
import { expirySection } from './sources/expiry';
import { opsSections, orgDetail, type OpsSections } from './sources/ops';
import { releasesSection } from './sources/releases';
import { adoptionSection } from './sources/adoption';
import { pipelineSection } from './sources/pipeline';
import { capacitySection, storageSection } from './sources/storage';
import { detail, detailAsk, glance, history, isRange, PART_IDS, RANGES } from './sources/history';

/**
 * The ops dashboard (docs/admin.md, decisions.md 160): the page at
 * /ops-dashboard and its API at /ops/api/*, on app.langquest.org. This
 * Worker has no address of its own; the app's Worker hands it those paths
 * through its OPS service binding (apps/web/worker/ops.ts). Every API call
 * checks the sign-in first. The one write, POST /ops/api/actions, is passed
 * to the app Worker's OpsActions entrypoint with the person's token, which
 * checks it again and acts (decisions.md 162); this Worker writes nowhere.
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
  expo: (env) => expoSection(env),
  googleplay: (env) => googlePlaySection(env),
  appstore: (env) => appStoreSection(env),
  expiry: (env) => expirySection(env),
  storage: (env) => storageSection(env),
  capacity: (env) => capacitySection(env),
  releases: (env) => releasesSection(env),
  adoption: (env) => adoptionSection(env),
  pipeline: (env) => pipelineSection(env),
  container: (env) => containerSection(env),
  videos: (env) => videosSection(env),
  nightly: (env) => nightlySection(env)
};

/** The sections read as diag_reader in one connection, with what each says when that connection fails. */
const DIAG_IDS = ['jobs', 'clients', 'database', 'v2', 'feedback'] as const;
const OPS_IDS = ['fleet', 'safety', 'people', 'cron', 'dbdetail', 'push', 'worker', 'integrations', 'support', 'security', 'tutorials'] as const;

const unreachable = (e: unknown): Section => ({ state: 'error', alerts: [], error: `Could not reach the database as diag_reader: ${errorText(e)}`, checkedAt: new Date().toISOString() });

async function diagAnswer(env: Env): Promise<Record<string, Section>> {
  try { return { ...(await withDiag(diagConnection(env), diagSections)) }; }
  catch (e) { return Object.fromEntries(DIAG_IDS.map((id) => [id, unreachable(e)])); }
}

async function opsAnswer(env: Env): Promise<Record<string, Section>> {
  try { return { ...(await withDiag<OpsSections>(diagConnection(env), opsSections)) }; }
  catch (e) { return Object.fromEntries(OPS_IDS.map((id) => [id, unreachable(e)])); }
}

/**
 * Every section's alerts in one list, most urgent first: what the page's
 * "Needs attention" shows, as JSON for whatever reads it without the page
 * (docs/ops-dashboard-plan.md 5.1). `id` is the line's name for a pull
 * request that fixes it: "Fixes ops warning: <id>" (alertKinds.ts).
 */
export interface AttentionItem {
  level: Level; text: string; link?: string; section: string; key: string; id: string;
  /** Its key in the watch for user issues, which ties it to its Linear issue (alertKinds.ts watchKeyOf). */
  watchKey: string;
  /** Linear issues the line already names (a nightly failure's). */
  issues?: string[];
}

export async function attention(env: Env, fresh: boolean): Promise<{ checkedAt: string; urgent: number; problems: number; watch: number; items: AttentionItem[] }> {
  const [diag, ops, ...providers] = await Promise.all([
    diagAnswer(env), opsAnswer(env),
    ...Object.entries(PROVIDERS).map(([id, run]) => memo(id, fresh, () => settle(id, () => run(env))).then((s) => [id, s] as const))
  ]);
  const all: (readonly [string, Section])[] = [...Object.entries(diag), ...Object.entries(ops), ...(providers as (readonly [string, Section])[])];
  const items = all.flatMap(([section, s]) => [
    ...s.alerts.map((a): AttentionItem => ({ level: a.level, text: a.text, ...(a.link ? { link: a.link } : {}), section, key: a.key, id: alertId(a), watchKey: watchKeyOf(a), ...(a.issues?.length ? { issues: a.issues } : {}) })),
    ...(s.state === 'error' ? [{ level: 'watch' as const, text: `Could not read: ${s.error ?? 'unknown'}`, section, key: 'unreadable', id: alertId({ key: 'unreadable', subject: section }), watchKey: watchKeyOf({ key: 'unreadable', subject: section }) }] : [])
  ]).sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
  const count = (level: Level) => items.filter((i) => i.level === level).length;
  return { checkedAt: new Date().toISOString(), urgent: count('urgent'), problems: count('problem'), watch: count('watch'), items };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const acting = url.pathname === `${API_BASE}actions` && request.method === 'POST';
  if (request.method !== 'GET' && request.method !== 'HEAD' && !acting) return json({ error: 'Only GET' }, 405);
  if (url.pathname === PAGE_PATH || url.pathname.startsWith(PAGE_PATH + '/')) {
    const nonce = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
    return page({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY }, nonce);
  }
  // Only on `npm run admin:dev`: the binding never hands this Worker anything else.
  if (url.pathname === '/') return Response.redirect(new URL(PAGE_PATH, url).toString(), 302);
  if (!url.pathname.startsWith(API_BASE)) return json({ error: 'Not found' }, 404);

  if (env.ADMIN_RATE_LIMIT) {
    const { success } = await env.ADMIN_RATE_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'unknown' });
    if (!success) return json({ error: 'Too many requests; wait a minute.' }, 429);
  }
  // Google sends the person back here from Connect YouTube (decisions.md 180), without the page's token.
  if (url.pathname === `${API_BASE}youtube/callback`) return youtubeCallback(url);
  const who = await access(request, env);
  if (!who.ok) return json({ error: who.error, ...(who.need ? { need: who.need } : {}) }, who.status);

  if (acting) {
    if (!env.APP_ACTIONS) return json({ error: 'Actions are not connected here (APP_ACTIONS).' }, 503);
    const text = await request.text();
    if (text.length > ACTION_BYTES) return json({ error: 'Too large' }, 413);
    let body: unknown;
    try { body = JSON.parse(text); } catch { return json({ error: 'Not JSON' }, 400); }
    const done = await env.APP_ACTIONS.perform(bearer(request) ?? '', body);
    return done.ok ? json(done) : json({ error: done.error }, done.status);
  }
  const fresh = url.searchParams.get('fresh') === '1';
  const section = url.pathname.slice(API_BASE.length);
  // A part's numbers over a range of days, from the totals only (sources/history.ts, decisions.md 254).
  const range = url.searchParams.get('range');
  if (range !== null) {
    if (!PART_IDS.has(section)) return json({ error: 'Not found' }, 404);
    if (!isRange(range)) return json({ error: `range is one of ${RANGES.join(', ')}` }, 400);
    try {
      return json(await withDiag(diagConnection(env), (query) => history(query, section, range)));
    } catch (e) {
      return json({ error: errorText(e) }, 502);
    }
  }
  // The start page's 14 days of each section's number, in one call (decisions.md 254).
  if (section === 'glance') {
    try {
      return json(await withDiag(diagConnection(env), glance));
    } catch (e) {
      return json({ error: errorText(e) }, 502);
    }
  }
  // The raw rows behind one bucket of one number, 50 at a time, 90 days at most (sources/history.ts).
  const tapped = /^([a-z0-9_]{1,40})\/detail$/.exec(section);
  if (tapped) {
    if (!PART_IDS.has(tapped[1]!)) return json({ error: 'Not found' }, 404);
    const ask = detailAsk(tapped[1]!, url.searchParams);
    if ('error' in ask) return json(ask, 400);
    try {
      return json(await withDiag(diagConnection(env), (query) => detail(query, ask)));
    } catch (e) {
      return json({ error: errorText(e) }, 502);
    }
  }
  if (section === 'me') return json({ profileId: who.profileId });
  // The connection itself failing makes every section of the answer say so.
  if (section === 'diag') return json(await diagAnswer(env));
  if (section === 'ops') return json(await opsAnswer(env));
  if (section === 'attention') return json(await attention(env, fresh));
  const org = /^org\/([^/]{1,200})$/.exec(section);
  if (org) {
    try {
      return json(await withDiag(diagConnection(env), (query) => orgDetail(query, decodeURIComponent(org[1]!))));
    } catch (e) {
      return json(unreachable(e));
    }
  }
  if (section === 'lookup') {
    const q = (url.searchParams.get('q') ?? '').trim();
    if (!q || q.length > 254) return json({ error: 'Type an error code, an install id, an email or a name.' }, 400);
    try {
      return json(await withDiag(diagConnection(env), (query) => lookup(query, q)));
    } catch (e) {
      return json({ error: errorText(e) }, 502);
    }
  }
  // A feedback's screenshot, chosen picture or voice note, kept in the database; its type comes from its bytes, and anything else is refused.
  const file = /^feedback\/([^/]+)\/(screenshot|picture|voice)$/.exec(section);
  if (file) {
    if (!UUID.test(file[1]!)) return json({ error: 'Not a feedback id' }, 400);
    try {
      const bytes = await withDiag(diagConnection(env), (query) => query<Uint8Array | null>(file[2] === 'voice' ? VOICE_SQL : file[2] === 'picture' ? PICTURE_SQL : SCREENSHOT_SQL, [file[1]!]));
      if (!bytes) return json({ error: `No ${file[2]}` }, 404);
      const type = mediaType(bytes);
      if (!type || (file[2] === 'voice') !== type.startsWith('audio/')) return json({ error: 'Not a file this page shows' }, 415);
      return new Response(bytes, { headers: { 'content-type': type, 'cache-control': 'private, max-age=300', ...SECURITY_HEADERS } });
    } catch (e) {
      return json({ error: errorText(e) }, 502);
    }
  }
  // Pull requests that say which lines they fix, for each line's state (sources/fixes.ts).
  if (section === 'fixes') return json(await memo('fixes', fresh, () => settle('fixes', () => fixesSection(env))));
  const provider = PROVIDERS[section];
  if (provider) return json(await memo(section, fresh, () => settle(section, () => provider(env))));
  return json({ error: 'Not found' }, 404);
}

/**
 * A call that throws outside every section's own catch (the rate limiter, the
 * actions binding, reading the body) is answered and logged here, so it is
 * an error answer the page shows, not an uncaught exception that Cloudflare
 * counts as a failed request with no message.
 */
export async function guarded(request: Request, env: Env, run: typeof handle = handle): Promise<Response> {
  try {
    return await run(request, env);
  } catch (e) {
    console.error(`ops dashboard: ${request.method} ${new URL(request.url).pathname} threw: ${errorText(e)}`);
    return json({ error: `The ops dashboard could not answer: ${errorText(e)}` }, 502);
  }
}

export default {
  fetch: (request, env) => guarded(request, env)
} satisfies ExportedHandler<Env>;
