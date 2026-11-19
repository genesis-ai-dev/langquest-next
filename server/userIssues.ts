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

/**
 * Where a kind comes from: the first part of its key. `ops`: a line of the
 * ops dashboard the records do not hold (apps/admin/src/alertKinds.ts), which
 * the app Worker reads from the dashboard's Worker for each watch.
 */
export const FAMILIES = ['error', 'sync', 'transfer', 'auth', 'expected', 'audio', 'fill', 'device', 'job', 'worker', 'feedback', 'ops'] as const;
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
  /** A server job in trouble, the Worker's 5xx answers, or an ops dashboard line (`line`: its level, text, title, part and link). */
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
  /**
   * The open issues an admin left an instruction on from the ops dashboard, the oldest first, with the notes'
   * ids (docs/decisions/2026-11-18-an-admin-tells-claude-what-to-do-with-a-user-issue.md). Absent before
   * migration 20261118073000_user_issue_notes.sql.
   */
  notes?: { issue: string; ids: string[] }[];
}

/** One issue's instructions for the run that writes its fix (`GET /api/user-issues?notes=LAN-12`). */
export interface IssueNotes {
  /** Not answered yet, the oldest first: an admin's words. */
  waiting: { id: string; at: string; text: string }[];
  /** The last answered ones, the oldest first: what was said before. */
  before: { at: string; text: string; result: NoteResult; answer: string | null }[];
}

/** What a run did with an instruction: changed the draft fix (or wrote one), answered in words only, or neither. */
export const NOTE_RESULTS = ['changed', 'answered', 'none'] as const;
export type NoteResult = (typeof NOTE_RESULTS)[number];
/** The longest answer a run sends back for an instruction. */
export const ANSWER_MAX = 1000;

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
export const LOOKED_MAX = { looked: 200, grew: 200, states: 100, notes: 60, fixes: 20 } as const;

// ---- what the agent team did with an issue (docs/agent-team.md, scripts/agent-team.mjs) -----------

/** `merge`: its pull request merges without a person. `waits`: a draft pull request waits for a developer. `none`: no change; a developer decides. */
export const FIX_DECISIONS = ['merge', 'waits', 'none'] as const;
export type FixDecision = (typeof FIX_DECISIONS)[number];
/** Why a fix waits, as the gate says it (scripts/agent-team.mjs REASONS; scripts/agentTeam.test.ts holds them equal). */
export const FIX_REASONS = ['mode', 'review', 'decision', 'not_a_bug', 'unconfirmed', 'cause', 'paths', 'checks', 'reviewer', 'instruction', 'app', 'stalled'] as const;
export type FixReason = (typeof FIX_REASONS)[number];
/** The manager's verdict (scripts/agent-team.mjs VERDICTS). */
export const FIX_VERDICTS = ['fix', 'review', 'decision', 'not_a_bug', 'unconfirmed', 'approved'] as const;
export const FIX_MODELS = ['sonnet', 'opus'] as const;
export const FIX_EFFORTS = ['low', 'medium', 'high'] as const;
/** The longest of each of the record's words. */
export const FIX_TEXT = { why: 600, summary: 1000, cause: 600, proof: 400, review: 1000, twins: 1000 } as const;

/**
 * The record of one issue's fix for the ops dashboard: what was decided and
 * why, and the reasoning in the team's own words (what changed, the cause, the
 * test that proves it, what the reviewer said, the same mistake in other
 * places). Claude's words only, never what a person wrote, and no address.
 * A later record of the same issue replaces the words it sends and keeps the rest.
 */
export interface FixRecord {
  issue: string; decision: FixDecision; reason: FixReason | null; why: string | null; pr: number | null;
  verdict: (typeof FIX_VERDICTS)[number] | null; model: (typeof FIX_MODELS)[number] | null; effort: (typeof FIX_EFFORTS)[number] | null;
  summary: string | null; cause: string | null; proof: string | null; review: string | null; twins: string | null;
  /** A display fix's proof: the screen without the change and with it, each a JPEG in base64. Both, or neither. */
  before: string | null; after: string | null;
}
/** A JPEG in base64, of at most 150 000 bytes (scripts/agent-team.mjs PICTURES). */
export const FIX_PICTURE = /^\/9j\/[A-Za-z0-9+/]{100,200000}={0,2}$/;
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
    /**
     * The issue in three lines for its card on the ops dashboard (decisions.md 202, amended 2026-11-18): what the
     * person was doing and where, what goes wrong, and what would fix it or what a person must decide. Claude's
     * words, never what someone wrote. A look that sends none keeps the lines the kind has.
     */
    context: string | null; problem: string | null; solution: string | null;
    /** `fixed` only: the pull request on main that fixed it (when known), and when it merged or its issue closed. */
    fixedBy: number | null; fixedAt: string | null;
  }[];
  grew: { key: string; people: number; count: number }[];
  /** Issues whose state in Linear changed since the watch last read it: closed (with the pull request that fixed it, when named) or open again. */
  states: { issue: string; state: string; closed: boolean; closedAt: string | null; fixedBy: number | null; fixedAt: string | null; title: string | null }[];
  /**
   * An admin's instructions this run has: `taken` when the run starts on one, then what it did (`result`),
   * Claude's answer (never an address) and the draft fix's pull request.
   */
  notes: ({ id: string; taken: true } | { id: string; taken: false; result: NoteResult; answer: string | null; pr: number | null })[];
  /** What the agent team did with each issue this run wrote a fix for. Absent from a run before the team. */
  fixes: FixRecord[];
}

export class LookedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LookedError';
  }
}

// ---- what Claude may look at besides the counts (GET /api/user-issues?media= | ?phone=) ---------

/**
 * A problem sent from help mode can come with a screenshot of the app and a
 * picture the person chose, and every phone records how long its downloads,
 * opens and syncs took. Claude looks at both before it judges a problem or
 * writes a fix (decisions.md 202, amended 2026-11-04): `?media=<feedback id>`
 * is the screenshot and picture (`ops_user_issue_media`, base64 JPEGs),
 * `?phone=<install>&at=<time>` that phone's build and records from three days
 * before the time to an hour after (`ops_user_issue_phone`). The workflow keeps
 * them on its runner, never in a log, artifact or pull request.
 */
export interface Media { screenshot: string | null; picture: string | null }

export interface PhoneRecord {
  at: string; receivedAt: string; kind: string; update?: string; about?: 'organization' | 'language';
  n: Record<string, number>; t: Record<string, string>; stack?: string;
}

export interface Phone {
  installId: string;
  /** As `apps` names it: `android update 01a1a398`, `ios store build 2026.103`, `web <commit>`. */
  build: string;
  phone: Partial<Record<'os' | 'osVersion' | 'model' | 'appVersion' | 'runtimeVersion' | 'updateId' | 'channel' | 'embedded', string>>;
  firstSeen: string; lastSeen: string; from: string; to: string;
  /** Newest first, at most 400. */
  records: PhoneRecord[];
}

/** A problem sent from help mode is named by its id; an install by the app's random id (a UUID, or a token). */
export const FEEDBACK_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const INSTALL_ID = /^[A-Za-z0-9_.-]{1,64}$/;

export type EvidenceAsk = { media: string } | { phone: string; at: string | null } | { notes: string };

/** What a GET asks for besides what is new: null for the watch itself, or a LookedError for what is wrong. */
export function evidenceAsked(params: URLSearchParams): EvidenceAsk | null {
  const media = params.get('media');
  const phone = params.get('phone');
  const notes = params.get('notes');
  if (media === null && phone === null && notes === null) return null;
  if ([media, phone, notes].filter((v) => v !== null).length > 1) throw new LookedError('media, phone or notes: one of them');
  if (notes !== null) {
    if (!ISSUE.test(notes)) throw new LookedError('notes: a Linear issue (LAN-12)');
    return { notes };
  }
  if (media !== null) {
    if (!FEEDBACK_ID.test(media)) throw new LookedError('media: the id of a problem sent from help mode');
    return { media };
  }
  if (!INSTALL_ID.test(phone ?? '')) throw new LookedError("phone: an install's id");
  const at = params.get('at');
  if (at !== null && (!ISO.test(at) || Number.isNaN(Date.parse(at)))) throw new LookedError('at: a time (ISO 8601)');
  return { phone: phone as string, at };
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

/** The longest line of an issue's card. */
export const LINE_MAX = 300;

/** One of an issue's three lines for its card: at most LINE_MAX characters and never an address. */
function lineOf(o: Obj, field: 'context' | 'problem' | 'solution', where: string): string | null {
  const v = o[field];
  if (absent(v) || v === '') return null;
  if (typeof v !== 'string' || v.length > LINE_MAX || EMAIL.test(v)) throw new LookedError(`${where}.${field}: at most ${LINE_MAX} characters, no address`);
  return v;
}

function oneOf<T extends string>(o: Obj, field: string, values: readonly T[], where: string): T | null {
  const v = o[field];
  if (absent(v)) return null;
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) throw new LookedError(`${where}.${field}: one of ${values.join(', ')}`);
  return v as T;
}

function words(o: Obj, field: keyof typeof FIX_TEXT, where: string): string | null {
  const v = o[field];
  if (absent(v) || v === '') return null;
  if (typeof v !== 'string' || v.length > FIX_TEXT[field] || EMAIL.test(v)) throw new LookedError(`${where}.${field}: at most ${FIX_TEXT[field]} characters, no address`);
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
      note: note as string | null, title, context: lineOf(l, 'context', where), problem: lineOf(l, 'problem', where), solution: lineOf(l, 'solution', where), fixedBy, fixedAt
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
  const noted = new Set<string>();
  const notes = list(input, 'notes', LOOKED_MAX.notes).map((x, n): Looked['notes'][number] => {
    const where = `notes[${n}]`;
    if (!isObj(x)) throw new LookedError(`${where}: an object`);
    const id = x['id'];
    if (typeof id !== 'string' || !FEEDBACK_ID.test(id) || noted.has(id)) throw new LookedError(`${where}.id: an instruction's id, once`);
    noted.add(id);
    if (x['taken'] === true) return { id, taken: true };
    const result = x['result'];
    if (typeof result !== 'string' || !(NOTE_RESULTS as readonly string[]).includes(result)) throw new LookedError(`${where}.result: one of ${NOTE_RESULTS.join(', ')}, or taken: true`);
    const answer = absent(x['answer']) || x['answer'] === '' ? null : x['answer'];
    if (answer !== null && (typeof answer !== 'string' || answer.length > ANSWER_MAX || EMAIL.test(answer))) throw new LookedError(`${where}.answer: at most ${ANSWER_MAX} characters, no address`);
    return { id, taken: false, result: result as NoteResult, answer: answer as string | null, pr: pr(x, 'pr', where) };
  });
  const fixed = new Set<string>();
  const fixes = list(input, 'fixes', LOOKED_MAX.fixes).map((f, n): FixRecord => {
    const where = `fixes[${n}]`;
    if (!isObj(f)) throw new LookedError(`${where}: an object`);
    const issue = f['issue'];
    if (typeof issue !== 'string' || !ISSUE.test(issue) || fixed.has(issue)) throw new LookedError(`${where}.issue: a Linear issue (LAN-12), once`);
    fixed.add(issue);
    const decision = oneOf(f, 'decision', FIX_DECISIONS, where);
    if (!decision) throw new LookedError(`${where}.decision: one of ${FIX_DECISIONS.join(', ')}`);
    const reason = oneOf(f, 'reason', FIX_REASONS, where);
    // A fix that merges without a person has no reason to wait; any other has one.
    if ((decision === 'merge') !== (reason === null)) throw new LookedError(`${where}.reason: ${decision === 'merge' ? 'none for merge' : `one of ${FIX_REASONS.join(', ')}`}`);
    const number = pr(f, 'pr', where);
    if ((decision === 'none') !== (number === null)) throw new LookedError(`${where}.pr: ${decision === 'none' ? 'none for none' : 'its pull request'}`);
    const picture = (field: 'before' | 'after'): string | null => {
      const v = f[field];
      if (v === undefined || v === null) return null;
      if (typeof v !== 'string' || !FIX_PICTURE.test(v)) throw new LookedError(`${where}.${field}: a JPEG in base64`);
      return v;
    };
    const before = picture('before'), after = picture('after');
    if ((before === null) !== (after === null)) throw new LookedError(`${where}: both pictures, or neither`);
    return {
      before, after,
      issue, decision, reason, why: words(f, 'why', where), pr: number, verdict: oneOf(f, 'verdict', FIX_VERDICTS, where),
      model: oneOf(f, 'model', FIX_MODELS, where), effort: oneOf(f, 'effort', FIX_EFFORTS, where),
      summary: words(f, 'summary', where), cause: words(f, 'cause', where), proof: words(f, 'proof', where), review: words(f, 'review', where), twins: words(f, 'twins', where)
    };
  });
  return { sha: input['sha'], runUrl: input['runUrl'], looked, grew, states, notes, fixes };
}
