import { handleApi } from './api';
import { connectPage } from './agent/connectPage';
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
      return connectPage({ supabaseUrl: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY ?? '' });
    }
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
          return {
            read: (grant, q) => object.agentRead(orgId, grant, q, url.origin),
            write: (grant, w) => object.agentWrite(orgId, grant, w, url.origin),
            access: (profileId) => object.agentAccess(orgId, profileId)
          } as OrgStub;
        },
        // Named by its hash like every file (decision 69); R2 checks the bytes against it.
        saveVoiceNote: async (orgId, languageId, bytes) => {
          const hash = await sha256Hex(bytes);
          const { size } = await r2Bucket(env.BLOBS).put(`${orgId}/${languageId}/${hash}.m4a`, bytes, bytes.length, hash, 'audio/mp4');
          await recordBlob(orgId, languageId, hash, size);
          return hash;
        }
      }
    });
  },
  // Verse timings asked for LangQuest's own sources, published when fia-align finishes them (worker/timings.ts).
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(publishLangQuestTimings(serviceClient(env)).then((r) => { if (r.jobs) console.log(`timings: ${r.published} of ${r.jobs} jobs published`); }));
  }
} satisfies ExportedHandler<Env>;
