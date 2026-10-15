// What the passage's detail pages show (screens/passage.tsx): one review
// (REC-10), one version (REC-9) and the versions-by-checks grid (REC-8). Which
// version or review a page is about, what it makes of them, and the words and
// marks derived from them. Pure, so held by tests (test/reviewModel.test.ts);
// the screen only draws them.
import {
  keyTermLinksFor, questionsForKind, reviewGrid,
  type KindDef, type PassageNote, type PassageState, type RequestView, type ReviewView, type Version
} from '@langquest-next/core';
import { checkName } from '../admin/adminModel';
import { currentLocale, t } from '../i18n';
import { commaList, feedbackSource, versionTitle } from './passageView';
import type { PassageView } from './passageView';
import { answeredQuestions, type NameFn } from './record';

// ---- one review (REC-10) --------------------------------------------------------------

/** The review a page opens: the one named, else the newest. */
export function reviewFor(p: PassageState, reviewId: string | undefined): ReviewView | undefined {
  // One taken back still opens from the history (decisions.md 110), marked as such.
  return p.reviews.find((r) => r.id === reviewId) ?? p.withdrawnReviews.find((r) => r.id === reviewId) ?? p.reviews.at(-1);
}

/** How a review's outcome card is coloured: made content, a good verdict, or a verdict that asks for changes. */
export type OutcomeTone = 'made' | 'good' | 'amber';

export interface ReviewDetailModel {
  /** The check, with its one name (decision 91). */
  kind: KindDef;
  /** What the check makes (a back translation), when it makes something. */
  makes: KindDef['produces'];
  /** The check that compares what was made, by its one name. */
  checkedBy: string | undefined;
  good: boolean;
  request: RequestView | undefined;
  questions: ReturnType<typeof questionsForKind>;
  answers: ReturnType<typeof answeredQuestions>;
  /** Questions left unanswered, with the reason given: [questionId, reason]. */
  skipped: [string, string][];
  /** Who it came from, as people say it. */
  source: string;
  /** The version it heard. */
  version: Version | undefined;
  tone: OutcomeTone;
  /** The translator may answer this feedback now: fix it, or keep it and say why. */
  answerable: boolean;
  /** The outcome line: "Back translation recorded", "Looks good", "Needs changes". */
  outcome: string;
}

/**
 * Everything a review page derives. `mayAnswer` is the session's say (it may
 * translate and take the edge to the workspace); the rest of "answerable" is
 * the record's: feedback asking for changes, unanswered, on the latest version,
 * which this person made.
 */
export function reviewDetailModel(o: { v: PassageView; review: ReviewView; me: string; name: NameFn; mayAnswer: boolean }): ReviewDetailModel {
  const { v, review, me } = o;
  const { p } = v;
  // A check's one name on every screen (decision 91), "Peer check".
  const kind = { ...v.kind(review.kindId), name: checkName(review.kindId, v.kinds) };
  const makes = kind.produces;
  const checkedBy = makes ? checkName(makes.checkedBy, v.kinds) : undefined;
  const good = review.outcome !== 'needs_changes';
  const request = review.requestId ? p.requests.find((r) => r.id === review.requestId) : undefined;
  const questions = questionsForKind(v.state, review.kindId, request);
  const answers = answeredQuestions(questions, review.answers);
  const skipped = Object.entries(review.skipped ?? {});
  const answerable = o.mayAnswer && review.outcome === 'needs_changes'
    && !review.response && review.versionN === p.latest?.n && p.latest?.by === me;
  // "Back translation recorded": what the kind makes, at the start of the line.
  const made = makes ? `${makes.what.charAt(0).toLocaleUpperCase(currentLocale())}${makes.what.slice(1)}` : '';
  const outcome = makes ? t('passage.review.madeRecorded', { what: made }) : good ? t('passage.view.outcomeStart.looksGood') : t('passage.view.outcomeStart.needsChanges');
  return {
    kind, makes, checkedBy, good, request, questions, answers, skipped, source: feedbackSource(review, o.name),
    version: p.versions[review.versionN - 1], tone: makes ? 'made' : good ? 'good' : 'amber', answerable, outcome
  };
}

/** The line over the answers: how many were answered, and how many left. */
export function answersSummary(answered: number, skipped: number): string {
  return [t('passage.review.answers', { count: answered }), skipped ? t('passage.review.leftUnanswered', { count: skipped }) : ''].filter(Boolean).join(' · ');
}

/** The question an unanswered entry was about, or "Question" when it is gone. */
export function skippedQuestionText(questions: ReviewDetailModel['questions'], questionId: string): string {
  return questions.find((q) => q.q.id === questionId)?.q.text ?? t('passage.record.answer.question');
}

/** Has the review words of its own to show: typed, or a recording. */
export function hasFeedback(review: Pick<ReviewView, 'comment' | 'commentBlobHash'>): boolean {
  return !!review.comment || !!review.commentBlobHash;
}

/** Nothing was said in the feedback: no words, no recording, no captured parts. */
export function feedbackIsEmpty(review: Pick<ReviewView, 'comment' | 'commentBlobHash' | 'artifacts'>): boolean {
  return !review.comment && !review.commentBlobHash && !review.artifacts?.length;
}

/** The translator's answer: "Tom revised it · 2 days ago" or "Tom kept it · …". */
export function responseLine(response: NonNullable<ReviewView['response']>, name: NameFn, when: string): string {
  return `${response.decision === 'revised' ? t('passage.review.revisedIt', { name: name(response.by) }) : t('passage.review.keptIt', { name: name(response.by) })} · ${when}`;
}

/** The version a response led to, when it is still on the record. */
export function revisedVersion(p: PassageState, response: ReviewView['response']): Version | undefined {
  return response?.revisedTakeId ? p.versions.find((x) => x.takeId === response.revisedTakeId) : undefined;
}

// ---- one version (REC-9) --------------------------------------------------------------

/** The version a page opens: the one named, else the newest. */
export function versionFor(p: PassageState, takeId: string | undefined): Version | undefined {
  return p.versions.find((x) => x.takeId === takeId) ?? p.latest;
}

export interface VersionDetailModel {
  title: string;
  /** Reviews this version heard. */
  reviews: ReviewView[];
  /** Feedback this version was recorded in answer to. */
  prompted: ReviewView[];
  terms: ReturnType<typeof keyTermLinksFor>;
  /** Notes on this version or one of its takes (study notes stay with the study). */
  notes: PassageNote[];
}

/** What hangs off one version of the passage. */
export function versionDetailModel(v: PassageView, version: Version): VersionDetailModel {
  const { p } = v;
  return {
    title: versionTitle(version.n),
    reviews: p.reviews.filter((r) => r.versionN === version.n),
    prompted: p.reviews.filter((r) => r.response?.revisedTakeId === version.takeId),
    terms: keyTermLinksFor(v.state, version.takeId),
    notes: p.notes.filter((n) => n.anchor.kind !== 'study' && (n.onTakeId === version.takeId || (n.anchor.kind === 'version' && n.anchor.takeId === version.takeId)))
  };
}

/** What a version says changed: its note, the first recording's, or that none was left. */
export function changeNoteText(version: Pick<Version, 'n' | 'changeNote'>): string {
  return version.changeNote ?? (version.n === 1 ? t('passage.record.entry.firstRecording') : t('passage.version.noChangeNote'));
}

/** The line over the key terms tied to a version: how many, and the first two. */
export function termsTiedSummary(terms: VersionDetailModel['terms']): string {
  return t('passage.version.termsTied', { count: terms.length, terms: `${commaList(terms.slice(0, 2).map((x) => x.term.term))}${terms.length > 2 ? '…' : ''}` });
}

/** A key term's row: the term and its first rendering. */
export function termLabel(term: VersionDetailModel['terms'][number]['term']): string {
  const rendering = term.renderings[0]?.rendering;
  return `${term.term}${rendering ? ` · ${rendering}` : ''}`;
}

/** The line over a version's notes: how many, and the first one's words. */
export function notesSummary(notes: PassageNote[], authored: (by: string | undefined, text: string) => string): string {
  return `${t('passage.version.noteCount', { count: notes.length })} · ${authored(notes[0]?.by, notes[0]?.text ?? t('common.voiceNote'))}`;
}

// ---- the reviews grid (REC-8) ---------------------------------------------------------

export type GridRows = ReturnType<typeof reviewGrid>;

export interface GridModel {
  rows: GridRows;
  /** Checks set aside, and checks asked and waiting: shown in the newest version's row. */
  skipped: Set<string>;
  asked: Set<string>;
  /** Checks in the columns that make something, for the legend. */
  producing: KindDef[];
}

/** The grid of versions (rows, newest first) against checks (columns). */
export function gridModel(p: PassageState, kindIds: string[], kind: (id: string) => KindDef): GridModel {
  const kinds = p.steps.flatMap((st) => st.kinds);
  return {
    rows: reviewGrid(p, kindIds),
    skipped: new Set(kinds.filter((k) => k.state === 'skipped').map((k) => k.kindId)),
    asked: new Set(kinds.filter((k) => k.state === 'asked').map((k) => k.kindId)),
    producing: kindIds.map((id) => kind(id)).filter((k) => k.produces)
  };
}

/** What one cell of the grid draws. */
export type GridCell =
  | { id: 'review'; review: ReviewView; count: number; produced: boolean }
  | { id: 'skipped' }
  | { id: 'asked' }
  | { id: 'empty' };

/**
 * A cell is its latest review (a made thing has its own mark, never a "looks
 * good" tick); with none, the newest version's row says whether the check was
 * set aside or is waiting; else it is empty.
 */
export function gridCell(cell: { kindId: string; reviews: ReviewView[] }, o: { newest: boolean; grid: Pick<GridModel, 'skipped' | 'asked'>; produces: boolean }): GridCell {
  const r = cell.reviews.at(-1);
  if (r) return { id: 'review', review: r, count: cell.reviews.length, produced: o.produces };
  if (o.newest && o.grid.skipped.has(cell.kindId)) return { id: 'skipped' };
  if (o.newest && o.grid.asked.has(cell.kindId)) return { id: 'asked' };
  return { id: 'empty' };
}

/** A review cell's spoken label: the check and who gave it, and how many when there are several. */
export function gridCellLabel(kindName: string, review: ReviewView, count: number, name: NameFn): string {
  return count > 1
    ? t('passage.grid.cellLatestOf', { kind: kindName, who: feedbackSource(review, name), count })
    : t('passage.grid.cell', { kind: kindName, who: feedbackSource(review, name) });
}

/** The column heading for a check: its first word. */
export function gridColumnName(kind: Pick<KindDef, 'name'>): string {
  return kind.name.split(' ')[0] ?? '';
}
