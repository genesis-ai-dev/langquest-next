import { REPOSITORY } from './tutorialFeedback';

/**
 * The watch for problems people hit in the app (docs/diagnostics.md "The
 * watch for user issues", decisions.md 202, migration *_user_issues.sql).
 * Every 15 minutes `.github/workflows/user-issues.yml` asks the app's Worker
 * what is new (`GET /api/user-issues`): kinds of failure the phones and
 * browsers reported, server jobs in trouble, and problems people sent from
 * help mode. Claude looks at the new ones, the workflow files each real one
 * in Linear, and it sends back what it did (`POST`), checked here and again
 * by the database (`ops_user_issues_looked`). Pure: no database, no network.
 */

/** Where a kind comes from: the first part of its key. */
export const FAMILIES = ['error', 'sync', 'transfer', 'auth', 'expected', 'audio', 'fill', 'device', 'job', 'worker', 'feedback'] as const;
export type Family = (typeof FAMILIES)[number];

/**
 * A kind of problem, as the database names it: its family, then the record's
 * code-like tags (`error:TypeError@sign in:-`, `transfer:down:source:failOther`,
 * `job:projection:failing`, `feedback:<id>`). Diagnostics tags are code-like
 * tokens (packages/sync/src/diagnostics.ts DIAG_TOKEN), so a key never holds
 * what someone typed.
 */
export const KEY = new RegExp(`^(${FAMILIES.join('|')}):[A-Za-z0-9 _.:()/#@-]{1,290}$`);

/**
 * What the look decided about a kind. `filed`: a new Linear issue. `known`:
 * an issue the team already had (a comment was added to it). `noise`: nothing
 * to fix (one person's wrong password, a phone of the store's review); the
 * watch asks again only when twice as many people hit it.
 */
export const VERDICTS = ['filed', 'known', 'noise'] as const;
export type Verdict = (typeof VERDICTS)[number];

/** A kind as `ops_user_issue_watch` hands it over. */
export interface WatchKind {
  key: string;
  family: Family;
  /** People (accounts) who hit it in the last 7 days, and in the last day. */
  people: number;
  peopleDay: number;
  installs: number;
  /** Records or failures counted, in 7 days. */
  count: number;
  orgs: number;
  firstAt: string | null;
  lastAt: string | null;
  /** People by platform (`web`, `ios`, `android`). */
  platforms: Record<string, number>;
  apps: { app: string; installs: number }[];
  /** A few installs that hit it, for `npm run diag -- timeline <id>`. */
  installIds: string[];
  /** The newest stack seen for an error: frames only, no message (diagnostics.md). */
  stack: string | null;
  /** What an earlier look decided, when it is looked at again because it grew. */
  before: { verdict: Verdict; issue: string | null; people: number; lookedAt: string } | null;
  /** A server job in trouble, or the Worker's 5xx answers. */
  server: Record<string, unknown> | null;
  /** A problem sent from help mode: never who sent it (no name or email). */
  feedback: {
    id: string; at: string; body: string; screen: string | null; os: string | null; app: string | null;
    uiLanguage: string | null; screenshot: boolean; picture: boolean; voiceMs: number | null; installId: string;
    /** The kinds that phone hit in the same 7 days, to tie the words to the records. */
    installKeys: string[];
  } | null;
}

/** A filed kind that more people hit since: the workflow adds the new counts to its Linear issue, no look needed. */
export interface GrownKind {
  key: string; issue: string; issueUrl: string; people: number; peopleBefore: number; installs: number; count: number;
  platforms: Record<string, number>; lastAt: string | null;
}

/** What `GET /api/user-issues` answers. */
export interface Watch {
  asOf: string;
  /** Kinds seen in the last 7 days, before choosing what to look at. */
  active: number;
  look: WatchKind[];
  grew: GrownKind[];
}

/** At most this many kinds are handed to one look; the rest wait for the next run. */
export const LOOK_MAX = 20;
/** A kind filed or judged noise is looked at again once at least this many times the people hit it, and two more. */
export const GROWTH = 2;

/** The first line of a Linear issue's title the workflow files, so the team can tell them apart. */
export const ISSUE_PREFIX = 'User issue: ';
/** The Linear label every such issue carries (scripts/user-issues.mjs makes it when missing). */
export const ISSUE_LABEL = 'User issue';

// ---- what the workflow sends back (POST /api/user-issues) ----------------------------------------

const SHA = /^[0-9a-f]{40}$/;
const ISSUE = /^[A-Z]{1,10}-[0-9]{1,7}$/;
const ISSUE_URL = /^https:\/\/linear\.app\/[A-Za-z0-9/_.-]{1,300}$/;
const RUN = new RegExp(`^https://github\\.com/${REPOSITORY.replace('/', '\\/')}/actions/runs/[0-9]{1,20}(/attempts/[0-9]{1,5})?$`);
/** No address may ride along in a note: the database keeps none (docs/diagnostics.md). */
export const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
export const LOOKED_MAX = { looked: 200, grew: 200 } as const;

export interface Looked {
  sha: string;
  runUrl: string;
  looked: { key: string; verdict: Verdict; issue: string | null; issueUrl: string | null; people: number; count: number; note: string | null }[];
  grew: { key: string; people: number; count: number }[];
}

export class LookedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LookedError';
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

function list(o: Obj, field: string, max: number): unknown[] {
  const v = o[field] ?? [];
  if (!Array.isArray(v) || v.length > max) throw new LookedError(`${field}: a list of at most ${max}`);
  return v;
}

function key(o: Obj, where: string): string {
  const k = o['key'];
  if (typeof k !== 'string' || !KEY.test(k)) throw new LookedError(`${where}.key: a kind's key`);
  return k;
}

function count(o: Obj, field: string, where: string): number {
  const v = o[field];
  if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 1_000_000_000) throw new LookedError(`${where}.${field}: a whole number`);
  return v as number;
}

/** What the workflow sent, checked; a LookedError says the first thing wrong. */
export function parseLooked(input: unknown): Looked {
  if (!isObj(input)) throw new LookedError('not an object');
  if (typeof input['sha'] !== 'string' || !SHA.test(input['sha'])) throw new LookedError('sha: a commit on main');
  if (typeof input['runUrl'] !== 'string' || !RUN.test(input['runUrl'])) throw new LookedError(`runUrl: a run of ${REPOSITORY}`);
  const seen = new Set<string>();
  const looked = list(input, 'looked', LOOKED_MAX.looked).map((l, n) => {
    const where = `looked[${n}]`;
    if (!isObj(l)) throw new LookedError(`${where}: an object`);
    const k = key(l, where);
    if (seen.has(k)) throw new LookedError(`${where}.key: named twice`);
    seen.add(k);
    const verdict = l['verdict'];
    if (typeof verdict !== 'string' || !(VERDICTS as readonly string[]).includes(verdict)) throw new LookedError(`${where}.verdict: one of ${VERDICTS.join(', ')}`);
    const issue = l['issue'] ?? null;
    const issueUrl = l['issueUrl'] ?? null;
    if (verdict === 'noise' ? issue !== null || issueUrl !== null : typeof issue !== 'string' || !ISSUE.test(issue) || typeof issueUrl !== 'string' || !ISSUE_URL.test(issueUrl)) {
      throw new LookedError(`${where}.issue: ${verdict === 'noise' ? 'none for noise' : 'its Linear issue (LAN-12) and address'}`);
    }
    const note = l['note'] === null || l['note'] === undefined || l['note'] === '' ? null : l['note'];
    if (note !== null && (typeof note !== 'string' || note.length > 500 || EMAIL.test(note))) throw new LookedError(`${where}.note: at most 500 characters, no address`);
    return { key: k, verdict: verdict as Verdict, issue: issue as string | null, issueUrl: issueUrl as string | null, people: count(l, 'people', where), count: count(l, 'count', where), note: note as string | null };
  });
  const grew = list(input, 'grew', LOOKED_MAX.grew).map((g, n) => {
    const where = `grew[${n}]`;
    if (!isObj(g)) throw new LookedError(`${where}: an object`);
    return { key: key(g, where), people: count(g, 'people', where), count: count(g, 'count', where) };
  });
  return { sha: input['sha'], runUrl: input['runUrl'], looked, grew };
}
