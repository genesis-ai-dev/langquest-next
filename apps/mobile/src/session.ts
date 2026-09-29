import {
  actorRole, adminScopeOf, effectiveRole, MANAGE_PRIVILEGES, privilegesFor, privilegesOfFixedRole,
  type OrgState, type Privilege, type ProjectState, type Role, type Scope
} from '@langquest-next/core';
import type { Edge, ScreenId } from './flow';

/**
 * Session facets derived from the folds (UX spec `domain/session.ts`), not
 * stored anywhere. Who you are is the union of your membership in the
 * org's work partition (the fixed role, kept for compatibility) and your org
 * memberships whose scope covers it (core `org.ts`). Screens ask
 * `can(privilege)`; the rest are conveniences derived from it.
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
  /** Has not been welcomed yet (ADR-022) on this account. */
  isFirstTime: boolean;
  /** Not signed in at all (browsing public listings). */
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
 * Demo `relevantFlowFor`: may this session take a gated edge? Each gate is
 * a permission, never the method (ADR-006). Ungated edges are open to
 * anyone who can reach the from-screen.
 */
export function edgeAllowed(edge: Edge, s: Session): boolean {
  switch (edge.when) {
    case undefined: return true;
    case 'guest': return s.isGuest;
    case 'home': return edge.to === homeScreenFor(s);
    case 'translator': return s.can('translate');
    case 'reviewer': return s.can('review');
    case 'contributor': return s.can('translate') || s.can('review');
    case 'asker': return s.can('send_to_reviewers') || s.can('assign_work');
    case 'assigner': return s.can('assign_work');
    case 'manageTemplates': return s.can('manage_templates');
    case 'manageReference': return s.can('manage_reference');
    case 'manageFlows': return s.can('manage_flows');
    case 'shapeTemplates': return s.can('shape_templates') || s.can('manage_templates');
  }
}

/**
 * Demo `homeScreenFor` (ADR-017): everyone who does or asks for work lands
 * on My Work, admins included; viewers on the progress overview; someone
 * with no organization on "What brings you here?".
 */
export function homeScreenFor(s: Session): ScreenId {
  if (s.hasNoOrg) return 'intent_chooser';
  if (s.isViewer) return 'status_home';
  return 'my_work';
}

/**
 * The screen behind the Manage tab: an admin's org or language home (demo
 * `manageHomeFor`). There is no project level (decision 34); a membership
 * scoped to the org's one work partition covers every language, so it opens
 * the organization.
 */
export function manageHomeFor(s: Session): ScreenId | null {
  if (s.adminScope?.level === 'org' || s.adminScope?.level === 'project') return 'org_home';
  if (s.adminScope?.level === 'lane') return 'language_home';
  return null;
}

/** The screen behind the Map tab: workers go straight to their language, everyone else to the overview. */
export function mapScreenFor(s: Session): ScreenId {
  return s.isWorker && !s.adminScope ? 'map_home' : 'status_home';
}

/**
 * Screens a signed-in session must never remain on: it has already done the
 * thing they exist for. `explore_home` and `scan_qr` are not listed, because
 * a signed-in member reaches both from `intent_chooser`.
 */
export const AUTH_SCREENS: ScreenId[] = ['sign_in', 'create_account'];

/**
 * Screens a signed-out session may legitimately occupy. Anywhere else means
 * the session ended under them, so they go back to `sign_in`. Kept in step
 * with the guest-gated edges by a test: every `guest` edge's endpoints must
 * appear here, so adding a guest screen without listing it fails.
 */
export const GUEST_SCREENS: ScreenId[] = ['sign_in', 'create_account', 'explore_home', 'scan_qr', 'terms_privacy'];

/** Demo `postSignInScreen`: a first sign-in gets the welcome (ADR-022), unless there is no org to welcome you to yet. */
export function postSignInScreen(s: Session): ScreenId {
  return s.isFirstTime && !s.hasNoOrg ? 'welcome' : homeScreenFor(s);
}

export type TabId = 'work' | 'map' | 'manage' | 'inbox' | 'settings';

export interface Tab {
  id: TabId;
  screen: ScreenId;
  label: string;
  badge?: number;
}

/** NAV-1: My Work (with its For you count), Map, Manage (admins only), Inbox (unread), Settings. */
export function tabsFor(s: Session, counts: { forYou: number; unread: number } = { forYou: 0, unread: 0 }): Tab[] {
  const tabs: Tab[] = [];
  if (homeScreenFor(s) === 'my_work') tabs.push({ id: 'work', screen: 'my_work', label: 'My Work', badge: counts.forYou });
  tabs.push({ id: 'map', screen: mapScreenFor(s), label: 'Map' });
  const manage = manageHomeFor(s);
  if (manage) tabs.push({ id: 'manage', screen: manage, label: 'Manage' });
  tabs.push({ id: 'inbox', screen: 'inbox_home', label: 'Inbox', badge: counts.unread });
  tabs.push({ id: 'settings', screen: 'settings_home', label: 'Settings' });
  return tabs;
}
