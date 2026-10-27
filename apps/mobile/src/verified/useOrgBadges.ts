// The blue checks of the organizations a screen shows (decisions.md 172), read
// from what the phone knows (orgBadges.ts) and asked of the server when stale.
import { useEffect, useSyncExternalStore } from 'react';
import { orgBadgeOf, orgBadgesVersion, refreshOrgBadges, subscribeOrgBadges, type OrgBadge } from './orgBadges';

export type { OrgBadge } from './orgBadges';

/** The blue check of one organization, or null. */
export function useOrgBadge(orgId: string | null | undefined): OrgBadge | null {
  useSyncExternalStore(subscribeOrgBadges, orgBadgesVersion);
  useEffect(() => { refreshOrgBadges([orgId]); }, [orgId]);
  return orgBadgeOf(orgId);
}

/** The blue checks of several organizations, by id. */
export function useOrgBadges(orgIds: readonly (string | null | undefined)[]): (orgId: string | null | undefined) => OrgBadge | null {
  useSyncExternalStore(subscribeOrgBadges, orgBadgesVersion);
  const key = orgIds.filter(Boolean).join('|');
  useEffect(() => { refreshOrgBadges(key ? key.split('|') : []); }, [key]);
  return orgBadgeOf;
}
