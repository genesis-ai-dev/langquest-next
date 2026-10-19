import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { OrgSnapshot } from './orgSnapshot';
import type { JobRunner } from './jobs';

export interface Env {
  ASSETS: Fetcher;
  ORG_SNAPSHOTS: DurableObjectNamespace<OrgSnapshot>;
  /** The job runner (jobs.ts, decisions.md 140): one object per server job, started by the cron. */
  JOBS: DurableObjectNamespace<JobRunner>;
  /** Recordings and guide media (blobs.ts, decisions.md 69). */
  BLOBS: R2Bucket;
  /** Per-address limit on the device endpoints, which anyone may call (agent/http.ts). */
  DEVICE_RATE_LIMIT?: RateLimit;
  /** Per-address limit on review links (agent/links.ts), generous because a WhatsApp group may share one address. */
  LINK_RATE_LIMIT?: RateLimit;
  SUPABASE_URL: string;
  /**
   * Where the job container reaches the database when that differs from the
   * Worker's address: local development, where the Worker runs on the host
   * and the container in Docker (a var in the local config copy,
   * scripts/web-dev-vars.ts). Unset in production.
   */
  JOBS_SUPABASE_URL?: string;
  /** This Worker's own address, where the v2 import puts files (`/api/blobs`). A plain var per environment. */
  API_URL?: string;
  /** The same for the job container in local development (host.docker.internal), like JOBS_SUPABASE_URL. */
  JOBS_API_URL?: string;
  /**
   * "true" runs the v2 import from the job tick (docs/v2-import.md, decisions.md 140);
   * anything else leaves it off. A plain var: the switch Caleb's go-ahead set on GitHub.
   */
  V2_IMPORT_ENABLED?: string;
  /** Files the import copies at once (8 when unset). */
  V2_IMPORT_CONCURRENCY?: string;
  /** v2's publishable key, for reading v2 (secret, optional: `npm run secrets`). */
  V2_SUPABASE_ANON_KEY?: string;
  /** A read-only login on v2's database, for people's names (secret, optional: scripts/v2-access.sh, `npm run secrets`). */
  V2_DATABASE_URL?: string;
  /** The public key the app ships with; the connect page signs in with it (agent/connectPage.ts). */
  SUPABASE_ANON_KEY?: string;
  /** Reads every stream; never sent to the browser. */
  SUPABASE_SERVICE_ROLE_KEY: string;
  /**
   * Faith Comes By Hearing's Bible Brain key, for /api/bible/* (bible.ts).
   * Optional: deploys never wait for it (decision 51); the routes answer 503
   * until a person applies it. Never sent to a phone.
   */
  BIBLE_BRAIN_ACCESS_KEY?: string;
  /**
   * What the database's poke sends (migration 20261013120000_api_webhooks.sql,
   * decisions.md 101). Optional: without it pokes are refused and webhooks
   * wait for the cron, at most ten minutes.
   */
  WEBHOOK_POKE_SECRET?: string;
}

let shared: { url: string; key: string; client: SupabaseClient } | undefined;

/**
 * One client per isolate: it holds no session (persistSession off), only the
 * URL and key, so reusing it saves building one per call and lets
 * `getClaims` keep the signing keys it fetched.
 */
export function serviceClient(env: Env): SupabaseClient {
  if (shared?.url === env.SUPABASE_URL && shared.key === env.SUPABASE_SERVICE_ROLE_KEY) return shared.client;
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  shared = { url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY, client };
  return client;
}
