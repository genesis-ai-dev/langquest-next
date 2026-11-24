import { REPOSITORY } from './tutorialFeedback';
import { EMAIL } from './userIssues';

/**
 * Claude decides whether a resolved line of the ops dashboard came back, from
 * the nature of its problem
 * (docs/decisions/2026-11-24-a-resolved-line-comes-back-with-its-problem.md, amended 2026-11-24;
 * migration 20261124030000_ops_line_resolve_checks.sql). The workflow
 * card-questions.yml asks the app Worker's door (apps/web/worker/cardQuestions.ts)
 * for the resolves to check, with each line's words now; Claude decides; the
 * workflow sends the verdicts back. This module checks what the workflow sends.
 */

/** The longest reason the database keeps. */
export const WHY_MAX = 1000;
/** At most this many resolves in one run's verdicts (ops_line_resolves_due gives at most 20). */
export const CHECKED_MAX = 20;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const RUN = new RegExp(`^https://github\\.com/${REPOSITORY.replace('/', '\\/')}/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$`);

/** One resolve as the workflow gets it (`GET /api/card-questions?resolves=1`). Not who resolved it. */
export interface DueResolve {
  id: string;
  line: string;
  part: string;
  /** The line's level and words when it was resolved. text is null for a resolve made before the words were kept. */
  level: string;
  measure: number | null;
  title: string;
  text: string | null;
  at: string;
  /** Claude's last check of this resolve, and its reason then. */
  checkedAt: string | null;
  why: string | null;
  /** The line as the page shows it now. */
  now: { level: string; text: string };
}

/**
 * What a run decided (`POST /api/card-questions` with `resolves`): same (the problem the admin resolved,
 * it stays hidden) or back (the problem came back, it shows again), each with Claude's reason; none: the
 * run took the resolve and could not decide, so it waits for the next check.
 */
export interface Checked {
  runUrl: string;
  resolves: ({ id: string; verdict: 'same' | 'back'; why: string } | { id: string; verdict: 'none'; why: null })[];
}

export class CheckedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckedError';
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What the workflow sent, checked; a CheckedError says what is wrong. Claude's reason never holds an address. */
export function parseChecked(input: unknown): Checked {
  if (!isObj(input)) throw new CheckedError('an object');
  const runUrl = input['runUrl'];
  if (typeof runUrl !== 'string' || !RUN.test(runUrl)) throw new CheckedError(`runUrl: a run of ${REPOSITORY}`);
  const list = input['resolves'];
  if (!Array.isArray(list) || list.length > CHECKED_MAX) throw new CheckedError(`resolves: a list of at most ${CHECKED_MAX}`);
  const seen = new Set<string>();
  const resolves = list.map((r, n): Checked['resolves'][number] => {
    const where = `resolves[${n}]`;
    if (!isObj(r)) throw new CheckedError(`${where}: an object`);
    const id = r['id'];
    if (typeof id !== 'string' || !UUID.test(id) || seen.has(id)) throw new CheckedError(`${where}.id: a resolve's id, once`);
    seen.add(id);
    const verdict = r['verdict'];
    if (verdict === 'none') return { id, verdict, why: null };
    if (verdict !== 'same' && verdict !== 'back') throw new CheckedError(`${where}.verdict: same, back or none`);
    const why = typeof r['why'] === 'string' ? r['why'].trim() : '';
    if (!why || why.length > WHY_MAX || EMAIL.test(why)) throw new CheckedError(`${where}.why: 1 to ${WHY_MAX} characters, no address`);
    return { id, verdict, why };
  });
  return { runUrl, resolves };
}

/**
 * The open resolves that are due, each with its line as the page shows it now. A resolve whose line is
 * not on the page now is left out: the watch for user issues ends it (ops_line_resolves_seen).
 */
export function dueWithNow(due: Omit<DueResolve, 'now'>[], lines: { id: string; level: string; text: string }[]): DueResolve[] {
  const byId = new Map(lines.map((l) => [l.id, l]));
  return due.flatMap((r) => {
    const l = byId.get(r.line);
    return l ? [{ ...r, now: { level: l.level, text: l.text.slice(0, 2000) } }] : [];
  });
}
