import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.EXPO_PUBLIC_SUPABASE_URL as string | undefined;
const anon = import.meta.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string | undefined;

/** Why this build cannot reach a server, or null when it can. Shown on screen, never thrown at import. */
export const configError: string | null = !url || !anon
  ? 'This build has no server configuration: EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY were not set when it was built.'
  : null;

export const supabase = createClient(url ?? 'https://unconfigured.invalid', anon ?? 'unconfigured', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
});
