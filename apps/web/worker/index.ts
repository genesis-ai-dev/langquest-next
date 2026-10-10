import { handleApi } from './api';
import { connectPage } from './agent/connectPage';
import { reviewPage } from './agent/reviewPage';
import { pageLanguage } from './i18n/pages';
import type { OrgStub } from './agent/http';
import { supabaseAgentStore } from './agent/store';
import { sha256Hex } from './agent/tokens';
import { r2Bucket } from './r2';
import { serviceClient, type Env } from './env';
import { publishLangQuestTimings } from './timings';

export { OrgSnapshot } from './orgSnapshot';

/** The dashboard's server: `/api/*` here, everything else is the built page. */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/connect' && request.method === 'GET') {
      return connectPage({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY ?? '' }, pageLanguage(request));
    }
    // A shared review link (agent/links.ts); the page checks the code with the API.
    const review = /^\/r\/([A-Za-z0-9_-]{22})\/?$/.exec(url.pathname);
    if (review && request.method === 'GET') return reviewPage(review[1]!, pageLanguage(request));
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    // Verified here against the project's signing keys when it has
    // asymmetric ones (the keys are fetched once and cached); otherwise
    // supabase-js asks Auth, as getUser did.
    const profileOf = async (token: string) => {
      const { data, error } = await serviceClient(env).auth.getClaims(token);
      return error ? null : data?.claims.sub ?? null;
    };
    const recordBlob = async (orgId: string, streamId: string, hash: string, size: number) => {
      const { error } = await serviceClient(env).rpc('record_blob', { p_org: orgId, p_stream: streamId, p_hash: hash, p_size: size });
      if (error) throw new Error(`record_blob: ${error.message}`);
    };
    const orgObject = (orgId: string) => env.ORG_SNAPSHOTS.get(env.ORG_SNAPSHOTS.idFromName(orgId));
    return handleApi(request, {
      profileOf,
      reports: (orgId, profileId, fresh) => orgObject(orgId).reports(orgId, profileId, fresh),
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
        mayUse: async (key, profileId, write) => {
          const { data, error } = await serviceClient(env).rpc('blob_access', { p_name: key, p_profile: profileId, p_write: write });
          if (error) throw new Error(`blob_access: ${error.message}`);
          return data === true;
        },
        record: recordBlob
      },
      agent: {
        store: supabaseAgentStore(serviceClient(env)),
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
            linkReview: (link, input) => plain(object.agentLinkReview(orgId, link, input))
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
  },
  // Verse timings asked for LangQuest's own sources, published when fia-align finishes them (worker/timings.ts).
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(publishLangQuestTimings(serviceClient(env)).then((r) => { if (r.jobs) console.log(`timings: ${r.published} of ${r.jobs} jobs published`); }));
    // App requests for a token, a day after they lapsed: anyone may make one, so they must not pile up.
    ctx.waitUntil(supabaseAgentStore(serviceClient(env)).deleteGrantsExpiredBefore(new Date(Date.now() - 86_400_000).toISOString())
      .catch((e: unknown) => console.error('device grant cleanup', e)));
  }
} satisfies ExportedHandler<Env>;
