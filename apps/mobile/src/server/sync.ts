import { SupabaseTransport, type Transport } from '@langquest-next/sync';
import { attestPulled } from './nearby';
import { supabase } from './supabase';

/**
 * The transport as whoever is signed in, before the app's own gate (sync/serverTransport.ts).
 * `SupabaseTransport` knows no Worker address, so the Worker's attestation of pulled work is
 * added here (docs/nearby-sync-plan.md 5.12, "The store"). Only a client with a nearby half
 * that holds a certificate for its organization calls it, which is the Android app alone.
 */
export function supabaseTransport(): SupabaseTransport & Required<Pick<Transport, 'attest'>> {
  return Object.assign(new SupabaseTransport(supabase), { attest: attestPulled });
}
