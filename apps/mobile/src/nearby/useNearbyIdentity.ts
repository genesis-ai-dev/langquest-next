import type { OrgState } from '@langquest-next/core';

export interface NearbyIdentityProps {
  actorId: string;
  signedIn: boolean;
  orgId: string;
  /** This session has pulled the organization's stream at least once. */
  orgPulled: boolean;
  org: OrgState | null;
  languageId: string | null;
}

/**
 * A phone's nearby identity (docs/nearby-sync-plan.md 5.5, 5.10). Until phase 5 only Android
 * makes a key or asks for a certificate (useNearbyIdentity.android.ts); here there is nothing to
 * keep, and the hold choice is always `{ hold: true }` (holdChoice.ts).
 */
export function useNearbyIdentity(_props: NearbyIdentityProps): void {}
