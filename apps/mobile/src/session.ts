import {
  adminScopeOf, effectiveRole, MANAGE_PRIVILEGES, privilegesFor,
  type OrgState, type Privilege, type Role, type Scope
} from '@langquest-next/core';
import { isManagedEmail } from './accounts';
import { t } from './i18n';
import type { Edge, ScreenId } from './flow';

/**
 * Session facets derived from the organization's fold (UX spec
 * `domain/session.ts`), not stored anywhere. What you may do in the open
 * language is the union of your org-scope role, if any, and your role in
 * that language, if any (core `privilegesFor`). Screens ask
 * `can(privilege)`; the rest are conveniences derived from it.
 */
export interface Session {
  actorId: string;
  email: string | null;
  /** The fixed role these privileges amount to, for labels (core `effectiveRole`). */
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
  /**
   * A looked-after account (accounts.ts): no email of its own. What it may
   * do is still its role's; only helping others sign in needs an email
   * (decisions.md 67, docs/invites-and-accounts.md).
   */
  isManaged: boolean;
}

export function deriveSession(
  actorId: string,
  email: string | null,
  seenVision: boolean,
  org: OrgState | null = null,
  languageId?: string | null
): Session {
  const privileges = org ? privilegesFor(org, actorId, languageId ?? undefined) : new Set<Privilege>();
  const isManaged = isManagedEmail(email);
  const role = effectiveRole(privileges);
  const isAdmin = MANAGE_PRIVILEGES.some((p) => privileges.has(p));
  const isWorker = privileges.has('translate') || privileges.has('review') || privileges.has('fill_reference');
  const isViewer = !isAdmin && !isWorker && privileges.has('view_status');
  const adminScope: Scope | null = org ? adminScopeOf(org, actorId) : null;
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
    isGuest: actorId === 'guest',
    isManaged
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
 * `manageHomeFor`). Below the organization there are only languages
 * (decision 63).
 */
export function manageHomeFor(s: Session): ScreenId | null {
  if (s.adminScope?.level === 'org') return 'org_home';
  if (s.adminScope?.level === 'language') return 'language_home';
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

/**
 * Has enough arrived to route a signed-in person? The org must have synced
 * once this session (or found itself offline or refused): a copy of the org
 * already on this phone can predate a membership the server granted moments
 * ago, as when someone joins by invite on a phone that held the org for
 * another account, and routing on it sends a new member to "What brings you
 * here?" and past their welcome (LAN-11). The open language must be in
 * too, unless the server lists no organization for this person: they have no
 * language to sync, nothing more will come, and waiting would keep them on
 * Sign In for ever. A returning person is not held up: they are routed to
 * the home remembered from last time meanwhile.
 */
export function foldsSettled(orgSynced: boolean, languageLoaded: boolean, noOrganizations: boolean): boolean {
  return orgSynced && (languageLoaded || noOrganizations);
}

/** Demo `postSignInScreen`: a first sign-in gets the welcome (ADR-022), unless there is no org to welcome you to yet. */
export function postSignInScreen(s: Session): ScreenId {
  return s.isFirstTime && !s.hasNoOrg ? 'welcome' : homeScreenFor(s);
}

export type TabId = 'work' | 'map' | 'reports' | 'manage' | 'inbox' | 'me';

export interface Tab {
  id: TabId;
  screen: ScreenId;
  label: string;
  badge?: number;
}

/**
 * NAV-1, as the simple redesign has it (decision 71, demo ADR-032): Work,
 * Map, Manage (admins only), Me. People with a My Work get updates from its
 * bell instead of an Inbox tab (one place for what's next, ADR-029); viewers
 * keep the Inbox tab (unread). Work carries no count: My Work itself leads
 * with the next thing, and the bell carries the unread count. A wide window
 * adds Reports after Map for anyone who may view status (decisions.md 57);
 * a phone keeps the demo's tabs exactly.
 */
export function tabsFor(s: Session, counts: { forYou: number; unread: number } = { forYou: 0, unread: 0 }, opts: { wide?: boolean } = {}): Tab[] {
  const tabs: Tab[] = [];
  const hasMyWork = homeScreenFor(s) === 'my_work';
  if (hasMyWork) tabs.push({ id: 'work', screen: 'my_work', label: t('account.tabs.work') });
  tabs.push({ id: 'map', screen: mapScreenFor(s), label: t('account.tabs.map') });
  if (opts.wide && !s.hasNoOrg && s.can('view_status')) tabs.push({ id: 'reports', screen: 'reports_home', label: t('account.tabs.reports') });
  const manage = manageHomeFor(s);
  if (manage) tabs.push({ id: 'manage', screen: manage, label: t('account.tabs.manage') });
  if (!hasMyWork) tabs.push({ id: 'inbox', screen: 'inbox_home', label: t('account.tabs.inbox'), badge: counts.unread });
  tabs.push({ id: 'me', screen: 'settings_home', label: t('account.tabs.me') });
  return tabs;
}
