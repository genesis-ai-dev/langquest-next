import { SupabaseTransport } from '@langquest-next/sync';
import { gated } from '../appVersion/syncGate';
import { supabase } from './supabase';

/** The transport every stream on this device syncs through, as whoever is signed in; it stops below the minimum version (decisions.md 151). */
export function serverTransport(): SupabaseTransport {
  return gated(new SupabaseTransport(supabase));
}
