import type { AnyEvent, EventEnvelope, EventType, Role } from './events';
import type { Hlc } from './hlc';
import type { Register } from './state';
import { validateEvent } from './validate';

/**
 * The organization partition (docs/flow-coverage-audit.md 5.A, 5.C).
 *
 * One extra partition per org, `projectId = ORG_PARTITION`, in the same log
 * with the same RPCs. It holds what must exist before a project does: the
 * org, its roles (named privilege sets, UX spec A38), who holds which role
 * at which scope (org, project, or lane), which catalog items each level
 * has enabled (A42), and which projects exist. Every device pulls it whole;
 * it is small.
 *
 * Authorization for a project partition is: the project's own membership
 * (v1.MemberAdded, kept for compatibility) or an org membership whose scope
 * covers the project and whose role's privileges include the one the event
 * needs (`EVENT_PRIVILEGE`). The server runs the same table.
 */
export const ORG_PARTITION = '_org';

/**
 * The id of the one work partition a new organization gets (decision 34):
 * an organization holds languages directly, with no project level between.
 */
export const WORK_PARTITION = 'work';

/**
 * The partition that holds an organization's languages: the earliest one
 * registered, by clock then event id, so every device opens the same one.
 * Before anything is registered it is `WORK_PARTITION`.
 */
export function workPartitionOf(org: OrgState | null): string {
  let best: { id: string; hlc: string; eventId: string } | null = null;
  for (const [id, p] of Object.entries(org?.projects ?? {})) {
    if (!best || p.hlc < best.hlc || (p.hlc === best.hlc && p.eventId < best.eventId)) best = { id, hlc: p.hlc, eventId: p.eventId };
  }
  return best?.id ?? WORK_PARTITION;
}

/** The UX spec's privilege catalog (ROLE_PRIVILEGES), as stable ids. */
export const PRIVILEGES = [
  'manage_structure',
  'invite_members',
  'manage_roles',
  'manage_templates',
  'shape_templates',
  'manage_reference',
  'manage_flows',
  'manage_teams',
  'assign_work',
  'override_checkpoints',
  'translate',
  'fill_reference',
  'send_to_reviewers',
  'review',
  'view_status'
] as const;
export type Privilege = (typeof PRIVILEGES)[number];

/** Privileges that make a member an admin of their scope (spec MANAGE_PRIVILEGES). */
export const MANAGE_PRIVILEGES: readonly Privilege[] = [
  'manage_structure', 'invite_members', 'manage_roles', 'manage_templates',
  'manage_reference', 'manage_flows', 'manage_teams', 'assign_work', 'override_checkpoints'
];

export type ScopeLevel = 'org' | 'project' | 'lane';
export interface Scope {
  level: ScopeLevel;
  projectId?: string;
  laneId?: string;
}

export type CatalogKind = 'template' | 'reference' | 'flow';

export interface OrgEventPayloads {
  'v1.OrgCreated': { name: string };
  /** A named privilege set. Scope is never on the role; it is on the membership (A38). */
  'v1.RoleDefined': { roleId: string; name: string; privileges: Privilege[] };
  'v1.RoleRetired': { roleId: string };
  /** Grants roleId to profileId at a scope. Register per (profile, scope). */
  'v1.OrgMemberAdded': { profileId: string; roleId: string; scope: Scope; displayName?: string };
  'v1.OrgMemberRemoved': { profileId: string; scope: Scope };
  /** Org enables from the system catalog; a project narrows what the org enabled (A42). */
  'v1.CatalogItemToggled': { kind: CatalogKind; itemId: string; level: 'org' | 'project'; projectId?: string; enabled: boolean };
  'v1.ProjectRegistered': { projectId: string; name: string };
  /**
   * An invite that may be redeemed once, for a role at a scope (audit 5.B).
   * The token itself is never in the log: only its hash, in the `invites`
   * table. Every member pulls this partition, so a token here would be a
   * token shared with everyone it was not issued to.
   */
  'v1.InviteIssued': { inviteId: string; roleId: string; scope: Scope; expiresAt: string };
  /**
   * Server-only. `redeem_invite` appends this beside the OrgMemberAdded it
   * grants, so the log says which invite let someone in without changing
   * the shape of the shipped OrgMemberAdded event.
   */
  'v1.InviteRedeemed': { inviteId: string; profileId: string };
  /** A coordinator's verdict on a join request (audit 5.B). */
  'v1.JoinDecided': { requestId: string; profileId: string; accepted: boolean };
}
export type OrgEventType = keyof OrgEventPayloads;
export const ORG_EVENT_TYPES: readonly OrgEventType[] = [
  'v1.OrgCreated', 'v1.RoleDefined', 'v1.RoleRetired', 'v1.OrgMemberAdded',
  'v1.OrgMemberRemoved', 'v1.CatalogItemToggled', 'v1.ProjectRegistered',
  'v1.InviteIssued', 'v1.InviteRedeemed', 'v1.JoinDecided'
];

/**
 * The privilege an event type needs. `null` means server-only (never a
 * client), `'bootstrap'` means the partition's creation rule applies, and a
 * list means any one of them will do (a translator may log a community
 * check they ran themselves; so may a reviewer). `v1.CatalogItemToggled`
 * and a few record events depend on their payload: see `privilegeFor`.
 * The SQL `event_privilege` is this table; keep them identical.
 */
export type EventPrivilege = Privilege | readonly Privilege[] | 'bootstrap' | null;

export const EVENT_PRIVILEGE: Record<EventType, EventPrivilege | 'by_kind'> = {
  'v1.ProjectCreated': 'bootstrap',
  'v1.ProjectConfigChanged': 'manage_structure',
  'v1.MemberAdded': 'invite_members',
  'v1.MemberRoleChanged': 'invite_members',
  'v1.MemberRemoved': 'invite_members',
  'v1.LaneAdded': 'manage_structure',
  'v1.UnitAdded': 'manage_templates',
  'v1.ReferenceAttached': 'fill_reference',
  'v1.RecordingAdded': 'translate',
  'v1.TakeComposed': 'translate',
  'v1.TakeArchived': 'translate',
  'v1.TakeSelected': 'translate',
  'v1.TakeSubmitted': 'translate',
  'v1.ReviewSubmitted': 'review',
  'v1.AssignmentMade': 'assign_work',
  'v1.SourceImported': 'manage_structure',
  'v1.BlobStored': null,
  'v1.BlobInvalidated': null,
  'v1.Redacted': 'manage_structure',
  'v1.LaneTemplateSelected': 'manage_templates',
  'v1.LaneFlowSelected': 'manage_flows',
  'v1.WorkflowStepSet': 'manage_flows',
  'v1.WorkflowStepRemoved': 'manage_flows',
  'v1.ReviewTeamDefined': 'manage_teams',
  'v1.ReviewTeamMemberSet': 'manage_teams',
  'v1.ResponseRecorded': 'translate',
  'v1.ReviewCommentRecorded': 'review',
  'v1.MaterialDefined': 'by_kind',
  'v1.MaterialFieldSet': 'fill_reference',
  'v1.MaterialLocked': 'manage_reference',
  'v1.StepQuestionSetLinked': 'manage_flows',
  'v1.KeyTermDefined': 'fill_reference',
  'v1.KeyTermRenderingAdded': 'fill_reference',
  'v1.KeyTermAdjusted': 'fill_reference',
  'v1.KeyTermLinked': 'fill_reference',
  'v1.OrgCreated': 'bootstrap',
  'v1.RoleDefined': 'manage_roles',
  'v1.RoleRetired': 'manage_roles',
  'v1.OrgMemberAdded': 'invite_members',
  'v1.OrgMemberRemoved': 'invite_members',
  'v1.CatalogItemToggled': 'by_kind',
  'v1.ProjectRegistered': 'manage_structure',
  'v1.InviteIssued': 'invite_members',
  'v1.InviteRedeemed': null,
  'v1.JoinDecided': 'invite_members',
  'v1.ReviewKindDefined': 'manage_flows',
  'v2.WorkflowStepSet': 'manage_flows',
  'v1.ReviewRecorded': 'by_kind',
  'v1.DepartureRecorded': 'by_kind',
  'v1.DepartureUndone': ['translate', 'review', 'assign_work', 'override_checkpoints'],
  'v1.RequestMade': ['send_to_reviewers', 'assign_work'],
  'v1.RequestWithdrawn': ['send_to_reviewers', 'assign_work'],
  'v1.NoteAdded': ['translate', 'review', 'fill_reference'],
  'v1.StudyStepMarked': 'translate',
  'v1.LaneNamed': 'manage_structure'
};

const CATALOG_PRIVILEGE: Record<CatalogKind, Privilege> = {
  template: 'manage_templates',
  reference: 'manage_reference',
  flow: 'manage_flows'
};

/** The privilege one concrete event needs, resolving payload-dependent cases. */
export function privilegeFor(event: AnyEvent): EventPrivilege {
  const p = EVENT_PRIVILEGE[event.type];
  if (p === 'by_kind') {
    if (event.type === 'v1.ReviewRecorded') {
      // A check that happened outside the app may be logged by whoever ran it.
      return event.payload.via === 'logged' ? ['review', 'translate'] : 'review';
    }
    if (event.type === 'v1.DepartureRecorded') {
      if (event.payload.type === 'override') return 'override_checkpoints';
      if (event.payload.type === 'keep') return 'translate';
      return ['translate', 'review', 'assign_work'];
    }
    const kind = (event.payload as { kind?: string }).kind;
    // Translators may write question sets at submit time (UX spec); every
    // other material is managed reference.
    if (event.type === 'v1.MaterialDefined') return kind === 'questions' ? 'fill_reference' : 'manage_reference';
    return kind && CATALOG_PRIVILEGE[kind as CatalogKind] ? CATALOG_PRIVILEGE[kind as CatalogKind] : 'manage_templates';
  }
  return p;
}

/** Does a privilege set satisfy what an event needs? Bootstrap and server-only are never satisfied here. */
export function privilegeAllows(needed: EventPrivilege, privs: ReadonlySet<Privilege>): boolean {
  if (needed === null || needed === 'bootstrap') return false;
  if (typeof needed === 'string') return privs.has(needed);
  return needed.some((p) => privs.has(p));
}

/**
 * The five fixed project roles as seed roles, with the UX spec's privilege
 * sets, so an org created today behaves exactly as before (A38 role
 * matrix, A2: higher roles can do the work below them).
 */
export const SEED_ROLES: { roleId: string; name: string; privileges: Privilege[]; fixed: Role }[] = [
  { roleId: 'org_admin', name: 'Organization Admin', privileges: [...PRIVILEGES], fixed: 'owner' },
  {
    roleId: 'project_coordinator', name: 'Coordinator', fixed: 'coordinator',
    privileges: PRIVILEGES.filter((p) => p !== 'manage_roles')
  },
  { roleId: 'translator', name: 'Translator', fixed: 'translator', privileges: ['translate', 'fill_reference', 'send_to_reviewers', 'view_status'] },
  { roleId: 'reviewer', name: 'Reviewer', fixed: 'reviewer', privileges: ['review', 'view_status'] },
  { roleId: 'viewer', name: 'Viewer', fixed: 'viewer', privileges: ['view_status'] }
];

/** Privileges of a fixed project role, for members added the old way. */
export function privilegesOfFixedRole(role: Role): Set<Privilege> {
  return new Set(SEED_ROLES.find((r) => r.fixed === role)?.privileges ?? []);
}

/**
 * The fixed role a privilege set amounts to, so everything written against
 * `Role` (workflow steps, eligibility, storage policies) keeps working for
 * org-scoped members. Same mapping as SQL `effective_role`.
 */
export function effectiveRole(privs: ReadonlySet<Privilege>): Role | null {
  if (privs.has('manage_roles')) return 'owner';
  if (privs.has('assign_work')) return 'coordinator';
  if (privs.has('translate')) return 'translator';
  if (privs.has('review')) return 'reviewer';
  if (privs.has('view_status')) return 'viewer';
  return null;
}

// ---- state ---------------------------------------------------------------

export interface OrgRoleState {
  name: Register<string>;
  privileges: Register<Privilege[]>;
  retired: boolean;
}

export interface OrgMembership {
  roleId: Register<string>;
  removed: Register<boolean>;
  displayName?: string;
  scope: Scope;
}

/**
 * An invite as the log knows it. `redeemedBy` is written by a different
 * event than the rest, so each event writes only its own fields and the two
 * commute: a redemption that arrives before its issue still lands.
 */
export interface OrgInvite {
  roleId: string;
  scope: Scope;
  expiresAt: string;
  issuedBy: string;
  hlc: string;
  redeemedBy: string | null;
}

export interface JoinDecision {
  profileId: string;
  accepted: boolean;
  decidedBy: string;
  hlc: string;
}

export interface OrgState {
  org: Register<{ name: string }> | null;
  roles: Record<string, OrgRoleState>;
  /** profileId -> scopeKey -> membership */
  members: Record<string, Record<string, OrgMembership>>;
  /** `${kind}:${itemId}:${level}:${projectId ?? ''}` -> enabled */
  catalog: Record<string, Register<boolean>>;
  /**
   * Registered work partitions. The app runs one per org (decision 34);
   * orgs from before that may have several, and the earliest is the one
   * that is opened (`workPartitionOf`).
   */
  projects: Record<string, { name: string; hlc: Hlc; eventId: string }>;
  /** inviteId -> invite. */
  invites: Record<string, OrgInvite>;
  /** requestId -> the verdict a coordinator recorded. */
  joinDecisions: Record<string, JoinDecision>;
  appliedEventIds: Record<string, true>;
  invalidEvents: Record<string, string>;
  redactions: Record<string, true>;
}

export function emptyOrgState(): OrgState {
  return { org: null, roles: {}, members: {}, catalog: {}, projects: {}, invites: {}, joinDecisions: {}, appliedEventIds: {}, invalidEvents: {}, redactions: {} };
}

export function scopeKey(s: Scope): string {
  return s.level === 'org' ? 'org' : s.level === 'project' ? `project:${s.projectId}` : `lane:${s.projectId}/${s.laneId}`;
}

export function catalogKey(kind: CatalogKind, itemId: string, level: 'org' | 'project', projectId?: string): string {
  return `${kind}:${itemId}:${level}:${level === 'project' ? projectId ?? '' : ''}`;
}

const empty: Register<never> = { value: undefined as never, hlc: '', eventId: '' };

function emptyInvite(): OrgInvite {
  return { roleId: '', scope: { level: 'org' }, expiresAt: '', issuedBy: '', hlc: '', redeemedBy: null };
}

function loses(current: Register<unknown>, event: EventEnvelope): boolean {
  if (current.hlc !== event.hlc) return current.hlc > event.hlc;
  return current.eventId > event.id;
}

function set<V>(current: Register<V> | undefined, event: EventEnvelope, value: V): Register<V> {
  if (current && current.hlc !== '' && loses(current, event)) return current;
  return { value, hlc: event.hlc, eventId: event.id };
}

/** Deterministic, order-independent, idempotent; same discipline as the project reducer. */
export function applyOrgEvent(state: OrgState, event: AnyEvent): OrgState {
  if (state.appliedEventIds[event.id]) return state;
  state.appliedEventIds[event.id] = true;
  const invalid = validateEvent(event);
  if (invalid) {
    state.invalidEvents[event.id] = invalid;
    return state;
  }
  if (state.redactions[event.id]) return state;

  switch (event.type) {
    case 'v1.OrgCreated':
      state.org = set(state.org ?? undefined, event, event.payload);
      break;
    case 'v1.RoleDefined': {
      const r = (state.roles[event.payload.roleId] ??= { name: empty, privileges: empty, retired: false });
      r.name = set(r.name, event, event.payload.name);
      r.privileges = set(r.privileges, event, [...event.payload.privileges].sort());
      break;
    }
    case 'v1.RoleRetired': {
      const r = (state.roles[event.payload.roleId] ??= { name: empty, privileges: empty, retired: false });
      r.retired = true; // add-wins
      break;
    }
    case 'v1.OrgMemberAdded': {
      const m = membership(state, event.payload.profileId, event.payload.scope);
      m.roleId = set(m.roleId, event, event.payload.roleId);
      m.removed = set(m.removed, event, false);
      if (event.payload.displayName !== undefined) m.displayName = event.payload.displayName;
      break;
    }
    case 'v1.OrgMemberRemoved': {
      const m = membership(state, event.payload.profileId, event.payload.scope);
      m.removed = set(m.removed, event, true);
      break;
    }
    case 'v1.CatalogItemToggled': {
      const { kind, itemId, level, projectId, enabled } = event.payload;
      const key = catalogKey(kind, itemId, level, projectId);
      state.catalog[key] = set(state.catalog[key], event, enabled);
      break;
    }
    case 'v1.InviteIssued': {
      const { inviteId, roleId, scope, expiresAt } = event.payload;
      const slot = (state.invites[inviteId] ??= emptyInvite());
      // Register by clock so a duplicated id cannot make the fold depend on
      // arrival order; only this event's own fields are written.
      if (slot.hlc === '' || slot.hlc < event.hlc) {
        slot.roleId = roleId;
        slot.scope = scope;
        slot.expiresAt = expiresAt;
        slot.issuedBy = event.actorId;
        slot.hlc = event.hlc;
      }
      break;
    }

    case 'v1.InviteRedeemed': {
      const { inviteId, profileId } = event.payload;
      (state.invites[inviteId] ??= emptyInvite()).redeemedBy = profileId;
      break;
    }

    case 'v1.JoinDecided': {
      const { requestId, profileId, accepted } = event.payload;
      const prior = state.joinDecisions[requestId];
      if (!prior || prior.hlc < event.hlc) {
        state.joinDecisions[requestId] = { profileId, accepted, decidedBy: event.actorId, hlc: event.hlc };
      }
      break;
    }

    case 'v1.ProjectRegistered': {
      // Earliest registration wins, so the name does not depend on arrival order.
      const prior = state.projects[event.payload.projectId];
      if (!prior || event.hlc < prior.hlc || (event.hlc === prior.hlc && event.id < prior.eventId)) {
        state.projects[event.payload.projectId] = { name: event.payload.name, hlc: event.hlc, eventId: event.id };
      }
      break;
    }
    case 'v1.Redacted':
      state.redactions[event.payload.eventId] = true;
      break;
    default:
      // Project events in the org partition, or future types: ignored.
      break;
  }
  return state;
}

function membership(state: OrgState, profileId: string, scope: Scope): OrgMembership {
  const byScope = (state.members[profileId] ??= {});
  return (byScope[scopeKey(scope)] ??= { roleId: empty, removed: empty, scope: { ...scope } });
}

export function foldOrg(events: Iterable<AnyEvent>, initial: OrgState = emptyOrgState()): OrgState {
  let state = initial;
  const rest: AnyEvent[] = [];
  for (const event of events) {
    if (event.type === 'v1.Redacted') state = applyOrgEvent(state, event);
    else rest.push(event);
  }
  for (const event of rest) state = applyOrgEvent(state, event);
  return state;
}

// ---- derivations ---------------------------------------------------------

/** Does a membership's scope cover a target project (and lane, if given)? */
export function scopeCovers(scope: Scope, target: { projectId?: string; laneId?: string }): boolean {
  if (scope.level === 'org') return true;
  if (scope.level === 'project') return target.projectId === scope.projectId;
  return target.projectId === scope.projectId && (target.laneId === undefined || target.laneId === scope.laneId);
}

/**
 * Every privilege a profile holds over a target: the union across active
 * memberships whose scope covers it, through roles that are not retired.
 * With no target, the union over every membership (what they can do somewhere).
 */
export function privilegesFor(state: OrgState, profileId: string, target: { projectId?: string; laneId?: string } = {}): Set<Privilege> {
  const out = new Set<Privilege>();
  for (const m of Object.values(state.members[profileId] ?? {})) {
    if (m.removed.value !== false) continue;
    if (target.projectId !== undefined && !scopeCovers(m.scope, target)) continue;
    const role = state.roles[m.roleId.value];
    if (!role || role.retired) continue;
    for (const p of role.privileges.value ?? []) out.add(p);
  }
  return out;
}

/** Active memberships of a profile, org-wide. */
export function membershipsOf(state: OrgState, profileId: string): OrgMembership[] {
  return Object.values(state.members[profileId] ?? {}).filter((m) => m.removed.value === false);
}

/**
 * The highest level at which the profile holds a manage privilege: where
 * their Home is (UX spec A34: org admin -> org home, project admin -> project
 * home, language admin -> language home). Null when they manage nothing.
 */
export function adminScopeOf(state: OrgState, profileId: string): Scope | null {
  const rank: Record<ScopeLevel, number> = { org: 0, project: 1, lane: 2 };
  let best: Scope | null = null;
  for (const m of membershipsOf(state, profileId)) {
    const role = state.roles[m.roleId.value];
    if (!role || role.retired) continue;
    if (!(role.privileges.value ?? []).some((p) => MANAGE_PRIVILEGES.includes(p))) continue;
    if (!best || rank[m.scope.level] < rank[best.level]) best = m.scope;
  }
  return best;
}

/** Catalog items enabled at a level, after the org's own enabling (A42: disabled above is hidden below). */
export function catalogEnabled(state: OrgState, kind: CatalogKind, itemId: string, projectId?: string): boolean {
  const org = state.catalog[catalogKey(kind, itemId, 'org')]?.value ?? true;
  if (!org) return false;
  if (projectId === undefined) return true;
  return state.catalog[catalogKey(kind, itemId, 'project', projectId)]?.value ?? true;
}

/** Register a payload's clock type for callers that need it. */
export type { Hlc };
