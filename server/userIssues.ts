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
 * watch asks again only when twice as many people hit it. `fixed`: every hit
 * came before a change merged into main that fixes it (its pull request);
 * nothing is filed, and it comes back only when people hit it after the fix.
 */
export const VERDICTS = ['filed', 'known', 'noise', 'fixed'] as const;
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
  /**
   * The builds that hit it, by installs (`ops.user_issue_build`): `web <commit>`
   * for a browser, `<os> update <id>` for a phone's over-the-air update,
   * `<os> store build <runtime>` for a store build's own code.
   */
  apps: { app: string; installs: number }[];
  /** A few installs that hit it, for `npm run diag -- timeline <id>`. */
  installIds: string[];
  /** The newest stack seen for an error: frames only, no message (diagnostics.md). */
  stack: string | null;
  /**
   * What an earlier look decided, when it is looked at again: noise that grew,
   * or a kind fixed (`fixedBy`, the pull request, merged at `fixedAt`) or whose
   * issue closed (`closedAt`, its Linear `state`) that people hit after the fix.
   */
  before: {
    verdict: Verdict; issue: string | null; issueUrl: string | null; people: number; lookedAt: string;
    fixedBy: number | null; fixedAt: string | null; closedAt: string | null; state: string | null;
  } | null;
  /** For a kind fixed or closed: people who hit it more than a day after the fix (its `platforms`, `apps`, `installIds` and `stack` are theirs only). */
  peopleAfterFix: number | null;
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
  /** Every Linear issue the watch filed or commented on in 180 days, with the state last read (the workflow reads them again each run). */
  issues: { issue: string; state: string | null; closed: boolean }[];
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
export const LOOKED_MAX = { looked: 200, grew: 200, states: 100 } as const;
/** A Linear state's name (Backlog, In Progress, Live). */
const STATE = /^[A-Za-z][A-Za-z0-9 ._()-]{0,59}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export interface Looked {
  sha: string;
  runUrl: string;
  looked: {
    key: string; verdict: Verdict; issue: string | null; issueUrl: string | null; people: number; count: number; note: string | null;
    /** What a person sees go wrong (filed or fixed), for the ops dashboard. */
    title: string | null;
    /** `fixed` only: the pull request on main that fixed it (when known), and when it merged or its issue closed. */
    fixedBy: number | null; fixedAt: string | null;
  }[];
  grew: { key: string; people: number; count: number }[];
  /** Issues whose state in Linear changed since the watch last read it: closed (with the pull request that fixed it, when named) or open again. */
  states: { issue: string; state: string; closed: boolean; closedAt: string | null; fixedBy: number | null; fixedAt: string | null; title: string | null }[];
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

const absent = (v: unknown) => v === null || v === undefined;

function pr(o: Obj, field: string, where: string): number | null {
  const v = o[field];
  if (absent(v)) return null;
  if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 100_000_000) throw new LookedError(`${where}.${field}: a pull request's number`);
  return v as number;
}

function time(o: Obj, field: string, where: string): string | null {
  const v = o[field];
  if (absent(v)) return null;
  if (typeof v !== 'string' || !ISO.test(v) || Number.isNaN(Date.parse(v))) throw new LookedError(`${where}.${field}: a time (ISO 8601)`);
  return v;
}

/** What a person sees go wrong, as a title: at most 200 characters and never an address. */
function titleOf(o: Obj, where: string): string | null {
  const v = o['title'];
  if (absent(v) || v === '') return null;
  if (typeof v !== 'string' || v.length > 200 || EMAIL.test(v)) throw new LookedError(`${where}.title: at most 200 characters, no address`);
  return v;
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
    // Filed and known name their issue; noise none; fixed names one when it is a closed issue's kind.
    const named = typeof issue === 'string' && ISSUE.test(issue) && typeof issueUrl === 'string' && ISSUE_URL.test(issueUrl);
    const none = issue === null && issueUrl === null;
    if (verdict === 'noise' ? !none : verdict === 'fixed' ? !named && !none : !named) {
      throw new LookedError(`${where}.issue: ${verdict === 'noise' ? 'none for noise' : verdict === 'fixed' ? 'its closed issue (LAN-12) and address, or none' : 'its Linear issue (LAN-12) and address'}`);
    }
    const note = l['note'] === null || l['note'] === undefined || l['note'] === '' ? null : l['note'];
    if (note !== null && (typeof note !== 'string' || note.length > 500 || EMAIL.test(note))) throw new LookedError(`${where}.note: at most 500 characters, no address`);
    const title = titleOf(l, where);
    const fixedBy = pr(l, 'fixedBy', where);
    const fixedAt = time(l, 'fixedAt', where);
    if (verdict === 'fixed' ? fixedAt === null : fixedBy !== null || fixedAt !== null) {
      throw new LookedError(`${where}.fixedAt: ${verdict === 'fixed' ? 'when the fix merged, for fixed' : 'only for fixed'}`);
    }
    return {
      key: k, verdict: verdict as Verdict, issue: issue as string | null, issueUrl: issueUrl as string | null, people: count(l, 'people', where), count: count(l, 'count', where),
      note: note as string | null, title, fixedBy, fixedAt
    };
  });
  const grew = list(input, 'grew', LOOKED_MAX.grew).map((g, n) => {
    const where = `grew[${n}]`;
    if (!isObj(g)) throw new LookedError(`${where}: an object`);
    return { key: key(g, where), people: count(g, 'people', where), count: count(g, 'count', where) };
  });
  const issues = new Set<string>();
  const states = list(input, 'states', LOOKED_MAX.states).map((s, n) => {
    const where = `states[${n}]`;
    if (!isObj(s)) throw new LookedError(`${where}: an object`);
    const issue = s['issue'];
    if (typeof issue !== 'string' || !ISSUE.test(issue) || issues.has(issue)) throw new LookedError(`${where}.issue: a Linear issue (LAN-12), once`);
    issues.add(issue);
    const state = s['state'];
    if (typeof state !== 'string' || !STATE.test(state)) throw new LookedError(`${where}.state: a Linear state's name`);
    if (typeof s['closed'] !== 'boolean') throw new LookedError(`${where}.closed: true or false`);
    const closed = s['closed'];
    const closedAt = time(s, 'closedAt', where);
    const fixedBy = pr(s, 'fixedBy', where);
    const fixedAt = time(s, 'fixedAt', where);
    if (!closed && (closedAt !== null || fixedBy !== null || fixedAt !== null)) throw new LookedError(`${where}: an open issue has no closedAt or fix`);
    return { issue, state, closed, closedAt, fixedBy, fixedAt, title: titleOf(s, where) };
  });
  return { sha: input['sha'], runUrl: input['runUrl'], looked, grew, states };
}
