import type { SupabaseTransport } from '@langquest-next/sync';
import { gated } from '../appVersion/syncGate';
import { supabaseTransport } from '../server/sync';

/** The transport every stream on this device syncs through, as whoever is signed in; it stops below the minimum version (decisions.md 154). */
export function serverTransport(): SupabaseTransport {
  return gated(supabaseTransport());
}
