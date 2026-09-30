import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { OrgSnapshot } from './orgSnapshot';

export interface Env {
  ASSETS: Fetcher;
  ORG_SNAPSHOTS: DurableObjectNamespace<OrgSnapshot>;
  SUPABASE_URL: string;
  /** Reads every partition; never sent to the browser. */
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export function serviceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}
