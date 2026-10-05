import { handleApi } from './api';
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
      bible: { key: env.BIBLE_BRAIN_ACCESS_KEY, cache: caches.default, waitUntil: (p) => ctx.waitUntil(p) }
    });
  },
  // Verse timings asked for LangQuest's own sources, published when fia-align finishes them (worker/timings.ts).
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(publishLangQuestTimings(serviceClient(env)).then((r) => { if (r.jobs) console.log(`timings: ${r.published} of ${r.jobs} jobs published`); }));
  }
} satisfies ExportedHandler<Env>;
