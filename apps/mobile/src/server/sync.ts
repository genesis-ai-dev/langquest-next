import { SupabaseTransport, type Transport } from '@langquest-next/sync';
import { attestPulled } from './nearby';
import { relayBatches } from './nearbyRelay';
import { supabase } from './supabase';

/**
 * The transport as whoever is signed in, before the app's own gate (sync/serverTransport.ts).
 * `SupabaseTransport` knows no Worker address, so the Worker's attestation of pulled work and,
 * on Android, its relay of teammates' signed work are added here (docs/nearby-sync-plan.md 5.12,
 * "The store", and section 6). Only a client with a nearby half calls either, which is the
 * Android app alone.
 */
export function supabaseTransport(): SupabaseTransport & Required<Pick<Transport, 'attest'>> & Pick<Transport, 'relay'> {
  return Object.assign(new SupabaseTransport(supabase), { attest: attestPulled, relay: relayBatches });
}
