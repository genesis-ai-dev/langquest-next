// A review being made, kept on this phone as it goes (decision 127). Review
// it and Already happened keep everything said, answered, skipped, chosen or
// recorded as a draft only its maker sees (drafts/useDraft.ts): leaving keeps
// it, opening the same review again brings it back where it was left, and
// sending the review drops it. Voice clips are files already on the phone,
// named by hash, so a draft keeps their hashes, lengths and formats only.
//
// Pure: screens/review.tsx builds a draft from its state and restores its
// state from one with these.
import type { Card, NoteAnchor } from '@langquest-next/core';
import { isRecord } from '../drafts/draftModel';
import type { Answers, Skips, StageId, VoiceAnswer } from './capture';

/** A note said at a moment of the version, while listening (before decisions.md 149: still sent from older drafts). */
export type Moment = VoiceAnswer & { atMs: number };

/**
 * A note written while reviewing (decisions.md 149): said or typed, on a
 * moment of the version (kept as its part), a help, a key word, a verse or
 * another note. It is part of the review: kept here until the verdict is
 * sent, then sent with it.
 */
export interface ReviewNote { id: string; anchor: NoteAnchor; text?: string; hash?: string }

/** What the review screen holds. `takeId` is a version chosen (or brought back) other than the one the screen opened on. */
export interface ReviewState {
  takeId: string | undefined;
  stage: StageId;
  /** The question showing, under Questions. */
  qi: number;
  answers: Answers;
  voice: Record<string, VoiceAnswer>;
  /** Questions whose typing field is open. */
  typing: Record<string, boolean>;
  skipped: Skips;
  comment: string;
  feedback: VoiceAnswer | null;
  typeFeedback: boolean;
  moments: Moment[];
  notes: ReviewNote[];
  people: number;
  givenBy: string;
  place: string;
  evidence: VoiceAnswer | null;
  made: Card[];
  /** The version has been played on this screen: Decide says when it has not. */
  played?: boolean;
  /** `comment` and `feedback` were said on "What should change?": Looks good asks before sending them. */
  saidForChange?: boolean;
}

/** A review's draft: the screen's state, with the version it is about. Older drafts have no `notes`. */
export type ReviewDraft = Omit<ReviewState, 'takeId' | 'notes'> & { takeId: string; notes?: ReviewNote[] };

/** Anything said, answered, skipped, chosen or recorded. Where you are, or a field opened, is not something said. */
export function saysSomething(s: Omit<ReviewState, 'takeId'>): boolean {
  return s.moments.length > 0 || s.notes.length > 0 || Object.values(s.answers).some((a) => !!a.trim()) || Object.keys(s.voice).length > 0
    || Object.keys(s.skipped).length > 0 || !!s.comment.trim() || !!s.feedback || !!s.evidence || s.people > 0 || !!s.place.trim()
    || !!s.givenBy.trim() || s.made.length > 0;
}

/**
 * The draft of what the screen holds, or null when nothing is said or
 * chosen there: where you are is kept with what you said, never alone.
 * `about` is the version the screen shows; `opened` the version it was
 * opened on (its `takeId` param), so choosing another counts as a choice.
 */
export function reviewDraftOf(s: ReviewState, about: string | undefined, opened: string | undefined): ReviewDraft | null {
  if (!about || (!saysSomething(s) && s.takeId === opened)) return null;
  // One order of fields, so a draft brought back and built again reads the same.
  return {
    takeId: about, stage: s.stage, qi: s.qi, answers: s.answers, voice: s.voice, typing: s.typing, skipped: s.skipped,
    comment: s.comment, feedback: s.feedback, typeFeedback: s.typeFeedback, moments: s.moments, notes: s.notes, people: s.people,
    givenBy: s.givenBy, place: s.place, evidence: s.evidence, made: s.made,
    ...(s.played ? { played: true } : {}), ...(s.saidForChange ? { saidForChange: true } : {})
  };
}

/**
 * The screen's state from a draft, or null when the version it is about is
 * no longer one of the passage's (the review starts fresh). `opened` is the
 * screen's `takeId` param and `shown` the version it shows without one: a
 * draft about that version keeps the screen on it.
 */
export function reviewStateOf(d: ReviewDraft, versions: readonly string[], opened: string | undefined, shown: string | undefined): ReviewState | null {
  if (!versions.includes(d.takeId)) return null;
  // A draft from before notes went with the review has none.
  return { ...d, notes: d.notes ?? [], takeId: d.takeId === shown ? opened : d.takeId };
}

const STAGES: readonly StageId[] = ['listen', 'questions', 'decide'];
const FORMATS: readonly unknown[] = ['wav', 'm4a'];

const isCount = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;

function isVoice(x: unknown): x is VoiceAnswer {
  return isRecord(x) && typeof x['hash'] === 'string' && typeof x['durationMs'] === 'number' && FORMATS.includes(x['format']);
}

function isMoment(x: unknown): x is Moment {
  return isVoice(x) && isRecord(x) && typeof x['atMs'] === 'number';
}

function isReviewNote(x: unknown): x is ReviewNote {
  return isRecord(x) && typeof x['id'] === 'string' && isRecord(x['anchor']) && typeof x['anchor']['kind'] === 'string'
    && (x['text'] === undefined || typeof x['text'] === 'string') && (x['hash'] === undefined || typeof x['hash'] === 'string');
}

function isCard(x: unknown): x is Card {
  return isRecord(x) && typeof x['hash'] === 'string' && typeof x['durationMs'] === 'number'
    && (x['format'] === undefined || FORMATS.includes(x['format'])) && (x['atMs'] === undefined || typeof x['atMs'] === 'number');
}

function isMap<T>(x: unknown, each: (v: unknown) => v is T): x is Record<string, T> {
  return isRecord(x) && Object.values(x).every(each);
}

function isList<T>(x: unknown, each: (v: unknown) => v is T): x is T[] {
  return Array.isArray(x) && x.every(each);
}

const isString = (x: unknown): x is string => typeof x === 'string';
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';

/** A stored review draft this version can read; an earlier version's `also` (other passages, gone in decision 128) is left unread. */
export function isReviewDraft(x: unknown): x is ReviewDraft {
  if (!isRecord(x)) return false;
  return typeof x['takeId'] === 'string' && STAGES.includes(x['stage'] as StageId) && isCount(x['qi'])
    && isMap(x['answers'], isString) && isMap(x['voice'], isVoice) && isMap(x['typing'], isBool) && isMap(x['skipped'], isString)
    && typeof x['comment'] === 'string' && (x['feedback'] === null || isVoice(x['feedback'])) && typeof x['typeFeedback'] === 'boolean'
    && isList(x['moments'], isMoment) && (x['notes'] === undefined || isList(x['notes'], isReviewNote)) && isCount(x['people'])
    && typeof x['givenBy'] === 'string' && typeof x['place'] === 'string' && (x['evidence'] === null || isVoice(x['evidence']))
    && isList(x['made'], isCard) && (x['played'] === undefined || isBool(x['played']))
    && (x['saidForChange'] === undefined || isBool(x['saidForChange']));
}

/** What useDraft keeps for a review: a draft, or nothing. */
export function isStoredReview(x: unknown): x is ReviewDraft | null {
  return x === null || isReviewDraft(x);
}
