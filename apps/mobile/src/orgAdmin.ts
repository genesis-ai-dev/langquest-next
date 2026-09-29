// Pure derivations and event plans behind the organization screens
// (screens/org.tsx), kept free of React Native so they can be tested.
// Demo sources: ng-langquest-ux src/screens/org.tsx and the helpers in
// src/data.ts (SCOPE_LABEL, grantScopeAt, assignableScopes,
// memberIsEditableAt, languageReviewers). Requirements ORG-1, ORG-2, ORG-5,
// ORG-6, ORG-7, FLOW-5.
import {
  catalogEnabled, contentTemplate, contentTemplates, CATALOG_VERSION, instantiateTemplate, privilegesFor,
  privilegesOfFixedRole, SEED_ROLES,
  type EventPayloads, type EventSpec, type EventType, type OrgState, type ProjectState, type Role, type Scope,
  type ScopeLevel
} from '@langquest-next/core';

// ---- levels ------------------------------------------------------------------------

/**
 * The levels anyone can grant at: the organization and a language
 * (decision 34). `project` remains a scope in the event shape; a membership
 * at it covers the org's one work partition, so it reads as every language.
 */
export const LEVELS: readonly ScopeLevel[] = ['org', 'lane'];
/** The demo's SCOPE_LABEL: a lane is a "Language" to people. */
export const LEVEL_LABEL: Record<ScopeLevel, string> = { org: 'Organization', project: 'All languages', lane: 'Language' };
const RANK: Record<ScopeLevel, number> = { org: 0, project: 1, lane: 2 };

export function levelRank(level: ScopeLevel): number {
  return RANK[level];
}

/** A `level` param back to a level; anything else (a project, from before decision 34) reads as the organization. */
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

export function scopeAt(level: ScopeLevel, projectId: string, laneId?: string): Scope {
  if (level === 'org') return { level };
  if (level === 'project') return { level, projectId };
  return { level, projectId, ...(laneId ? { laneId } : {}) };
}

export function sameScope(a: Scope, b: Scope): boolean {
  return a.level === b.level && (a.level === 'org' || a.projectId === b.projectId) && (a.level !== 'lane' || a.laneId === b.laneId);
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

/** One person's role at one scope. A project member added the old way reads as a project-level entry. */
export interface MemberEntry {
  key: string;
  profileId: string;
  scope: Scope;
  roleId: string;
  /** When the role was granted (the register's clock), for "joined". */
  since: string;
  /** Present for a member of the project log only (v1.MemberAdded), who has no org membership. */
  legacyRole?: Role;
}

/** The seed role a fixed project role reads as. */
export function seedRoleId(role: Role): string {
  return SEED_ROLES.find((r) => r.fixed === role)?.roleId ?? role;
}

/**
 * Everyone with a role somewhere: active org memberships at every scope,
 * plus members of the open project's own log who hold no org membership.
 */
export function memberEntries(org: OrgState | null, project: ProjectState | null, projectId: string): MemberEntry[] {
  const out: MemberEntry[] = [];
  for (const [profileId, scopes] of Object.entries(org?.members ?? {})) {
    for (const [key, m] of Object.entries(scopes)) {
      if (m.removed.value !== false) continue;
      out.push({ key: `${profileId}|${key}`, profileId, scope: m.scope, roleId: m.roleId.value, since: m.roleId.hlc });
    }
  }
  for (const [profileId, m] of Object.entries(project?.members ?? {})) {
    if (m.removed.value || org?.members[profileId]) continue;
    out.push({
      key: `${profileId}|legacy`, profileId, scope: { level: 'project', projectId }, roleId: seedRoleId(m.role.value),
      since: m.role.hlc, legacyRole: m.role.value
    });
  }
  return out;
}

/**
 * Members assigned exactly at a home's level (ORG-5). At the organization
 * that includes anyone assigned to all of its languages (a project-level
 * membership of its work partition, from before decision 34).
 */
export function membersAt(entries: MemberEntry[], level: ScopeLevel, projectId: string, laneId?: string): MemberEntry[] {
  return entries.filter((e) => sameScope(e.scope, scopeAt(level, projectId, laneId))
    || (level === 'org' && e.scope.level === 'project' && e.scope.projectId === projectId));
}

/** Members from the levels above a home, shown view-only there (ORG-5). */
export function membersAbove(entries: MemberEntry[], level: ScopeLevel, projectId: string): MemberEntry[] {
  if (level === 'org') return [];
  return entries.filter((e) => e.scope.level === 'org' || (level === 'lane' && e.scope.level === 'project' && e.scope.projectId === projectId));
}

/** Members assigned at a language of this organization, grouped by language, for "Expand by". */
export function groupBelow(entries: MemberEntry[], projectId: string): Map<string, MemberEntry[]> {
  const out = new Map<string, MemberEntry[]>();
  for (const e of entries) {
    if (e.scope.level !== 'lane' || e.scope.projectId !== projectId || !e.scope.laneId) continue;
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
 * Legacy project members are not handled here (their role is a project event).
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
export function reviewEligible(org: OrgState | null, project: ProjectState | null, projectId: string, laneId: string): string[] {
  const out = new Set<string>();
  for (const profileId of Object.keys(org?.members ?? {})) {
    if (org && privilegesFor(org, profileId, { projectId, laneId }).has('review')) out.add(profileId);
  }
  for (const [profileId, m] of Object.entries(project?.members ?? {})) {
    if (m.removed.value || org?.members[profileId]) continue;
    if (privilegesOfFixedRole(m.role.value).has('review')) out.add(profileId);
  }
  return [...out].sort();
}

export function teamMembers(state: ProjectState, teamId: string): string[] {
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
export function saveTeam(state: ProjectState, c: { commandId: string; teamId: string; laneId: string; name: string; members: string[] }): { specs: EventSpec[]; undo: (() => EventSpec[]) | null } {
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

let canon: Map<string, number> | null = null;
/** Books of the Protestant canon in order; the first 39 are the Old Testament. */
function testamentOf(bookId: string): 'ot' | 'nt' | null {
  canon ??= new Map((contentTemplate('bible')?.items.filter((i) => i.parentItemId === null) ?? []).map((b, i) => [b.itemId, i]));
  const i = canon.get(bookId);
  return i === undefined ? null : i < 39 ? 'ot' : 'nt';
}

/**
 * The template a new language starts from (ORG-2): the one most languages
 * in the organization already use, else the first it has enabled.
 */
export function suggestedTemplate(state: ProjectState | null, org: OrgState | null, projectId: string): string {
  const counts = new Map<string, number>();
  for (const sel of Object.values(state?.laneTemplates ?? {})) counts.set(sel.value.templateId, (counts.get(sel.value.templateId) ?? 0) + 1);
  const used = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0];
  if (used && contentTemplate(used)) return used;
  const enabled = contentTemplates().find((t) => !org || catalogEnabled(org, 'template', t.id, projectId));
  return enabled?.id ?? contentTemplates()[0]!.id;
}

/** The units a scope covers in a template: its books in that testament and everything under them. */
export function unitsInScope(templateId: string, scope: LanguageScope): EventPayloads['v1.UnitAdded'][] {
  const t = contentTemplate(templateId);
  if (!t) return [];
  const parent = new Map(t.items.map((i) => [i.itemId, i.parentItemId]));
  const root = (id: string): string => {
    let at = id;
    for (let p = parent.get(at); p; p = parent.get(at)) at = p;
    return at;
  };
  const keep = new Set(t.items.filter((i) => scope === 'all' || testamentOf(root(i.itemId)) === scope).map((i) => i.itemId));
  return instantiateTemplate(templateId).filter((u) => keep.has(u.unitId.slice(u.unitId.indexOf('/') + 1)));
}

/**
 * Add a language: the lane, its name for people (read everywhere through
 * core `laneName`), the template it uses, and the passages its scope needs
 * that the organization does not have yet (units are shared across languages).
 */
export function addLanguage(state: ProjectState | null, c: { commandId: string; laneId: string; code: string; name: string; templateId: string; scope: LanguageScope }): EventSpec[] {
  const code = c.code.trim().toLowerCase();
  const name = c.name.trim();
  if (!code) throw new Error('Enter a language code.');
  if (state?.lanes[c.laneId]) throw new Error('That language is already here.');
  const next = counter(c.commandId);
  const specs: EventSpec[] = [spec(next(), 'v1.LaneAdded', { laneId: c.laneId, languoidId: code })];
  if (name) specs.push(spec(next(), 'v1.LaneNamed', { laneId: c.laneId, name }));
  specs.push(spec(next(), 'v1.LaneTemplateSelected', { laneId: c.laneId, templateId: c.templateId, catalogVersion: CATALOG_VERSION }));
  for (const u of unitsInScope(c.templateId, c.scope)) if (!state?.units[u.unitId]) specs.push(spec(next(), 'v1.UnitAdded', u));
  return specs;
}

/** A lane id people can read in logs, unique per add: "L-din-3f9a2c". */
export function newLaneId(code: string, random: string): string {
  const slug = code.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') || 'lang';
  return `L-${slug}-${random.replace(/-/g, '').slice(0, 6)}`;
}
