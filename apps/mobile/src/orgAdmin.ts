// Pure derivations and event plans behind the organization screens
// (screens/org.tsx), kept free of React Native so they can be tested.
// Demo sources: ng-langquest-ux src/screens/org.tsx and the helpers in
// src/data.ts (SCOPE_LABEL, grantScopeAt, assignableScopes,
// memberIsEditableAt, languageReviewers). Requirements ORG-1, ORG-2, ORG-5,
// ORG-6, ORG-7, FLOW-5.
import {
  privilegesFor, privilegesOfFixedRole, SEED_ROLES,
  type EventPayloads, type EventSpec, type EventType, type OrgState, type PartitionState, type Role, type Scope,
  type ScopeLevel, type TemplateDoc
} from '@langquest-next/core';
import { canonIndex, STARTER_TEMPLATE, type LibraryChoice } from './contentTemplates';

// ---- levels ------------------------------------------------------------------------

/**
 * The levels anyone can grant at: the organization and a language
 * (decision 34). `partition` remains a scope in the event shape; a membership
 * at it covers the org's one work partition, so it reads as every language.
 */
export const LEVELS: readonly ScopeLevel[] = ['org', 'lane'];
/** The demo's SCOPE_LABEL: a lane is a "Language" to people. */
export const LEVEL_LABEL: Record<ScopeLevel, string> = { org: 'Organization', partition: 'All languages', lane: 'Language' };
const RANK: Record<ScopeLevel, number> = { org: 0, partition: 1, lane: 2 };

export function levelRank(level: ScopeLevel): number {
  return RANK[level];
}

/** A `level` param back to a level; anything else (a partition, from before decision 34) reads as the organization. */
export function parseLevel(value: string | undefined): ScopeLevel {
  return value === 'lane' ? value : 'org';
}

/**
 * Demo `grantScopeAt`: the highest level this admin may grant at from a
 * home. Viewing a lower home, it is that home; viewing above your own
 * scope, it is your own scope. Null when you administer nothing.
 */
export function grantFloor(admin: Scope | null, view: ScopeLevel): ScopeLevel | null {
  if (!admin) return null;
  return RANK[view] >= RANK[admin.level] ? view : admin.level;
}

/** Demo `assignableScopes`: this level and below, never above the inviter's own scope (ORG-6). */
export function assignableLevels(admin: Scope | null, view: ScopeLevel): ScopeLevel[] {
  const floor = grantFloor(admin, view);
  return floor ? LEVELS.filter((l) => RANK[l] >= RANK[floor]) : [];
}

export function scopeAt(level: ScopeLevel, partitionId: string, laneId?: string): Scope {
  if (level === 'org') return { level };
  if (level === 'partition') return { level, partitionId };
  return { level, partitionId, ...(laneId ? { laneId } : {}) };
}

export function sameScope(a: Scope, b: Scope): boolean {
  return a.level === b.level && (a.level === 'org' || a.partitionId === b.partitionId) && (a.level !== 'lane' || a.laneId === b.laneId);
}

// ---- progress ----------------------------------------------------------------------

/** Recorded and done, never one "% done" (ORG-1). */
export interface HomeProgress {
  total: number;
  recorded: number;
  done: number;
}

export function sumProgress(list: HomeProgress[]): HomeProgress {
  return list.reduce((a, p) => ({ total: a.total + p.total, recorded: a.recorded + p.recorded, done: a.done + p.done }), { total: 0, recorded: 0, done: 0 });
}

/** "12 of 260 recorded · 3 done", or "No passages yet". */
export function progressLine(p: HomeProgress): string {
  const n = (x: number) => x.toLocaleString('en-US');
  return p.total === 0 ? 'No passages yet' : `${n(p.recorded)} of ${n(p.total)} recorded · ${n(p.done)} done`;
}

// ---- members -----------------------------------------------------------------------

/** One person's role at one scope. A partition member added the old way reads as a partition-level entry. */
export interface MemberEntry {
  key: string;
  profileId: string;
  scope: Scope;
  roleId: string;
  /** When the role was granted (the register's clock), for "joined". */
  since: string;
  /** Present for a member of the partition log only (v1.MemberAdded), who has no org membership. */
  legacyRole?: Role;
}

/** The seed role a fixed partition role reads as. */
export function seedRoleId(role: Role): string {
  return SEED_ROLES.find((r) => r.fixed === role)?.roleId ?? role;
}

/**
 * Everyone with a role somewhere: active org memberships at every scope,
 * plus members of the open partition's own log who hold no org membership.
 */
export function memberEntries(org: OrgState | null, partition: PartitionState | null, partitionId: string): MemberEntry[] {
  const out: MemberEntry[] = [];
  for (const [profileId, scopes] of Object.entries(org?.members ?? {})) {
    for (const [key, m] of Object.entries(scopes)) {
      if (m.removed.value !== false) continue;
      out.push({ key: `${profileId}|${key}`, profileId, scope: m.scope, roleId: m.roleId.value, since: m.roleId.hlc });
    }
  }
  for (const [profileId, m] of Object.entries(partition?.members ?? {})) {
    if (m.removed.value || org?.members[profileId]) continue;
    out.push({
      key: `${profileId}|legacy`, profileId, scope: { level: 'partition', partitionId }, roleId: seedRoleId(m.role.value),
      since: m.role.hlc, legacyRole: m.role.value
    });
  }
  return out;
}

/**
 * Members assigned exactly at a home's level (ORG-5). At the organization
 * that includes anyone assigned to all of its languages (a partition-level
 * membership of its work partition, from before decision 34).
 */
export function membersAt(entries: MemberEntry[], level: ScopeLevel, partitionId: string, laneId?: string): MemberEntry[] {
  return entries.filter((e) => sameScope(e.scope, scopeAt(level, partitionId, laneId))
    || (level === 'org' && e.scope.level === 'partition' && e.scope.partitionId === partitionId));
}

/** Members from the levels above a home, shown view-only there (ORG-5). */
export function membersAbove(entries: MemberEntry[], level: ScopeLevel, partitionId: string): MemberEntry[] {
  if (level === 'org') return [];
  return entries.filter((e) => e.scope.level === 'org' || (level === 'lane' && e.scope.level === 'partition' && e.scope.partitionId === partitionId));
}

/**
 * Members assigned at a language of this organization, grouped by language,
 * for "Expand by". Each language is its own partition (decisions.md 37), so
 * every language counts, not only the open one.
 */
export function groupBelow(entries: MemberEntry[]): Map<string, MemberEntry[]> {
  const out = new Map<string, MemberEntry[]>();
  for (const e of entries) {
    if (e.scope.level !== 'lane' || !e.scope.laneId) continue;
    out.set(e.scope.laneId, [...(out.get(e.scope.laneId) ?? []), e]);
  }
  return out;
}

/** Demo `memberIsEditableAt`: a home edits its own level and below, never above. */
export function editableAt(scope: Scope, view: ScopeLevel): boolean {
  return RANK[scope.level] >= RANK[view];
}

/** An org-partition write (ctx.org.append), in the order to apply it. */
export type OrgOp =
  | { type: 'v1.OrgMemberAdded'; payload: EventPayloads['v1.OrgMemberAdded'] }
  | { type: 'v1.OrgMemberRemoved'; payload: EventPayloads['v1.OrgMemberRemoved'] };

/**
 * Change an org member's role or scope (ORG-7) and the writes that put it
 * back (CORE-5). A new scope is a new membership: the old one is removed.
 * Legacy partition members are not handled here (their role is a partition event).
 */
export function changeMembership(entry: MemberEntry, next: { roleId: string; scope: Scope }): { apply: OrgOp[]; undo: OrgOp[] } {
  const add = (roleId: string, scope: Scope): OrgOp => ({ type: 'v1.OrgMemberAdded', payload: { profileId: entry.profileId, roleId, scope } });
  const remove = (scope: Scope): OrgOp => ({ type: 'v1.OrgMemberRemoved', payload: { profileId: entry.profileId, scope } });
  if (sameScope(entry.scope, next.scope)) {
    if (entry.roleId === next.roleId) return { apply: [], undo: [] };
    return { apply: [add(next.roleId, entry.scope)], undo: [add(entry.roleId, entry.scope)] };
  }
  return {
    apply: [add(next.roleId, next.scope), remove(entry.scope)],
    undo: [add(entry.roleId, entry.scope), remove(next.scope)]
  };
}

/** Take someone off one scope (and the write that restores them). */
export function removeMembership(entry: MemberEntry): { apply: OrgOp[]; undo: OrgOp[] } {
  return {
    apply: [{ type: 'v1.OrgMemberRemoved', payload: { profileId: entry.profileId, scope: entry.scope } }],
    undo: [{ type: 'v1.OrgMemberAdded', payload: { profileId: entry.profileId, roleId: entry.roleId, scope: entry.scope } }]
  };
}

// ---- review teams (FLOW-5) ------------------------------------------------------------

/** Demo `languageReviewers`: people holding Review over this language. */
export function reviewEligible(org: OrgState | null, partition: PartitionState | null, partitionId: string, laneId: string): string[] {
  const out = new Set<string>();
  for (const profileId of Object.keys(org?.members ?? {})) {
    if (org && privilegesFor(org, profileId, { partitionId, laneId }).has('review')) out.add(profileId);
  }
  for (const [profileId, m] of Object.entries(partition?.members ?? {})) {
    if (m.removed.value || org?.members[profileId]) continue;
    if (privilegesOfFixedRole(m.role.value).has('review')) out.add(profileId);
  }
  return [...out].sort();
}

export function teamMembers(state: PartitionState, teamId: string): string[] {
  return Object.entries(state.teams[teamId]?.members ?? {}).filter(([, r]) => r.value).map(([id]) => id).sort();
}

const spec = <T extends EventType>(id: string, type: T, payload: EventPayloads[T]): EventSpec => ({ id, type, payload } as EventSpec);
const counter = (commandId: string) => {
  let n = 0;
  return () => `${commandId}:${n++}`;
};

/**
 * Save a team: its name, and who joins or leaves. Only what changed is
 * written. `undo` restores the name and membership it had, or is null for a
 * new team (there is no event that removes a team).
 */
export function saveTeam(state: PartitionState, c: { commandId: string; teamId: string; laneId: string; name: string; members: string[] }): { specs: EventSpec[]; undo: (() => EventSpec[]) | null } {
  const next = counter(c.commandId);
  const team = state.teams[c.teamId];
  const before = team ? teamMembers(state, c.teamId) : [];
  const chosen = new Set(c.members);
  const name = c.name.trim();
  const specs: EventSpec[] = [];
  if (!team || team.name.value !== name || team.laneId !== c.laneId) specs.push(spec(next(), 'v1.ReviewTeamDefined', { teamId: c.teamId, laneId: c.laneId, name }));
  for (const id of [...chosen].sort()) if (!before.includes(id)) specs.push(spec(next(), 'v1.ReviewTeamMemberSet', { teamId: c.teamId, profileId: id, member: true }));
  for (const id of before) if (!chosen.has(id)) specs.push(spec(next(), 'v1.ReviewTeamMemberSet', { teamId: c.teamId, profileId: id, member: false }));
  if (!team) return { specs, undo: null };
  const oldName = team.name.value;
  return {
    specs,
    undo: () => {
      const back = counter(`${c.commandId}:undo`);
      const out: EventSpec[] = [];
      if (oldName !== name) out.push(spec(back(), 'v1.ReviewTeamDefined', { teamId: c.teamId, laneId: team.laneId, name: oldName }));
      for (const id of before) if (!chosen.has(id)) out.push(spec(back(), 'v1.ReviewTeamMemberSet', { teamId: c.teamId, profileId: id, member: true }));
      for (const id of chosen) if (!before.includes(id)) out.push(spec(back(), 'v1.ReviewTeamMemberSet', { teamId: c.teamId, profileId: id, member: false }));
      return out;
    }
  };
}

// ---- a new language (ORG-2) ---------------------------------------------------------------

export type LanguageScope = 'nt' | 'ot' | 'all';
export const LANGUAGE_SCOPES: { id: LanguageScope; label: string; sub: string }[] = [
  { id: 'nt', label: 'New Testament', sub: 'Matthew to Revelation' },
  { id: 'ot', label: 'Old Testament', sub: 'Genesis to Malachi' },
  { id: 'all', label: 'Whole Bible', sub: 'Every book' }
];

/**
 * The books of a Bible template a scope covers (USFM codes; the first 39
 * are the Old Testament, the next 27 the New). Undefined means all of them,
 * so books a later version adds reach the language too; an outline has no
 * books.
 */
export function booksInScope(doc: TemplateDoc, scope: LanguageScope): string[] | undefined {
  if (scope === 'all' || doc.structure !== 'bible' || !doc.bible) return undefined;
  return doc.bible.books.map((b) => b.book).filter((b) => {
    const i = canonIndex(b);
    return scope === 'ot' ? i >= 0 && i < 39 : i >= 39 && i < 66;
  });
}

/**
 * The template a new language starts from (ORG-2): the one most languages
 * here already use, else LangQuest's starter, else the first there is.
 * Returns a choice's key, or null when there is nothing to choose.
 */
export function suggestedTemplate(state: PartitionState | null, choices: LibraryChoice[]): string | null {
  const counts = new Map<string, number>();
  for (const sel of Object.values(state?.laneTemplates ?? {})) {
    const itemId = sel.value.itemId;
    if (itemId) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
  }
  const used = choices
    .filter((c): c is Extract<LibraryChoice, { source: 'ours' }> => c.source === 'ours' && (counts.get(c.item.itemId) ?? 0) > 0)
    .sort((a, b) => counts.get(b.item.itemId)! - counts.get(a.item.itemId)! || (a.item.itemId < b.item.itemId ? -1 : 1))[0];
  if (used) return used.key;
  const starter = choices.find((c) => c.name === STARTER_TEMPLATE.name && (c.source === 'ours' || c.shared.org_id === STARTER_TEMPLATE.orgId));
  return (starter ?? choices[0])?.key ?? null;
}

/**
 * Add a language: the lane, its name for people (read everywhere through
 * core `laneName`), then its template's events (`applySpecs` from the
 * library: the selection and the units it needs that are not here yet;
 * units are shared across languages).
 */
export function addLanguage(state: PartitionState | null, c: { commandId: string; laneId: string; code: string; name: string; template: EventSpec[] }): EventSpec[] {
  const code = c.code.trim().toLowerCase();
  const name = c.name.trim();
  if (!code) throw new Error('Enter a language code.');
  if (state?.lanes[c.laneId]) throw new Error('That language is already here.');
  const next = counter(c.commandId);
  // The language's own partition starts with it (docs/decisions.md 37); the
  // server accepts that first event from someone who manages structure.
  const specs: EventSpec[] = [
    spec(next(), 'v1.PartitionCreated', { name: name || code, sourceLanguoidId: SOURCE_LANGUOID }),
    spec(next(), 'v1.LaneAdded', { laneId: c.laneId, languoidId: code })
  ];
  if (name) specs.push(spec(next(), 'v1.LaneNamed', { laneId: c.laneId, name }));
  return [...specs, ...c.template];
}

/**
 * The source text a language translates from: the app ships English
 * readings (BSB, WEB, KJV), so a new language starts from them.
 */
export const SOURCE_LANGUOID = 'eng';

/** A lane id people can read in logs, unique per add: "L-din-3f9a2c". It is also the language's partition id. */
export function newLaneId(code: string, random: string): string {
  const slug = code.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') || 'lang';
  return `L-${slug}-${random.replace(/-/g, '').slice(0, 6)}`;
}
