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
//   node scripts/agent-team.mjs follow   the team's open pull requests that merge without a person: one whose
//                                        checks failed, or that did not merge in a day, becomes a draft that
//                                        waits for a developer, and the Worker is told
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
 *   unconfirmed  the cause is not proven: no change
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
    twins: cut(said(o.twins), VERDICT_LIMITS.twins)
  };
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
 *   approved     that instruction says to merge the draft fix, the manager's verdict is `approved`, and the
 *                manager left the draft fix as it was
 *   app          the job holds LangQuest's GitHub App's token (it opens the pull request so its checks start)
 */
export function gate({ mode = 'ask', verdict, changes = [], checks = {}, vet = null, instructed = false, approved = false, app = true }) {
  const wait = (reason, why) => ({ merge: false, reason, why: cut(said(why), 600) });
  if (!verdict) return wait('unconfirmed', 'The manager gave no verdict.');
  if (!changes.length) {
    if (verdict.verdict === 'not_a_bug') return wait('not_a_bug', verdict.why || 'The manager found that the app works as it is meant to.');
    if (verdict.verdict === 'decision') return wait('decision', verdict.why || 'The fix needs a choice from a developer.');
    return wait('unconfirmed', verdict.why || 'The manager did not prove the cause, so it changed nothing.');
  }
  if (checks.typecheck === 'failed' || checks.tests === 'failed') return wait('checks', `${checks.typecheck === 'failed' ? 'Typecheck' : 'A test'} fails with the change.`);
  if (!app) return wait('app', 'The job has no token of LangQuest\'s GitHub App, which opens a pull request that merges.');
  // A developer's own word: the draft fix they read merges as it is. The paths a draft fix may never
  // change were refused before this, and guardrails still hold the merge.
  if (approved) return { merge: true, reason: null, why: 'A developer said to merge it on the ops dashboard.' };
  if (instructed) return wait('instruction', 'It follows an instruction from the ops dashboard. The developer who sent it reads the change.');
  if (verdict.verdict === 'decision') return wait('decision', verdict.why || 'The fix needs a choice from a developer.');
  if (verdict.verdict !== 'fix') return wait('review', verdict.why || 'The manager asks a developer to read the change.');
  if (!causeProven(verdict)) return wait('cause', 'The manager did not say the cause and the test that proves it.');
  const refused = changes.map((c) => pathRefusal(c.file)).find(Boolean);
  if (refused) return wait('paths', `${refused}.`);
  if (!changes.some((c) => isTest(c.file) && c.lines > 0)) return wait('cause', 'The change has no test that proves the cause.');
  if (checks.typecheck !== 'passed' || checks.tests !== 'passed') return wait('checks', 'Typecheck and the tests near the change did not both run and pass.');
  if (!vet) return wait('reviewer', 'The reviewer did not run.');
  if (!vet.ok) return wait('reviewer', `The reviewer asks a developer to look: ${vet.why}`);
  if (mode !== 'on') return wait('mode', 'The agent team is in mode ask: every fix waits for a developer. This fix passed every other part of the rule.');
  return { merge: true, reason: null, why: vet.why };
}

/** The reasons a fix waits, as the gate says them (server/userIssues.ts FIX_REASONS holds the same list). */
export const REASONS = ['mode', 'review', 'decision', 'not_a_bug', 'unconfirmed', 'cause', 'paths', 'checks', 'reviewer', 'instruction', 'app', 'stalled'];

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

/**
 * What to do with an open pull request that merges without a person: nothing
 * yet (null), or why it now waits for a developer. Its newest `gate` check
 * finished and did not pass, or it is older than OPEN_HOURS (a conflict with
 * main, most often).
 */
export function stalled(gateRuns, createdAt, now = Date.now()) {
  const newest = [...(gateRuns ?? [])].sort((a, b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')))[0];
  if (newest?.status === 'completed' && !['success', 'neutral', 'skipped'].includes(newest.conclusion)) return `Its checks failed (gate: ${newest.conclusion}).`;
  const opened = Date.parse(createdAt ?? '');
  if (Number.isFinite(opened) && now - opened > OPEN_HOURS * 3600_000) return `It did not merge within ${OPEN_HOURS} hours.`;
  return null;
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
  return {
    verdict: fix ? verdictOf(fix) : null, changes, checks: { typecheck: one(check.typecheck), tests: one(check.tests) },
    vet: vetRaw ? checkVet(vetRaw) : null, instructed: Array.isArray(notes?.ids) && notes.ids.length > 0, approved: notes?.approved === true
  };
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

/**
 * The team's open pull requests that merge without a person. One whose checks
 * failed, or that waited a day, becomes a draft and waits for a developer; the
 * Worker is told, so its card on the ops dashboard says why. Runs nothing of
 * any change.
 */
async function follow() {
  const { call, ISSUE_OF_BRANCH } = await import('./user-issues.mjs');
  const got = await github('GET', '/pulls?state=open&per_page=100');
  if (got.status !== 200) throw new Error(`GitHub answered ${got.status} to the list of open pull requests`);
  const fixes = [];
  for (const p of got.json) {
    const issue = ISSUE_OF_BRANCH(p.head?.ref);
    if (!issue || p.draft || !String(p.body ?? '').includes(MERGE_MARK)) continue;
    const runs = await github('GET', `/commits/${p.head.sha}/check-runs?check_name=gate&per_page=20`);
    const why = stalled(runs.status === 200 ? runs.json.check_runs : [], p.created_at);
    if (!why) continue;
    if (!(await toDraft(p.node_id))) {
      console.log(`::warning::PR ${p.number}: GitHub did not make it a draft`);
      continue;
    }
    await github('PATCH', `/pulls/${p.number}`, { body: String(p.body).replace(MERGE_MARK, '').replace(/\*\*This pull request merges without a person[^\n]*\n\nTo stop it[^\n]*/, `**It waits for a developer.** ${why}`) });
    await github('POST', `/issues/${p.number}/labels`, { labels: [LABELS.waits] }).catch(() => null);
    await github('DELETE', `/issues/${p.number}/labels/${LABELS.merge}`).catch(() => null);
    fixes.push({ issue, decision: 'waits', reason: 'stalled', why, pr: p.number, verdict: null, model: null, effort: null });
    console.log(`PR ${p.number} (${issue}) waits for a developer: ${why}`);
  }
  if (fixes.length) await call('POST', { sha: git('rev-parse', 'HEAD').trim(), runUrl: runUrl(process.env), looked: [], grew: [], states: [], notes: [], fixes });
  else console.log('no pull request of the team stalled');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, dir] = process.argv.slice(2);
  const commands = { 'review-needed': reviewNeededStep, 'vet-out': vetOut, follow };
  if (!Object.hasOwn(commands, command) || (command !== 'follow' && !dir)) {
    console.error(`usage: node scripts/agent-team.mjs <${Object.keys(commands).join('|')}> [dir]`);
    process.exit(2);
  }
  try {
    await commands[command](dir);
  } catch (e) {
    console.error(`::error::${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
