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
export const FAMILIES = ['error', 'sync', 'transfer', 'auth', 'expected', 'audio', 'fill', 'device', 'slow', 'snapshot', 'job', 'worker', 'feedback', 'ops'] as const;
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
   * The top line of each of its stacks, by records, at most 5. Two lines can be two bugs under one
   * error name and place: the key stays one kind, and the look says so. Absent before migration
   * 20261121031500_user_issue_watch_gaps.sql, and on help mode's problems and the server's.
   */
  tops?: { frame: string; records: number }[];
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
  /** Kinds to look at past the 20 a run: they wait for the next runs. Absent before migration 20261121031500_user_issue_watch_gaps.sql. */
  waiting?: number;
  grew: GrownKind[];
  /** Every Linear issue the watch filed or commented on in 180 days, with the state last read (the workflow reads them again each run). */
  issues: { issue: string; state: string | null; closed: boolean }[];
  /**
   * The open issues an admin left an instruction on from the ops dashboard, the oldest first, with the notes'
   * ids (docs/decisions/2026-11-18-an-admin-tells-claude-what-to-do-with-a-user-issue.md). Absent before
   * migration 20261118073000_user_issue_notes.sql.
   */
  notes?: { issue: string; ids: string[] }[];
  /** The issues the research recommends a fix for, which the fix team did not get yet, the oldest first. */
  research?: string[];
  /**
   * The open issues Claude never tried (no fix record, never handed to the fix jobs), the oldest first
   * (docs/agent-team.md "Issues Claude never tried"). Absent before migration 20261121221500_user_issue_tries.sql.
   */
  untried?: string[];
  /**
   * The open issues whose plan's time has come: the manager did not prove the cause yet and said what it does
   * next and when (docs/agent-team.md "When the cause is not proven yet"), the oldest first. Absent before
   * migration 20261121235200_user_issue_plans.sql.
   */
  due?: string[];
  /**
   * Every issue that waits for the fix team (due, research, untried), the most important first
   * (docs/agent-team.md "Which issue Claude takes first", `ops_user_issue_order`). Absent before
   * migration 20261122044500_user_issue_order.sql.
   */
  order?: OrderedIssue[];
}

/**
 * Where an issue that waits for the fix team comes from: a plan whose time came, the research, never
 * tried, or a choice Claude asked for before it could read production, tried once more (again).
 */
export const ORDER_FROM = ['plan', 'research', 'untried', 'again'] as const;

/** One issue in the order the fix team takes them, with the facts the order used. */
export interface OrderedIssue {
  issue: string;
  from: (typeof ORDER_FROM)[number];
  /** A person sent it from help mode: it goes before every issue that nobody sent (migration 20261124061500_user_reports.sql). Absent before it. */
  sent?: boolean;
  /** Linear's number: 0 none, 1 Urgent, 2 High, 3 Medium, 4 Low. */
  priority: number;
  /** The most people of one of its kinds, in 7 days. */
  people: number;
  /** How many kinds of failure point to it. */
  kinds: number;
  /** How many places the research found with the same mistake. */
  places: number;
  /** How many times its kinds happened. */
  times: number;
  firstAt: string | null;
}

/** One issue's instructions for the run that writes its fix (`GET /api/user-issues?notes=LAN-12`). */
export interface IssueNotes {
  /** Not answered yet, the oldest first: an admin's words. */
  waiting: { id: string; at: string; text: string }[];
  /** The last answered ones, the oldest first: what was said before. */
  before: { at: string; text: string; result: NoteResult; answer: string | null }[];
  /** The manager's last plan for the issue, with what its probe printed, or null. Absent before migration 20261121235200_user_issue_plans.sql. */
  plan?: { next: string; steps: string | null; nextAt: string; probe: string | null; tries: number; at: string; reads?: string[] | null } | null;
  /**
   * A developer claimed the issue on the ops dashboard (ops.issue_claims): the fix team assists and never merges
   * (docs/decisions/2026-11-24-claim-issues-and-see-claudes-replies.md). Absent before migration 20261124023000.
   */
  claimed?: boolean;
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
export const LOOKED_MAX = { looked: 200, grew: 200, states: 100, notes: 60, fixes: 20, research: 70, handed: 10, tried: 10, diagrams: 20, plans: 20, priorities: 100 } as const;

// ---- what the agent team did with an issue (docs/agent-team.md, scripts/agent-team.mjs) -----------

/** `merge`: its pull request merges without a person. `waits`: a draft pull request waits for a developer. `none`: no change; a developer decides. */
export const FIX_DECISIONS = ['merge', 'waits', 'none'] as const;
export type FixDecision = (typeof FIX_DECISIONS)[number];
/** Why a fix waits, as the gate says it (scripts/agent-team.mjs REASONS; scripts/agentTeam.test.ts holds them equal). */
export const FIX_REASONS = ['mode', 'review', 'decision', 'not_a_bug', 'unconfirmed', 'cause', 'paths', 'checks', 'reviewer', 'instruction', 'app', 'stalled', 'claimed'] as const;
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
  /**
   * The screen where the problem shows, without the change (`before`) and with it (`after`), each a JPEG in
   * base64. Both are a display fix's proof; `before` alone shows the problem of an issue with no fix. Never `after` alone.
   */
  before: string | null; after: string | null;
}
/**
 * What the manager does next on an issue whose cause it did not prove yet (docs/agent-team.md "When the cause
 * is not proven yet"): `next` in a sentence, all the `steps`, in how many hours the watch hands the issue
 * back, and what its probe printed on main. `next: null` removes the plan (the issue has a cause now, or a
 * developer decides). Claude's words only, and the probe ran in the local test world, never on production.
 */
export interface PlanRecord { issue: string; next: string | null; steps: string | null; inHours: number | null; probe: string | null; reads?: string[] | null }
/** The reads of production a plan may name, run before the next try's Claude starts (scripts/agent-team.mjs READS_LIMITS). */
export const PLAN_READS = { count: 6, sql: 1500 } as const;
/** A log a plan reads, as prod-read.mjs takes it: `--logs <source> name=value ...` (scripts/agent-team.mjs READS_LOGS). */
export const PLAN_READS_LOGS = /^--logs [a-z][a-z-]{1,40}( [a-z]{1,20}=[^\s;]{1,200}){0,8}$/;
/** The longest of a plan's words, and its hours (scripts/agent-team.mjs NEXT_LIMITS and NEXT_HOURS). */
export const PLAN_TEXT = { next: 300, steps: 600, probe: 6000 } as const;
export const PLAN_HOURS = { min: 0.25, max: 168 } as const;
/** After this many tries to prove the cause (hand-backs, ops_user_issue_tried counts them) the watch hands an issue back once a day, not each 2 hours (scripts/agent-team.mjs PLAN_TRIES). */
export const PLAN_TRIES = 10;

/** A JPEG in base64, of at most 150 000 bytes (scripts/agent-team.mjs PICTURES). */
export const FIX_PICTURE = /^\/9j\/[A-Za-z0-9+/]{100,200000}={0,2}$/;

// ---- a small diagram on an issue's card (docs/agent-team.md "An image on each card") ----------------

/** How many steps a diagram has, and the longest of a step's words. */
export const DIAGRAM = { min: 2, max: 6, text: 90, where: 20 } as const;
/**
 * One step of an issue's diagram: where it happens (Phone, Server), what
 * happens, and whether this is the step that goes wrong. Claude's words about
 * the app, never what a person wrote; the dashboard draws them as text.
 */
export interface DiagramStep { where: string | null; text: string; wrong: boolean }

/** A diagram's steps, checked: 2 to 6, at least one that goes wrong, no address. */
export function parseSteps(v: unknown, at: string): DiagramStep[] {
  if (!Array.isArray(v) || v.length < DIAGRAM.min || v.length > DIAGRAM.max) throw new LookedError(`${at}: ${DIAGRAM.min} to ${DIAGRAM.max} steps`);
  const steps = v.map((s, n): DiagramStep => {
    if (!isObj(s)) throw new LookedError(`${at}[${n}]: an object`);
    const text = s['text'], where = absent(s['where']) || s['where'] === '' ? null : s['where'];
    if (typeof text !== 'string' || !text.trim() || text.length > DIAGRAM.text || EMAIL.test(text)) throw new LookedError(`${at}[${n}].text: 1 to ${DIAGRAM.text} characters, no address`);
    if (where !== null && (typeof where !== 'string' || where.length > DIAGRAM.where || EMAIL.test(where))) throw new LookedError(`${at}[${n}].where: at most ${DIAGRAM.where} characters`);
    return { where: where as string | null, text, wrong: s['wrong'] === true };
  });
  if (!steps.some((s) => s.wrong)) throw new LookedError(`${at}: one step that goes wrong`);
  return steps;
}

// ---- what the research team found (docs/agent-team.md "The research team", scripts/agent-research.mjs) ----

/** `recommend`: do something about it. `watch`: not sure yet. `reject`: looked at, nothing to do. */
export const RESEARCH_DECISIONS = ['recommend', 'watch', 'reject'] as const;
/** `fix`: the fix team can write the change. `ask`: a developer must decide first. `none`: nothing to do. */
export const RESEARCH_ACTIONS = ['fix', 'ask', 'none'] as const;
export const RESEARCH_TAG = /^[a-z0-9][a-z0-9-]{2,59}$/;
/** Where in the code: a path in this repository, with or without a line. */
export const RESEARCH_PLACE = /^[A-Za-z0-9_@.()[\]/-]{1,200}(:[0-9]{1,6})?$/;
export const RESEARCH_TEXT = { title: 200, found: 600, why: 600, places: 8, links: 6, link: 300 } as const;

/**
 * The research team that looks ahead (docs/research-team.md, scripts/research-team.mjs BEATS): the subject of
 * each scout, what kind of thing it found and how bad. scripts/agentResearch.test.ts holds these to the script's.
 */
export const RESEARCH_BEATS = ['security', 'versions', 'packages', 'offline', 'code-security', 'speed', 'platform', 'alternatives', 'supply-chain'] as const;
export const RESEARCH_KINDS = ['vulnerability', 'upgrade', 'replace', 'bug', 'risk', 'cost', 'deadline', 'other'] as const;
export const RESEARCH_SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export const RESEARCH_RESULTS = ['clear', 'found', 'failed', 'skipped'] as const;
export const RESEARCH_MODELS = ['opus', 'sonnet', 'haiku'] as const;
/** A public page that backs an item: an advisory, release notes, a store's rule. */
export const RESEARCH_LINK = /^https:\/\/[^\s<>"'`]{4,295}$/;
export const RESEARCH_PACKAGE = /^(@[a-z0-9._-]{1,100}\/)?[a-z0-9._-]{1,100}$/;
export const RESEARCH_VERSION = /^[0-9A-Za-z.+-]{1,40}$/;
export const RESEARCH_ASK = { why: 300, label: 80, then: 200, min: 2, max: 4 } as const;
export const RESEARCH_REPORT = { headline: 200, summary: 5, line: 300, beats: 12, title: 60, checked: 400 } as const;

/** A choice the team asks of a developer: why it is theirs, and 2 to 4 choices, the team's pick first. */
export interface ResearchAsk { why: string; choices: { label: string; then: string | null }[] }

/**
 * One thing the research found. The same mistake as an issue the team fixed, in another place (`like`), or what a
 * scout of the day found looking ahead (`beat` and the fields after it). Claude's words only: the research reads
 * the team's own words, the code and public pages, never what a person wrote.
 */
export interface ResearchItem {
  tag: string; title: string; like: string | null; found: string; why: string; places: string[];
  /** The mistake as a small diagram for its card, when the lead drew one. */
  steps: DiagramStep[] | null;
  decision: (typeof RESEARCH_DECISIONS)[number]; action: (typeof RESEARCH_ACTIONS)[number];
  /** The Linear issue filed for a recommended item. */
  issue: string | null; issueUrl: string | null;
  beat: (typeof RESEARCH_BEATS)[number] | null; kind: (typeof RESEARCH_KINDS)[number] | null; severity: (typeof RESEARCH_SEVERITIES)[number] | null;
  links: string[]; package: string | null; from: string | null; to: string | null; deadline: string | null; ask: ResearchAsk | null;
}

/** The report of one run of the research team: what the ops dashboard's Research page shows on top. */
export interface ResearchReport {
  day: string; headline: string; summary: string[];
  beats: { id: string; title: string; model: (typeof RESEARCH_MODELS)[number]; checked: string; result: (typeof RESEARCH_RESULTS)[number]; note: string | null }[];
  lead: 'ok' | 'failed'; minutes: number | null; turns: number | null;
  counts: { found: number; recommended: number; rejected: number; watching: number; toFix: number; toAsk: number };
  facts: { packages: number; advisories: number; outdated: number; actions: number } | null;
}
/** What the lead reads before it starts (`GET /api/user-issues?research=1`, `ops_research_context`). */
export interface ResearchContext { issues: unknown[]; items: unknown[] }

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
     * words, never what someone wrote. A look that sends none keeps the lines the kind has. `known` (2026-11-21):
     * what the records show and what they do not.
     */
    context: string | null; problem: string | null; known: string | null; solution: string | null;
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
  /** What the research team found this run. Absent from every other run. */
  research: ResearchItem[];
  /** The research team's report of this run. Absent from every other run. */
  report: ResearchReport | null;
  /** The research's issues this run hands to the fix team. */
  handed: string[];
  /** Every issue this run hands to the fix jobs, so the dashboard knows when Claude started on it. */
  tried: string[];
  /** The diagram of each issue this run filed, for its card. */
  diagrams: { issue: string; steps: DiagramStep[] }[];
  /** What the manager does next on each issue whose cause it did not prove yet, or `next: null` to remove the plan. */
  plans: PlanRecord[];
  /** Each open issue's priority in Linear (0 none, 1 Urgent, 2 High, 3 Medium, 4 Low), for the order the fix team takes them. */
  priorities: { issue: string; priority: number }[];
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

export type EvidenceAsk = { media: string } | { phone: string; at: string | null } | { notes: string } | { research: true };

/** What a GET asks for besides what is new: null for the watch itself, or a LookedError for what is wrong. */
export function evidenceAsked(params: URLSearchParams): EvidenceAsk | null {
  const media = params.get('media');
  const phone = params.get('phone');
  const notes = params.get('notes');
  const research = params.get('research');
  if (media === null && phone === null && notes === null && research === null) return null;
  if ([media, phone, notes, research].filter((v) => v !== null).length > 1) throw new LookedError('media, phone, notes or research: one of them');
  if (research !== null) {
    if (research !== '1') throw new LookedError('research: 1');
    return { research: true };
  }
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
function lineOf(o: Obj, field: 'context' | 'problem' | 'known' | 'solution', where: string): string | null {
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

/** Words of the research team: a string of 1 to max characters with no address, or null when it may be absent. */
function researchWords(v: unknown, max: number, where: string, mayBeAbsent = false): string | null {
  if (mayBeAbsent && (absent(v) || v === '')) return null;
  if (typeof v !== 'string' || !v.trim() || v.length > max || EMAIL.test(v)) throw new LookedError(`${where}: 1 to ${max} characters, no address`);
  return v;
}

function researchAsk(v: unknown, where: string): ResearchAsk {
  if (!isObj(v)) throw new LookedError(`${where}: an object`);
  const choices = v['choices'];
  if (!Array.isArray(choices) || choices.length < RESEARCH_ASK.min || choices.length > RESEARCH_ASK.max) throw new LookedError(`${where}.choices: ${RESEARCH_ASK.min} to ${RESEARCH_ASK.max}`);
  return {
    why: researchWords(v['why'], RESEARCH_ASK.why, `${where}.why`) as string,
    choices: choices.map((c, n) => {
      if (!isObj(c)) throw new LookedError(`${where}.choices[${n}]: an object`);
      return { label: researchWords(c['label'], RESEARCH_ASK.label, `${where}.choices[${n}].label`) as string, then: researchWords(c['then'], RESEARCH_ASK.then, `${where}.choices[${n}].then`, true) };
    })
  };
}

function researchReport(v: unknown): ResearchReport {
  const where = 'report';
  if (!isObj(v)) throw new LookedError(`${where}: an object`);
  const day = v['day'];
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new LookedError(`${where}.day: a date`);
  const summary = list(v, 'summary', RESEARCH_REPORT.summary).map((x, n) => researchWords(x, RESEARCH_REPORT.line, `${where}.summary[${n}]`) as string);
  const ids = new Set<string>([...RESEARCH_BEATS, 'twins']);
  const beats = list(v, 'beats', RESEARCH_REPORT.beats).map((b, n) => {
    const at = `${where}.beats[${n}]`;
    if (!isObj(b) || typeof b['id'] !== 'string' || !ids.has(b['id'])) throw new LookedError(`${at}.id: a beat of the team`);
    const model = oneOf(b, 'model', RESEARCH_MODELS, at), result = oneOf(b, 'result', RESEARCH_RESULTS, at);
    if (!model || !result) throw new LookedError(`${at}: a model and a result`);
    return {
      id: b['id'], title: researchWords(b['title'], RESEARCH_REPORT.title, `${at}.title`) as string, model,
      checked: absent(b['checked']) || b['checked'] === '' ? '' : (researchWords(b['checked'], RESEARCH_REPORT.checked, `${at}.checked`) as string),
      result, note: researchWords(b['note'], RESEARCH_REPORT.line, `${at}.note`, true)
    };
  });
  const lead = v['lead'];
  if (lead !== 'ok' && lead !== 'failed') throw new LookedError(`${where}.lead: ok or failed`);
  const counts = v['counts'];
  if (!isObj(counts)) throw new LookedError(`${where}.counts: an object`);
  const facts = v['facts'];
  if (!absent(facts) && !isObj(facts)) throw new LookedError(`${where}.facts: an object`);
  const minutes = v['minutes'];
  if (!absent(minutes) && (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes < 0 || minutes > 600)) throw new LookedError(`${where}.minutes: 0 to 600`);
  return {
    day, headline: researchWords(v['headline'], RESEARCH_REPORT.headline, `${where}.headline`) as string, summary, beats, lead,
    minutes: absent(minutes) ? null : Math.round((minutes as number) * 10) / 10,
    turns: absent(v['turns']) ? null : count(v, 'turns', where),
    counts: {
      found: count(counts, 'found', `${where}.counts`), recommended: count(counts, 'recommended', `${where}.counts`), rejected: count(counts, 'rejected', `${where}.counts`),
      watching: count(counts, 'watching', `${where}.counts`), toFix: count(counts, 'toFix', `${where}.counts`), toAsk: count(counts, 'toAsk', `${where}.counts`)
    },
    facts: isObj(facts) ? {
      packages: count(facts, 'packages', `${where}.facts`), advisories: count(facts, 'advisories', `${where}.facts`),
      outdated: count(facts, 'outdated', `${where}.facts`), actions: count(facts, 'actions', `${where}.facts`)
    } : null
  };
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
      note: note as string | null, title, context: lineOf(l, 'context', where), problem: lineOf(l, 'problem', where), known: lineOf(l, 'known', where), solution: lineOf(l, 'solution', where), fixedBy, fixedAt
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
    if (before === null && after !== null) throw new LookedError(`${where}: no picture after the fix without the one before it`);
    return {
      before, after,
      issue, decision, reason, why: words(f, 'why', where), pr: number, verdict: oneOf(f, 'verdict', FIX_VERDICTS, where),
      model: oneOf(f, 'model', FIX_MODELS, where), effort: oneOf(f, 'effort', FIX_EFFORTS, where),
      summary: words(f, 'summary', where), cause: words(f, 'cause', where), proof: words(f, 'proof', where), review: words(f, 'review', where), twins: words(f, 'twins', where)
    };
  });
  const tags = new Set<string>();
  const research = list(input, 'research', LOOKED_MAX.research).map((r, n): ResearchItem => {
    const where = `research[${n}]`;
    if (!isObj(r)) throw new LookedError(`${where}: an object`);
    const tag = r['tag'];
    if (typeof tag !== 'string' || !RESEARCH_TAG.test(tag) || tags.has(tag)) throw new LookedError(`${where}.tag: a short name in small letters, once`);
    tags.add(tag);
    const said = (field: 'title' | 'found' | 'why'): string => {
      const v = r[field];
      if (typeof v !== 'string' || !v.trim() || v.length > RESEARCH_TEXT[field] || EMAIL.test(v)) throw new LookedError(`${where}.${field}: 1 to ${RESEARCH_TEXT[field]} characters, no address`);
      return v;
    };
    const issueOf = (field: 'like' | 'issue'): string | null => {
      const v = r[field];
      if (absent(v) || v === '') return null;
      if (typeof v !== 'string' || !ISSUE.test(v)) throw new LookedError(`${where}.${field}: a Linear issue (LAN-12)`);
      return v;
    };
    const places = list(r, 'places', RESEARCH_TEXT.places).map((x) => {
      if (typeof x !== 'string' || !RESEARCH_PLACE.test(x) || x.includes('..')) throw new LookedError(`${where}.places: each a path in the repository, with or without :line`);
      return x;
    });
    const decision = oneOf(r, 'decision', RESEARCH_DECISIONS, where);
    const action = oneOf(r, 'action', RESEARCH_ACTIONS, where);
    if (!decision || !action) throw new LookedError(`${where}: decision (${RESEARCH_DECISIONS.join(', ')}) and action (${RESEARCH_ACTIONS.join(', ')})`);
    // Only something recommended has work to do, and something to do is somewhere in the code.
    if (decision !== 'recommend' && action !== 'none') throw new LookedError(`${where}.action: none unless recommended`);
    const issue = issueOf('issue');
    const issueUrl = absent(r['issueUrl']) || r['issueUrl'] === '' ? null : r['issueUrl'];
    if (issueUrl !== null && (typeof issueUrl !== 'string' || !ISSUE_URL.test(issueUrl))) throw new LookedError(`${where}.issueUrl: the issue in Linear`);
    if ((issue === null) !== (issueUrl === null)) throw new LookedError(`${where}: an issue with its address, or neither`);
    const steps = absent(r['steps']) ? null : parseSteps(r['steps'], `${where}.steps`);
    const links = list(r, 'links', RESEARCH_TEXT.links).map((x) => {
      if (typeof x !== 'string' || !RESEARCH_LINK.test(x) || EMAIL.test(x)) throw new LookedError(`${where}.links: each a public https address`);
      return x;
    });
    const plain = (field: 'package' | 'from' | 'to' | 'deadline', re: RegExp): string | null => {
      const v = r[field];
      if (absent(v) || v === '') return null;
      if (typeof v !== 'string' || !re.test(v)) throw new LookedError(`${where}.${field}: not one`);
      return v;
    };
    const ask = absent(r['ask']) ? null : researchAsk(r['ask'], `${where}.ask`);
    if (ask && action !== 'ask') throw new LookedError(`${where}.ask: only with the action ask`);
    // Only something recommended has work to do, and something to do is somewhere: in the code or on a public page.
    if (decision === 'recommend' && (action === 'none' || (!places.length && !links.length))) throw new LookedError(`${where}: a recommended item has an action and a place or a link`);
    return {
      tag, title: said('title'), like: issueOf('like'), found: said('found'), why: said('why'), places, steps, decision, action, issue, issueUrl: issueUrl as string | null,
      beat: oneOf(r, 'beat', RESEARCH_BEATS, where), kind: oneOf(r, 'kind', RESEARCH_KINDS, where), severity: oneOf(r, 'severity', RESEARCH_SEVERITIES, where),
      links, package: plain('package', RESEARCH_PACKAGE), from: plain('from', RESEARCH_VERSION), to: plain('to', RESEARCH_VERSION),
      deadline: plain('deadline', /^\d{4}-\d{2}-\d{2}$/), ask
    };
  });
  const report = absent(input['report']) ? null : researchReport(input['report']);
  const handed = list(input, 'handed', LOOKED_MAX.handed).map((x, n) => {
    if (typeof x !== 'string' || !ISSUE.test(x)) throw new LookedError(`handed[${n}]: a Linear issue (LAN-12)`);
    return x;
  });
  const tried = list(input, 'tried', LOOKED_MAX.tried).map((x, n) => {
    if (typeof x !== 'string' || !ISSUE.test(x)) throw new LookedError(`tried[${n}]: a Linear issue (LAN-12)`);
    return x;
  });
  const drawn = new Set<string>();
  const diagrams = list(input, 'diagrams', LOOKED_MAX.diagrams).map((d, n) => {
    const where = `diagrams[${n}]`;
    if (!isObj(d)) throw new LookedError(`${where}: an object`);
    const issue = d['issue'];
    if (typeof issue !== 'string' || !ISSUE.test(issue) || drawn.has(issue)) throw new LookedError(`${where}.issue: a Linear issue (LAN-12), once`);
    drawn.add(issue);
    return { issue, steps: parseSteps(d['steps'], `${where}.steps`) };
  });
  const planned = new Set<string>();
  const plans = list(input, 'plans', LOOKED_MAX.plans).map((x, n): PlanRecord => {
    const where = `plans[${n}]`;
    if (!isObj(x)) throw new LookedError(`${where}: an object`);
    const issue = x['issue'];
    if (typeof issue !== 'string' || !ISSUE.test(issue) || planned.has(issue)) throw new LookedError(`${where}.issue: a Linear issue (LAN-12), once`);
    planned.add(issue);
    const said = (field: keyof typeof PLAN_TEXT): string | null => {
      const v = x[field];
      if (absent(v) || v === '') return null;
      if (typeof v !== 'string' || v.length > PLAN_TEXT[field] || EMAIL.test(v)) throw new LookedError(`${where}.${field}: at most ${PLAN_TEXT[field]} characters, no address`);
      return v;
    };
    const next = said('next');
    if (next === null) return { issue, next: null, steps: null, inHours: null, probe: null };
    const hours = x['inHours'];
    if (typeof hours !== 'number' || !Number.isFinite(hours) || hours < PLAN_HOURS.min || hours > PLAN_HOURS.max) throw new LookedError(`${where}.inHours: ${PLAN_HOURS.min} to ${PLAN_HOURS.max}`);
    const r = x['reads'];
    let reads: string[] | null = null;
    if (!absent(r)) {
      if (!Array.isArray(r) || r.length > PLAN_READS.count || r.some((s) => typeof s !== 'string' || !s || s.length > PLAN_READS.sql || EMAIL.test(s) || !(/^\s*(select|with)\b/i.test(s) || PLAN_READS_LOGS.test(s.trim()))))
        throw new LookedError(`${where}.reads: at most ${PLAN_READS.count} statements that start with select or with, or logs (--logs <source> name=value), each at most ${PLAN_READS.sql} characters, no address`);
      reads = r.length ? (r as string[]) : null;
    }
    return { issue, next, steps: said('steps'), inHours: hours, probe: said('probe'), reads };
  });
  const ranked = new Set<string>();
  const priorities = list(input, 'priorities', LOOKED_MAX.priorities).map((x, n) => {
    const where = `priorities[${n}]`;
    if (!isObj(x)) throw new LookedError(`${where}: an object`);
    const issue = x['issue'];
    if (typeof issue !== 'string' || !ISSUE.test(issue) || ranked.has(issue)) throw new LookedError(`${where}.issue: a Linear issue (LAN-12), once`);
    ranked.add(issue);
    const priority = x['priority'];
    if (!Number.isInteger(priority) || (priority as number) < 0 || (priority as number) > 4) throw new LookedError(`${where}.priority: 0 to 4, as Linear numbers it`);
    return { issue, priority: priority as number };
  });
  return { sha: input['sha'], runUrl: input['runUrl'], looked, grew, states, notes, fixes, research, report, handed, tried, diagrams, plans, priorities };
}
