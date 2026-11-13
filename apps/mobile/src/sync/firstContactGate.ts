import type { SupabaseTransport } from '@langquest-next/sync';

/**
 * The streams' transport until a local person's first contact (docs/nearby-sync-plan.md 14.1, 5
 * "Requests"). Only an Android phone holds a local person (firstContactGate.android.ts), so here
 * the transport is as it is.
 */
export function untilFirstContact(transport: SupabaseTransport): SupabaseTransport {
  return transport;
}
