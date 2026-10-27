import { SupabaseTransport } from '@langquest-next/sync';
import { supabase } from './supabase';

/** The transport as whoever is signed in, before the app's own gate (sync/serverTransport.ts). */
export function supabaseTransport(): SupabaseTransport {
  return new SupabaseTransport(supabase);
}
