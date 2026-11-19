import type { OrgState } from '@langquest-next/core';
import type { HoldChoice } from './nearbyModel';

/**
 * What this phone holds of teammates' recordings (docs/nearby-sync-plan.md 5.6, 5.12): kept
 * here by `useNearbyIdentity`, which runs from `SyncEffects` whatever screen is open, because a
 * phone back in town sheds at the end of a sync with Share nearby closed. Null until it has
 * been worked out, which sheds nothing.
 */
let choice: HoldChoice | null = null;

export function currentHoldChoice(): HoldChoice | null {
  return choice;
}

export function keepHoldChoice(next: HoldChoice): void {
  choice = next;
}

/**
 * The organization's fold as `useNearbyIdentity` last saw it, so a language session can ask what
 * this person may do there (may they review, may they write files) without a screen open. It
 * changes in place, so it is kept by reference.
 */
const orgs = new Map<string, OrgState>();

export function keepNearbyOrg(orgId: string, org: OrgState | null): void {
  if (org) orgs.set(orgId, org);
  else orgs.delete(orgId);
}

export function nearbyOrg(orgId: string): OrgState | null {
  return orgs.get(orgId) ?? null;
}
