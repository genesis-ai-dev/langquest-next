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
    case 'contributor': return s.can('translate') || s.can('review');
    case 'asker': return s.can('send_to_reviewers') || s.can('assign_work');
    case 'assigner': return s.can('assign_work');
    case 'manageTemplates': return s.can('manage_templates');
    case 'manageReference': return s.can('manage_reference');
    case 'manageFlows': return s.can('manage_flows');
  }
}

/**
 * UX spec `homeScreenFor` (ADR-017): everyone who does or asks for work lands
 * on My Work, admins included; viewers have nothing to act on, so they land
 * on the progress overview. Admins reach their scope's home by the Manage tab.
 */
export function homeScreenFor(s: Session): ScreenId {
  if (s.hasNoOrg) return 'intent_chooser';
  if (s.isViewer) return 'status_home';
  return 'my_work';
}

/** UX spec `manageHomeFor`: the screen behind the Manage tab, or null for a non-admin. */
export function manageHomeFor(s: Session): ScreenId | null {
  if (s.adminScope?.level === 'org') return 'org_home';
  if (s.adminScope?.level === 'project') return 'project_home';
  // Decision 28: a stored language-scoped admin manages their project.
  if (s.adminScope?.level === 'lane') return 'project_home';
  return null;
}

/** UX spec `mapScreenFor`: workers go straight to their language, everyone else to the overview. */
export function mapScreenFor(s: Session): ScreenId {
  return s.isWorker && !s.adminScope ? 'map_home' : 'status_home';
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

export type TabId = 'work' | 'map' | 'manage' | 'inbox' | 'settings';
export interface Tab {
  id: TabId;
  screen: ScreenId;
  /** The spec's tab name; the bar is icons only, so this is the accessibility label. */
  label: string;
  badge?: number;
}

/** Screens that sit under the Map tab (spec `MAP_SCREENS`, plus the record's details). */
export const MAP_SCREENS: ScreenId[] = ['status_home', 'map_home', 'book_map', 'passage_record', 'version_detail', 'review_detail'];
export const MANAGE_HOMES: ScreenId[] = ['org_home', 'project_home'];

/**
 * Bottom tabs (UX spec `NAV_ITEMS`): My Work (only when it is home), Map,
 * Manage (admins), Inbox (always), Settings. No bar without an organization.
 */
export function tabsFor(s: Session, counts: { work?: number; inbox?: number } = {}): Tab[] {
  if (s.hasNoOrg) return [];
  const tabs: Tab[] = [];
  if (homeScreenFor(s) === 'my_work') tabs.push({ id: 'work', screen: 'my_work', label: 'My Work', badge: counts.work });
  tabs.push({ id: 'map', screen: mapScreenFor(s), label: 'Map' });
  const manage = manageHomeFor(s);
  if (manage) tabs.push({ id: 'manage', screen: manage, label: 'Manage' });
  tabs.push({ id: 'inbox', screen: 'inbox_home', label: 'Inbox', badge: counts.inbox });
  tabs.push({ id: 'settings', screen: 'settings_home', label: 'Settings' });
  return tabs;
}

/** Which tab a screen belongs to: an exact match, else Map for map screens, Manage for manage homes. */
export function activeTabFor(tabs: Tab[], screen: ScreenId): TabId | undefined {
  return tabs.find((t) => t.screen === screen)?.id
    ?? (MAP_SCREENS.includes(screen) ? 'map' : MANAGE_HOMES.includes(screen) ? 'manage' : undefined);
}
