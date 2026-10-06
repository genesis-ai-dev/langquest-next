import { effectiveRole, privilegesFor, type OrgState } from './org';
import type { PartitionState } from './state';

/** Org-wide/partition grants participate in partition task and review derivation.
 * This is a view, never an event or a snapshot mutation. Explicit active
 * partition memberships retain their existing role, matching deriveSession.
 */
export function withOrgMembers(
  partition: PartitionState, org: OrgState, partitionId: string
): PartitionState {
  const members = { ...partition.members };
  let changed = false;
  for (const profileId of Object.keys(org.members)) {
    if (members[profileId] && !members[profileId]!.removed.value) continue;
    const broadMemberships = Object.fromEntries(Object.entries(org.members[profileId]!)
      .filter(([, member]) => member.scope.level !== 'lane'));
    const role = effectiveRole(privilegesFor({ ...org, members: {
      [profileId]: broadMemberships
    } }, profileId, { partitionId }));
    if (!role) continue;
    const membership = Object.values(org.members[profileId]!).find((m) => !m.removed.value);
    if (!membership) continue;
    changed = true;
    members[profileId] = {
      role: { ...membership.roleId, value: role },
      removed: { ...membership.removed, value: false }
    };
  }
  return changed ? { ...partition, members } : partition;
}
