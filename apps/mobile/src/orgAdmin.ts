// Pure derivations and event plans behind the organization screens
// (screens/org.tsx), kept free of React Native so they can be tested.
// Demo sources: ng-langquest-ux src/screens/org.tsx and the helpers in
// src/data.ts (SCOPE_LABEL, grantScopeAt, assignableScopes,
// memberIsEditableAt, languageReviewers). Requirements ORG-1, ORG-2, ORG-5,
// ORG-6, ORG-7, FLOW-5.
import {
  FLOWS, languagePeople, orgLanguages, privilegesFor, scopeKey,
  type EventPayloads, type LanguageInfo, type EventSpec, type EventType, type LanguageState, type OrgState, type Scope, type ScopeLevel, type TemplateDoc
} from '@langquest-next/core';
import { canonIndex, STARTER_TEMPLATE, type LibraryChoice } from './contentTemplates';
import { t } from './i18n';
import { formatNumber } from './i18n/format';

// ---- levels ------------------------------------------------------------------------

/** The two levels a role is granted at: the organization, which covers every language, and one language (decision 63). */
export function levelLabel(level: ScopeLevel): string {
  return level === 'org' ? t('org.levels.org') : t('org.levels.language');
}

/** A `level` param back to a level; anything else reads as the organization. */
export function parseLevel(value: string | undefined): ScopeLevel {
  return value === 'language' ? value : 'org';
}

function scopeAt(level: ScopeLevel, languageId: string): Scope {
  return level === 'org' ? { level } : { level, languageId };
}

function sameScope(a: Scope, b: Scope): boolean {
  return scopeKey(a) === scopeKey(b);
}

/**
 * May this person grant a role, or issue an invite, at a scope? Only where
 * they hold Invite: at org scope, or at a language they hold it for. The
 * server checks the same (rule 6 of docs/streams-and-languages.md).
 */
export function mayGrantAt(org: OrgState | null, actorId: string, scope: Scope): boolean {
  return !!org && privilegesFor(org, actorId, scope.level === 'language' ? scope.languageId : undefined).has('invite_members');
}

/** The languages this person may grant roles in, by name. */
export function grantableLanguages(org: OrgState | null, actorId: string): string[] {
  return orgLanguages(org).filter((l) => mayGrantAt(org, actorId, scopeAt('language', l.languageId))).map((l) => l.languageId);
}

/**
 * Demo `assignableScopes`: the levels this person may grant at from a home,
 * highest first. A language home grants at the language only; the
 * organization's home also at the organization, for someone who holds
 * Invite there (ORG-6).
 */
export function assignableLevels(org: OrgState | null, actorId: string, view: ScopeLevel): ScopeLevel[] {
  const out: ScopeLevel[] = [];
  if (view === 'org' && mayGrantAt(org, actorId, { level: 'org' })) out.push('org');
  if (grantableLanguages(org, actorId).length > 0) out.push('language');
  return out;
}

/** Demo `grantScopeAt`: the highest level this person may grant at from a home, or null. */
export function grantFloor(org: OrgState | null, actorId: string, view: ScopeLevel): ScopeLevel | null {
  return assignableLevels(org, actorId, view)[0] ?? null;
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
  return p.total === 0 ? t('org.progress.none')
    : t('org.progress.line', { recorded: formatNumber(p.recorded), total: formatNumber(p.total), done: formatNumber(p.done) });
}

// ---- members -----------------------------------------------------------------------

/** One person's role at one scope. */
export interface MemberEntry {
  key: string;
  profileId: string;
  scope: Scope;
  roleId: string;
  /** When the role was granted (the register's clock), for "joined". */
  since: string;
}

/** Everyone with a role somewhere: the organization's active memberships at every scope. */
export function memberEntries(org: OrgState | null): MemberEntry[] {
  const out: MemberEntry[] = [];
  for (const [profileId, scopes] of Object.entries(org?.members ?? {})) {
    for (const [key, m] of Object.entries(scopes)) {
      if (m.removed.value !== false) continue;
      out.push({ key: `${profileId}|${key}`, profileId, scope: m.scope, roleId: m.roleId.value, since: m.roleId.hlc });
    }
  }
  return out;
}

/** Members assigned exactly at a home's level (ORG-5): the organization, or that language. */
export function membersAt(entries: MemberEntry[], level: ScopeLevel, languageId = ''): MemberEntry[] {
  const at = scopeAt(level, languageId);
  return entries.filter((e) => sameScope(e.scope, at));
}

/** Members from the level above a home, shown view only there (ORG-5): the organization's, on a language home. */
export function membersAbove(entries: MemberEntry[], level: ScopeLevel): MemberEntry[] {
  return level === 'org' ? [] : entries.filter((e) => e.scope.level === 'org');
}

/** Members assigned at a language, grouped by language, for "Expand by". */
export function groupBelow(entries: MemberEntry[]): Map<string, MemberEntry[]> {
  const out = new Map<string, MemberEntry[]>();
  for (const e of entries) {
    if (e.scope.level !== 'language') continue;
    out.set(e.scope.languageId, [...(out.get(e.scope.languageId) ?? []), e]);
  }
  return out;
}

/** An organization-stream write (ctx.org.append), in the order to apply it. */
export type OrgOp =
  | { type: 'v1.MemberAdded'; payload: EventPayloads['v1.MemberAdded'] }
  | { type: 'v1.MemberRemoved'; payload: EventPayloads['v1.MemberRemoved'] };

/**
 * Change a member's role or scope (ORG-7) and the writes that put it back
 * (CORE-5). A new scope is a new membership: the old one is removed.
 */
export function changeMembership(entry: MemberEntry, next: { roleId: string; scope: Scope }): { apply: OrgOp[]; undo: OrgOp[] } {
  const add = (roleId: string, scope: Scope): OrgOp => ({ type: 'v1.MemberAdded', payload: { profileId: entry.profileId, roleId, scope } });
  const remove = (scope: Scope): OrgOp => ({ type: 'v1.MemberRemoved', payload: { profileId: entry.profileId, scope } });
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
    apply: [{ type: 'v1.MemberRemoved', payload: { profileId: entry.profileId, scope: entry.scope } }],
    undo: [{ type: 'v1.MemberAdded', payload: { profileId: entry.profileId, roleId: entry.roleId, scope: entry.scope } }]
  };
}

// ---- review teams (FLOW-5) ------------------------------------------------------------

/** Demo `languageReviewers`: people holding Review over this language. */
export function reviewEligible(org: OrgState | null, languageId: string): string[] {
  return [...languagePeople(org, languageId).values()].filter((p) => p.privileges.has('review')).map((p) => p.profileId).sort();
}

export function teamMembers(state: LanguageState, teamId: string): string[] {
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
export function saveTeam(state: LanguageState, c: { commandId: string; teamId: string; name: string; members: string[] }): { specs: EventSpec[]; undo: (() => EventSpec[]) | null } {
  const next = counter(c.commandId);
  const team = state.teams[c.teamId];
  const before = team ? teamMembers(state, c.teamId) : [];
  const chosen = new Set(c.members);
  const name = c.name.trim();
  const specs: EventSpec[] = [];
  if (!team || team.name.value !== name) specs.push(spec(next(), 'v1.ReviewTeamDefined', { teamId: c.teamId, name }));
  for (const id of [...chosen].sort()) if (!before.includes(id)) specs.push(spec(next(), 'v1.ReviewTeamMemberSet', { teamId: c.teamId, profileId: id, member: true }));
  for (const id of before) if (!chosen.has(id)) specs.push(spec(next(), 'v1.ReviewTeamMemberSet', { teamId: c.teamId, profileId: id, member: false }));
  if (!team) return { specs, undo: null };
  const oldName = team.name.value;
  return {
    specs,
    undo: () => {
      const back = counter(`${c.commandId}:undo`);
      const out: EventSpec[] = [];
      if (oldName !== name) out.push(spec(back(), 'v1.ReviewTeamDefined', { teamId: c.teamId, name: oldName }));
      for (const id of before) if (!chosen.has(id)) out.push(spec(back(), 'v1.ReviewTeamMemberSet', { teamId: c.teamId, profileId: id, member: true }));
      for (const id of chosen) if (!before.includes(id)) out.push(spec(back(), 'v1.ReviewTeamMemberSet', { teamId: c.teamId, profileId: id, member: false }));
      return out;
    }
  };
}

// ---- a new language (ORG-2) ---------------------------------------------------------------

export type LanguageScope = 'nt' | 'ot' | 'all' | 'custom';
// Demo ADR-039 (amended 2026-10-08): the books a team chooses, not only a testament.
export const LANGUAGE_SCOPES: readonly LanguageScope[] = ['nt', 'ot', 'all', 'custom'];

/** The testament pills: "New Testament", "Old Testament", "Whole Bible", "Choose books". */
export function languageScopeLabel(scope: LanguageScope): string {
  switch (scope) {
    case 'nt': return t('org.scopes.nt');
    case 'ot': return t('org.scopes.ot');
    case 'all': return t('org.scopes.all');
    case 'custom': return t('org.scopes.custom');
  }
}

/**
 * The books of a Bible template a scope covers (USFM codes; the first 39
 * are the Old Testament, the next 27 the New). Undefined means all of them,
 * so books a later version adds reach the language too; an outline has no
 * books.
 */
export function booksInScope(doc: TemplateDoc, scope: LanguageScope, chosen: ReadonlySet<string> = new Set()): string[] | undefined {
  if (scope === 'all' || doc.structure !== 'bible' || !doc.bible) return undefined;
  if (scope === 'custom') return doc.bible.books.map((b) => b.book).filter((b) => chosen.has(b));
  return doc.bible.books.map((b) => b.book).filter((b) => {
    const i = canonIndex(b);
    return scope === 'ot' ? i >= 0 && i < 39 : i >= 39 && i < 66;
  });
}

/** The flow LangQuest suggests to a language that has nothing to go by. */
export const STARTER_FLOW = { orgId: STARTER_TEMPLATE.orgId, name: FLOWS[0]!.name } as const;

/**
 * What a new language starts from (ORG-2): the item the open language uses,
 * else LangQuest's starter, else the first there is. Returns a choice's
 * key, or null when there is nothing to choose.
 */
export function suggestedChoice(inUse: string | null | undefined, choices: LibraryChoice[], starter: { orgId: string; name: string }): string | null {
  const used = inUse ? choices.find((c) => c.source === 'ours' && c.item.itemId === inUse) : undefined;
  if (used) return used.key;
  const first = choices.find((c) => c.name === starter.name && (c.source === 'ours' || c.shared.org_id === starter.orgId));
  return (first ?? choices[0])?.key ?? null;
}

/**
 * Add a language: `LanguageAdded` for the organization's stream, then the
 * new language's own first events, its template (`TemplateSelected` and
 * the units it needs) and its flow (`FlowSelected` and its steps), as
 * `applySpecs` from the library made them. A language needs both, so a
 * missing one is refused here. The language's stream accepts its events
 * once the organization's lists it. One picked from the language list also
 * gets `LanguageCodeSet` (`link`), which links it to that languoid.
 */
export function addLanguage(
  org: OrgState | null,
  c: { languageId: string; code: string; name: string; template: EventSpec[]; flow: EventSpec[]; languoidId?: string | null }
): { added: EventPayloads['v1.LanguageAdded']; link: EventPayloads['v1.LanguageCodeSet'] | null; specs: EventSpec[] } {
  const code = c.code.trim().toLowerCase();
  const name = c.name.trim();
  if (!code) throw new Error('Enter a language code.');
  if (org?.languages[c.languageId]?.added) throw new Error('That language is already here.');
  if (!c.template.some((s) => s.type === 'v1.TemplateSelected')) throw new Error('Choose a template.');
  if (!c.flow.some((s) => s.type === 'v1.FlowSelected')) throw new Error('Choose a review flow.');
  return {
    added: { languageId: c.languageId, name: name || code.toUpperCase(), code, sourceCode: SOURCE_CODE },
    // Picked from the language list: linked to it from the start. Typed in, it stays unlinked until someone links it.
    link: c.languoidId ? { languageId: c.languageId, code, languoidId: c.languoidId } : null,
    specs: [...c.template, ...c.flow]
  };
}

/**
 * Languages already in the organization that a new one may repeat: the
 * same code, or the same name once case, accents, spaces and punctuation
 * are set aside. Ids identify a language, never its name or code, so two
 * admins can add one language twice, offline above all (decision 76).
 * This only warns: the screen says so and lets them go on. `except` is
 * the language being renamed, which is not a repeat of itself.
 */
export function similarLanguages(org: OrgState | null, c: { code: string; name: string; except?: string }): LanguageInfo[] {
  const code = c.code.trim().toLowerCase();
  const name = nameKey(c.name);
  if (!code && !name) return [];
  return orgLanguages(org).filter((l) => l.languageId !== c.except &&
    ((!!code && l.code.toLowerCase() === code) || (!!name && nameKey(l.name) === name)));
}

const nameKey = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The language source Bibles are offered in: the app ships English
 * readings (BSB, WEB, KJV), so a new language starts from them.
 */
const SOURCE_CODE = 'eng';

/** A language id people can read in logs, unique per add: "L-din-3f9a2c". It is also its stream's id. */
export function newLanguageId(code: string, random: string): string {
  const slug = code.trim().toLowerCase().replace(/[^a-z0-9]+/g, '') || 'lang';
  return `L-${slug}-${random.replace(/-/g, '').slice(0, 6)}`;
}
