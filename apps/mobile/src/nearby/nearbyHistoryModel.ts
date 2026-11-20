import type { LocalEvent } from '@langquest-next/sync';

/**
 * Where a row still `nearby` came from, for a record's History (docs/nearby-sync-plan.md 5.8):
 * the person whose phone sent it, by its install key and `nearbyNames`, and whether it came by
 * claim, which the Worker has said the server holds. Read from row status, since the fold does
 * not know. A History entry carries its author and clock, not its event's id, so rows are found
 * by those two.
 */
export interface NearbyOrigin {
  /** The person whose phone sent it; null when this phone cannot put a name to that key. */
  from: string | null;
  claim: boolean;
}

export const originKey = (actorId: string, hlc: string) => `${actorId}\n${hlc}`;

export function originsOf(rows: readonly LocalEvent[], names: ReadonlyMap<string, string>): Map<string, NearbyOrigin> {
  const out = new Map<string, NearbyOrigin>();
  for (const { event, status, via } of rows) {
    if (status !== 'nearby' || !via) continue;
    const key = 'batch' in via ? via.key : via.claim.key;
    out.set(originKey(event.actorId, event.hlc), { from: names.get(key) ?? null, claim: 'claim' in via });
  }
  return out;
}

/** The History line's catalog key, or null for an entry that did not come that way. */
export function originWords(o: NearbyOrigin | null) {
  if (!o) return null;
  if (o.claim) return o.from ? 'nearby.history.claim' : 'nearby.history.claimUnknown';
  return o.from ? 'nearby.history.nearby' : 'nearby.history.nearbyUnknown';
}
