// Pure reading behind the admin's simple screens (decision 71, demo ADR-039):
// getting a language ready as four plain questions, the ready language's
// summary, letting someone in, inviting, and a role's switches. The words
// here are the admin's, never the model's (no "template", "flow" or
// "reference material"): each function turns a library document, a flow's
// steps or a set of privileges into what an admin who knows nothing about
// the app would say. No React, no I/O, so it is tested on its own
// (test/adminModel.test.ts). The words are in the language showing (LAN-42):
// whole catalog sentences, never English grammar put together here.
import { canonIndex } from '../contentTemplates';
import {
  bookIdOf, languagePeople, PRIVILEGES, templateBooks,
  type KindDef, type OrgState, type Privilege, type TemplateDoc
} from '@langquest-next/core';
import { bookName } from '../coreText';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { booksInScope, languageScopeLabel, type LanguageScope } from '../orgAdmin';

// ---- the four questions -------------------------------------------------------------

/** The four questions, in the order an admin thinks (demo ADR-039). */
export const QUESTIONS = [
  { id: 'record', icon: 'template' },
  { id: 'helps', icon: 'listen' },
  { id: 'checks', icon: 'people' },
  { id: 'invite', icon: 'qr' }
] as const;
export type QuestionId = (typeof QUESTIONS)[number]['id'];

/** A question as the admin reads it: "What will they record?". */
export function questionLabel(id: QuestionId): string {
  switch (id) {
    case 'record': return t('admin.questions.record');
    case 'helps': return t('admin.questions.helps');
    case 'checks': return t('admin.questions.checks');
    case 'invite': return t('admin.questions.invite');
  }
}

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
  // A template@2 breaks up each book its own way: passages anywhere read as stories.
  const divides = new Set(templateBooks(doc).map((b) => b.divide));
  if (divides.has('passages')) return 'stories';
  if (divides.has('chapters')) return 'chapters';
  if (divides.has('book')) return 'books';
  return doc.format === 'template@2' ? 'chapters' : null;
}

/** What a template divides the work into, as a choice's title: "Bible stories". */
export function recordTitle(kind: RecordKind): string {
  switch (kind) {
    case 'stories': return t('admin.record.stories');
    case 'chapters': return t('admin.record.chapters');
    case 'books': return t('admin.record.books');
    case 'outline': return t('admin.record.outline');
  }
}

/** A book by its USFM code ("LUK") in the language showing; the code when core has no such book. */
function bookLabel(usfm: string): string {
  const id = bookIdOf(usfm);
  const name = bookName(id);
  return name === id ? usfm : name;
}

/** "LUK 15:1-7" as people read it: "Luke 15:1–7". */
export function readableRef(ref: string): string {
  const m = /^([1-3A-Z]{3})\s+(.*)$/.exec(ref.trim());
  if (!m) return ref;
  return t('admin.reference', { book: bookLabel(m[1]!), place: m[2]!.replace(/-/g, '–') });
}

/**
 * A few of what they would record, to show under a choice: named stories
 * ("The lost sheep · Luke 15:1–7"), the lost sheep and coin first when the
 * set has them (everyone knows them); an outline's first items.
 */
export function recordExamples(doc: TemplateDoc | null | undefined, n = 2): string[] {
  if (!doc) return [];
  if (doc.structure === 'outline') return (doc.outline ?? []).slice(0, n).map((o) => o.title);
  const books = templateBooks(doc);
  const passages = books.flatMap((b) => (b.divide === 'passages' ? b.passages ?? [] : []));
  if (passages.length) {
    const named = passages.filter((p) => p.name);
    const list = named.length ? named : passages;
    const luke15 = list.findIndex((p) => /^LUK 15:/.test(p.ref));
    const from = luke15 >= 0 ? luke15 : 0;
    return list.slice(from, from + n).map((p) => (p.name ? `${p.name} · ${readableRef(p.ref)}` : readableRef(p.ref)));
  }
  const byChapter = books.filter((b) => b.divide === 'chapters');
  if (byChapter.length) {
    const luke = byChapter.some((b) => b.book === 'LUK');
    const book = luke ? 'LUK' : byChapter[0]!.book;
    const first = luke ? 15 : 1;
    return Array.from({ length: n }, (_, i) => t('admin.bookChapter', { book: bookLabel(book), chapter: formatNumber(first + i) }));
  }
  return books.slice(0, n).map((b) => bookLabel(b.book));
}

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
  if (scope !== 'custom') return languageScopeLabel(scope);
  const sorted = [...books].sort((a, b) => canonIndex(a) - canonIndex(b)).map(bookLabel);
  if (sorted.length === 0) return t('admin.record.noBooks');
  if (sorted.length <= 2) return joinAnd(sorted);
  return t('admin.record.someBooks', { count: sorted.length });
}

/** "Bible stories · New Testament" for the checklist and the language page. */
export function recordSummary(doc: TemplateDoc | null | undefined, books: readonly string[] | undefined, name?: string): string {
  const kind = recordKind(doc);
  if (!kind) return name ?? t('admin.record.chosen');
  if (kind === 'outline') return name ?? doc?.name ?? t('admin.record.ownList');
  return `${recordTitle(kind)} · ${scopeLabel(scopeOfBooks(doc, books), books)}`;
}

// ---- who checks ----------------------------------------------------------------------

/**
 * A kind of check in an admin's words, each a whole catalog string so every
 * language says it its own way:
 * - `step`, the step's name ("Peer check"), and `stepLater`, the same after
 *   another in one step ("Peer check and back translation");
 * - `who` does it ("Another translator");
 * - `noun` for a flow's title, first (`nounFirst`, "Team, …") or later
 *   ("…, then a consultant"), and `short`/`shortFirst` for the summary line
 *   ("Team, community, consultant");
 * - `just`, the title of a flow with only this check ("Just the community").
 * Final approval is never a check, so it has only its step and who.
 */
interface PlainKind { step: string; stepLater: string; who: string; noun: string; nounFirst: string; short: string; shortFirst: string; just: string }

function plainKind(id: string, kinds: readonly KindDef[]): PlainKind {
  switch (id) {
    case 'peer': return {
      step: t('admin.kinds.peer.step'), stepLater: t('admin.kinds.peer.stepLater'), who: t('admin.kinds.peer.who'),
      noun: t('admin.kinds.peer.noun'), nounFirst: t('admin.kinds.peer.nounFirst'), short: t('admin.kinds.peer.short'),
      shortFirst: t('admin.kinds.peer.shortFirst'), just: t('admin.kinds.peer.just')
    };
    case 'bt': return {
      step: t('admin.kinds.bt.step'), stepLater: t('admin.kinds.bt.stepLater'), who: t('admin.kinds.bt.who'),
      noun: t('admin.kinds.bt.noun'), nounFirst: t('admin.kinds.bt.nounFirst'), short: t('admin.kinds.bt.short'),
      shortFirst: t('admin.kinds.bt.shortFirst'), just: t('admin.kinds.bt.just')
    };
    case 'community': return {
      step: t('admin.kinds.community.step'), stepLater: t('admin.kinds.community.stepLater'), who: t('admin.kinds.community.who'),
      noun: t('admin.kinds.community.noun'), nounFirst: t('admin.kinds.community.nounFirst'), short: t('admin.kinds.community.short'),
      shortFirst: t('admin.kinds.community.shortFirst'), just: t('admin.kinds.community.just')
    };
    case 'consultant': return {
      step: t('admin.kinds.consultant.step'), stepLater: t('admin.kinds.consultant.stepLater'), who: t('admin.kinds.consultant.who'),
      noun: t('admin.kinds.consultant.noun'), nounFirst: t('admin.kinds.consultant.nounFirst'), short: t('admin.kinds.consultant.short'),
      shortFirst: t('admin.kinds.consultant.shortFirst'), just: t('admin.kinds.consultant.just')
    };
    case 'final': {
      // Never a check (`checks` leaves it out), so it is never a flow's noun.
      const step = t('admin.kinds.final.step');
      return { step, stepLater: t('admin.kinds.final.stepLater'), who: t('admin.kinds.final.who'), noun: step, nounFirst: step, short: step, shortFirst: step, just: step };
    }
    case 'retell': return {
      step: t('admin.kinds.retell.step'), stepLater: t('admin.kinds.retell.stepLater'), who: t('admin.kinds.retell.who'),
      noun: t('admin.kinds.retell.noun'), nounFirst: t('admin.kinds.retell.nounFirst'), short: t('admin.kinds.retell.short'),
      shortFirst: t('admin.kinds.retell.shortFirst'), just: t('admin.kinds.retell.just')
    };
    case 'local': return {
      step: t('admin.kinds.local.step'), stepLater: t('admin.kinds.local.stepLater'), who: t('admin.kinds.local.who'),
      noun: t('admin.kinds.local.noun'), nounFirst: t('admin.kinds.local.nounFirst'), short: t('admin.kinds.local.short'),
      shortFirst: t('admin.kinds.local.shortFirst'), just: t('admin.kinds.local.just')
    };
  }
  // A kind the organization made: its own name, as it typed it, placed in a
  // sentence the way every cased language this app speaks does (lower case
  // mid-sentence, a capital to start).
  const k = kinds.find((x) => x.id === id);
  const name = k?.name ?? id.replace(/_/g, ' ');
  const lower = name.toLowerCase();
  const first = lower.charAt(0).toUpperCase() + lower.slice(1);
  return {
    step: name, stepLater: name.charAt(0).toLowerCase() + name.slice(1), who: k?.usualReviewer || name,
    noun: lower, nounFirst: first, short: lower, shortFirst: first, just: t('admin.flow.justKind', { kind: lower })
  };
}

interface PlainStep {
  kindIds: readonly string[];
  checkpoint?: boolean;
}

/** "Peer check and back translation": a step's kinds, joined. */
export function stepTitle(kindIds: readonly string[], kinds: readonly KindDef[]): string {
  return joinAnd(kindIds.map((id, i) => (i === 0 ? plainKind(id, kinds).step : plainKind(id, kinds).stepLater)), false);
}

/** Who usually does a step, as a short line ("Another translator"). */
export function stepWho(kindIds: readonly string[], kinds: readonly KindDef[]): string {
  return kindIds.length ? plainKind(kindIds[0]!, kinds).who : '';
}

/** The checks a flow makes before approval (an approval-only step is not a check). */
function checks(steps: readonly PlainStep[]): PlainStep[] {
  return steps.filter((s) => s.kindIds.some((k) => k !== 'final'));
}

/** The kinds of check a flow makes, in order, a kind repeated in a row said once. */
function checkKinds(steps: readonly PlainStep[], kinds: readonly KindDef[], by: (k: PlainKind) => string): PlainKind[] {
  const out: PlainKind[] = [];
  for (const s of checks(steps)) {
    const k = plainKind(s.kindIds.find((id) => id !== 'final')!, kinds);
    if (!out.length || by(out.at(-1)!) !== by(k)) out.push(k);
  }
  return out;
}

/** "Team, community, then a consultant"; "Just the community"; "No checks". */
export function flowTitle(steps: readonly PlainStep[], kinds: readonly KindDef[]): string {
  const list = checkKinds(steps, kinds, (k) => k.noun);
  if (list.length === 0) return steps.length ? t('admin.flow.justApproval') : t('admin.flow.noChecks');
  if (list.length === 1) return list[0]!.just;
  const before = [list[0]!.nounFirst, ...list.slice(1, -1).map((k) => k.noun)].join(t('admin.list.separator'));
  return t('admin.flow.then', { before, last: list.at(-1)!.noun });
}

/** The same, shorter, for a summary line: "Team, community, consultant". */
export function flowShort(steps: readonly PlainStep[], kinds: readonly KindDef[]): string {
  const list = checkKinds(steps, kinds, (k) => k.short);
  if (list.length === 0) return flowTitle(steps, kinds);
  return [list[0]!.shortFirst, ...list.slice(1).map((k) => k.short)].join(t('admin.list.separator'));
}

/** "One check", "3 checks", "Done once recorded". */
export function flowSub(steps: readonly PlainStep[]): string {
  const n = checks(steps).length;
  if (steps.length === 0) return t('admin.flow.doneOnceRecorded');
  if (n === 0) return t('admin.flow.youApprove');
  return t('admin.flow.checks', { count: n });
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

export const PLAIN_ROLES: { id: PlainRoleId; icon: 'mic' | 'check' | 'globe' | 'people' }[] = [
  { id: 'translate', icon: 'mic' },
  { id: 'check', icon: 'check' },
  { id: 'backtranslate', icon: 'globe' },
  { id: 'lead', icon: 'people' }
];

/** A plain choice as a row says it ("Check recordings") and as a chip ("Check"). */
function plainRoleWords(id: PlainRoleId): { label: string; chip: string } {
  switch (id) {
    case 'translate': return { label: t('admin.roles.translate'), chip: t('admin.roles.translateChip') };
    case 'check': return { label: t('admin.roles.check'), chip: t('admin.roles.checkChip') };
    case 'backtranslate': return { label: t('admin.roles.backtranslate'), chip: t('admin.roles.backtranslateChip') };
    case 'lead': return { label: t('admin.roles.lead'), chip: t('admin.roles.leadChip') };
  }
}

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
  const choices = PLAIN_ROLES.flatMap((c) => (given[c.id] ? [{ ...c, ...plainRoleWords(c.id), roleId: given[c.id]!.id }] : []));
  const used = new Set(choices.map((c) => c.roleId));
  return { choices, others: roles.filter((r) => !used.has(r.id)) };
}

// ---- a role's switches --------------------------------------------------------------

/**
 * A role's permissions as three groups of switches (demo ADR-039). A few
 * permissions share one switch: setting up a language covers its passages
 * and how they divide; choosing who checks covers the review groups. Every
 * permission is under exactly one switch (tested). Titles and labels are
 * read when shown, in the language showing (getters, never at load).
 */
export const ROLE_SWITCHES: { readonly title: string; rows: { readonly label: string; privileges: Privilege[] }[] }[] = [
  { get title() { return t('admin.switches.doTheWork'); }, rows: [
    { get label() { return t('admin.switches.record'); }, privileges: ['translate'] },
    { get label() { return t('admin.switches.addNotes'); }, privileges: ['fill_reference'] },
    { get label() { return t('admin.switches.askForChecks'); }, privileges: ['send_to_reviewers'] }
  ] },
  { get title() { return t('admin.switches.checkTheWork'); }, rows: [
    { get label() { return t('admin.switches.checkRecordings'); }, privileges: ['review'] },
    { get label() { return t('admin.switches.seeEveryonesWork'); }, privileges: ['view_status'] }
  ] },
  { get title() { return t('admin.switches.runTheTeam'); }, rows: [
    { get label() { return t('admin.switches.invitePeople'); }, privileges: ['invite_members'] },
    { get label() { return t('admin.switches.setUpLanguages'); }, privileges: ['manage_structure', 'manage_templates', 'shape_templates'] },
    { get label() { return t('admin.switches.chooseBibles'); }, privileges: ['manage_reference'] },
    { get label() { return t('admin.switches.chooseWhoChecks'); }, privileges: ['manage_flows', 'manage_teams'] },
    { get label() { return t('admin.switches.assignWork'); }, privileges: ['assign_work'] },
    { get label() { return t('admin.switches.overrideChecks'); }, privileges: ['override_checkpoints'] },
    { get label() { return t('admin.switches.manageRoles'); }, privileges: ['manage_roles'] }
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
  const at = createdAt ? Date.parse(createdAt) : NaN;
  if (!Number.isFinite(at)) return t('admin.asked.toJoin');
  const min = Math.max(0, Math.round((now - at) / 60000));
  if (min < 1) return t('admin.asked.justNow');
  if (min < 60) return t('admin.asked.minutes', { count: min });
  const h = Math.round(min / 60);
  if (h < 24) return t('admin.asked.hours', { count: h });
  const d = Math.round(h / 24);
  return d === 1 ? t('admin.asked.yesterday') : t('admin.asked.days', { count: d });
}

/** A person's first name, for "Let Deng in". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** Names of the languages Bibles and guides are written in, for lines like "Amharic and English Bibles"; else the code. */
export function languageLabel(code: string | null | undefined): string {
  if (!code) return '';
  switch (code.toLowerCase()) {
    case 'eng': return t('admin.languageNames.eng');
    case 'amh': return t('admin.languageNames.amh');
    case 'orm': return t('admin.languageNames.orm');
    case 'fra': return t('admin.languageNames.fra');
    case 'por': return t('admin.languageNames.por');
    case 'spa': return t('admin.languageNames.spa');
    case 'hin': return t('admin.languageNames.hin');
    case 'cmn': return t('admin.languageNames.cmn');
    case 'arb': case 'arz': return t('admin.languageNames.arb');
    case 'swh': case 'swa': return t('admin.languageNames.swa');
    case 'tir': return t('admin.languageNames.tir');
    case 'som': return t('admin.languageNames.som');
    case 'hau': return t('admin.languageNames.hau');
    case 'yor': return t('admin.languageNames.yor');
    case 'ibo': return t('admin.languageNames.ibo');
    case 'rus': return t('admin.languageNames.rus');
    case 'ind': return t('admin.languageNames.ind');
    case 'tha': return t('admin.languageNames.tha');
    case 'vie': return t('admin.languageNames.vie');
    case 'din': return t('admin.languageNames.din');
    case 'nus': return t('admin.languageNames.nus');
    default: return code.toUpperCase();
  }
}

/**
 * "Amharic and English", "Amharic, English and Oromo", in the language
 * showing (Hermes has no Intl.ListFormat). Repeats are said once unless
 * `unique` is false (a step may hold one kind twice).
 */
export function joinAnd(names: readonly string[], unique = true): string {
  const list = unique ? [...new Set(names.filter(Boolean))] : names.filter(Boolean);
  if (list.length <= 1) return list.join('');
  return t('admin.list.and', { before: list.slice(0, -1).join(t('admin.list.separator')), last: list.at(-1)! });
}

/** "FIA study guides (English)" -> "FIA": the short name of a set of guides. */
export function guideShortName(name: string): string {
  const short = name.replace(/\(.*?\)/g, '').replace(/study guides?/i, '').replace(/guides?/i, '').trim();
  return short || name;
}

/** "Amharic and English Bibles · FIA guides", or what is missing. */
export function helpsSummary(bibleLanguages: readonly string[], guides: readonly string[], notes: number): string {
  const parts: string[] = [];
  if (bibleLanguages.length) parts.push(t('admin.helps.bibles', { count: bibleLanguages.length, languages: joinAnd(bibleLanguages) }));
  if (guides.length) parts.push(t('admin.helps.guides', { names: joinAnd(guides) }));
  if (notes) parts.push(t('admin.helps.notes', { count: notes }));
  return parts.length ? parts.join(' · ') : t('admin.helps.nothing');
}
