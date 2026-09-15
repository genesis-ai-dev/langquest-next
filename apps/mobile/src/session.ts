import {
  actorRole, adminScopeOf, effectiveRole, MANAGE_PRIVILEGES, privilegesFor, privilegesOfFixedRole,
  type OrgState, type Privilege, type ProjectState, type Role, type Scope
} from '@langquest-next/core';
import type { Edge, ScreenId } from './flow';

/**
 * Session facets derived from the folds (UX spec `domain/session.ts`), not
 * stored anywhere. Who you are is the union of your project membership (the
 * fixed role, kept for compatibility) and your org memberships whose scope
 * covers the open project (core `org.ts`). Screens ask `can(privilege)`;
 * the rest are conveniences derived from it.
 */
export interface Session {
  actorId: string;
  email: string | null;
  /** The fixed role this session amounts to (workflow steps and eligibility still speak Role). */
  role: Role | null;
  privileges: ReadonlySet<Privilege>;
  can: (p: Privilege) => boolean;
  /** Highest scope with a manage privilege: where Home goes (A34). */
  adminScope: Scope | null;
  /** Holds any manage privilege. */
  isAdmin: boolean;
  isWorker: boolean;
  isViewer: boolean;
  hasNoOrg: boolean;
  /** Has not yet accepted terms and seen the vision steps on this device. */
  isFirstTime: boolean;
  /** Not signed in at all (browsing public projects). */
  isGuest: boolean;
}

export function deriveSession(
  actorId: string,
  email: string | null,
  state: ProjectState | null,
  seenVision: boolean,
  org: OrgState | null = null,
  projectId?: string
): Session {
  const projectRole = state ? actorRole(state, actorId) : null;
  const privileges = new Set<Privilege>(projectRole ? privilegesOfFixedRole(projectRole) : []);
  if (org) for (const p of privilegesFor(org, actorId, projectId ? { projectId } : {})) privileges.add(p);
  const role = projectRole ?? effectiveRole(privileges);
  const isAdmin = MANAGE_PRIVILEGES.some((p) => privileges.has(p));
  const isWorker = privileges.has('translate') || privileges.has('review') || privileges.has('fill_reference');
  const isViewer = !isAdmin && !isWorker && privileges.has('view_status');
  let adminScope: Scope | null = org ? adminScopeOf(org, actorId) : null;
  if (!adminScope && projectRole === 'owner') adminScope = { level: 'org' };
  if (!adminScope && projectRole === 'coordinator' && projectId) adminScope = { level: 'project', projectId };
  return {
    actorId,
    email,
    role,
    privileges,
    can: (p) => privileges.has(p),
    adminScope,
    isAdmin,
    isWorker,
    isViewer,
    hasNoOrg: privileges.size === 0,
    isFirstTime: !seenVision,
    isGuest: actorId === 'guest'
  };
}

/**
 * UX spec `relevantFlowFor`: may this session take a gated edge? Each gate
 * is one privilege from the spec's catalog. Ungated edges are open to
 * anyone who can reach the from-screen.
 */
export function edgeAllowed(edge: Edge, s: Session): boolean {
  switch (edge.when) {
    case undefined: return true;
    case 'guest': return s.isGuest;
    case 'home': return edge.to === homeScreenFor(s);
    case 'translator': return s.can('translate');
    case 'fillReference': return s.can('fill_reference');
    case 'reviewer': return s.can('review');
    case 'assigner': return s.can('assign_work');
    case 'manageTemplates': return s.can('manage_templates');
    case 'manageReference': return s.can('manage_reference');
    case 'manageFlows': return s.can('manage_flows');
  }
}

/** UX spec `homeScreenFor` (A34): admins land on their scope's Manage home, viewers on Status, workers on My Work. */
export function homeScreenFor(s: Session): ScreenId {
  if (s.hasNoOrg) return 'intent_chooser';
  if (s.adminScope?.level === 'org') return 'org_home';
  if (s.adminScope?.level === 'project') return 'project_home';
  if (s.adminScope?.level === 'lane') return 'language_home';
  if (s.isViewer) return 'status_home';
  return 'assignments_home';
}

/** UX spec `postSignInScreen`: first-time users see terms, then vision. */
export function postSignInScreen(s: Session): ScreenId {
  return s.isFirstTime ? 'terms_privacy' : homeScreenFor(s);
}

/** Bottom tabs for signed-in users (spec: Home or My Work or Status, Status, Inbox, Settings). */
export function tabsFor(s: Session): ScreenId[] {
  const home = homeScreenFor(s);
  const tabs: ScreenId[] = [home];
  if (home !== 'status_home' && !s.hasNoOrg) tabs.push('status_home');
  tabs.push('inbox_home', 'settings_home');
  return tabs;
}
