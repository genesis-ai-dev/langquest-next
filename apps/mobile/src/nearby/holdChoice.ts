import type { OrgState } from '@langquest-next/core';
import type { HoldChoice } from './nearbyModel';

/**
 * What this phone holds of teammates' recordings, where `openLanguage` reads it for
 * `LanguageSession` (docs/nearby-sync-plan.md 5.6, 5.12 "What a phone keeps"). A build with
 * no phone's files (the web) shares nothing nearby, so it holds whatever it is given and sheds
 * nothing: `{ hold: true }`. A phone's file (holdChoice.native.ts) answers what
 * `useNearbyIdentity` worked out, so sync never reads a disguise.
 */
export function currentHoldChoice(): HoldChoice | null {
  return { hold: true };
}

/** Only a phone's `useNearbyIdentity` keeps one. */
export function keepHoldChoice(_choice: HoldChoice): void {}

/** Only a phone's `useNearbyIdentity` keeps the organization for its nearby files. */
export function keepNearbyOrg(_orgId: string, _org: OrgState | null): void {}

export function nearbyOrg(_orgId: string): OrgState | null {
  return null;
}
