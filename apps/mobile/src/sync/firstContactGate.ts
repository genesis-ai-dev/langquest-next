import type { SupabaseTransport } from '@langquest-next/sync';

/**
 * The streams' transport until a local person's first contact (docs/nearby-sync-plan.md 14.1, 5
 * "Requests"). Only an Android phone holds a local person (firstContactGate.android.ts), so here
 * the transport is as it is.
 */
export function untilFirstContact(transport: SupabaseTransport): SupabaseTransport {
  return transport;
}

/** Here no local person ever holds the phone, so the gate never opens: nothing to be told. */
export function onGateOpen(_fn: () => void): () => void {
  return () => {};
}
