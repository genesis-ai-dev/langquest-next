import type { AnyEvent, EventEnvelope, EventType, Role } from './events';
import type { Hlc } from './hlc';
import { applyOrgRecommendation, type ReferenceOrgEvents } from './references';
import { applyLibraryEvent, LIBRARY_EVENT_TYPES, type LibraryEvents, type LibraryItemState } from './library';
import { DEFAULT_LICENSE, licenseRank, type License } from './license';
import type { Register } from './state';
import { validateEvent } from './validate';
import { later } from './ties';
import { PRIVILEGES, MANAGE_PRIVILEGES, type Privilege, type TargetScope } from './orgTerms';

export * from './orgTerms';

/** Where a membership or an invite applies: the whole organization, or one language. */
export type Scope = { level: 'org' } | { level: 'language'; languageId: string };
export type ScopeLevel = Scope['level'];

export interface LanguageTarget {
  scope: TargetScope;
  /** `YYYY-MM-DD` */
  startDate: string;
  /** `YYYY-MM-DD` */
  targetDate: string;
}

export interface OrgEventPayloads extends LibraryEvents, ReferenceOrgEvents {
  'v1.OrgCreated': { name: string };
  /** The organization's name from now on. Same register as `OrgCreated`'s name: the later clock wins. */
  'v1.OrgRenamed': { name: string };
  /** A named privilege set. Scope is never on the role; it is on the membership (A38). */
  'v1.RoleDefined': { roleId: string; name: string; privileges: Privilege[] };
  'v1.RoleRetired': { roleId: string };
  /** Grants roleId to profileId at a scope. Register per (profile, scope): one role per scope. */
  'v1.MemberAdded': { profileId: string; roleId: string; scope: Scope };
  'v1.MemberRemoved': { profileId: string; scope: Scope };
  /**
   * An invite that may be redeemed, for a role at a scope (audit 5.B). The
   * token itself is never in the log: only its hash, in the `invites` table.
   * Every member pulls this stream, so a token here would be shared with
   * everyone it was not issued to.
   */
  'v1.InviteIssued': { inviteId: string; roleId: string; scope: Scope; expiresAt: string };
  /** Server-only. `redeem_invite` appends this beside the MemberAdded it grants. */
  'v1.InviteRedeemed': { inviteId: string; profileId: string };
  /** A coordinator's verdict on a join request (audit 5.B). */
  'v1.JoinDecided': { requestId: string; profileId: string; accepted: boolean };
  /**
   * The license the organization's work is under (license.ts). Only ever
   * opens: the fold keeps the most open one set, so an older, more closed
   * choice arriving late changes nothing (docs/decisions.md 38).
   */
  'v1.LicenseSet': { license: License };
  /**
   * A new language: its id is its stream's id. `code` is the target
   * language's code ("din"), `sourceCode` the language source Bibles are
   * offered in ("eng"). Earliest wins; the language's stream accepts events
   * only after this.
   */
  'v1.LanguageAdded': { languageId: string; name: string; code: string; sourceCode: string };
  /** A language's display name. Register per language. */
  'v1.LanguageRenamed': { languageId: string; name: string };
  /**
   * Which language in the world a language is: its code, and the languoid
   * (docs/languoids.md) it is linked to, or null when it is not linked to
   * the language list (typed in offline, or not in Glottolog yet). Register
   * per language; it takes over the code `v1.LanguageAdded` gave. A language
   * no event of this type names is unlinked.
   */
  'v1.LanguageCodeSet': { languageId: string; code: string; languoidId: string | null };
  /** Where a language's work happens (ISO 3166-1 alpha-2, "SS"), for the dashboard's geography. Register per language. */
  'v1.LanguageCountrySet': { languageId: string; country: string };
  /** What a language aims to record, from when and by when, for the dashboard's pace (decision 41). Register per language. */
  'v1.LanguageTargetSet': { languageId: string } & LanguageTarget;
}
export type OrgEventType = keyof OrgEventPayloads;
export const ORG_EVENT_TYPES: readonly OrgEventType[] = [
  'v1.OrgCreated', 'v1.OrgRenamed', 'v1.RoleDefined', 'v1.RoleRetired', 'v1.MemberAdded', 'v1.MemberRemoved',
  'v1.InviteIssued', 'v1.InviteRedeemed', 'v1.JoinDecided', 'v1.LicenseSet',
  'v1.LanguageAdded', 'v1.LanguageRenamed', 'v1.LanguageCodeSet', 'v1.LanguageCountrySet', 'v1.LanguageTargetSet',
  'v1.ReferenceRecommended', ...LIBRARY_EVENT_TYPES
];

/**
 * The privilege an event type needs. `null` means server-only (never a
 * client), `'bootstrap'` means the organization's creation rule applies, and
 * a list means any one of them will do (a translator may log a community
 * check they ran themselves; so may a reviewer). A few depend on their
 * payload: see `privilegeFor`. The SQL `event_privilege` is this table; keep
 * them identical (`scripts/record-parity-sql.ts`).
 */
type EventPrivilege = Privilege | readonly Privilege[] | 'bootstrap' | null;

export const EVENT_PRIVILEGE: Record<EventType, EventPrivilege | 'by_kind'> = {
  // organization stream
  'v1.OrgCreated': 'bootstrap',
  // Who the organization is to everyone, Request Access included: the
  // owner's, as the license is.
  'v1.OrgRenamed': 'manage_roles',
  'v1.RoleDefined': 'manage_roles',
  'v1.RoleRetired': 'manage_roles',
  'v1.MemberAdded': 'invite_members',
  'v1.MemberRemoved': 'invite_members',
  'v1.InviteIssued': 'invite_members',
  'v1.InviteRedeemed': null,
  'v1.JoinDecided': 'invite_members',
  // The owner's decision, and it cannot be taken back: only Organization
  // Admin holds manage_roles among the seed roles.
  'v1.LicenseSet': 'manage_roles',
  'v1.LanguageAdded': 'manage_structure',
  'v1.LanguageRenamed': 'manage_structure',
  'v1.LanguageCodeSet': 'manage_structure',
  'v1.LanguageCountrySet': 'manage_structure',
  'v1.LanguageTargetSet': 'manage_structure',
  'v1.ReferenceRecommended': 'manage_reference',
  'v1.LibraryItemDefined': 'by_kind',
  'v1.LibraryVersionPublished': 'by_kind',
  'v1.LibrarySharingSet': 'by_kind',
  'v1.LibraryItemArchived': 'by_kind',
  'v1.LibrarySubscribed': 'by_kind',
  'v1.LibraryPinned': 'by_kind',
  // either stream
  'v1.Redacted': 'manage_structure',
  // language stream
  'v1.TemplateSelected': 'manage_templates',
  'v1.UnitAdded': 'manage_templates',
  'v1.UnitHidden': ['manage_templates', 'shape_templates'],
  'v1.BookNameSet': 'manage_templates',
  'v1.FlowSelected': 'manage_flows',
  'v1.FlowStepSet': 'manage_flows',
  'v1.FlowStepRemoved': 'manage_flows',
  'v1.ReviewKindDefined': 'manage_flows',
  'v1.ReviewTeamDefined': 'manage_teams',
  'v1.ReviewTeamMemberSet': 'manage_teams',
  'v1.ReviewTeamKindSet': 'manage_teams',
  'v1.FlowStepLinksSet': 'manage_flows',
  // Whoever runs the work says where it went out.
  'v1.VersionReleased': 'assign_work',
  'v1.RecordingAdded': 'translate',
  'v1.TakeComposed': 'translate',
  'v1.TakeArchived': 'translate',
  'v1.CardVerseSet': 'translate',
  'v1.TakeSubmitted': 'translate',
  'v1.ResponseRecorded': 'translate',
  // Whoever may append an event that names a voice note (voiceNotesOf, blobs.ts).
  'v1.AudioFormatSet': ['translate', 'review', 'assign_work', 'send_to_reviewers', 'override_checkpoints', 'fill_reference'],
  // Whoever contributes to the language's work (decisions.md 79); only the Worker appends it, for a token with the external_values scope.
  'v1.ExternalValueSet': ['translate', 'review', 'fill_reference'],
  'v1.ReviewRecorded': 'by_kind',
  'v1.DepartureRecorded': 'by_kind',
  'v1.DepartureUndone': ['translate', 'review', 'assign_work', 'override_checkpoints'],
  'v1.RequestMade': ['send_to_reviewers', 'assign_work'],
  'v1.RequestWithdrawn': ['send_to_reviewers', 'assign_work'],
  'v1.NoteAdded': ['translate', 'review', 'fill_reference'],
  'v1.StudyStepMarked': 'translate',
  'v1.MaterialDefined': 'by_kind',
  'v1.MaterialFieldSet': 'fill_reference',
  'v1.MaterialLocked': 'manage_reference',
  'v1.KeyTermDefined': 'fill_reference',
  'v1.KeyTermRenderingAdded': 'fill_reference',
  'v1.KeyTermAdjusted': 'fill_reference',
  'v1.KeyTermLinked': 'fill_reference',
  'v1.ReferenceSet': 'manage_reference',
  'v1.PassageReferenceLinked': 'manage_reference',
  // Whoever publishes a version (translate) or records a review (review, or translate for a logged check).
  'v1.ReferencesUsed': ['translate', 'review'],
  'v1.BlobStored': null,
  'v1.BlobInvalidated': null
};

/** The privilege that manages each kind of library item. */
const LIBRARY_PRIVILEGE: Record<'template' | 'flow' | 'material' | 'versification', Privilege> = {
  template: 'manage_templates',
  versification: 'manage_templates',
  flow: 'manage_flows',
  material: 'manage_reference'
};

/** The privilege one concrete event needs, resolving payload-dependent cases. */
export function privilegeFor(event: AnyEvent): EventPrivilege {
  const p = EVENT_PRIVILEGE[event.type];
  if (p !== 'by_kind') return p;
  if (event.type === 'v1.ReviewRecorded') {
    // A check that happened outside the app may be logged by whoever ran
    // it, and a review given through a shared link is recorded the same way,
    // by whoever shared it (decisions.md 72). Neither clears a checkpoint.
    return event.payload.via === 'logged' || event.payload.via === 'link' ? ['review', 'translate'] : 'review';
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
  return LIBRARY_PRIVILEGE[kind as keyof typeof LIBRARY_PRIVILEGE] ?? 'manage_structure';
}

/**
 * The language an organization-stream event is authorized against, or
 * undefined when it needs org scope. A language admin may rename their
 * language or grant and invite at its scope (rule 6); adding a language, and
 * everything else here, needs org scope. The SQL `may_emit` mirrors this.
 */
export function languageOfOrgEvent(event: AnyEvent): string | undefined {
  switch (event.type) {
    case 'v1.LanguageRenamed':
    case 'v1.LanguageCodeSet':
    case 'v1.LanguageCountrySet':
    case 'v1.LanguageTargetSet':
      return event.payload.languageId;
    case 'v1.MemberAdded':
    case 'v1.MemberRemoved':
    case 'v1.InviteIssued':
      return event.payload.scope.level === 'language' ? event.payload.scope.languageId : undefined;
    default:
      return undefined;
  }
}

/** Does a privilege set satisfy what an event needs? Bootstrap and server-only are never satisfied here. */
export function privilegeAllows(needed: EventPrivilege, privs: ReadonlySet<Privilege>): boolean {
  if (needed === null || needed === 'bootstrap') return false;
  if (typeof needed === 'string') return privs.has(needed);
  return needed.some((p) => privs.has(p));
}

/**
 * The five fixed roles as seed roles, with the UX spec's privilege sets
 * (A38 role matrix, A2: higher roles can do the work below them).
 */
export const SEED_ROLES: { roleId: string; name: string; privileges: Privilege[]; fixed: Role }[] = [
  { roleId: 'org_admin', name: 'Organization Admin', privileges: [...PRIVILEGES], fixed: 'owner' },
  {
    roleId: 'coordinator', name: 'Coordinator', fixed: 'coordinator',
    privileges: PRIVILEGES.filter((p) => p !== 'manage_roles')
  },
  { roleId: 'translator', name: 'Translator', fixed: 'translator', privileges: ['translate', 'fill_reference', 'send_to_reviewers', 'view_status'] },
  { roleId: 'reviewer', name: 'Reviewer', fixed: 'reviewer', privileges: ['review', 'view_status'] },
  { roleId: 'viewer', name: 'Viewer', fixed: 'viewer', privileges: ['view_status'] }
];

/** Privileges of a fixed role. */
export function privilegesOfFixedRole(role: Role): Set<Privilege> {
  return new Set(SEED_ROLES.find((r) => r.fixed === role)?.privileges ?? []);
}

/**
 * The fixed role a privilege set amounts to, for labels and for code that
 * speaks `Role`. Same mapping as SQL `effective_role_of`.
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

interface OrgRoleState {
  name: Register<string>;
  privileges: Register<Privilege[]>;
  retired: boolean;
}

interface OrgMembership {
  roleId: Register<string>;
  removed: Register<boolean>;
  scope: Scope;
}

/**
 * An invite as the log knows it. `redeemedBy` is written by a different
 * event than the rest, so each event writes only its own fields and the two
 * commute: a redemption that arrives before its issue still lands.
 */
interface OrgInvite {
  roleId: string;
  scope: Scope;
  expiresAt: string;
  issuedBy: string;
  hlc: string;
  redeemedBy: string | null;
}

interface JoinDecision {
  profileId: string;
  accepted: boolean;
  decidedBy: string;
  hlc: string;
}

/**
 * One language as the organization knows it. Each part is written by one
 * event type, so they commute: a rename that arrives before the language
 * was added waits for `added`.
 */
interface OrgLanguage {
  /** `v1.LanguageAdded`, earliest wins; null while only later events have arrived. */
  added: { name: string; code: string; sourceCode: string; hlc: Hlc; eventId: string } | null;
  renamed: Register<string> | null;
  /** `v1.LanguageCodeSet`; absent in states folded before it existed. */
  codeSet?: Register<{ code: string; languoidId: string | null }> | null;
  country: Register<string> | null;
  target: Register<LanguageTarget> | null;
}

export interface OrgState {
  /** The name, written by `OrgCreated` and `OrgRenamed`; the later clock wins (`orgName`). */
  org: Register<{ name: string }> | null;
  roles: Record<string, OrgRoleState>;
  /** profileId -> scopeKey -> membership */
  members: Record<string, Record<string, OrgMembership>>;
  /** languageId -> what defines it. Only entries with `added` exist as languages (`orgLanguages`). */
  languages: Record<string, OrgLanguage>;
  /** inviteId -> invite. */
  invites: Record<string, OrgInvite>;
  /** requestId -> the verdict a coordinator recorded. */
  joinDecisions: Record<string, JoinDecision>;
  appliedEventIds: Record<string, true>;
  invalidEvents: Record<string, string>;
  redactions: Record<string, true>;
  /** itemId -> library item (library.ts). */
  library: Record<string, LibraryItemState>;
  /**
   * The most open license ever set, and the earliest event that set it
   * (`v1.LicenseSet`). Null until one is set: the work is then all rights
   * reserved (`orgLicense`).
   */
  license: Register<License> | null;
  /** itemId -> recommended to every language (`v1.ReferenceRecommended`, references.ts). */
  recommendations: Record<string, Register<boolean>>;
}

export function emptyOrgState(): OrgState {
  return { org: null, roles: {}, members: {}, languages: {}, invites: {}, joinDecisions: {}, appliedEventIds: {}, invalidEvents: {}, redactions: {}, library: {}, license: null, recommendations: {} };
}

export function scopeKey(s: Scope): string {
  return s.level === 'org' ? 'org' : `language:${s.languageId}`;
}

const empty: Register<never> = { value: undefined as never, hlc: '', eventId: '' };

function emptyInvite(): OrgInvite {
  return { roleId: '', scope: { level: 'org' }, expiresAt: '', issuedBy: '', hlc: '', redeemedBy: null };
}

function loses(current: Register<unknown>, event: EventEnvelope): boolean {
  if (current.hlc !== event.hlc) return current.hlc > event.hlc;
  return current.eventId > event.id;
}

function set<V>(current: Register<V> | null | undefined, event: EventEnvelope, value: V): Register<V> {
  if (current && current.hlc !== '' && loses(current, event)) return current;
  return { value, hlc: event.hlc, eventId: event.id };
}

function language(state: OrgState, languageId: string): OrgLanguage {
  return (state.languages[languageId] ??= { added: null, renamed: null, codeSet: null, country: null, target: null });
}

/** Deterministic, order-independent, idempotent; same discipline as the language fold. */
export function applyOrgEvent(state: OrgState, event: AnyEvent): OrgState {
  if (state.appliedEventIds[event.id]) return state;
  state.appliedEventIds[event.id] = true;
  const invalid = validateEvent(event);
  if (invalid) {
    state.invalidEvents[event.id] = invalid;
    return state;
  }
  // A redaction is never itself redacted (reducer.ts, applyLanguageEvent).
  if (state.redactions[event.id] && event.type !== 'v1.Redacted') return state;

  switch (event.type) {
    case 'v1.OrgCreated':
    case 'v1.OrgRenamed':
      // One register for both, by clock, as MemberAdded and MemberRemoved
      // share `removed`: a rename is always stamped after the creation it saw.
      state.org = set(state.org, event, { name: event.payload.name });
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
    case 'v1.MemberAdded': {
      const m = membership(state, event.payload.profileId, event.payload.scope);
      m.roleId = set(m.roleId, event, event.payload.roleId);
      m.removed = set(m.removed, event, false);
      break;
    }
    case 'v1.MemberRemoved': {
      const m = membership(state, event.payload.profileId, event.payload.scope);
      m.removed = set(m.removed, event, true);
      break;
    }
    case 'v1.InviteIssued': {
      const { inviteId, roleId, scope, expiresAt } = event.payload;
      const slot = (state.invites[inviteId] ??= emptyInvite());
      // Register by clock so a duplicated id cannot make the fold depend on
      // arrival order, a tie included; only this event's own fields are written.
      if (slot.hlc === '' || later(event, { roleId, scope, expiresAt }, { hlc: slot.hlc, actorId: slot.issuedBy }, { roleId: slot.roleId, scope: slot.scope, expiresAt: slot.expiresAt })) {
        slot.roleId = roleId;
        slot.scope = { ...scope };
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
      // The latest decision stands; a tie is settled by who decided and what.
      if (!prior || later(event, { profileId, accepted }, { hlc: prior.hlc, actorId: prior.decidedBy }, { profileId: prior.profileId, accepted: prior.accepted })) {
        state.joinDecisions[requestId] = { profileId, accepted, decidedBy: event.actorId, hlc: event.hlc };
      }
      break;
    }
    case 'v1.LicenseSet': {
      // A ratchet: the most open license wins, and among events setting the
      // same one, the earliest (clock, then id), so the result is the same
      // in any order and says when the organization first opened that far.
      const prior = state.license;
      const next = licenseRank(event.payload.license);
      const was = prior ? licenseRank(prior.value) : -1;
      if (!prior || next > was || (next === was && (event.hlc < prior.hlc || (event.hlc === prior.hlc && event.id < prior.eventId)))) {
        state.license = { value: event.payload.license, hlc: event.hlc, eventId: event.id };
      }
      break;
    }
    case 'v1.LanguageAdded': {
      const { languageId, name, code, sourceCode } = event.payload;
      const l = language(state, languageId);
      // Earliest wins, so two admins adding the same id offline agree.
      if (!l.added || event.hlc < l.added.hlc || (event.hlc === l.added.hlc && event.id < l.added.eventId)) {
        l.added = { name, code, sourceCode, hlc: event.hlc, eventId: event.id };
      }
      break;
    }
    case 'v1.LanguageRenamed': {
      const l = language(state, event.payload.languageId);
      l.renamed = set(l.renamed, event, event.payload.name);
      break;
    }
    case 'v1.LanguageCodeSet': {
      const { languageId, code, languoidId } = event.payload;
      const l = language(state, languageId);
      l.codeSet = set(l.codeSet, event, { code, languoidId });
      break;
    }
    case 'v1.LanguageCountrySet': {
      const l = language(state, event.payload.languageId);
      l.country = set(l.country, event, event.payload.country);
      break;
    }
    case 'v1.LanguageTargetSet': {
      const { languageId, scope, startDate, targetDate } = event.payload;
      const l = language(state, languageId);
      l.target = set(l.target, event, { scope, startDate, targetDate });
      break;
    }
    case 'v1.ReferenceRecommended':
      applyOrgRecommendation(state.recommendations, event);
      break;
    case 'v1.Redacted':
      state.redactions[event.payload.eventId] = true;
      break;
    case 'v1.LibraryItemDefined':
    case 'v1.LibraryVersionPublished':
    case 'v1.LibrarySharingSet':
    case 'v1.LibraryItemArchived':
    case 'v1.LibrarySubscribed':
    case 'v1.LibraryPinned':
      applyLibraryEvent(state.library, event);
      break;
    default:
      // Language-stream events, or future types: ignored.
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

export interface LanguageInfo {
  languageId: string;
  name: string;
  /** The target language's code ("din"): the latest `LanguageCodeSet`'s, else the one it was added with. */
  code: string;
  /** The languoid it is linked to (docs/languoids.md), or null while it is unlinked. */
  languoidId: string | null;
  /** The language source Bibles are offered in ("eng"). */
  sourceCode: string;
  country: string | null;
  target: LanguageTarget | null;
}

/** One language as the organization lists it, or null when it has not been added. */
export function languageInfo(org: OrgState | null, languageId: string): LanguageInfo | null {
  const l = org?.languages[languageId];
  if (!l?.added) return null;
  return {
    languageId,
    name: l.renamed?.value ?? l.added.name,
    code: l.codeSet?.value.code ?? l.added.code,
    languoidId: l.codeSet?.value.languoidId ?? null,
    sourceCode: l.added.sourceCode,
    country: l.country?.value ?? null,
    target: l.target?.value ?? null
  };
}

/** An organization's languages, sorted by name, then id. */
export function orgLanguages(org: OrgState | null): LanguageInfo[] {
  return Object.keys(org?.languages ?? {})
    .map((id) => languageInfo(org, id))
    .filter((l): l is LanguageInfo => l !== null)
    .sort((a, b) => a.name.localeCompare(b.name) || (a.languageId < b.languageId ? -1 : 1));
}

/** A language's display name: its latest name, else its code in capitals, else its id. */
export function languageName(org: OrgState | null, languageId: string): string {
  const l = languageInfo(org, languageId);
  return l?.name || l?.code.toUpperCase() || languageId;
}

/** Does a membership's scope cover a language? With no language, only org scope does. */
export function scopeCovers(scope: Scope, languageId?: string): boolean {
  return scope.level === 'org' || (languageId !== undefined && scope.languageId === languageId);
}

/**
 * Every privilege a profile holds for a language: the union of their
 * org-scope role, if any, and their role in that language, if any, through
 * roles that are not retired. With no language, only the org-scope role
 * counts. The SQL `org_privileges` computes the same.
 */
export function privilegesFor(state: OrgState, profileId: string, languageId?: string): Set<Privilege> {
  const out = new Set<Privilege>();
  for (const m of Object.values(state.members[profileId] ?? {})) {
    if (m.removed.value !== false) continue;
    if (!scopeCovers(m.scope, languageId)) continue;
    const role = state.roles[m.roleId.value];
    if (!role || role.retired) continue;
    for (const p of role.privileges.value ?? []) out.add(p);
  }
  return out;
}

/**
 * May this person grant this role at this scope (an invite, an admission,
 * or a role given directly)? They need Invite there and every privilege the
 * role carries: nobody hands out more than they hold (decisions.md 75). The
 * SQL `_grant_refusal` asks the same at the door.
 */
export function mayGrantRole(state: OrgState | null, actorId: string, roleId: string, scope: Scope): boolean {
  if (!state) return false;
  const role = state.roles[roleId];
  if (!role || role.retired) return false;
  const mine = privilegesFor(state, actorId, scope.level === 'language' ? scope.languageId : undefined);
  return mine.has('invite_members') && (role.privileges.value ?? []).every((p) => mine.has(p));
}

/**
 * May this person change or remove someone's role at a scope? Only when
 * they could have granted the role it holds now, so nobody demotes or
 * removes someone who holds more than they do (decisions.md 75).
 */
export function mayChangeMembership(state: OrgState | null, actorId: string, profileId: string, scope: Scope): boolean {
  if (!state) return false;
  const mine = privilegesFor(state, actorId, scope.level === 'language' ? scope.languageId : undefined);
  if (!mine.has('invite_members')) return false;
  const current = state.members[profileId]?.[scopeKey(scope)];
  if (!current || current.removed.value !== false) return true;
  const role = state.roles[current.roleId.value];
  return !role || role.retired || (role.privileges.value ?? []).every((p) => mine.has(p));
}

/** Active memberships of a profile, at any scope. */
export function membershipsOf(state: OrgState, profileId: string): OrgMembership[] {
  return Object.values(state.members[profileId] ?? {}).filter((m) => m.removed.value === false);
}

/** Someone who may work in a language, with what they may do there. */
interface LanguagePerson {
  profileId: string;
  privileges: Set<Privilege>;
  /** The fixed role their privileges amount to (`effectiveRole`). */
  role: Role;
}

/**
 * Everyone who holds a role covering a language (org scope or that
 * language), by profile id. A language stream has no member list of its own;
 * this is it (rule 4).
 */
export function languagePeople(org: OrgState | null, languageId: string): Map<string, LanguagePerson> {
  const out = new Map<string, LanguagePerson>();
  if (!org) return out;
  for (const profileId of Object.keys(org.members)) {
    const privileges = privilegesFor(org, profileId, languageId);
    const role = effectiveRole(privileges);
    if (role) out.set(profileId, { profileId, privileges, role });
  }
  return out;
}

/**
 * The highest level at which the profile holds a manage privilege: where
 * their Home is (UX spec A34: org admin -> org home, language admin ->
 * language home). Null when they manage nothing.
 */
export function adminScopeOf(state: OrgState, profileId: string): Scope | null {
  let best: Scope | null = null;
  for (const m of membershipsOf(state, profileId)) {
    const role = state.roles[m.roleId.value];
    if (!role || role.retired) continue;
    if (!(role.privileges.value ?? []).some((p) => MANAGE_PRIVILEGES.includes(p))) continue;
    if (m.scope.level === 'org') return m.scope;
    if (!best || (best.level === 'language' && m.scope.languageId < best.languageId)) best = m.scope;
  }
  return best;
}

/** The license the organization's work is under; all rights reserved until one is set (license.ts). */
export function orgLicense(state: OrgState | null): License {
  return state?.license?.value ?? DEFAULT_LICENSE;
}

/** The organization's name, as it was last set. */
export function orgName(state: OrgState | null): string | undefined {
  return state?.org?.value.name;
}

/** May this person rename the organization? It needs manage_roles at org scope, as the license does. */
export function mayRenameOrg(state: OrgState | null, profileId: string): boolean {
  return !!state && privilegesFor(state, profileId).has('manage_roles');
}

/**
 * May this person rename a language, or link it to the language list
 * (`v1.LanguageCodeSet`)? It needs manage_structure there, at
 * org scope or the language's own, so a language admin may rename theirs
 * (`languageOfOrgEvent`; the SQL `may_emit` is the same).
 */
export function mayRenameLanguage(state: OrgState | null, profileId: string, languageId: string): boolean {
  return !!state && privilegesFor(state, profileId, languageId).has('manage_structure');
}

/** May this person change the organization's license? It needs manage_roles at org scope. */
export function mayChangeLicense(state: OrgState | null, profileId: string): boolean {
  return !!state && privilegesFor(state, profileId).has('manage_roles');
}

/** Register a payload's clock type for callers that need it. */
export type { Hlc };
