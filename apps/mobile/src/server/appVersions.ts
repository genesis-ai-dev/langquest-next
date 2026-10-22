import { supabase } from './supabase';

/** Per platform: the newest version live in its store, and the lowest version that may still sync (decisions.md 151). */
export function appVersions() {
  return supabase.rpc('app_versions');
}
