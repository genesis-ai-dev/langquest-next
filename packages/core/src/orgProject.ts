import { effectiveRole, privilegesFor, type OrgState } from './org';
import type { ProjectState } from './state';

/** Org-wide/project grants participate in project task and review derivation.
 * This is a view, never an event or a snapshot mutation. Explicit active
 * project memberships retain their existing role, matching deriveSession.
 */
export function withOrgMembers(
  project: ProjectState, org: OrgState, projectId: string
): ProjectState {
  const members = { ...project.members };
  let changed = false;
  for (const profileId of Object.keys(org.members)) {
    if (members[profileId] && !members[profileId]!.removed.value) continue;
    const broadMemberships = Object.fromEntries(Object.entries(org.members[profileId]!)
      .filter(([, member]) => member.scope.level !== 'lane'));
    const role = effectiveRole(privilegesFor({ ...org, members: {
      [profileId]: broadMemberships
    } }, profileId, { projectId }));
    if (!role) continue;
    const membership = Object.values(org.members[profileId]!).find((m) => !m.removed.value);
    if (!membership) continue;
    changed = true;
    members[profileId] = {
      role: { ...membership.roleId, value: role },
      removed: { ...membership.removed, value: false }
    };
  }
  return changed ? { ...project, members } : project;
}
