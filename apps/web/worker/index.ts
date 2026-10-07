import { handleApi } from './api';
import { r2Bucket } from './r2';
import { serviceClient, type Env } from './env';
import { publishLangQuestTimings } from './timings';

export { OrgSnapshot } from './orgSnapshot';

/** The dashboard's server: `/api/*` here, everything else is the built page. */
export default {
  async fetch(request, env, ctx) {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    return handleApi(request, {
      // Verified here against the project's signing keys when it has
      // asymmetric ones (the keys are fetched once and cached); otherwise
      // supabase-js asks Auth, as getUser did.
      profileOf: async (token) => {
        const { data, error } = await serviceClient(env).auth.getClaims(token);
        return error ? null : data?.claims.sub ?? null;
      },
      reports: (orgId, profileId, fresh) => env.ORG_SNAPSHOTS.get(env.ORG_SNAPSHOTS.idFromName(orgId)).reports(orgId, profileId, fresh),
      bible: { key: env.BIBLE_BRAIN_ACCESS_KEY, cache: caches.default, waitUntil: (p) => ctx.waitUntil(p) },
      blobs: {
        bucket: r2Bucket(env.BLOBS),
        serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
        mayUse: async (key, profileId, write) => {
          const { data, error } = await serviceClient(env).rpc('blob_access', { p_name: key, p_profile: profileId, p_write: write });
          if (error) throw new Error(`blob_access: ${error.message}`);
          return data === true;
        },
        record: async (orgId, streamId, hash, size) => {
          const { error } = await serviceClient(env).rpc('record_blob', { p_org: orgId, p_stream: streamId, p_hash: hash, p_size: size });
          if (error) throw new Error(`record_blob: ${error.message}`);
        }
      }
    });
  },
  // Verse timings asked for LangQuest's own sources, published when fia-align finishes them (worker/timings.ts).
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(publishLangQuestTimings(serviceClient(env)).then((r) => { if (r.jobs) console.log(`timings: ${r.published} of ${r.jobs} jobs published`); }));
  }
} satisfies ExportedHandler<Env>;
