#!/usr/bin/env node
// The agent team's rules (docs/agent-team.md,
// docs/decisions/2026-11-19-an-agent-team-fixes-user-issues.md), as pure
// functions, and the steps of .github/workflows/user-issues.yml that use them.
// Plain Node, no packages.
//
// The team: a coordinator (the watch's look) judges each problem and chooses
// the model and effort of the issue's manager; the manager owns one issue,
// starts workers and gives a verdict with its change; a reviewer reads only
// the change; then `gate` below decides, in code, whether the change merges
// without a person or waits for a developer. No agent can change this file
// (scripts/user-issues.mjs FIX_REFUSED), and the mode is a file on main.
//
//   node scripts/agent-team.mjs review-needed <dir>
//                                        writes yes=true|false to GITHUB_OUTPUT: whether the reviewer must read
//                                        the change in <dir>/fix (false when the gate says "waits" without it)
//   node scripts/agent-team.mjs vet-out <dir>
//                                        after the reviewer: its verdict.json, checked, in VET_OUT
//   node scripts/agent-team.mjs pictures <from> <to>
//                                        the two pictures of a display fix, for the reviewer: only real pictures
//   node scripts/agent-team.mjs follow   the team's open pull requests that merge without a person: for one in
//                                        trouble Claude takes a try (run failed jobs again, merge main, or a
//                                        change by the fix team: repairs=<issues> to GITHUB_OUTPUT); after TRIES
//                                        it becomes a draft that waits for a developer, and the Worker is told
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkVet, runUrl } from './tutorial-review.mjs';

export { checkVet };

export const REPO = 'genesis-ai-dev/langquest-next';
/** The file on main that holds the mode. Only a pull request a person merges changes it. */
export const MODE_FILE = '.github/agent-team.json';
/**
 * `on`: a fix that passes the gate merges without a person. `ask`: every fix
 * waits for a developer (the gate still runs, and the card says what it would
 * do). `off`: the team writes no fix; the watch still files issues.
 */
export const MODES = ['on', 'ask', 'off'];
/** The models and efforts the coordinator may choose for an issue's manager. Workers use what the skill says. */
export const MODELS = ['sonnet', 'opus'];
export const EFFORTS = ['low', 'medium', 'high'];
export const DEFAULT_PLAN = { model: 'opus', effort: 'high' };
/** A pull request that merges without a person and has not merged in this long becomes a draft that waits. */
export const OPEN_HOURS = 24;
export const LABELS = { merge: 'agent-merge', waits: 'agent-waits' };

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const said = (v) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const cut = (t, max) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);

/** The mode the file names; anything odd or missing is `ask`, so a broken file never merges. */
export function modeOf(text) {
  try {
    const mode = JSON.parse(String(text))?.mode;
    return MODES.includes(mode) ? mode : 'ask';
  } catch {
    return 'ask';
  }
}

/** The manager's model and effort as the coordinator chose them; anything else is the default. */
export function planOf(raw) {
  const o = isObj(raw) ? raw : {};
  return { model: MODELS.includes(o.model) ? o.model : DEFAULT_PLAN.model, effort: EFFORTS.includes(o.effort) ? o.effort : DEFAULT_PLAN.effort };
}

// ---- the manager's verdict ---------------------------------------------------------------------

/**
 * What the manager says about its issue (fix.json `verdict`):
 *   fix          a real bug, its cause proven, a small and local change, no product choice
 *   review       a real bug with a change that is bigger or riskier: a developer reads it
 *   decision     the fix needs a product choice (behaviour, look, words); the change, if any, is what it recommends
 *   not_a_bug    the app works as it is meant to
 *   unconfirmed  the cause is not proven yet: `next` says what the manager does next to prove it, and when
 *                (a change, when there is one, is the timing or the test the plan needs, and a developer reads it)
 *   approved     only with an admin's instruction that says to merge the draft fix as it is
 */
export const VERDICTS = ['fix', 'review', 'decision', 'not_a_bug', 'unconfirmed', 'approved'];
export const VERDICT_LIMITS = { cause: 600, proof: 400, why: 600, twins: 1000 };

/** The verdict in fix.json, checked and cut. One written before the team, or an odd one, is `review`: it waits. */
export function verdictOf(raw) {
  const o = isObj(raw) ? raw : {};
  return {
    verdict: VERDICTS.includes(o.verdict) ? o.verdict : 'review',
    cause: cut(said(o.cause), VERDICT_LIMITS.cause),
    proof: cut(said(o.proof), VERDICT_LIMITS.proof),
    why: cut(said(o.why), VERDICT_LIMITS.why),
    twins: cut(said(o.twins), VERDICT_LIMITS.twins),
    // A display fix: what a person sees is wrong (words cut off, parts that overlap), and nothing else changes.
    // Its proof is a picture of the screen before the fix and one after it, not a test.
    display: o.display === true,
    // The manager read the admin's instructions as "show me the change before it merges" (with `go`, below).
    askFirst: o.askFirst === true,
    // What the manager does next to prove the cause, and when the watch hands the issue back (nextOf).
    next: nextOf(o.next)
  };
}

// ---- when the cause is not proven yet ------------------------------------------------------------

/** The longest of a plan's words (server/userIssues.ts PLAN_TEXT holds the same numbers). */
export const NEXT_LIMITS = { do: 300, steps: 600 };
/** In how many hours the watch hands the issue back: from the next run of the watch to a week (server/userIssues.ts PLAN_HOURS). */
export const NEXT_HOURS = { min: 0.25, max: 168 };
/** After this many tries to prove the cause (each a hand-back of the issue to the fix jobs) the watch hands it back once a day (server/userIssues.ts PLAN_TRIES). */
export const PLAN_TRIES = 10;
/** The file of the manager's own test, beside fix.json: the job `check` runs it on main, and the next try reads what it printed. */
export const PROBE_TEST = 'probe.test.ts';
/** Where the probe may run: a folder of tests the repository's vitest reads. */
export const PROBE_DIRS = ['apps/mobile/test', 'apps/admin/test', 'apps/web/test', 'packages/core/test', 'packages/sync/test', 'scripts'];

/** The most production reads a plan may name, and the longest of each (server/userIssues.ts PLAN_READS holds the same). */
export const READS_LIMITS = { count: 6, sql: 1500 };

/**
 * The reads of production a plan names (fix.json `next.reads`): each one read-only statement, `select` or
 * `with`, cut to READS_LIMITS. The fix job runs them before the next try's Claude starts, through the read gate
 * as agent_reader, and gives Claude the answers in .user-issues/reads.json: Claude's own shell cannot get the
 * job's token (claude-code-action removes it), and the gate is what holds a read to reading.
 */
/** A log the plan reads: `--logs <source> name=value ...` (prod-read.mjs, docs/production-reads.md "Logs"). */
export const READS_LOGS = /^--logs [a-z][a-z-]{1,40}( [a-z]{1,20}=[^\s;]{1,200}){0,8}$/;

export function readsOf(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r) => typeof r === 'string').map((r) => r.trim().replace(/;\s*$/, ''))
    .filter((r) => r && r.length <= READS_LIMITS.sql && (/^(select|with)\b/i.test(r) ? !r.includes(';') : READS_LOGS.test(r)))
    .slice(0, READS_LIMITS.count);
}

/**
 * fix.json `next`: { do, steps, inHours, probeAt, reads }. `do` says in a sentence what the manager does next to
 * prove the cause (read production again, run its probe, wait for records a timing makes); `steps` the
 * whole plan; `inHours` when the watch hands the issue back (cut to NEXT_HOURS); `probeAt` the folder its
 * probe runs in (PROBE_DIRS). Null when there is no `do`.
 */
export function nextOf(raw) {
  const o = isObj(raw) ? raw : {};
  const what = cut(said(o.do), NEXT_LIMITS.do);
  if (!what) return null;
  const hours = Number(o.inHours);
  const inHours = Number.isFinite(hours) ? Math.min(NEXT_HOURS.max, Math.max(NEXT_HOURS.min, hours)) : 1;
  return { do: what, steps: cut(said(o.steps), NEXT_LIMITS.steps), inHours, probeAt: PROBE_DIRS.includes(o.probeAt) ? o.probeAt : null, reads: readsOf(o.reads) };
}

/**
 * The manager's run ended before it wrote fix.json (or its job failed): it gave no verdict, so it did not
 * find that the cause cannot be proven either. The card says so, and the watch runs the manager again.
 */
export const ENDED = {
  why: 'The manager\'s run ended before it wrote its verdict, so the cause is neither proven nor ruled out.',
  next: { do: 'Claude runs the manager again at the next run of the watch, to read production and prove the cause.', steps: '', inHours: 0.25, probeAt: null, reads: [] }
};

/**
 * What the manager does next when it did not prove the cause. A manager that wrote no plan never leaves
 * the issue at "not proven": it tries again at the next run, with the probe it wrote, if any.
 */
export function planNext(verdict) {
  if (verdict?.ended === true) return ENDED.next;
  if (!verdict || verdict.verdict !== 'unconfirmed') return verdict?.next ?? null;
  return verdict.next ?? { do: 'Claude tries again: it reads production and writes a test that runs the code, to prove the cause.', steps: '', inHours: 1, probeAt: null, reads: [] };
}

/** The manager named the cause and how a test proves it. The gate also wants that test in the change. */
export const causeProven = (v) => v.cause.length >= 20 && v.proof.length >= 10;

// ---- the gate ------------------------------------------------------------------------------------

/** A test file. A fix that merges without a person holds one: it proves the cause. */
export const isTest = (file) => /(^|\/)(test|tests|__tests__)\//.test(file) || /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);

/**
 * Where a fix that merges without a person may change code: the app's screens
 * and logic, the ops dashboard, and the pure core. Everything else waits for a
 * developer: migrations and anything that changes data, sync, the servers and
 * Workers, packages, native code, build and store settings, workflows,
 * scripts, docs and decisions.
 */
export const MERGE_PATHS = [/^apps\/mobile\/src\//, /^apps\/admin\/src\//, /^packages\/core\/src\//];
/**
 * Inside those, what still waits: every Supabase call of the app (decisions.md
 * 105), sync, sign-in, who may do what, what an event is and how it folds
 * (PLAN.md section 6: a shipped event's shape never changes), privacy, and
 * what the app sends as diagnostics (the store declarations).
 */
export const MERGE_REFUSED = [
  // Server calls, sync, sign-in and accounts, who may do what, what is kept on the phone, privacy, diagnostics.
  /^apps\/mobile\/src\/(server|sync|nearby|auth|session|account|invites|roles|storage|appLock|disguise|diagnostics)\//,
  // What an event is and how it folds, and what phones sign and send each other.
  /^packages\/core\/src\/(events|record|reducer|validate|passageParts|snapshot|hlc|nearby\w*)\.ts$/,
  /^apps\/admin\/src\/(auth|jwt|env|worker|db)\.ts$/
];

/** Why a file may not change in a fix that merges without a person, or null. */
export function pathRefusal(file) {
  if (isTest(file)) return /^(apps|packages)\/[a-z0-9-]+\/test\//.test(file) ? null : `${file} is a test outside apps/*/test and packages/*/test`;
  if (!MERGE_PATHS.some((r) => r.test(file))) return `${file} is outside the app's screens and logic, the ops dashboard and the core`;
  if (MERGE_REFUSED.some((r) => r.test(file))) return `${file} holds server calls, sync, sign-in, permissions, event shapes, privacy or diagnostics`;
  return null;
}

/** `git apply --numstat -z` output as changes: a binary file counts 999 lines. */
export function changesOf(numstatZ) {
  const out = [];
  const parts = String(numstatZ).split('\0');
  for (let i = 0; i < parts.length; i += 1) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(parts[i]);
    if (!m) continue;
    const lines = m[1] === '-' || m[2] === '-' ? 999 : Number(m[1]) + Number(m[2]);
    if (m[3]) out.push({ file: m[3], lines });
    else {
      // A rename: both names count, so a file moved out of a place it may not leave is seen.
      out.push({ file: parts[i + 1], lines }, { file: parts[i + 2], lines: 0 });
      i += 2;
    }
  }
  return out.filter((c) => c.file);
}

/** Words in an instruction that can mean "merge it as it is". The manager decides; this only stops a guess. */
const MERGE_WORDS = /\b(merge|merged|merging|approve|approved|lgtm|ship it|go ahead|looks good)\b/i;
export const saysMerge = (texts) => (Array.isArray(texts) ? texts : []).some((t) => MERGE_WORDS.test(String(t ?? '')));
/**
 * Words in an instruction that ask to see the change before it merges ("ask me first", "wait for my yes",
 * "don't merge"). With `go`, they hold the fix for the admin. A miss is safe only one way, so the list is wide:
 * the manager can also say so in fix.json (`askFirst`).
 */
const ASK_FIRST_WORDS = /\b(ask me|check with me|wait for (me|my)|(my|your) (ok|okay|yes|input|approval|go)\b|show me|let me (see|look|check|read|review)|before (it |you |this )?(merge|merging|merges|goes in|ships)|(don'?t|do not|never) (auto-?)?merge|not (auto-?)?merge|hold (it|the (fix|change|merge)))/i;
export const saysAskFirst = (texts) => (Array.isArray(texts) ? texts : []).some((t) => ASK_FIRST_WORDS.test(String(t ?? '')));

/** Why a fix waits on an issue a developer claimed (docs/decisions/2026-11-24-claim-issues-and-see-claudes-replies.md). */
export const CLAIMED_WHY = 'A developer claimed this issue on the ops dashboard. Claude\'s change is a suggestion: the developer reads it and merges it.';

/**
 * What happens to a change: it merges without a person, or it waits for a
 * developer, with the reason (a fixed word, for the ops dashboard) and why
 * (one line). Code decides, never an agent's word alone.
 *
 *   mode         MODES
 *   verdict      verdictOf(fix.json)
 *   changes      changesOf(the patch), or [] when there is none
 *   checks       { typecheck, tests } as the job with no key said them (advisory: guardrails on the
 *                pull request and in the merge queue are what GitHub holds a merge to)
 *   vet          checkVet(the reviewer's verdict), or null when the reviewer did not run
 *   instructed   an admin's instruction came with this run
 *   go           the issue's fix was asked for with Fix it on a tutorial video's card (ops.user_issue_notes
 *                `go`), in this run or before it (a repair): the admin's word is the yes, so neither the
 *                instruction nor mode `ask` holds the fix, and every other part of the rule still does
 *   askFirst     the admin asked to see the change before it merges (Fix it's box, the instruction's words, or
 *                the manager's reading of them): the fix waits for the admin
 *   approved     that instruction says to merge the draft fix, the manager's verdict is `approved`, and the
 *                manager left the draft fix as it was
 *   claimed      a developer claimed the issue on the ops dashboard: the team assists, and the fix waits for
 *                that developer (docs/decisions/2026-11-24-claim-issues-and-see-claudes-replies.md)
 *   app          the job holds LangQuest's GitHub App's token (it opens the pull request so its checks start)
 *   pictures     { before, after }: the picture job made a picture of the screen without the change and with it
 */
export function gate({ mode = 'ask', verdict, changes = [], checks = {}, vet = null, instructed = false, go = false, askFirst = false, approved = false, claimed = false, app = true, pictures = {} }) {
  const wait = (reason, why) => ({ merge: false, reason, why: cut(said(why), 600) });
  if (!verdict) return wait('unconfirmed', 'The manager gave no verdict.');
  if (!changes.length) {
    if (verdict.verdict === 'not_a_bug') return wait('not_a_bug', verdict.why || 'The manager found that the app works as it is meant to.');
    if (verdict.verdict === 'decision') return wait('decision', verdict.why || 'The fix needs a choice from a developer.');
    return wait('unconfirmed', verdict.why || 'The cause is not proven yet. Claude carries out its plan to prove it.');
  }
  if (checks.typecheck === 'failed' || checks.tests === 'failed') return wait('checks', `${checks.typecheck === 'failed' ? 'Typecheck' : 'A test'} fails with the change.`);
  if (!app) return wait('app', 'The job has no token of LangQuest\'s GitHub App, which opens a pull request that merges.');
  // A developer's own word: the draft fix they read merges as it is. The paths a draft fix may never
  // change were refused before this, and guardrails still hold the merge.
  if (approved) return { merge: true, reason: null, why: 'A developer said to merge it on the ops dashboard.' };
  // A developer works on it: Claude's change is a suggestion for them, never a merge of its own.
  if (claimed) return wait('claimed', CLAIMED_WHY);
  const asked = askFirst || verdict.askFirst === true;
  if (go && asked) return wait('instruction', 'The admin asked on the tutorial video\'s card to see the change before it merges. Say "merge it" on the card to merge it.');
  if (instructed && !go) return wait('instruction', 'It follows an instruction from the ops dashboard. The developer who sent it reads the change.');
  if (verdict.verdict === 'decision') return wait('decision', verdict.why || 'The fix needs a choice from a developer.');
  if (verdict.verdict !== 'fix') return wait('review', verdict.why || 'The manager asks a developer to read the change.');
  if (!causeProven(verdict)) return wait('cause', 'The manager did not say the cause and the test that proves it.');
  const refused = changes.map((c) => pathRefusal(c.file)).find(Boolean);
  if (refused) return wait('paths', `${refused}.`);
  if (verdict.display) {
    // A display fix is proven by the two pictures, which the reviewer looks at. It needs no test, and none may fail.
    if (!pictures.before || !pictures.after) return wait('cause', 'There is no picture of the screen before the fix and after it.');
    if (checks.typecheck !== 'passed' || !['passed', 'none'].includes(checks.tests)) return wait('checks', 'Typecheck did not run and pass, or the tests near the change did not run.');
  } else {
    if (!changes.some((c) => isTest(c.file) && c.lines > 0)) return wait('cause', 'The change has no test that proves the cause.');
    if (checks.typecheck !== 'passed' || checks.tests !== 'passed') return wait('checks', 'Typecheck and the tests near the change did not both run and pass.');
  }
  if (!vet) return wait('reviewer', 'The reviewer did not run.');
  if (!vet.ok) return wait('reviewer', `The reviewer asks a developer to look: ${vet.why}`);
  if (go) return { merge: true, reason: null, why: `An admin said Fix it on a tutorial video's card, and the fix keeps every part of the rule. ${vet.why}` };
  if (mode !== 'on') return wait('mode', 'The agent team is in mode ask: every fix waits for a developer. This fix passed every other part of the rule.');
  return { merge: true, reason: null, why: vet.why };
}

/** The reasons a fix waits, as the gate says them (server/userIssues.ts FIX_REASONS holds the same list). */
export const REASONS = ['mode', 'review', 'decision', 'not_a_bug', 'unconfirmed', 'cause', 'paths', 'checks', 'reviewer', 'instruction', 'app', 'stalled', 'claimed'];

/** Whether the reviewer must read the change: only when everything before it in the gate passes. */
export function reviewNeeded(input) {
  const before = gate({ ...input, mode: 'on', vet: { ok: true, why: '-' }, app: true });
  return before.merge && !input.approved;
}

// ---- pull requests ---------------------------------------------------------------------------------

/** The hidden line that marks a pull request of the team that merges without a person. */
export const MERGE_MARK = '<!-- agent-team: merges without a person -->';

/** The first lines of the pull request's body: what happens to it, and why. */
export function decisionLines(decision) {
  return decision.merge
    ? [MERGE_MARK, `**This pull request merges without a person when its checks pass** (docs/agent-team.md). ${decision.why}`, '', 'To stop it, make it a draft or close it.']
    : [`**It waits for a developer.** ${decision.why}`];
}

/** Claude tries this many times to get a pull request of the team into main; then it waits for a developer. */
export const TRIES = 3;
/** At most this many pull requests a run go back to the fix team for a change. */
export const REPAIR_MAX = 2;
/**
 * What Claude does in a try. `rerun`: run the failed jobs again (a flaky test). `update`: merge main
 * into the branch and turn auto-merge on again (it left the merge queue, or it waits too long). `fix`:
 * the issue's manager reads the failure and changes the code (a conflict with main, or checks that
 * fail again after a rerun).
 */
export const ACTS = ['rerun', 'update', 'fix'];
const TRY_MARK = /<!-- agent-team: try (\d+) (rerun|update|fix) (\S+) -->/;

/** The tries a pull request's body records: how many, the last act, and when. */
export function triesOf(body) {
  const m = TRY_MARK.exec(String(body ?? ''));
  if (!m) return { count: 0, last: null, at: null };
  const at = Date.parse(m[3]);
  return { count: Math.min(Number(m[1]), 99), last: m[2], at: Number.isFinite(at) ? new Date(at).toISOString() : null };
}

/** The body with the record of a try: it takes the place of the one before. */
export function withTry(body, { count, last, at }) {
  const mark = `<!-- agent-team: try ${count} ${last} ${at} -->`;
  const text = String(body ?? '');
  return TRY_MARK.test(text) ? text.replace(TRY_MARK, mark) : `${text}\n\n${mark}`;
}

/**
 * What to do with an open pull request that merges without a person (docs/agent-team.md "When a fix
 * does not get into main"): nothing yet (null), a try (`act` from ACTS, with `count`), or `waits`: it
 * becomes a draft that waits for a developer. Each act is one try; after TRIES it waits.
 *
 *   runs        its `gate` check runs (the newest counts)
 *   mergeable   GitHub's mergeable_state: `dirty` is a conflict with main
 *   autoMerge   auto-merge is on (GitHub turns it off when the merge queue removes the pull request)
 *   tries       triesOf(its body)
 *   createdAt   when it was opened
 *   team        the fix team can write a change now (mode not off, and its Claude token is there)
 */
export function nextStep({ runs = [], mergeable = null, autoMerge = true, tries = { count: 0, last: null, at: null }, createdAt = null, team = true }, now = Date.now()) {
  const newest = [...(runs ?? [])].sort((a, b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')))[0];
  const failed = newest?.status === 'completed' && !['success', 'neutral', 'skipped'].includes(newest.conclusion);
  const running = newest && newest.status !== 'completed';
  let trouble = null;
  let act = null;
  if (mergeable === 'dirty') [trouble, act] = ['It has a conflict with main.', 'fix'];
  else if (failed) [trouble, act] = [`Its checks failed (gate: ${newest.conclusion}).`, tries.last === 'rerun' ? 'fix' : 'rerun'];
  else if (running) return null;
  else if (!autoMerge) [trouble, act] = ['It left the merge queue and did not merge.', 'update'];
  else {
    const since = Date.parse(tries.at ?? createdAt ?? '');
    if (Number.isFinite(since) && now - since > OPEN_HOURS * 3600_000) [trouble, act] = [`It did not merge within ${OPEN_HOURS} hours.`, 'update'];
  }
  if (!trouble) return null;
  if (tries.count >= TRIES) return { act: 'waits', why: `Claude tried ${TRIES} times to get it into main. ${trouble}` };
  if (act === 'fix' && !team) return { act: 'waits', why: `${trouble} The agent team cannot change the code now (mode off, or no AGENT_TEAM_CLAUDE_TOKEN).` };
  return { act, why: trouble, count: tries.count + 1 };
}

/** The last lines of a failed job's log, for the issue's manager: no time stamps, no colour codes. */
export const LOG_LINES = 120;
export function logTail(text, lines = LOG_LINES) {
  const clean = String(text ?? '')
    .split('\n')
    .map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z ?/, '').trimEnd())
    .filter((l) => l && !l.startsWith('##[group]') && !l.startsWith('##[endgroup]'));
  const tail = clean.slice(-lines).join('\n');
  return tail.length > 12_000 ? `…${tail.slice(-11_999)}` : tail;
}

// ---- the steps -------------------------------------------------------------------------------------

const readJson = (path) => {
  try {
    return existsSync(path) && readFileSync(path).length < 200_000 ? JSON.parse(readFileSync(path, 'utf8')) : null;
  } catch {
    return null;
  }
};
const output = (values) => {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`).join('\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines}\n`);
  else console.log(lines);
};
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/**
 * The pictures of a display fix: the screen without the change and with it, as the picture job made
 * them (JPEG, so both fit in what the Worker takes). The job runs the change's code, so a file is
 * read only when it is a JPEG of a sane size.
 */
export const PICTURES = { before: 'before.jpg', after: 'after.jpg', maxBytes: 150_000 };
export const isJpeg = (bytes) => bytes.length > 100 && bytes.length <= PICTURES.maxBytes && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
/** The picture at a path, or null when there is none or it is not one. */
export function pictureOf(path) {
  try {
    const bytes = existsSync(path) ? readFileSync(path) : null;
    return bytes && isJpeg(bytes) ? bytes : null;
  } catch {
    return null;
  }
}

/** The mode on this checkout of main. */
export const modeHere = (root = '.') => modeOf(existsSync(join(root, MODE_FILE)) ? readFileSync(join(root, MODE_FILE), 'utf8') : '');

/**
 * What the gate reads about a change, from the artifacts in <dir>: fix.json and
 * the manager's own patch (fix/), the checks' words (check/), the reviewer's
 * verdict (vet/). The patch is the one the fix job took, never the copy that
 * came back from the job where its code ran.
 */
export function gateInput(dir) {
  const fix = readJson(join(dir, 'fix', 'fix.json'));
  const patchPath = join(dir, 'fix', 'fix.patch');
  const changes = fix && !fix.noFix && existsSync(patchPath) ? changesOf(git('apply', '--numstat', '-z', patchPath)) : [];
  const check = readJson(join(dir, 'check', 'check.json')) ?? {};
  const one = (v) => (['passed', 'failed', 'none'].includes(v) ? v : 'not run');
  const notes = readJson(join(dir, 'fix', 'notes.json'));
  const vetRaw = readJson(join(dir, 'vet', 'verdict.json'));
  const pictures = { before: Boolean(pictureOf(join(dir, 'picture', PICTURES.before))), after: Boolean(pictureOf(join(dir, 'picture', PICTURES.after))) };
  return {
    pictures,
    verdict: fix ? verdictOf(fix) : null, changes, checks: { typecheck: one(check.typecheck), tests: one(check.tests) },
    vet: vetRaw ? checkVet(vetRaw) : null, instructed: Array.isArray(notes?.ids) && notes.ids.length > 0, approved: notes?.approved === true,
    go: notes?.go === true, askFirst: notes?.askFirst === true, claimed: notes?.claimed === true
  };
}

/** The two pictures of a display fix, copied for the reviewer: only files that are pictures, under their fixed names. */
function picturesStep(from, to) {
  mkdirSync(to, { recursive: true });
  for (const name of [PICTURES.before, PICTURES.after]) {
    const bytes = pictureOf(join(from, name));
    if (bytes) writeFileSync(join(to, name), bytes);
  }
}

function reviewNeededStep(dir) {
  const yes = reviewNeeded(gateInput(dir));
  console.log(yes ? 'the reviewer reads the change' : 'no review: the change waits for a developer without it, or there is none');
  output({ yes });
}

/** After the reviewer: its verdict, checked, in VET_OUT. Runs nothing of the patch. */
function vetOut(dir) {
  const out = process.env.VET_OUT || join(dir, 'out');
  mkdirSync(out, { recursive: true });
  const vet = checkVet(readJson(join(dir, 'verdict.json')) ?? {});
  writeFileSync(join(out, 'verdict.json'), JSON.stringify(vet, null, 2));
  console.log(vet.ok ? 'the reviewer agrees' : 'the reviewer asks a developer to look');
}

export async function github(method, path, body, token = process.env.GITHUB_TOKEN) {
  if (!token) throw new Error('No GITHUB_TOKEN: this job needs it.');
  const res = await fetch(`${process.env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${REPO}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

export async function graphql(query, variables, token = process.env.GITHUB_TOKEN) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables })
  });
  return (await res.json().catch(() => ({}))).data ?? null;
}

/** A pull request made a draft, so nothing merges it and Ready for review runs its checks again. False when GitHub refused. */
export async function toDraft(nodeId, token = process.env.GITHUB_TOKEN) {
  try {
    const data = await graphql('mutation($id: ID!) { convertPullRequestToDraft(input: { pullRequestId: $id }) { pullRequest { isDraft } } }', { id: nodeId }, token);
    return data?.convertPullRequestToDraft?.pullRequest?.isDraft === true;
  } catch {
    return false;
  }
}

/** A text answer from GitHub (a job's log), or '' when GitHub refused. */
async function githubText(path, token = process.env.GITHUB_TOKEN) {
  try {
    const res = await fetch(`${process.env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${REPO}${path}`, { headers: { authorization: `Bearer ${token}`, 'x-github-api-version': '2022-11-28' } });
    return res.ok ? await res.text() : '';
  } catch {
    return '';
  }
}

/** The workflow run of a check run (its check suite), or null. */
async function runOf(checkRun) {
  const suite = checkRun?.check_suite?.id;
  if (!suite) return null;
  const got = await github('GET', `/actions/runs?check_suite_id=${suite}&per_page=1`);
  return got.status === 200 ? got.json.workflow_runs?.[0] ?? null : null;
}

/** The failed jobs of a workflow run, with the last lines of each log, for the issue's manager. At most 3. */
async function failuresOf(run) {
  if (!run) return [];
  const got = await github('GET', `/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
  const failed = (got.status === 200 ? got.json.jobs : []).filter((j) => j.conclusion === 'failure' && j.name !== 'gate').slice(0, 3);
  const out = [];
  for (const j of failed) {
    const steps = (j.steps ?? []).filter((st) => st.conclusion === 'failure').map((st) => st.name);
    out.push({ job: cut(said(j.name), 200), steps: steps.slice(0, 5).map((st) => cut(said(st), 200)), log: logTail(await githubText(`/actions/jobs/${j.id}/logs`)) });
  }
  return out;
}

/** Auto-merge through the merge queue, as LangQuest's GitHub App. False when GitHub refused. */
function autoMergeAs(pr, token) {
  if (!token) return false;
  try {
    execFileSync('gh', ['pr', 'merge', String(pr), '--auto', '-R', REPO], { env: { ...process.env, GH_TOKEN: token }, stdio: 'inherit' });
    return true;
  } catch {
    return false;
  }
}

/** The body of a pull request that now waits for a developer: the merge line and its mark out, the reason in. */
export function waitingBody(body, why) {
  return String(body ?? '').replace(MERGE_MARK, '').replace(/\*\*This pull request merges without a person[^\n]*\n\nTo stop it[^\n]*/, `**It waits for a developer.** ${why}`);
}

/** A pull request of the team made a draft that waits for a developer, with labels and body. False when GitHub refused. */
export async function toWaiting(p, why, token = process.env.GITHUB_TOKEN) {
  if (!(await toDraft(p.node_id, token))) return false;
  await github('PATCH', `/pulls/${p.number}`, { body: waitingBody(p.body, why) }, token);
  await github('POST', `/issues/${p.number}/labels`, { labels: [LABELS.waits] }, token).catch(() => null);
  await github('DELETE', `/issues/${p.number}/labels/${LABELS.merge}`, undefined, token).catch(() => null);
  return true;
}

/**
 * The team's open pull requests that merge without a person (docs/agent-team.md "When a fix does not
 * get into main"). For each in trouble, Claude takes a try (nextStep): it runs the failed jobs again,
 * merges main into the branch and turns auto-merge on again (as LangQuest's GitHub App, PR_TOKEN, so
 * the checks start), or hands the pull request to the fix team with the failed jobs' logs (written to
 * REPAIR_DIR, their issues in the output `repairs`). After TRIES it becomes a draft that waits for a
 * developer, and the Worker is told why. Runs nothing of any change.
 */
async function follow() {
  const { call, ISSUE_OF_BRANCH } = await import('./user-issues.mjs');
  const got = await github('GET', '/pulls?state=open&per_page=100');
  if (got.status !== 200) throw new Error(`GitHub answered ${got.status} to the list of open pull requests`);
  const team = modeHere() !== 'off' && process.env.HAS_TEAM_TOKEN === 'true';
  const app = process.env.PR_TOKEN;
  const repairDir = process.env.REPAIR_DIR || '.user-issues/repairs';
  const fixes = [];
  const repairs = [];
  for (const listed of got.json) {
    const issue = ISSUE_OF_BRANCH(listed.head?.ref);
    if (!issue || listed.draft || !String(listed.body ?? '').includes(MERGE_MARK)) continue;
    const full = await github('GET', `/pulls/${listed.number}`);
    const p = full.status === 200 ? full.json : listed;
    // A developer claimed the issue after the fix was opened: it stops merging by itself and waits for them.
    // An answer that does not come leaves the pull request as it is until the next run.
    const notes = await call('GET', undefined, `?notes=${issue}`).catch(() => null);
    if (notes?.claimed === true) {
      const why = CLAIMED_WHY;
      if (!(await toWaiting(p, why))) {
        console.log(`::warning::PR ${p.number}: GitHub did not make it a draft`);
        continue;
      }
      fixes.push({ issue, decision: 'waits', reason: 'claimed', why, pr: p.number, verdict: null, model: null, effort: null });
      console.log(`PR ${p.number} (${issue}) waits for the developer who claimed the issue`);
      continue;
    }
    const runs = await github('GET', `/commits/${p.head.sha}/check-runs?check_name=gate&per_page=20`);
    const gateRuns = runs.status === 200 ? runs.json.check_runs : [];
    const tries = triesOf(p.body);
    const step = nextStep({ runs: gateRuns, mergeable: p.mergeable_state ?? null, autoMerge: Boolean(p.auto_merge), tries, createdAt: p.created_at, team });
    if (!step) continue;
    if (step.act === 'fix' && repairs.length >= REPAIR_MAX) {
      console.log(`PR ${p.number} (${issue}): the fix team has no room this run; next run`);
      continue;
    }
    if (step.act === 'waits') {
      if (!(await toWaiting(p, step.why))) {
        console.log(`::warning::PR ${p.number}: GitHub did not make it a draft`);
        continue;
      }
      fixes.push({ issue, decision: 'waits', reason: 'stalled', why: step.why, pr: p.number, verdict: null, model: null, effort: null });
      console.log(`PR ${p.number} (${issue}) waits for a developer: ${step.why}`);
      continue;
    }
    const newest = [...gateRuns].sort((x, y) => String(y.started_at ?? '').localeCompare(String(x.started_at ?? '')))[0];
    if (step.act === 'rerun') {
      const run = await runOf(newest);
      const again = run ? await github('POST', `/actions/runs/${run.id}/rerun-failed-jobs`) : { status: 0 };
      if (again.status !== 201) console.log(`::warning::PR ${p.number}: GitHub did not run the failed jobs again (${again.status})`);
    } else if (step.act === 'update') {
      // Main merged into the branch by the App, so the checks start; GitHub says 422 when there is nothing new on main.
      const upd = app ? await github('PUT', `/pulls/${p.number}/update-branch`, { expected_head_sha: p.head.sha }, app) : { status: 0 };
      if (![202, 422].includes(upd.status)) console.log(`::warning::PR ${p.number}: GitHub did not merge main into the branch (${upd.status})`);
      if (!autoMergeAs(p.number, app)) console.log(`::warning::PR ${p.number}: auto-merge is not on again`);
    } else {
      const failures = p.mergeable_state === 'dirty' ? [] : await failuresOf(await runOf(newest));
      mkdirSync(repairDir, { recursive: true });
      writeFileSync(join(repairDir, `${issue}.json`), JSON.stringify({ issue, pr: p.number, why: step.why, failures }, null, 2));
      repairs.push(issue);
    }
    await github('PATCH', `/pulls/${p.number}`, { body: withTry(p.body, { count: step.count, last: step.act, at: new Date().toISOString() }) });
    console.log(`PR ${p.number} (${issue}): try ${step.count} of ${TRIES}, ${step.act}: ${step.why}`);
  }
  output({ repairs: JSON.stringify(repairs) });
  if (fixes.length) await call('POST', { sha: git('rev-parse', 'HEAD').trim(), runUrl: runUrl(process.env), looked: [], grew: [], states: [], notes: [], fixes });
  else console.log('no pull request of the team waits for a developer now');
}

// ---- how the manager's run ended -------------------------------------------------------------------

/**
 * How a Claude run ended, from the action's execution file (an array of messages): its end, its turns, the
 * names of the tools it was refused, and how many workers it started in the background and in the
 * foreground. Only names and numbers: never what Claude or people wrote, since the log is public.
 */
export function runEnd(messages, fixWritten) {
  const all = Array.isArray(messages) ? messages : [];
  const r = all.filter((m) => m && m.type === 'result').pop() || {};
  const names = [...new Set((r.permission_denials || []).map((d) => String(d.tool_name || '').replace(/[^A-Za-z_]/g, '').slice(0, 40)))];
  const ok = (v) => (typeof v === 'string' && /^[a-z_]{1,40}$/.test(v) ? v : 'unknown');
  let background = 0, foreground = 0;
  for (const m of all) {
    const content = m && m.type === 'assistant' && m.message && Array.isArray(m.message.content) ? m.message.content : [];
    for (const c of content) {
      if (!c || c.type !== 'tool_use' || !['Agent', 'Task'].includes(c.name)) continue;
      // A worker runs in the background unless the call says otherwise (Claude Code's default).
      if (c.input && c.input.run_in_background === false) foreground++;
      else background++;
    }
  }
  const fix = fixWritten ? 'written' : 'missing';
  return {
    fix,
    line: `end: ${ok(r.subtype)}; turns: ${Number(r.num_turns) || 0}; refused: ${(r.permission_denials || []).length} (${names.join(', ') || 'none'}); workers: ${foreground} waited for, ${background} in the background; fix.json: ${fix}`
  };
}

function runEndStep(out, fixPath) {
  let messages = [];
  try { messages = JSON.parse(readFileSync(out, 'utf8')); } catch { /* no execution file: the run did not start */ }
  const e = runEnd(messages, existsSync(fixPath));
  console.error(e.line);
  console.log(`fix=${e.fix}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, dir, to] = process.argv.slice(2);
  const commands = { 'review-needed': reviewNeededStep, 'vet-out': vetOut, pictures: () => picturesStep(dir, to ?? '.'), 'run-end': () => runEndStep(dir, to ?? '.user-issues/fix.json'), follow };
  if (!Object.hasOwn(commands, command) || (command !== 'follow' && !dir)) {
    console.error(`usage: node scripts/agent-team.mjs <${Object.keys(commands).join('|')}> [dir]`);
    process.exit(2);
  }
  // No top-level await: `follow` imports user-issues.mjs, which imports this
  // file. A module still in its top-level await never finishes loading, so
  // that import would wait for itself, and Node exits with code 13.
  Promise.resolve()
    .then(() => commands[command](dir))
    .catch((e) => {
      console.error(`::error::${e instanceof Error ? e.message : e}`);
      process.exit(1);
    });
}
