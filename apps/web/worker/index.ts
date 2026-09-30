import { handleApi } from './api';
import { serviceClient, type Env } from './env';

export { OrgSnapshot } from './orgSnapshot';

/** The dashboard's server: `/api/*` here, everything else is the built page. */
export default {
  async fetch(request, env) {
    if (!new URL(request.url).pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    return handleApi(request, {
      profileOf: async (token) => {
        const { data, error } = await serviceClient(env).auth.getUser(token);
        return error ? null : data.user?.id ?? null;
      },
      reports: (orgId, profileId, fresh) => env.ORG_SNAPSHOTS.get(env.ORG_SNAPSHOTS.idFromName(orgId)).reports(orgId, profileId, fresh)
    });
  }
} satisfies ExportedHandler<Env>;
