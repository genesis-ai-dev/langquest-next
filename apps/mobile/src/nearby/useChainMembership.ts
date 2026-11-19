import type { LocalPerson } from '../server/localPerson';
import type { OrgHandle } from '../sync/useOrg';

/**
 * The organization as a local person's own phone sees it (docs/nearby-sync-plan.md 14.1, 5
 * "Membership"). Joining offline is Android only (useChainMembership.android.ts), so here there
 * is never a local person and the organization is as the fold has it.
 */
export function useChainMembership(org: OrgHandle, _orgId: string | null, _local: LocalPerson | null): OrgHandle {
  return org;
}
