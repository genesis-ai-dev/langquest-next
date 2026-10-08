// Pure reading behind the admin's simple screens (decision 71, demo ADR-039):
// getting a language ready as four plain questions, the ready language's
// summary, letting someone in, inviting, and a role's switches. The words
// here are the admin's, never the model's (no "template", "flow" or
// "reference material"): each function turns a library document, a flow's
// steps or a set of privileges into what an admin who knows nothing about
// the app would say. No React, no I/O, so it is tested on its own
// (test/adminModel.test.ts).
import {
  englishBookName, canonIndex
} from '../contentTemplates';
import {
  languagePeople, PRIVILEGES,
  type KindDef, type OrgState, type Privilege, type TemplateDoc
} from '@langquest-next/core';
import { booksInScope, type LanguageScope } from '../orgAdmin';

// ---- the four questions -------------------------------------------------------------

/** The four questions, in the order an admin thinks (demo ADR-039). */
export const QUESTIONS = [
  { id: 'record', label: 'What will they record?', icon: 'template' },
  { id: 'helps', label: 'What will help them?', icon: 'listen' },
  { id: 'checks', label: 'Who checks the recordings?', icon: 'people' },
  { id: 'invite', label: 'Invite your translators', icon: 'qr' }
] as const;
export type QuestionId = (typeof QUESTIONS)[number]['id'];

export interface ReadyFacts {
  /** The language records against a template. */
  template: boolean;
  /** Bibles, guides or notes are offered to its team (recommended for it). */
  helps: boolean;
  /** It has a way of checking (a flow, even one with no checks). */
  flow: boolean;
  /** People given a role that translates in this language (`languageTranslators`). */
  translators: number;
  /** An invite was issued for it (someone may be about to join). */
  invited: boolean;
}

export interface Readiness {
  /** Per question, in QUESTIONS order. */
  done: boolean[];
  /** The first question not answered yet, or -1 when all are. */
  current: number;
  /**
   * Ready for translators: something to record, a way to check it, and
   * someone to do it. What helps them is offered, never required: a team
   * can start without a Bible chosen (they still explore any Bible).
   */
  ready: boolean;
}

export function readiness(f: ReadyFacts): Readiness {
  const people = f.translators > 0 || f.invited;
  const done = [f.template, f.helps, f.flow, people];
  return { done, current: done.findIndex((d) => !d), ready: f.template && f.flow && people };
}

/**
 * The people who translate in a language: whoever holds Translate there
 * (at the language or the organization), not counting those who run the
 * team (Assign Work), who hold it too.
 */
export function translatorsOf(org: OrgState | null, languageId: string): string[] {
  return [...languagePeople(org, languageId).values()]
    .filter((p) => p.privileges.has('translate') && !p.privileges.has('assign_work'))
    .map((p) => p.profileId)
    .sort();
}

/**
 * People given a role that translates in this language itself (not the
 * organization's translators, who cover every language): whether someone
 * was invited for it yet.
 */
export function languageTranslators(org: OrgState | null, languageId: string): string[] {
  if (!org) return [];
  const out = new Set<string>();
  for (const [profileId, scopes] of Object.entries(org.members)) {
    for (const m of Object.values(scopes)) {
      if (m.removed.value !== false || m.scope.level !== 'language' || m.scope.languageId !== languageId) continue;
      const role = org.roles[m.roleId.value];
      if (role && !role.retired && role.privileges.value?.includes('translate')) out.add(profileId);
    }
  }
  return [...out].sort();
}

/** Was an invite issued for this language? */
export function invitedTo(org: OrgState | null, languageId: string): boolean {
  return Object.values(org?.invites ?? {}).some((i) => !!i.roleId && i.scope.level === 'language' && i.scope.languageId === languageId);
}

// ---- what they record ---------------------------------------------------------------

/** What a template divides the work into, in an admin's words. */
export type RecordKind = 'stories' | 'chapters' | 'books' | 'outline';

export function recordKind(doc: TemplateDoc | null | undefined): RecordKind | null {
  if (!doc) return null;
  if (doc.structure === 'outline') return 'outline';
  switch (doc.bible?.divide) {
    case 'passages': return 'stories';
    case 'chapters': return 'chapters';
    case 'books': return 'books';
    default: return null;
  }
}

export const RECORD_LABEL: Record<RecordKind, { title: string; sub: string }> = {
  stories: { title: 'Bible stories', sub: 'One story at a time' },
  chapters: { title: 'Bible chapters', sub: 'One chapter at a time' },
  books: { title: 'Whole books', sub: 'One book at a time' },
  outline: { title: 'Something else', sub: 'Songs, lessons, your own list' }
};

/** "LUK 15:1-7" as people read it: "Luke 15:1–7". */
export function readableRef(ref: string): string {
  const m = /^([1-3A-Z]{3})\s+(.*)$/.exec(ref.trim());
  if (!m) return ref;
  return `${englishBookName(m[1]!)} ${m[2]!.replace(/-/g, '–')}`;
}

/**
 * A few of what they would record, to show under a choice: named stories
 * ("The lost sheep · Luke 15:1–7"), the lost sheep and coin first when the
 * set has them (everyone knows them); an outline's first items.
 */
export function recordExamples(doc: TemplateDoc | null | undefined, n = 2): string[] {
  if (!doc) return [];
  if (doc.structure === 'outline') return (doc.outline ?? []).slice(0, n).map((o) => o.title);
  const bible = doc.bible;
  if (!bible) return [];
  if (bible.divide === 'passages') {
    const all = bible.passages ?? [];
    const named = all.filter((p) => p.name);
    const list = named.length ? named : all;
    const luke15 = list.findIndex((p) => /^LUK 15:/.test(p.ref));
    const from = luke15 >= 0 ? luke15 : 0;
    return list.slice(from, from + n).map((p) => (p.name ? `${p.name} · ${readableRef(p.ref)}` : readableRef(p.ref)));
  }
  if (bible.divide === 'chapters') {
    const luke = bible.books.some((b) => b.book === 'LUK');
    const book = luke ? 'LUK' : bible.books[0]?.book;
    if (!book) return [];
    const first = luke ? 15 : 1;
    return Array.from({ length: n }, (_, i) => `${englishBookName(book)} ${first + i}`);
  }
  return bible.books.slice(0, n).map((b) => englishBookName(b.book));
}

const TESTAMENT_LABEL: Record<Exclude<LanguageScope, 'custom'>, string> = { nt: 'New Testament', ot: 'Old Testament', all: 'Whole Bible' };

/** Which part of the Bible a language's books are, as the testament pills read it. */
export function scopeOfBooks(doc: TemplateDoc | null | undefined, books: readonly string[] | undefined): LanguageScope {
  if (!doc?.bible || books === undefined) return 'all';
  const same = (a: readonly string[], b: readonly string[] | undefined) => !!b && a.length === b.length && a.every((x) => b.includes(x));
  if (same(books, booksInScope(doc, 'nt'))) return 'nt';
  if (same(books, booksInScope(doc, 'ot'))) return 'ot';
  if (same(books, doc.bible.books.map((b) => b.book))) return 'all';
  return 'custom';
}

/** "New Testament", or for chosen books "Luke and Acts" / "5 books". */
export function scopeLabel(scope: LanguageScope, books: readonly string[] = []): string {
  if (scope !== 'custom') return TESTAMENT_LABEL[scope];
  const sorted = [...books].sort((a, b) => canonIndex(a) - canonIndex(b)).map(englishBookName);
  if (sorted.length === 0) return 'No books yet';
  if (sorted.length <= 2) return sorted.join(' and ');
  return `${sorted.length} books`;
}

/** "Bible stories · New Testament" for the checklist and the language page. */
export function recordSummary(doc: TemplateDoc | null | undefined, books: readonly string[] | undefined, name?: string): string {
  const kind = recordKind(doc);
  if (!kind) return name ?? 'Chosen';
  if (kind === 'outline') return name ?? doc?.name ?? 'Your own list';
  return `${RECORD_LABEL[kind].title} · ${scopeLabel(scopeOfBooks(doc, books), books)}`;
}

// ---- who checks ----------------------------------------------------------------------

/** Each shipped kind of check in an admin's words: the step's name, who does it, and the noun for a summary. */
const PLAIN_KIND: Record<string, { step: string; who: string; noun: string; just: string }> = {
  peer: { step: 'Peer check', who: 'Another translator', noun: 'team', just: 'the team' },
  bt: { step: 'Back translation', who: 'A back-translator', noun: 'back translation', just: 'a back translation' },
  community: { step: 'Community check', who: 'The community', noun: 'community', just: 'the community' },
  consultant: { step: 'Consultant check', who: 'A consultant', noun: 'a consultant', just: 'a consultant' },
  final: { step: 'Final approval', who: 'You approve', noun: 'your approval', just: 'your approval' },
  retell: { step: 'Retelling', who: 'Someone retells it', noun: 'retelling', just: 'retelling' },
  local: { step: 'Local check', who: 'Local listeners', noun: 'local listeners', just: 'local listeners' }
};

function plainKind(id: string, kinds: readonly KindDef[]) {
  const known = PLAIN_KIND[id];
  if (known) return known;
  const k = kinds.find((x) => x.id === id);
  const name = k?.name ?? id.replace(/_/g, ' ');
  return { step: name, who: k?.usualReviewer || name, noun: name.toLowerCase(), just: name.toLowerCase() };
}

interface PlainStep {
  kindIds: readonly string[];
  checkpoint?: boolean;
}

/** "Peer check and back translation": a step's kinds, joined. */
export function stepTitle(kindIds: readonly string[], kinds: readonly KindDef[]): string {
  const names = kindIds.map((id, i) => {
    const s = plainKind(id, kinds).step;
    return i === 0 ? s : s.charAt(0).toLowerCase() + s.slice(1);
  });
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Who usually does a step, as a short line ("Another translator"). */
export function stepWho(kindIds: readonly string[], kinds: readonly KindDef[]): string {
  return kindIds.length ? plainKind(kindIds[0]!, kinds).who : '';
}

/** The checks a flow makes before approval (an approval-only step is not a check). */
function checks(steps: readonly PlainStep[]): PlainStep[] {
  return steps.filter((s) => s.kindIds.some((k) => k !== 'final'));
}

/** "Team, community, then a consultant"; "Just the community"; "No checks". */
export function flowTitle(steps: readonly PlainStep[], kinds: readonly KindDef[]): string {
  const nouns: string[] = [];
  for (const s of checks(steps)) {
    const n = plainKind(s.kindIds.find((k) => k !== 'final')!, kinds);
    if (nouns.at(-1) !== n.noun) nouns.push(n.noun);
  }
  if (nouns.length === 0) return steps.length ? 'Just your approval' : 'No checks';
  if (nouns.length === 1) {
    const first = checks(steps)[0]!.kindIds.find((k) => k !== 'final')!;
    return `Just ${plainKind(first, kinds).just}`;
  }
  const text = `${nouns.slice(0, -1).join(', ')}, then ${nouns.at(-1)}`;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The same, shorter, for a summary line: "Team, community, consultant". */
export function flowShort(steps: readonly PlainStep[], kinds: readonly KindDef[]): string {
  const nouns: string[] = [];
  for (const s of checks(steps)) {
    const n = plainKind(s.kindIds.find((k) => k !== 'final')!, kinds).noun.replace(/^an? /, '');
    if (nouns.at(-1) !== n) nouns.push(n);
  }
  if (nouns.length === 0) return flowTitle(steps, kinds);
  const text = nouns.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "One check", "3 checks", "Done once recorded". */
export function flowSub(steps: readonly PlainStep[]): string {
  const n = checks(steps).length;
  if (steps.length === 0) return 'Done once recorded';
  if (n === 0) return 'You approve each one';
  return n === 1 ? 'One check' : `${n} checks`;
}

/** Where a dragged step lands: its place moved by how many cards it crossed. */
export function dropIndex(from: number, dy: number, cardHeight: number, count: number): number {
  if (cardHeight <= 0) return from;
  return Math.max(0, Math.min(count - 1, from + Math.round(dy / cardHeight)));
}

/** A list with one item moved from one place to another. */
export function moveTo<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [it] = next.splice(from, 1);
  next.splice(to, 0, it!);
  return next;
}

/** The numbered lines under a choice: who does each step, and whether it must pass. */
export function flowWho(steps: readonly PlainStep[], kinds: readonly KindDef[]): { label: string; lock: boolean }[] {
  return steps.map((s) => ({ label: stepWho(s.kindIds, kinds), lock: !!s.checkpoint }));
}

// ---- what will they do (roles, in plain words) ------------------------------------------

export type PlainRoleId = 'translate' | 'check' | 'backtranslate' | 'lead';

export const PLAIN_ROLES: { id: PlainRoleId; label: string; chip: string; icon: 'mic' | 'check' | 'globe' | 'people' }[] = [
  { id: 'translate', label: 'Translate', chip: 'Translate', icon: 'mic' },
  { id: 'check', label: 'Check recordings', chip: 'Check', icon: 'check' },
  { id: 'backtranslate', label: 'Back-translate', chip: 'Back-translate', icon: 'globe' },
  { id: 'lead', label: 'Help run the team', chip: 'Help run the team', icon: 'people' }
];

export interface RoleInfo {
  id: string;
  name: string;
  privileges: readonly Privilege[];
}

/** Running the team: what makes a role more than doing or checking the work. */
const RUNS: readonly Privilege[] = ['invite_members', 'manage_roles', 'manage_structure', 'manage_templates', 'shape_templates',
  'manage_reference', 'manage_flows', 'manage_teams', 'assign_work', 'override_checkpoints'];
const runs = (r: RoleInfo) => r.privileges.some((p) => RUNS.includes(p));
const has = (r: RoleInfo, p: Privilege) => r.privileges.includes(p);
const fewest = (list: RoleInfo[]) => [...list].sort((a, b) => a.privileges.length - b.privileges.length || a.name.localeCompare(b.name))[0];

/**
 * The four plain choices and the role each one gives, from the roles the
 * organization has: the seed role when it is there, else the closest one.
 * Back-translating is checking work (a back translation is a kind of
 * review), so without a role of its own it gives the checking role. A
 * choice with no role to give is left out. `others` are the roles no
 * choice gives, offered one tap deeper.
 */
export function plainRoleChoices(roles: readonly RoleInfo[]): { choices: { id: PlainRoleId; label: string; chip: string; icon: string; roleId: string }[]; others: RoleInfo[] } {
  const byId = (id: string) => roles.find((r) => r.id === id);
  const translate = byId('translator') ?? fewest(roles.filter((r) => has(r, 'translate') && !has(r, 'review') && !runs(r)));
  const check = byId('reviewer') ?? fewest(roles.filter((r) => has(r, 'review') && !has(r, 'translate') && !runs(r)));
  const back = roles.find((r) => /back.?transl/i.test(r.name) && has(r, 'review'))
    ?? fewest(roles.filter((r) => has(r, 'review') && has(r, 'translate') && !runs(r))) ?? check;
  const lead = byId('coordinator') ?? fewest(roles.filter((r) => has(r, 'assign_work') && !has(r, 'manage_roles')));
  const given: Record<PlainRoleId, RoleInfo | undefined> = { translate, check, backtranslate: back, lead };
  const choices = PLAIN_ROLES.flatMap((c) => (given[c.id] ? [{ ...c, roleId: given[c.id]!.id }] : []));
  const used = new Set(choices.map((c) => c.roleId));
  return { choices, others: roles.filter((r) => !used.has(r.id)) };
}

// ---- a role's switches --------------------------------------------------------------

/**
 * A role's permissions as three groups of switches (demo ADR-039). A few
 * permissions share one switch: setting up a language covers its passages
 * and how they divide; choosing who checks covers the review groups. Every
 * permission is under exactly one switch (tested).
 */
export const ROLE_SWITCHES: { title: string; rows: { label: string; privileges: Privilege[] }[] }[] = [
  { title: 'Do the work', rows: [
    { label: 'Record', privileges: ['translate'] },
    { label: 'Add notes and key words', privileges: ['fill_reference'] },
    { label: 'Ask for checks', privileges: ['send_to_reviewers'] }
  ] },
  { title: 'Check the work', rows: [
    { label: 'Check recordings', privileges: ['review'] },
    { label: 'See everyone’s work', privileges: ['view_status'] }
  ] },
  { title: 'Run the team', rows: [
    { label: 'Invite people', privileges: ['invite_members'] },
    { label: 'Set up languages', privileges: ['manage_structure', 'manage_templates', 'shape_templates'] },
    { label: 'Choose Bibles and guides', privileges: ['manage_reference'] },
    { label: 'Choose who checks', privileges: ['manage_flows', 'manage_teams'] },
    { label: 'Assign work', privileges: ['assign_work'] },
    { label: 'Let work past a locked check', privileges: ['override_checkpoints'] },
    { label: 'Make and change roles', privileges: ['manage_roles'] }
  ] }
];

/** On, off, or only some of what the switch covers (a role made before the switches). */
export function switchState(privileges: readonly Privilege[], row: { privileges: readonly Privilege[] }): 'on' | 'off' | 'some' {
  const n = row.privileges.filter((p) => privileges.includes(p)).length;
  return n === 0 ? 'off' : n === row.privileges.length ? 'on' : 'some';
}

/** Flip a switch: all of what it covers on (from off or some), or all off. In the canonical order. */
export function flipSwitch(privileges: readonly Privilege[], row: { privileges: readonly Privilege[] }): Privilege[] {
  const on = switchState(privileges, row) !== 'on';
  const next = new Set(privileges.filter((p) => !row.privileges.includes(p)));
  if (on) for (const p of row.privileges) next.add(p);
  return PRIVILEGES.filter((p) => next.has(p));
}

// ---- time and names ------------------------------------------------------------------

/** "Asked 10 minutes ago", "Asked just now", "Asked yesterday". */
export function askedAgo(createdAt: string | undefined, now: number): string {
  const t = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(t)) return 'Asked to join';
  const min = Math.max(0, Math.round((now - t) / 60000));
  if (min < 1) return 'Asked just now';
  if (min < 60) return `Asked ${min} minute${min === 1 ? '' : 's'} ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `Asked ${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return d === 1 ? 'Asked yesterday' : `Asked ${d} days ago`;
}

/** A person's first name, for "Let Deng in". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** Names of the languages Bibles and guides are written in, for lines like "Amharic and English Bibles". */
const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English', amh: 'Amharic', orm: 'Oromo', fra: 'French', por: 'Portuguese', spa: 'Spanish', hin: 'Hindi',
  cmn: 'Mandarin Chinese', arb: 'Arabic', arz: 'Arabic', swh: 'Swahili', swa: 'Swahili', tir: 'Tigrinya', som: 'Somali',
  hau: 'Hausa', yor: 'Yoruba', ibo: 'Igbo', rus: 'Russian', ind: 'Indonesian', tha: 'Thai', vie: 'Vietnamese', din: 'Dinka', nus: 'Nuer'
};

export function languageLabel(code: string | null | undefined): string {
  if (!code) return '';
  return LANGUAGE_NAMES[code.toLowerCase()] ?? code.toUpperCase();
}

/** "Amharic and English", "Amharic, English and Oromo". */
export function joinAnd(names: readonly string[]): string {
  const list = [...new Set(names.filter(Boolean))];
  return list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
}

/** "FIA study guides (English)" -> "FIA": the short name of a set of guides. */
export function guideShortName(name: string): string {
  const short = name.replace(/\(.*?\)/g, '').replace(/study guides?/i, '').replace(/guides?/i, '').trim();
  return short || name;
}

/** "Amharic and English Bibles · FIA guides", or what is missing. */
export function helpsSummary(bibleLanguages: readonly string[], guides: readonly string[], notes: number): string {
  const parts: string[] = [];
  if (bibleLanguages.length) parts.push(`${joinAnd(bibleLanguages)} Bible${bibleLanguages.length === 1 ? '' : 's'}`);
  if (guides.length) parts.push(`${joinAnd(guides)} guides`);
  if (notes) parts.push(`${notes} note${notes === 1 ? '' : 's'}`);
  return parts.length ? parts.join(' · ') : 'Nothing offered yet';
}
