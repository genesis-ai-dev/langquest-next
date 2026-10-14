import { SupabaseTransport } from '@langquest-next/sync';
import { supabase } from './supabase';

/** The transport every stream on this device syncs through, as whoever is signed in. */
export function serverTransport(): SupabaseTransport {
  return new SupabaseTransport(supabase);
}
