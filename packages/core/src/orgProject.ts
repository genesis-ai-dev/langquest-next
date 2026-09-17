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
  for (const profileId of Object.keys(org.members)) {
    if (members[profileId] && !members[profileId]!.removed.value) continue;
    const role = effectiveRole(privilegesFor(org, profileId, { projectId }));
    if (!role) continue;
    const membership = Object.values(org.members[profileId]!).find((m) => !m.removed.value);
    if (!membership) continue;
    members[profileId] = {
      role: { ...membership.roleId, value: role },
      removed: { ...membership.removed, value: false }
    };
  }
  return { ...project, members };
}
