import {
  actorRole, adminScopeOf, effectiveRole, MANAGE_PRIVILEGES, privilegesFor, privilegesOfFixedRole,
  type OrgState, type Privilege, type ProjectState, type Role, type Scope
} from '@langquest-next/core';
import type { Edge, ScreenId } from './flow';

/**
 * Count inbox items: decisions on this actor's takes, plus (future) join
 * requests and notifications. Inbox tab appears only when this count > 0.
 */
export function deriveInboxCount(state: ProjectState | null, actorId: string): number {
  if (!state) return 0;
  let count = 0;
  for (const [takeId, take] of Object.entries(state.takes)) {
    if (take.actorId !== actorId) continue;
    const reviews = state.reviews[takeId] ?? {};
    for (const byActor of Object.values(reviews)) {
      count += Object.keys(byActor).length;
    }
  }
  return count;
}

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
  /** Not signed in; can create an account or scan an invitation. */
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

/**
 * Screens a signed-in session must never remain on: it has already done the
 * thing they exist for. `scan_qr` is not listed because
 * a signed-in member reaches it from `intent_chooser`.
 */
export const AUTH_SCREENS: ScreenId[] = ['sign_in', 'create_account'];

/**
 * Screens a signed-out session may legitimately occupy. Anywhere else means
 * the session ended under them, so they go back to `sign_in`. Kept in step
 * with the guest-gated edges by a test: every `guest` edge's endpoints must
 * appear here, so adding a guest screen without listing it fails.
 */
export const GUEST_SCREENS: ScreenId[] = ['sign_in', 'create_account', 'scan_qr'];

/** UX spec `postSignInScreen`: first-time users see terms, then vision. */
export function postSignInScreen(s: Session): ScreenId {
  return s.isFirstTime ? 'terms_privacy' : homeScreenFor(s);
}

/** Bottom tabs for signed-in users (spec: Home or My Work or Status, Status, Inbox, Settings). */
export function tabsFor(s: Session, inboxCount: number = 0): ScreenId[] {
  const home = homeScreenFor(s);
  const tabs: ScreenId[] = [home];
  if (home !== 'status_home' && !s.hasNoOrg) tabs.push('status_home');
  if (inboxCount > 0) tabs.push('inbox_home');
  tabs.push('settings_home');
  return tabs;
}
