import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { OrgSnapshot } from './orgSnapshot';

export interface Env {
  ASSETS: Fetcher;
  ORG_SNAPSHOTS: DurableObjectNamespace<OrgSnapshot>;
  SUPABASE_URL: string;
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
