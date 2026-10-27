import { handleApi } from './api';
import type { OrgStub } from './agent/http';
import { supabaseAgentStore } from './agent/store';
import { sha256Hex } from './agent/tokens';
import { r2Bucket } from './r2';
import { serviceClient, type Env } from './env';
import { claimsVerifier, sessionLiveCheck } from './identity';
import { publishLangQuestTimings } from './timings';
import { runImports } from '../../../server/publisherImport';
import { RequestTally, routeClass } from './requestTally';
import { errorClassOf, jobRunSink, type JobRun } from '../../../server/jobRuns';
import { ownsResponse, withSecurityHeaders } from './securityHeaders';
import { liveSessions } from './liveSessions';
import { cachedBlobAccess, cachedGlobalViewerOn, cachedIdentityOf, cachedOrgsOf, MAX_ENTRIES, TtlCache, type Identity } from './isolateCache';
import type { TokenRecord } from './agent/store';
import { JOB_TICK, jobsDue } from './jobsModel';
import { checkStores, storeCheckDue } from './storeReleases';
import { isOpsPath, toOps } from './ops';
import { pokeInBatches } from './batches';

export { OrgSnapshot } from './orgSnapshot';
export { JobRunner } from './jobs';
export { JobStatus } from './jobStatus';
export { OpsActions } from './opsActions';

/**
 * A job tick: start each job due (jobsModel.ts jobsDue), never waiting for a
 * run. Its job run counts what started, what was found still running, what
 * is switched off and what could not start, and names the first failure.
 */
async function startJobs(env: Env, scheduledTime: number): Promise<JobRun> {
  const startedAt = Date.now();
  const n = { started: 0, running: 0, disabled: 0, failed: 0 };
  let firstError: unknown;
  await Promise.all(jobsDue(scheduledTime).map(({ key, all }) =>
    env.JOBS.get(env.JOBS.idFromName(key)).run(all ? { all } : {})
      .then((r) => { n[r] += 1; })
      .catch((e: unknown) => {
        n.failed += 1;
        firstError ??= e;
        console.error(`job ${key} did not start`, e);
      })));
  return {
    job: 'job_starts', startedAt, ms: Date.now() - startedAt, n,
    outcome: n.failed === 0 ? 'ok' : n.failed < n.started + n.running + n.disabled + n.failed ? 'partial' : 'error',
    ...(firstError ? { errorClass: errorClassOf(firstError) } : {})
  };
}

/** How long a schedule spends on imports: well inside a scheduled run's 15 minutes. */
const IMPORT_BUDGET_MS = 8 * 60_000;

/** Compared by digest, so the time taken says nothing about the secret. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(given), sha256Hex(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** This isolate's request counts (requestTally.ts), written as a job run at most once a minute. */
const tally = new RequestTally();

/** Write the tally when a minute has passed, after the response, never holding it up. */
function flushTally(env: Env, ctx: ExecutionContext): void {
  const run = tally.take();
  if (run) ctx.waitUntil(jobRunSink(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)(run));
}

/** One per isolate, so its answers outlive a request. */
let sessionLive: ((sessionId: string) => Promise<boolean>) | null = null;
/** This isolate's token and file-access caches (isolateCache.ts); an isolate's secrets do not change, so the first request's env serves them all. */
let identityOfCached: ((token: string) => Promise<Identity | null>) | null = null;
let globalViewerOnCached: ((profileId: string, aal: string | undefined) => Promise<boolean>) | null = null;
let orgsOfCached: ((profileId: string) => Promise<string[]>) | null = null;
const tokenCache = new TtlCache<TokenRecord>(MAX_ENTRIES);
let blobAccessCached: ((key: string, profileId: string, write: boolean, aal?: string) => Promise<boolean>) | null = null;

/** The app's Worker: `/api/*` here, everything else is the built page. */
export default {
  async fetch(request, env, ctx) {
    const route = routeClass(request.method, new URL(request.url).pathname);
    let response: Response;
    const began = Date.now();
    try {
      response = await serve(request, env, ctx);
    } catch (e) {
      if (route) tally.add(route, 500, Date.now() - began);
      flushTally(env, ctx);
      throw e;
    }
    if (route) tally.add(route, response.status, Date.now() - began);
    flushTally(env, ctx);
    // The built page gets its headers from the `_headers` file; what the Worker answers itself (the routes in
    // wrangler's run_worker_first) never passes through it, so it is given the same three here.
    return ownsResponse(new URL(request.url), request) ? withSecurityHeaders(response) : response;
  },
  // The Worker's crons (wrangler.jsonc). The job tick, every five minutes,
  // starts the server's heavy jobs in their container (jobs.ts, decisions.md
  // 141): the projection pass each time, the v2 import every 15 minutes. The
  // other, every ten, publishes verse timings asked for LangQuest's own
  // sources (worker/timings.ts), deletes expired device grants, catches up
  // webhooks, and once an hour records the app version live in the stores
  // (worker/storeReleases.ts). Each part's failure is caught on its own, so one does not stop
  // the others, and each tick leaves a job run (diag.jobs `job_starts`,
  // `worker_cron`) saying which failed and how.
  async scheduled(event, env, ctx) {
    if (event.cron === JOB_TICK) {
      ctx.waitUntil(startJobs(env, event.scheduledTime).then(jobRunSink(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)));
      flushTally(env, ctx);
      return;
    }
    const startedAt = Date.now();
    const n = { timingJobs: 0, timingsPublished: 0, timingsFailed: 0, importSteps: 0, importFailed: 0, grantCleanupFailed: 0, webhookOrgs: 0, webhookCatchupFailed: 0, storeVersions: 0, storeCheckFailed: 0, appleStatus: 0, applePageStatus: 0, appleFound: 0, appleSource: 0, playStatus: 0, playRedirected: 0, playFound: 0 };
    const errors: unknown[] = [];
    const failed = (key: keyof typeof n, what: string) => (e: unknown) => {
      n[key] = 1;
      errors.push(e);
      console.error(what, e);
    };
    const timings = publishLangQuestTimings(serviceClient(env)).then((r) => {
      n.timingJobs = r.jobs;
      n.timingsPublished = r.published;
      if (r.jobs) console.log(`timings: ${r.published} of ${r.jobs} jobs published`);
    }).catch(failed('timingsFailed', 'timings'));
    // Organizations' imports of their own material (decisions.md 173): a few minutes of steps, the rest at the next schedule.
    const imports = runImports(serviceClient(env), { fetch: (input, init) => fetch(input, init) }, IMPORT_BUDGET_MS).then((r) => {
      n.importSteps = r.steps;
      if (r.errors) throw new Error(`${r.errors} import step failed`);
    }).catch(failed('importFailed', 'imports'));
    // App requests for a token, a day after they lapsed: anyone may make one, so they must not pile up.
    const cleanup = supabaseAgentStore(serviceClient(env)).deleteGrantsExpiredBefore(new Date(Date.now() - 86_400_000).toISOString())
      .catch(failed('grantCleanupFailed', 'device grant cleanup'));
    // A poke the database lost, or never sent (no secret yet), waits at most this long (decisions.md 101).
    const catchUp = supabaseAgentStore(serviceClient(env)).webhookOrgs()
      .then((orgs) => {
        n.webhookOrgs = orgs.length;
        return pokeInBatches(orgs, (orgId) => env.ORG_SNAPSHOTS.get(env.ORG_SNAPSHOTS.idFromName(orgId)).webhookPoke(orgId));
      })
      .catch(failed('webhookCatchupFailed', 'webhook catch-up'));
    // Which app version is live in the stores, once an hour (storeReleases.ts, decisions.md 154).
    const stores = storeCheckDue(event.scheduledTime)
      ? checkStores(serviceClient(env)).then(({ live, counts, problems }) => {
          n.storeVersions = live.length;
          Object.assign(n, counts);
          if (problems.length) throw new Error(problems.join('; '));
        }).catch(failed('storeCheckFailed', 'store check'))
      : Promise.resolve();
    const run = Promise.all([timings, imports, cleanup, catchUp, stores]).then((): JobRun => ({
      job: 'worker_cron', startedAt, ms: Date.now() - startedAt, n,
      outcome: errors.length === 0 ? 'ok' : errors.length < 5 ? 'partial' : 'error',
      ...(errors.length ? { errorClass: errorClassOf(errors[0]) } : {})
    }));
    ctx.waitUntil(run.then(jobRunSink(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)));
    flushTally(env, ctx);
  }
} satisfies ExportedHandler<Env>;

/** Everything but the tally: `/api/*` here, everything else is the built page. */
async function serve(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  // The ops dashboard, a Worker of its own reached through the binding (ops.ts).
  if (isOpsPath(url.pathname)) return toOps(request, env.OPS);
  if (url.pathname === '/connect' && request.method === 'GET') {
    // The pages' words (about 195 KB of JSON) are read only when a page is asked for, not on every cold start.
    const [{ connectPage }, { pageLanguage }] = await Promise.all([import('./agent/connectPage'), import('./i18n/pages')]);
    return connectPage({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY ?? '' }, pageLanguage(request));
  }
  // A shared review link (agent/links.ts); the page checks the code with the API.
  const review = /^\/r\/([A-Za-z0-9_-]{22})\/?$/.exec(url.pathname);
  if (review && request.method === 'GET') {
    const [{ reviewPage }, { pageLanguage }] = await Promise.all([import('./agent/reviewPage'), import('./i18n/pages')]);
    return reviewPage(review[1]!, pageLanguage(request));
  }
  if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
  // The database says an organization's log moved (decisions.md 101); its object looks a few seconds later.
  if (url.pathname === '/api/internal/poke' && request.method === 'POST') {
    if (!env.WEBHOOK_POKE_SECRET || !(await sameSecret(request.headers.get('x-poke-secret') ?? '', env.WEBHOOK_POKE_SECRET))) return new Response(null, { status: 401 });
    const orgId = ((await request.json().catch(() => null)) as { orgId?: unknown } | null)?.orgId;
    if (typeof orgId !== 'string' || !orgId) return new Response(null, { status: 400 });
    ctx.waitUntil(env.ORG_SNAPSHOTS.get(env.ORG_SNAPSHOTS.idFromName(orgId)).webhookPoke(orgId));
    return new Response(null, { status: 202 });
  }
  // Verified here against the project's signing keys when it has
  // asymmetric ones (the keys are fetched once and cached); otherwise
  // supabase-js asks Auth, as getUser did.
  // A session signed out since (a lost phone, a deleted account) no longer counts (liveSessions.ts).
  sessionLive ??= liveSessions(sessionLiveCheck(serviceClient(env)));
  // A verified token is remembered for up to a minute (decisions.md 121); its session is asked about every time (118).
  const identityOf = identityOfCached ??= cachedIdentityOf(claimsVerifier(serviceClient(env)), Date.now, (sessionId) => sessionLive!(sessionId));
  const profileOf = async (token: string) => (await identityOf(token))?.profileId ?? null;
  const recordBlob = async (orgId: string, streamId: string, hash: string, size: number) => {
    const { error } = await serviceClient(env).rpc('record_blob', { p_org: orgId, p_stream: streamId, p_hash: hash, p_size: size });
    if (error) throw new Error(`record_blob: ${error.message}`);
  };
  const orgObject = (orgId: string) => env.ORG_SNAPSHOTS.get(env.ORG_SNAPSHOTS.idFromName(orgId));
  const agentStore = supabaseAgentStore(serviceClient(env));
  return handleApi(request, {
    profileOf,
    orgsOf: (orgsOfCached ??= cachedOrgsOf((profileId) => agentStore.orgsOf(profileId))),
    reports: (orgId, profileId, fresh, everyLanguage) => orgObject(orgId).reports(orgId, profileId, fresh, everyLanguage),
    // A Global Viewer reads every organization's reports, on an aal2 session only (decisions.md 158).
    globalViewerOn: async (token) => {
      const who = await identityOf(token);
      if (!who) return false;
      globalViewerOnCached ??= cachedGlobalViewerOn(async (profileId) => {
        const { data, error } = await serviceClient(env).rpc('_gv_on', { p_profile: profileId, p_aal: 'aal2' });
        if (error) throw new Error(`_gv_on: ${error.message}`);
        return data === true;
      });
      return globalViewerOnCached(who.profileId, who.aal);
    },
    bible: { key: env.BIBLE_BRAIN_ACCESS_KEY, cache: caches.default, waitUntil: (p) => ctx.waitUntil(p) },
    languoids: {
      load: async () => {
        const { data, error } = await serviceClient(env).rpc('languoid_explorer');
        if (error) throw new Error(`languoid_explorer: ${error.message}`);
        return data;
      },
      cache: caches.default,
      waitUntil: (p) => ctx.waitUntil(p)
    },
    blobs: {
      bucket: r2Bucket(env.BLOBS),
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
      // Remembered per person, stream and mode for a minute (decisions.md 121).
      identityOf,
      // A Global Viewer reads only on aal2 (decisions.md 158), so the level goes with the question. Only
      // aal2 is sent: any other level answers as an unknown one does, and the call keeps working on a
      // database the Worker reaches before the migration that added p_aal.
      mayUse: blobAccessCached ??= cachedBlobAccess(async (key, profileId, write, aal) => {
        const { data, error } = await serviceClient(env).rpc('blob_access', {
          p_name: key, p_profile: profileId, p_write: write, ...(aal === 'aal2' ? { p_aal: aal } : {})
        });
        if (error) throw new Error(`blob_access: ${error.message}`);
        return data === true;
      }),
      record: recordBlob,
      tally: (step, status) => tally.add(step, status)
    },
    agent: {
      store: agentStore,
      tokenCache,
      waitUntil: (p) => ctx.waitUntil(p),
      profileOf,
      org: (orgId): OrgStub => {
        const object = orgObject(orgId);
        // Durable Object stubs wrap answers in RPC types; the values are plain data.
        const plain = <T>(p: Promise<unknown>) => p as Promise<T>;
        return {
          read: (grant, q) => plain(object.agentRead(orgId, grant, q, url.origin)),
          write: (grant, w) => plain(object.agentWrite(orgId, grant, w, url.origin)),
          access: (profileId) => plain(object.agentAccess(orgId, profileId)),
          spend: (key) => plain(object.agentSpend(orgId, key)),
          spendWrite: (key) => plain(object.agentSpendWrite(orgId, key)),
          linkOpen: (link) => plain(object.agentLinkOpen(orgId, link)),
          mayRevokeLink: (profileId, link) => plain(object.agentMayRevokeLink(orgId, profileId, link)),
          checkLink: (profileId, spec) => plain(object.agentCheckLink(orgId, profileId, spec)),
          linkInfo: (link) => plain(object.agentLinkInfo(orgId, link, url.origin)),
          linkReview: (link, input) => plain(object.agentLinkReview(orgId, link, input)),
          changes: (grant, languageId, after, limit) => plain(object.agentChanges(orgId, grant, languageId, after, limit)),
          scanWebhooks: () => plain(object.agentScanWebhooks(orgId)),
          webhooksEnded: (webhooks) => plain(object.agentWebhooksEnded(orgId, webhooks)),
          pingWebhook: (webhook) => plain(object.agentPingWebhook(orgId, webhook)),
          webhookDeliveries: (webhookId) => plain(object.agentWebhookDeliveries(orgId, webhookId))
        };
      },
      // Named by its hash like every file (decision 69); R2 checks the bytes against it.
      publicAllowed: async (req, what) => {
        const limiter = what === 'device' ? env.DEVICE_RATE_LIMIT : env.LINK_RATE_LIMIT;
        if (!limiter) return true;
        const { success } = await limiter.limit({ key: req.headers.get('cf-connecting-ip') ?? 'unknown' });
        return success;
      },
      saveVoiceNote: async (orgId, languageId, bytes, format) => {
        const hash = await sha256Hex(bytes);
        const { size } = await r2Bucket(env.BLOBS).put(`${orgId}/${languageId}/${hash}.${format}`, bytes, bytes.length, hash, format === 'm4a' ? 'audio/mp4' : 'audio/wav');
        await recordBlob(orgId, languageId, hash, size);
        return hash;
      }
    }
  });
}
