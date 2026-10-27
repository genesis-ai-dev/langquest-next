import {
  adminScopeOf, effectiveRole, MANAGE_PRIVILEGES, mayViewLanguage, privilegesFor, privilegesOfFixedRole,
  type OrgState, type Privilege, type Role, type Scope
} from '@langquest-next/core';
import { viewsAsGlobalViewer, type GlobalViewerAccess } from '../account/globalViewerModel';
import { isManagedEmail } from '../auth/accounts';
import { t } from '../i18n';
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
  /** `can`, for something done and kept: never for a read-only session, whatever its privileges show. */
  canChange: (p: Privilege) => boolean;
  /** Highest scope with a manage privilege: where Home goes (A34). */
  adminScope: Scope | null;
  /** Holds any manage privilege. */
  isAdmin: boolean;
  isWorker: boolean;
  isViewer: boolean;
  hasNoOrg: boolean;
  /** Has not been welcomed yet (ADR-022) on this account. */
  isFirstTime: boolean;
  /**
   * Came from LangQuest v2 with work to be welcomed back to: some of it
   * here, or on its way (demo ADR-043, welcomeBack.ts).
   */
  fromV2: boolean;
  /** Not signed in at all (browsing public listings). */
  isGuest: boolean;
  /**
   * A looked-after account (accounts.ts): no email of its own. What it may
   * do is still its role's; only helping others sign in needs an email
   * (decisions.md 67, docs/invites-and-accounts.md).
   */
  isManaged: boolean;
  /**
   * A Global Viewer whose access is on (decisions.md 158): every
   * organization, as a Viewer. Never an admin for it.
   */
  isGlobalViewer: boolean;
  /** Here only as a Global Viewer: no membership of their own in this organization. Read-only. */
  viewingAsGlobalViewer: boolean;
  /**
   * Nothing may be written: the organization's and the language's appends
   * refuse (readOnly.ts), whatever `can` says. `can` then says what the
   * screens may show, not what may be done.
   */
  readOnly: boolean;
}

/**
 * May this session see a language's report? A member by the role's reach
 * (RPT-016); a Global Viewer looking in may view every language (decisions.md 158).
 */
export function mayViewReports(s: Session, org: OrgState | null, languageId: string): boolean {
  return !org || s.readOnly || mayViewLanguage(org, s.actorId, languageId);
}

/** What doing the work takes, which a read-only session never offers. */
const WORK_PRIVILEGES: readonly Privilege[] = ['translate', 'review', 'fill_reference', 'send_to_reviewers'];

export function deriveSession(
  actorId: string,
  email: string | null,
  seenVision: boolean,
  org: OrgState | null = null,
  languageId?: string | null,
  fromV2 = false,
  globalViewer: GlobalViewerAccess | null = null
): Session {
  const own = org ? privilegesFor(org, actorId, languageId ?? undefined) : new Set<Privilege>();
  // A Global Viewer sees an organization they are not in as its admins do,
  // read-only (decision 158 amended): every screen shows what an admin's
  // shows, and nothing they try is written (readOnly.ts). The server lets
  // them read, and refuses anything they might write (may_emit).
  const viewing = viewsAsGlobalViewer(globalViewer, !!org?.org);
  const member = !!org && Object.values(org.members[actorId] ?? {}).some((m) => m.removed.value === false);
  const readOnly = viewing && !member;
  // An admin's view of the organization, without the privileges for doing its work (recording, reviewing,
  // notes, sending to reviewers): nothing done with those could be kept, so nothing offers them.
  const privileges = readOnly ? new Set([...privilegesOfFixedRole('owner')].filter((p) => !WORK_PRIVILEGES.includes(p))) : own;
  const isManaged = isManagedEmail(email);
  const role = effectiveRole(privileges);
  const isAdmin = MANAGE_PRIVILEGES.some((p) => privileges.has(p));
  const isWorker = privileges.has('translate') || privileges.has('review') || privileges.has('fill_reference');
  const isViewer = !isAdmin && !isWorker && privileges.has('view_status');
  const adminScope: Scope | null = readOnly ? { level: 'org' } : org ? adminScopeOf(org, actorId) : null;
  return {
    actorId,
    email,
    role,
    privileges,
    can: (p) => privileges.has(p),
    canChange: (p) => !readOnly && privileges.has(p),
    adminScope,
    isAdmin,
    isWorker,
    isViewer,
    hasNoOrg: privileges.size === 0,
    // The welcome is for joining a team; a Global Viewer only looking in gets none.
    isFirstTime: !seenVision && !readOnly,
    fromV2,
    isGuest: actorId === 'guest',
    isManaged,
    isGlobalViewer: globalViewer === 'on',
    viewingAsGlobalViewer: readOnly,
    readOnly
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
  // Looking in, read-only: the progress overview, not a My Work of nothing to do.
  if (s.readOnly) return 'status_home';
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

/**
 * Demo `postSignInScreen`: a first sign-in gets the welcome (ADR-022),
 * unless there is no org to welcome you to yet. Someone coming from v2 is
 * welcomed back to their work instead (ADR-043), organization or not: until
 * their work arrives, it says it is on its way, never "What brings you here?".
 */
export function postSignInScreen(s: Session): ScreenId {
  if (s.isFirstTime && s.fromV2) return 'welcome_back';
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
 * a phone keeps the demo's tabs exactly. A read-only session (a Global
 * Viewer looking in) has no Inbox: nothing ever arrives there for them
 * (decision 71 amended, decision 158).
 */
export function tabsFor(s: Session, counts: { forYou: number; unread: number } = { forYou: 0, unread: 0 }, opts: { wide?: boolean } = {}): Tab[] {
  const tabs: Tab[] = [];
  const hasMyWork = homeScreenFor(s) === 'my_work';
  if (hasMyWork) tabs.push({ id: 'work', screen: 'my_work', label: t('account.tabs.work') });
  tabs.push({ id: 'map', screen: mapScreenFor(s), label: t('account.tabs.map') });
  if (opts.wide && !s.hasNoOrg && s.can('view_status')) tabs.push({ id: 'reports', screen: 'reports_home', label: t('account.tabs.reports') });
  const manage = manageHomeFor(s);
  if (manage) tabs.push({ id: 'manage', screen: manage, label: t('account.tabs.manage') });
  if (!hasMyWork && !s.readOnly) tabs.push({ id: 'inbox', screen: 'inbox_home', label: t('account.tabs.inbox'), badge: counts.unread });
  tabs.push({ id: 'me', screen: 'settings_home', label: t('account.tabs.me') });
  return tabs;
}
