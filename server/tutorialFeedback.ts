/**
 * Feedback on the tutorial videos (docs/tutorial-videos.md "Feedback",
 * decisions.md 185, migration *_tutorial_feedback.sql), as the comments job,
 * the app's Worker and the ops dashboard share it: what came in about a
 * video (a comment on YouTube, a code change merged into main, a note on
 * the dashboard), what Claude's nightly look suggests doing about it, and
 * the checks on what that look sends back. Pure: no database, no network.
 */

export const INPUT_KINDS = ['comment', 'code', 'note'] as const;
export type InputKind = (typeof INPUT_KINDS)[number];
/** script: what is said; screen: what is shown or tapped; voice: how it is said; code: the app itself; new: a video not made yet. */
export const SUGGESTION_KINDS = ['script', 'screen', 'voice', 'code', 'new'] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

/** An input as `ops.tutorial_input_json` gives it. */
export interface FeedbackInput {
  id: string;
  kind: InputKind;
  tutorial: string | null;
  language: string | null;
  at: string;
  /** A comment's thread id on YouTube; a code change's commit on main. */
  ref: string | null;
  youtubeId: string | null;
  pr: number | null;
  /** A comment as written, a pull request's title, a note. */
  text: string;
  /** A comment in English, or what a code change changes in the video. */
  english: string | null;
  reply: string | null;
  replyEnglish: string | null;
  lookedAt: string | null;
  outcome: string | null;
}

/** A suggestion as `ops.tutorial_suggestion_json` gives it, with the inputs it answers. */
export interface Suggestion {
  id: string;
  kind: SuggestionKind;
  tutorial: string | null;
  title: string;
  detail: string;
  madeAt: string;
  editedAt: string | null;
  decision: 'accepted' | 'rejected' | null;
  decidedAt: string | null;
  reason: string | null;
  issue: string | null;
  issueUrl: string | null;
  inputs: FeedbackInput[];
}

export const REPOSITORY = 'genesis-ai-dev/langquest-next';
/** A Linear issue's title starts with this, as the nightly's start with "Nightly: ". */
export const ISSUE_PREFIX = 'Tutorial feedback: ';

/** Where an input is: a comment under its video, lit (`lc`), or YouTube Studio's comments when on no video; a code change's pull request or commit. */
export function inputLink(i: Pick<FeedbackInput, 'kind' | 'ref' | 'youtubeId' | 'pr'>): string | null {
  if (i.kind === 'comment') return i.youtubeId && i.ref ? `https://www.youtube.com/watch?v=${i.youtubeId}&lc=${i.ref}` : 'https://studio.youtube.com';
  if (i.kind === 'code') return i.pr ? `https://github.com/${REPOSITORY}/pull/${i.pr}` : i.ref ? `https://github.com/${REPOSITORY}/commit/${i.ref}` : null;
  return null;
}

/** The Linear issue for an accepted code change: what to change, what it answers and where. Never who wrote a comment. */
export function issueOf(s: Suggestion, languageName: (code: string) => string): { title: string; description: string } {
  const quote = (t: string) => t.split('\n').map((l) => `> ${l}`).join('\n');
  const answers = s.inputs.flatMap((i) => {
    const link = inputLink(i);
    const where = i.kind === 'comment' ? `A comment on the ${languageName(i.language ?? 'en')} channel, ${i.at.slice(0, 10)}`
      : i.kind === 'code' ? `A change merged into main, ${i.at.slice(0, 10)}` : `A note on the ops dashboard, ${i.at.slice(0, 10)}`;
    return [`${where}${link ? ` (${link})` : ''}:`, '', quote(i.english ?? i.text), ''];
  });
  return {
    title: `${ISSUE_PREFIX}${s.title}`.slice(0, 255),
    description: [
      s.detail, '',
      ...(s.tutorial ? [`Video: ${s.tutorial}`, ''] : []),
      ...(answers.length ? ['What it answers:', '', ...answers] : []),
      ...(s.reason ? [`Accepted with: ${s.reason}`, ''] : []),
      'Suggested by Claude and accepted on the ops dashboard (docs/tutorial-videos.md, decisions.md 185).'
    ].join('\n')
  };
}

// ---- what Claude's nightly look sends back (POST /api/tutorial-review) ------------------------------

const TUTORIAL = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const KEY = /^[A-Za-z0-9_-]{1,40}$/;
const RUN = new RegExp(`^https://github\\.com/${REPOSITORY.replace('/', '\\/')}/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$`);
/** More than a night could bring; a look past them is refused whole. */
export const REVIEW_MAX = { code: 200, comments: 2000, looked: 4000, suggestions: 200, attach: 200, inputs: 100 } as const;

/** A code change Claude found, under a key its suggestions can name. */
export interface CodeInput { key: string; sha: string; tutorial: string; pr: number | null; title: string; english: string; at: string }

/** What one look made: checked here before the database checks it again (`ops_tutorial_reviewed`). */
export interface Review {
  sha: string;
  runUrl: string;
  code: CodeInput[];
  comments: { id: string; english: string; reply: string; replyEnglish: string }[];
  looked: { input: string; outcome: string | null }[];
  suggestions: { kind: SuggestionKind; tutorial: string | null; title: string; detail: string; inputs: string[] }[];
  attach: { suggestion: string; inputs: string[] }[];
}

export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReviewError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function text(o: Obj, field: string, where: string, max: number, min = 1): string {
  const v = o[field];
  if (typeof v !== 'string' || v.trim().length < min || v.length > max) throw new ReviewError(`${where}.${field}: text of ${min} to ${max} characters`);
  return v.trim();
}

function list(o: Obj, field: string, max: number): unknown[] {
  const v = o[field] ?? [];
  if (!Array.isArray(v) || v.length > max) throw new ReviewError(`${field}: a list of at most ${max}`);
  return v;
}

/** What Claude's look sent, checked; a ReviewError says the first thing wrong. */
export function parseReview(input: unknown): Review {
  const codeKeys = new Set<string>();
  if (!isObj(input)) throw new ReviewError('not an object');
  if (typeof input['sha'] !== 'string' || !SHA.test(input['sha'])) throw new ReviewError('sha: a commit on main');
  if (typeof input['runUrl'] !== 'string' || !RUN.test(input['runUrl'])) throw new ReviewError(`runUrl: a run of ${REPOSITORY}`);
  const ref = (v: unknown, where: string) => {
    if (typeof v !== 'string' || !(UUID.test(v) || codeKeys.has(v))) throw new ReviewError(`${where}: an input's id or a code change's key`);
    return v;
  };
  const code = list(input, 'code', REVIEW_MAX.code).map((c, n) => {
    const where = `code[${n}]`;
    if (!isObj(c)) throw new ReviewError(`${where}: an object`);
    const key = text(c, 'key', where, 40);
    const tutorial = text(c, 'tutorial', where, 80);
    const pr = c['pr'] ?? null;
    if (!KEY.test(key) || UUID.test(key) || codeKeys.has(key)) throw new ReviewError(`${where}.key: a new key of letters, digits, - and _`);
    if (typeof c['sha'] !== 'string' || !SHA.test(c['sha'])) throw new ReviewError(`${where}.sha: a commit`);
    if (!TUTORIAL.test(tutorial)) throw new ReviewError(`${where}.tutorial: a video's id`);
    if (pr !== null && !(Number.isInteger(pr) && (pr as number) > 0 && (pr as number) <= 10_000_000)) throw new ReviewError(`${where}.pr: a pull request's number or null`);
    const at = text(c, 'at', where, 40);
    if (Number.isNaN(Date.parse(at))) throw new ReviewError(`${where}.at: a time`);
    codeKeys.add(key);
    return { key, sha: c['sha'], tutorial, pr: pr as number | null, title: text(c, 'title', where, 1000), english: text(c, 'english', where, 5000), at };
  });
  const comments = list(input, 'comments', REVIEW_MAX.comments).map((c, n) => {
    const where = `comments[${n}]`;
    if (!isObj(c) || typeof c['id'] !== 'string' || !UUID.test(c['id'])) throw new ReviewError(`${where}.id: an input's id`);
    return { id: c['id'], english: text(c, 'english', where, 5000), reply: text(c, 'reply', where, 2000, 0), replyEnglish: text(c, 'replyEnglish', where, 2000, 0) };
  });
  const looked = list(input, 'looked', REVIEW_MAX.looked).map((l, n) => {
    const where = `looked[${n}]`;
    if (!isObj(l)) throw new ReviewError(`${where}: an object`);
    const outcome = l['outcome'] === null || l['outcome'] === undefined || l['outcome'] === '' ? null : text(l, 'outcome', where, 500);
    return { input: ref(l['input'], `${where}.input`), outcome };
  });
  const refs = (o: Obj, where: string) => list(o, 'inputs', REVIEW_MAX.inputs).map((r, k) => ref(r, `${where}.inputs[${k}]`));
  const suggestions = list(input, 'suggestions', REVIEW_MAX.suggestions).map((s, n) => {
    const where = `suggestions[${n}]`;
    if (!isObj(s)) throw new ReviewError(`${where}: an object`);
    const kind = s['kind'];
    if (typeof kind !== 'string' || !(SUGGESTION_KINDS as readonly string[]).includes(kind)) throw new ReviewError(`${where}.kind: one of ${SUGGESTION_KINDS.join(', ')}`);
    const tutorial = s['tutorial'] ?? null;
    if (kind === 'new' ? tutorial !== null : tutorial !== null && (typeof tutorial !== 'string' || !TUTORIAL.test(tutorial) || tutorial.length > 80)) {
      throw new ReviewError(`${where}.tutorial: ${kind === 'new' ? 'null for a new video' : "a video's id, or null"}`);
    }
    return { kind: kind as SuggestionKind, tutorial: tutorial as string | null, title: text(s, 'title', where, 200), detail: text(s, 'detail', where, 4000), inputs: refs(s, where) };
  });
  const attach = list(input, 'attach', REVIEW_MAX.attach).map((a, n) => {
    const where = `attach[${n}]`;
    if (!isObj(a) || typeof a['suggestion'] !== 'string' || !UUID.test(a['suggestion'])) throw new ReviewError(`${where}.suggestion: an open suggestion's id`);
    return { suggestion: a['suggestion'], inputs: refs(a, where) };
  });
  return { sha: input['sha'], runUrl: input['runUrl'], code, comments, looked, suggestions, attach };
}
