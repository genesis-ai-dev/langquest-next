import type { Transport } from '@langquest-next/sync';

/**
 * Delivery of teammates' signed work (docs/nearby-sync-plan.md section 6) is a phone's only, as
 * Share nearby is (nearbyRelay.native.ts): the web shares nothing nearby (decision 58), so
 * here there is no relay and its transport has none.
 */
export const relayBatches: Transport['relay'] = undefined;
