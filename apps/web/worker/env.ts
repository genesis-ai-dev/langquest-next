import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { OrgSnapshot } from './orgSnapshot';

export interface Env {
  ASSETS: Fetcher;
  ORG_SNAPSHOTS: DurableObjectNamespace<OrgSnapshot>;
  /** Recordings and guide media (blobs.ts, decisions.md 69). */
  BLOBS: R2Bucket;
  /** Per-address limit on the device endpoints, which anyone may call (agent/http.ts). */
  DEVICE_RATE_LIMIT?: RateLimit;
  /** Per-address limit on review links (agent/links.ts), generous because a WhatsApp group may share one address. */
  LINK_RATE_LIMIT?: RateLimit;
  SUPABASE_URL: string;
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
}

export function serviceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}
