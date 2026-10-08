// Pure reading for the reviewing screens (UX demo src/screens/review.tsx,
// requirements REV-1..8, ADR-005, ADR-015, ADR-028): which request a review
// answers, what a checking kind compares against, what is still required
// before an outcome can be sent, how notes are labelled, and which other
// passages a session that already happened may have covered, and the
// stages the screen walks through (REV-0, ADR-029). No React and
// no I/O here, so it is tested directly (test/reviewCapture.test.ts).
import {
  derivePassage, unitPlace, unitTitle,
  type Card, type KindDef, type NoteAnchor, type PassageState, type LanguageState,
  type RequestView, type ReviewView, type SourcedQuestion, type Version
} from '@langquest-next/core';
import { bookMatches, canonBook, parseQuery } from '../canon';

/** The demo's quick reasons for leaving a required question unanswered (REV-2). */
export const CANT_ANSWER = [
  "Listeners weren't able to judge this",
  'Not relevant for this passage',
  'Ran out of time in the session'
];

// ---- what is being reviewed ----------------------------------------------------------

/** The version a review hears: the one named, else the latest (REV-8). */
export function versionFor(p: PassageState, takeId?: string): Version | undefined {
  return (takeId ? p.versions.find((v) => v.takeId === takeId) : undefined) ?? p.latest;
}

/**
 * The open request this review answers: the one named if it is still open,
 * else an open request for this kind, preferring one made to this person.
 * `mineOnly` (a session logged afterwards) closes only a request made to you.
 */
export function requestFor(p: PassageState, kindId: string, actorId: string, opts: { requestId?: string; mineOnly?: boolean } = {}): RequestView | undefined {
  const named = opts.requestId ? p.openRequests.find((r) => r.id === opts.requestId) : undefined;
  const open = named ? [named] : p.openRequests.filter((r) => r.what === 'review' && r.kindId === kindId);
  const mine = open.find((r) => r.profileId === actorId);
  return opts.mineOnly ? mine : mine ?? open[0];
}

/** Kinds whose content this kind checks (the Consultant Check checks a back translation, ADR-015). */
function producersFor(kinds: KindDef[], kindId: string): KindDef[] {
  return kinds.filter((k) => k.produces?.checkedBy === kindId);
}

/** The latest content made for this kind to check: the material, not background (REV-5). */
export function toCompareFor(p: PassageState, kinds: KindDef[], kindId: string): ReviewView | undefined {
  const producers = new Set(producersFor(kinds, kindId).map((k) => k.id));
  if (producers.size === 0) return undefined;
  return [...p.reviews].reverse().find((r) => producers.has(r.kindId));
}

/** Earlier reviews as background, newest first, leaving out the content shown to compare. */
export function earlierReviews(p: PassageState, kinds: KindDef[], kindId: string): ReviewView[] {
  const producers = new Set(producersFor(kinds, kindId).map((k) => k.id));
  return [...p.reviews].reverse().filter((r) => !producers.has(r.kindId));
}

// ---- questions and readiness ----------------------------------------------------------------

export type Answers = Record<string, string>;
export type Skips = Record<string, string>;

const answered = (v: string | undefined) => v !== undefined && v.trim() !== '';

/** Required questions neither answered nor skipped with a reason (REV-2). */
export function openRequired(questions: SourcedQuestion[], answers: Answers, skipped: Skips): SourcedQuestion[] {
  return questions.filter((q) => q.required && !answered(answers[q.q.id]) && skipped[q.q.id] === undefined);
}

interface Readiness {
  /** Required questions left. */
  open: number;
  /** Looks good may be sent: every required question handled (REV-3). */
  ready: boolean;
  /** Something says what to change: text or a voice note. */
  saysWhat: boolean;
}

export function readiness(questions: SourcedQuestion[], answers: Answers, skipped: Skips, comment: string, commentHash: string | null): Readiness {
  const open = openRequired(questions, answers, skipped).length;
  return { open, ready: open === 0, saysWhat: comment.trim() !== '' || !!commentHash };
}

/** The line above the buttons: what still stands between you and sending. */
export function footHint(r: Readiness, makes?: { what: string; has: boolean }): string | null {
  if (!r.ready) return `${r.open} required question${r.open === 1 ? '' : 's'} left — answer, or say why not`;
  if (makes) return makes.has ? null : `Record the ${makes.what}.`;
  return r.saysWhat ? null : 'To ask for changes, say what to change above';
}

// ---- stages (REV-0, ADR-029; demo SIMPLE-10) ------------------------------------------------

export type StageId = 'listen' | 'questions' | 'decide';
export interface Stage { id: StageId; label: string; icon: 'listen' | 'help' | 'check' | 'mic' }

/**
 * Reviewing is three short stages under the header: Listen, Questions (one
 * per screen), Decide. Questions is left out when there are none. A kind
 * that makes content (a back translation logged afterwards) ends in "Record
 * it" instead of a verdict.
 */
export function reviewStages(opts: { questions: number; logged: boolean; makes: boolean }): Stage[] {
  return [
    { id: 'listen', label: 'Listen', icon: 'listen' },
    ...(opts.questions > 0 ? [{ id: 'questions' as const, label: 'Questions', icon: 'help' as const }] : []),
    opts.makes ? { id: 'decide', label: 'Record it', icon: 'mic' } : { id: 'decide', label: 'Decide', icon: 'check' }
  ];
}

/** Where a stage sits on the strip; a stage that is no longer there (its questions went) falls back to the first. */
export function stageAt(stages: Stage[], id: StageId): number {
  return Math.max(0, stages.findIndex((s) => s.id === id));
}

/** The footer's main button before the last stage: "Next: questions", "Next: decide". */
export function nextLabel(stage: Stage): string {
  return `Next: ${stage.label.toLowerCase()}`;
}

/**
 * A kind's name as the simple screens say it under the passage: "Community
 * check", "Peer review". Words after the first lose their capital unless
 * they are an abbreviation ("FIA check" stays).
 */
export function kindLabel(name: string): string {
  const words = name.trim().split(/\s+/);
  return words.map((w, i) => (i === 0 || w.length < 2 || w === w.toUpperCase() ? w : w.charAt(0).toLowerCase() + w.slice(1))).join(' ');
}

/** The question the Decide stage asks, by kind (the shipped kinds; anything else asks whether it is clear). */
export function verdictQuestion(kindId: string): string {
  switch (kindId) {
    case 'peer': return 'Is it accurate and natural?';
    case 'consultant': return 'Does it carry the meaning?';
    case 'final': return 'Is it ready to share?';
    case 'retell': return 'Did they understand it?';
    case 'local': return 'Does it sound natural?';
    default: return 'Is it clear?';
  }
}

/** Under the version on Listen: a group hears it together; anyone else listens alone. */
export function listenLine(kindId: string, logged: boolean): string {
  if (logged) return 'The version that was played';
  return isGroupKind(kindId) || kindId === 'local' ? 'Play it for the group' : 'Listen to all of it first';
}

// ---- one question per screen (SIMPLE-10) ----------------------------------------------------

/** A voice answer: the clip, kept with the review as one of its recordings. */
export interface VoiceAnswer { hash: string; durationMs: number; format: 'wav' | 'm4a' }

/** May the reviewer leave this question: it is optional, answered (in words or aloud), or set aside with a reason. */
export function canLeave(q: SourcedQuestion, answers: Answers, skipped: Skips, voice: Record<string, VoiceAnswer>): boolean {
  return !q.required || answered(answers[q.q.id]) || !!voice[q.q.id] || skipped[q.q.id] !== undefined;
}

/** The first required question still open, or -1: Decide sends the reviewer back to it. */
export function firstOpenAt(questions: SourcedQuestion[], answers: Answers, skipped: Skips, voice: Record<string, VoiceAnswer>): number {
  return questions.findIndex((q) => !canLeave(q, answers, skipped, voice));
}

/** "0:14". */
export function clockMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * What a review carries for its answers and clips. Answers stay words (the
 * record's `answers` are text); an answer said aloud is one of the review's
 * recordings, and its answer names it ("Said aloud · 0:14 · recording 1"),
 * so the record reads the same everywhere. Recordings go in a fixed order:
 * answers said aloud (question order), notes at moments (by time), then the
 * retelling.
 */
export function reviewCapture(c: {
  questions: SourcedQuestion[];
  answers: Answers;
  voice: Record<string, VoiceAnswer>;
  moments: (VoiceAnswer & { atMs: number })[];
  evidence?: VoiceAnswer | null;
}): { answers: Answers; artifacts: Card[] } {
  const artifacts: Card[] = [];
  const out: Answers = { ...c.answers };
  for (const q of c.questions) {
    const v = c.voice[q.q.id];
    if (!v) continue;
    artifacts.push({ hash: v.hash, durationMs: v.durationMs, format: v.format });
    const said = `Said aloud · ${clockMs(v.durationMs)} · recording ${artifacts.length}`;
    const typed = out[q.q.id]?.trim();
    out[q.q.id] = typed ? `${typed} (${said.charAt(0).toLowerCase()}${said.slice(1)})` : said;
  }
  for (const m of [...c.moments].sort((a, b) => a.atMs - b.atMs)) {
    artifacts.push({ hash: m.hash, durationMs: m.durationMs, format: m.format, atMs: Math.max(0, Math.round(m.atMs)) });
  }
  if (c.evidence) artifacts.push({ hash: c.evidence.hash, durationMs: c.evidence.durationMs, format: c.evidence.format });
  return { answers: out, artifacts };
}

/** One line for a collapsed card: the parts that have something, joined with " · ". */
export function summaryLine(parts: (string | false | null | undefined)[]): string {
  return parts.filter((x): x is string => !!x).join(' · ');
}

/** Answers worth saving: only questions on the list, trimmed, none empty. Undefined when there are none. */
export function cleanAnswers(questions: SourcedQuestion[], answers: Answers): Answers | undefined {
  const ids = new Set(questions.map((q) => q.q.id));
  const out: Answers = {};
  for (const [id, v] of Object.entries(answers)) if (ids.has(id) && answered(v)) out[id] = v.trim();
  return Object.keys(out).length ? out : undefined;
}

/** Skips worth saving: only questions still unanswered. Undefined when there are none. */
export function cleanSkips(questions: SourcedQuestion[], answers: Answers, skipped: Skips): Skips | undefined {
  const ids = new Set(questions.map((q) => q.q.id));
  const out: Skips = {};
  for (const [id, why] of Object.entries(skipped)) if (ids.has(id) && !answered(answers[id])) out[id] = why;
  return Object.keys(out).length ? out : undefined;
}

/** Where a question comes from, as the demo labels it (REV-2). */
export function questionSource(q: SourcedQuestion, asker?: string): string {
  switch (q.source) {
    case 'org': return 'Organization';
    case 'language': return 'Language team';
    case 'request': return asker ? `From ${asker}` : 'From whoever asked';
  }
}

// ---- notes ------------------------------------------------------------------------------------

/** What a note is about, as the demo says it: "Verse 4", "Key term · Shepherd", "Whole passage". */
export function noteAnchorText(anchor: NoteAnchor, look: { term: (termId: string) => string | undefined; versionN: (takeId: string) => number | undefined }): string {
  switch (anchor.kind) {
    case 'passage': return 'Whole passage';
    case 'verse': return `Verse ${anchor.verse}${anchor.translation ? ` · ${anchor.translation}` : ''}${anchor.at ? ` · ${anchor.at}` : ''}`;
    case 'term': return `Key term · ${look.term(anchor.termId) ?? 'term'}`;
    case 'version': {
      const n = look.versionN(anchor.takeId);
      return n ? `Version ${n}` : 'A version';
    }
    case 'study': return 'Study';
  }
}

// ---- a session that already happened (REV-6) ------------------------------------------------------

/** Kinds heard by a group: ask how many listened rather than who reviewed it. */
export function isGroupKind(kindId: string): boolean {
  return kindId === 'community' || kindId === 'retell';
}

export interface PassageChoice {
  unitId: string;
  title: string;
  bookId: string | null;
  bookLabel: string;
  chapters: number[];
  /** Canon, chapter, first verse: the order people expect. */
  order: number;
}

function choiceOf(state: LanguageState, unitId: string): PassageChoice {
  const place = unitPlace(state, unitId);
  const title = unitTitle(state, unitId);
  const verse = /:(\d+)/.exec(title);
  return {
    unitId, title, bookId: place.bookId, bookLabel: place.bookLabel, chapters: place.chapters,
    order: place.canon * 1_000_000 + (place.chapters[0] ?? 0) * 1000 + Number(verse?.[1] ?? 0)
  };
}

const recordedCache = new WeakMap<LanguageState, PassageChoice[]>();

/**
 * Every passage in the language with at least one published version, in
 * canon order. One pass over the submissions, cached per state, so a whole
 * Bible costs nothing to reopen.
 */
export function recordedPassages(state: LanguageState): PassageChoice[] {
  const hit = recordedCache.get(state);
  if (hit) return hit;
  const units = new Set<string>();
  for (const takeId of Object.keys(state.submissions)) {
    const t = state.takes[takeId];
    if (t && t.unitId && state.units[t.unitId]) units.add(t.unitId);
  }
  const out = [...units].map((u) => choiceOf(state, u)).sort((a, b) => a.order - b.order || (a.title < b.title ? -1 : 1));
  recordedCache.set(state, out);
  return out;
}

/** The nearest recorded passages in the same book, in canon order (the demo shows four). */
export function nearbyPassages(all: PassageChoice[], here: PassageChoice, n = 4): PassageChoice[] {
  if (!here.bookId) return [];
  const at = here.chapters[0] ?? 0;
  return all
    .filter((p) => p.unitId !== here.unitId && p.bookId === here.bookId)
    .map((p) => ({ p, d: Math.abs((p.chapters[0] ?? 0) - at) }))
    .sort((a, b) => a.d - b.d || a.p.order - b.p.order)
    .slice(0, n)
    .map((x) => x.p)
    .sort((a, b) => a.order - b.order);
}

/**
 * "joh 3", "ps 23", "cor" (both Corinthians), "Mark 2", "1 cor 13:4-6" find
 * their passages; "1" is a book prefix (1 Samuel, 1 Kings, ...), not every
 * chapter 1. Parsing and book names are the Map's (canon.ts), so the two
 * searches agree; a passage outside the canon matches by its own title.
 */
export function matchesQuery(p: PassageChoice, query: string): boolean {
  if (!query.trim()) return false;
  const { book, chapter } = parseQuery(query);
  const canon = canonBook(p.bookId);
  const bookOk = canon ? bookMatches(canon, book)
    : !book || [p.bookLabel, p.title].some((n) => n.toLowerCase().startsWith(book));
  if (!bookOk) return false;
  return chapter === undefined || p.chapters.includes(chapter);
}

export function searchPassages(all: PassageChoice[], query: string, exceptUnitId: string, n = 8): PassageChoice[] {
  if (!query.trim()) return [];
  const out: PassageChoice[] = [];
  for (const p of all) {
    if (p.unitId === exceptUnitId || !matchesQuery(p, query)) continue;
    out.push(p);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Where a logged session's review goes (REV-6): the version that was played
 * on this passage, and the latest version of every other passage picked.
 * Passages with no version are left out.
 */
export function loggedTargets(state: LanguageState, main: { unitId: string; takeId: string }, alsoUnitIds: string[]): { unitId: string; takeId: string }[] {
  const out = [main];
  for (const unitId of alsoUnitIds) {
    if (unitId === main.unitId || out.some((t) => t.unitId === unitId)) continue;
    const latest = derivePassage(state, unitId).latest;
    if (latest) out.push({ unitId, takeId: latest.takeId });
  }
  return out;
}
