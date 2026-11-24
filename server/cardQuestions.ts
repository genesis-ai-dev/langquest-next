import { REPOSITORY } from './tutorialFeedback';
import { EMAIL } from './userIssues';

/**
 * Questions an admin asks Claude from any card or page of the ops dashboard
 * (docs/decisions/2026-11-23-ask-claude-from-every-dashboard-card.md, migration
 * 20261123233000_ops_card_questions.sql). The dashboard keeps a question with
 * the card's words; the workflow card-questions.yml takes it through the app
 * Worker's door (apps/web/worker/cardQuestions.ts), Claude answers, and the
 * workflow sends the answer back. This module checks what the workflow sends.
 */

/** A card: a line's (`line:<key>[:<subject>]`, apps/admin/src/pageCards.ts lineCardId) or a page's (`page:<section>`). */
export const CARD = /^(line|page):[^\u0000-\u001f\u007f]{1,200}$/;
/** A section of the dashboard (apps/admin/src/pageOps.ts GROUPS). */
export const PAGE = /^[a-z0-9_]{1,40}$/;
/** The longest title, card words, question and answer the database keeps. */
export const QUESTION_MAX = { title: 300, context: 6000, text: 2000, answer: 8000 } as const;
/** At most this many questions in one run's answer. */
export const ANSWERED_MAX = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUN = new RegExp(`^https://github\\.com/${REPOSITORY.replace('/', '\\/')}/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$`);

/** One question as the workflow gets it (`GET /api/card-questions`). Not who asked. */
export interface CardQuestion {
  id: string;
  card: string;
  page: string;
  title: string;
  /** The card's words and numbers as the page drew them. */
  context: string;
  text: string;
  at: string;
  /** The card's last answered questions, the oldest first. */
  before: { at: string; text: string; answer: string }[];
}

/** What a run did with its questions (`POST /api/card-questions`). */
export interface Answered {
  runUrl: string;
  questions: ({ id: string; taken: true } | { id: string; taken: false; result: 'answered' | 'none'; answer: string | null })[];
}

export class AnsweredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AnsweredError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What the workflow sent, checked; an AnsweredError says what is wrong. Claude's answer never holds an address. */
export function parseAnswered(input: unknown): Answered {
  if (!isObj(input)) throw new AnsweredError('an object');
  const runUrl = input['runUrl'];
  if (typeof runUrl !== 'string' || !RUN.test(runUrl)) throw new AnsweredError(`runUrl: a run of ${REPOSITORY}`);
  const list = input['questions'];
  if (!Array.isArray(list) || list.length > ANSWERED_MAX) throw new AnsweredError(`questions: a list of at most ${ANSWERED_MAX}`);
  const seen = new Set<string>();
  const questions = list.map((q, n): Answered['questions'][number] => {
    const where = `questions[${n}]`;
    if (!isObj(q)) throw new AnsweredError(`${where}: an object`);
    const id = q['id'];
    if (typeof id !== 'string' || !UUID.test(id) || seen.has(id)) throw new AnsweredError(`${where}.id: a question's id, once`);
    seen.add(id);
    if (q['taken'] === true) return { id, taken: true };
    const result = q['result'];
    if (result !== 'answered' && result !== 'none') throw new AnsweredError(`${where}.result: answered or none, or taken: true`);
    const raw = q['answer'];
    const answer = raw === undefined || raw === null || raw === '' ? null : raw;
    if (answer !== null && (typeof answer !== 'string' || answer.length > QUESTION_MAX.answer || EMAIL.test(answer))) {
      throw new AnsweredError(`${where}.answer: at most ${QUESTION_MAX.answer} characters, no address`);
    }
    if ((result === 'answered') !== (answer !== null)) throw new AnsweredError(`${where}.answer: ${result === 'answered' ? 'the answer' : 'none for none'}`);
    return { id, taken: false, result, answer: answer as string | null };
  });
  return { runUrl, questions };
}
