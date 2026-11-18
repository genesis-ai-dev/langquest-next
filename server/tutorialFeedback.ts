/**
 * Feedback on the tutorial videos (docs/tutorial-videos.md "Feedback",
 * decisions.md 186, migration *_tutorial_feedback.sql), as the comments job,
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
/** What an admin told Claude to do with a video, from a card on the ops dashboard: accepted as it is written, never the look's. */
export type StoredSuggestionKind = SuggestionKind | 'instruction';

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
  kind: StoredSuggestionKind;
  tutorial: string | null;
  /** An instruction's film language (its log and pictures); null means English. */
  language?: string | null;
  title: string;
  detail: string;
  madeAt: string;
  editedAt: string | null;
  decision: 'accepted' | 'rejected' | null;
  decidedAt: string | null;
  reason: string | null;
  /**
   * Claude accepted it itself, as a clear fix (decisions.md 186, amended 2026-11-16): a change to a video's script,
   * screens or voice with one right answer that Claude checked. `decidedAt` is when; no person decided it.
   */
  clear?: boolean;
  issue: string | null;
  issueUrl: string | null;
  /** Where Claude's draft pull request for an accepted change to a video is, or null before one is started. */
  fix?: Fix | null;
  /** What the suggestion is about, as the last film run showed it, picked by Claude (decisions.md 186, amended 2026-11-17). */
  pictures?: Picture[];
  /** The same places after its fix was merged and the video filmed again. */
  after?: Picture[];
  inputs: FeedbackInput[];
}

/**
 * A picture of what a suggestion is about (decisions.md 186, amended 2026-11-17), from the last film run in a
 * language (the `tutorials-<language>` artifact of tutorials.yml): a step's screen as the night's try saw it
 * (`step`, steps/NN.png), a still of the film the frame check found wrong (`still`, check/NN.jpg, `at` seconds
 * into the film), or the screen where a film stopped (`stopped`, failed-step-N.png). Claude picks it, says in
 * `caption` what to look at, and may ring that place: `ring` is x, y, width and height as parts of the picture,
 * from its top left. The file is kept by its bytes' hash (`picture`) and served at /api/tutorial-pictures/.
 */
export const PICTURE_KINDS = ['step', 'still', 'stopped'] as const;
export type PictureKind = (typeof PICTURE_KINDS)[number];
export interface Picture {
  picture: string;
  language: string;
  tutorial: string;
  kind: PictureKind;
  /** The step's number from 1, or the still's. */
  n: number;
  /** A still's time in the film, in seconds. */
  at?: number;
  caption: string;
  ring?: [number, number, number, number];
}
/** At most this many pictures for a suggestion, before or after; a caption's length; a picture's size. */
export const PICTURE_MAX = { pictures: 6, caption: 300, bytes: 3 * 1024 * 1024 } as const;
/** A picture's name: its bytes' SHA-256 and its kind of file. */
export const PICTURE_FILE = /^([0-9a-f]{64})\.(png|jpg)$/;
/** Where a picture is served, to anyone: it is a still of a public video, or a screen of its test data. */
export const pictureUrl = (name: string, origin = 'https://next.langquest.org') => `${origin}/api/tutorial-pictures/${name}`;

/**
 * Where Claude's fix for an accepted change to a video's script, screens or voice is (decisions.md 186,
 * amended 2026-11-13 and 2026-11-16): `working`, a run is writing it; `open`, its pull request runs its
 * checks and merges itself when they pass; `merged`, the film run after the merge films the video again;
 * `closed`, closed without a merge by a person; `failed`, Claude wrote no fix, the second check stopped it,
 * or its checks failed (the run closed it), and `note` says why; `unneeded`, the video already does what
 * the suggestion says, and `note` says how.
 */
export const FIX_STATES = ['working', 'open', 'merged', 'closed', 'failed', 'unneeded'] as const;
export type FixState = (typeof FIX_STATES)[number];
export interface Fix {
  state: FixState;
  /** The pull request: null while working, and when no fix was opened. */
  pr: number | null;
  at: string;
  /** The Actions run that wrote it. */
  run: string | null;
  note: string | null;
}
/**
 * The changes Claude makes once a person accepts them, and an admin's instruction (accepted as written); a code
 * change goes to Linear, and a new video is made by a person.
 */
export const FIXABLE_KINDS: readonly StoredSuggestionKind[] = ['script', 'screen', 'voice', 'instruction'];

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
      'Suggested by Claude and accepted on the ops dashboard (docs/tutorial-videos.md, decisions.md 186).'
    ].join('\n')
  };
}

// ---- what Claude's nightly look sends back (POST /api/tutorial-review) ------------------------------

const TUTORIAL = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{40}$/;
const KEY = /^[A-Za-z0-9_-]{1,40}$/;
const LANGUAGE = /^[a-z]{2,3}(-[A-Z][a-z]{3})?$/;
/** The suggestions Claude may accept itself as clear, and make: a change to a video, never the app or a new video. */
export const CLEAR_KINDS: readonly SuggestionKind[] = ['script', 'screen', 'voice'];
const RUN = new RegExp(`^https://github\\.com/${REPOSITORY.replace('/', '\\/')}/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$`);
/**
 * The phone's disguise (decisions.md 171): a calculator or notepad in front of the app that a code opens. No video,
 * reply or suggestion shows or explains it (Caleb, 2026-10-29): a public how-to teaches anyone to see through it.
 * A look whose reply or suggestion names it is refused whole; a person answers such a comment.
 */
export const DISGUISE = /\b(disguis\w*|calculators?|notepads?)\b/i;
const noDisguise = (s: string, where: string): string => {
  if (DISGUISE.test(s)) throw new ReviewError(`${where}: never the phone's disguise (decisions.md 171)`);
  return s;
};
/** More than a night could bring; a look past them is refused whole. */
export const REVIEW_MAX = { code: 200, comments: 2000, looked: 4000, suggestions: 200, attach: 200, inputs: 100, pictures: 400 } as const;

/** A code change Claude found, under a key its suggestions can name. */
export interface CodeInput { key: string; sha: string; tutorial: string; pr: number | null; title: string; english: string; at: string }

/** What one look made: checked here before the database checks it again (`ops_tutorial_reviewed`). */
export interface Review {
  sha: string;
  runUrl: string;
  code: CodeInput[];
  comments: { id: string; english: string; reply: string; replyEnglish: string }[];
  looked: { input: string; outcome: string | null }[];
  /**
   * `clear`: Claude accepts it itself (only a change to a video's script, screens or voice); `language`: the film
   * it is about, when that is not English (a film that fails or is held in one language).
   */
  suggestions: { kind: SuggestionKind; tutorial: string | null; language: string | null; clear: boolean; title: string; detail: string; inputs: string[]; pictures: Picture[] }[];
  attach: { suggestion: string; inputs: string[] }[];
  /**
   * Pictures for a suggestion made before: `now`, for one that has none yet or still waits for a person; `after`,
   * for one whose fix was merged, from a film run after the merge. A `now` entry may also say a waiting
   * suggestion's `title` and `detail` again in plain words, which the database keeps unless an admin edited it.
   */
  pictures: { suggestion: string; when: 'now' | 'after'; pictures: Picture[]; title?: string; detail?: string }[];
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

const isPart = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/** A suggestion's pictures, as the workflow sends them (named by hash); a ReviewError says the first thing wrong. */
export function parsePictures(o: Obj, where: string): Picture[] {
  return list(o, 'pictures', PICTURE_MAX.pictures).map((p, n) => {
    const at = `${where}.pictures[${n}]`;
    if (!isObj(p)) throw new ReviewError(`${at}: an object`);
    const picture = p['picture'];
    if (typeof picture !== 'string' || !PICTURE_FILE.test(picture)) throw new ReviewError(`${at}.picture: a picture's file from the last film run`);
    const language = p['language'];
    if (typeof language !== 'string' || !LANGUAGE.test(language)) throw new ReviewError(`${at}.language: an app language's code`);
    const tutorial = p['tutorial'];
    if (typeof tutorial !== 'string' || !TUTORIAL.test(tutorial) || tutorial.length > 80) throw new ReviewError(`${at}.tutorial: a video's id`);
    const kind = p['kind'];
    if (typeof kind !== 'string' || !(PICTURE_KINDS as readonly string[]).includes(kind)) throw new ReviewError(`${at}.kind: one of ${PICTURE_KINDS.join(', ')}`);
    const num = p['n'];
    if (!Number.isInteger(num) || (num as number) < 1 || (num as number) > 500) throw new ReviewError(`${at}.n: a step's or still's number`);
    const time = p['at'];
    if (time !== undefined && time !== null && !(typeof time === 'number' && Number.isFinite(time) && time >= 0 && time < 36_000)) throw new ReviewError(`${at}.at: seconds into the film`);
    const ring = p['ring'];
    if (ring !== undefined && ring !== null && !(Array.isArray(ring) && ring.length === 4 && ring.every(isPart)
      && (ring[2] as number) > 0 && (ring[3] as number) > 0 && (ring[0] as number) + (ring[2] as number) <= 1.001 && (ring[1] as number) + (ring[3] as number) <= 1.001)) {
      throw new ReviewError(`${at}.ring: x, y, width and height, each a part of the picture from 0 to 1, inside it`);
    }
    return {
      picture, language, tutorial, kind: kind as PictureKind, n: num as number,
      ...(typeof time === 'number' ? { at: Math.round(time * 100) / 100 } : {}),
      caption: noDisguise(text(p, 'caption', at, PICTURE_MAX.caption), `${at}.caption`),
      ...(Array.isArray(ring) ? { ring: ring.map((x) => Math.round((x as number) * 1000) / 1000) as [number, number, number, number] } : {})
    };
  });
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
    return {
      id: c['id'], english: text(c, 'english', where, 5000), reply: noDisguise(text(c, 'reply', where, 2000, 0), `${where}.reply`),
      replyEnglish: noDisguise(text(c, 'replyEnglish', where, 2000, 0), `${where}.replyEnglish`)
    };
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
    const clear = s['clear'] ?? false;
    if (typeof clear !== 'boolean') throw new ReviewError(`${where}.clear: true or false`);
    if (clear && !(CLEAR_KINDS.includes(kind as SuggestionKind) && tutorial !== null)) throw new ReviewError(`${where}.clear: only a change to one video's ${CLEAR_KINDS.join(', ')}`);
    const language = s['language'] ?? null;
    if (language !== null && (typeof language !== 'string' || !LANGUAGE.test(language) || tutorial === null)) throw new ReviewError(`${where}.language: an app language's code for the video's film, or null`);
    const pictures = parsePictures(s, where);
    if (pictures.length && tutorial === null) throw new ReviewError(`${where}.pictures: only for a suggestion about a video`);
    return {
      kind: kind as SuggestionKind, tutorial: tutorial as string | null, language: language as string | null, clear,
      title: noDisguise(text(s, 'title', where, 200), `${where}.title`),
      detail: noDisguise(text(s, 'detail', where, 4000), `${where}.detail`), inputs: refs(s, where), pictures
    };
  });
  const attach = list(input, 'attach', REVIEW_MAX.attach).map((a, n) => {
    const where = `attach[${n}]`;
    if (!isObj(a) || typeof a['suggestion'] !== 'string' || !UUID.test(a['suggestion'])) throw new ReviewError(`${where}.suggestion: an open suggestion's id`);
    return { suggestion: a['suggestion'], inputs: refs(a, where) };
  });
  const pictures = list(input, 'pictures', REVIEW_MAX.pictures).map((p, n) => {
    const where = `pictures[${n}]`;
    if (!isObj(p) || typeof p['suggestion'] !== 'string' || !UUID.test(p['suggestion'])) throw new ReviewError(`${where}.suggestion: a suggestion's id`);
    const when = p['when'] ?? 'now';
    if (when !== 'now' && when !== 'after') throw new ReviewError(`${where}.when: now or after`);
    const shown = parsePictures(p, where);
    const words = {
      ...(p['title'] === undefined ? {} : { title: noDisguise(text(p, 'title', where, 200), `${where}.title`) }),
      ...(p['detail'] === undefined ? {} : { detail: noDisguise(text(p, 'detail', where, 4000), `${where}.detail`) })
    };
    if (when === 'after' && Object.keys(words).length) throw new ReviewError(`${where}: new words only with when now`);
    if (!shown.length && !Object.keys(words).length) throw new ReviewError(`${where}.pictures: at least one, or new words`);
    return { suggestion: p['suggestion'], when: when as 'now' | 'after', pictures: shown, ...words };
  });
  return { sha: input['sha'], runUrl: input['runUrl'], code, comments, looked, suggestions, attach, pictures };
}

// ---- where each fix is, as the fix jobs say it (POST /api/tutorial-review/fixes) -------------------

/** A fix's move, as the fix jobs send it and `ops_tutorial_fixed` takes it. */
export interface FixUpdate { id: string; state: FixState; pr: number | null; note: string | null }
/** More than a run could send; a list past it is refused whole. */
export const FIX_UPDATES_MAX = 50;

/** What a fix run sent: the run it is, and each suggestion's move. A ReviewError says the first thing wrong. */
export function parseFixUpdates(input: unknown): { runUrl: string; updates: FixUpdate[] } {
  if (!isObj(input)) throw new ReviewError('not an object');
  if (typeof input['runUrl'] !== 'string' || !RUN.test(input['runUrl'])) throw new ReviewError(`runUrl: a run of ${REPOSITORY}`);
  const updates = list(input, 'updates', FIX_UPDATES_MAX).map((u, n) => {
    const where = `updates[${n}]`;
    if (!isObj(u) || typeof u['id'] !== 'string' || !UUID.test(u['id'])) throw new ReviewError(`${where}.id: a suggestion's id`);
    const state = u['state'];
    if (typeof state !== 'string' || !(FIX_STATES as readonly string[]).includes(state)) throw new ReviewError(`${where}.state: one of ${FIX_STATES.join(', ')}`);
    const pr = u['pr'] ?? null;
    if (pr !== null && !(Number.isInteger(pr) && (pr as number) > 0 && (pr as number) <= 10_000_000)) throw new ReviewError(`${where}.pr: a pull request's number or null`);
    if (pr === null && ['open', 'merged', 'closed'].includes(state)) throw new ReviewError(`${where}.pr: the pull request, for ${state}`);
    // Why there is no fix: only for the dashboard, which is private.
    const note = u['note'] === null || u['note'] === undefined || u['note'] === '' ? null : text(u, 'note', where, 1000);
    return { id: u['id'], state: state as FixState, pr: pr as number | null, note };
  });
  return { runUrl: input['runUrl'], updates };
}
