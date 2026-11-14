#!/usr/bin/env node
// Claude's nightly look at the tutorial videos' feedback, around Claude
// (.github/workflows/tutorial-review.yml, docs/tutorial-videos.md "Feedback",
// decisions.md 186). Plain Node, no packages, so the workflow needs no
// `npm ci`.
//
//   node scripts/tutorial-review.mjs fetch <dir>   what is open (state.json) and what main changed since the last look (changes.json)
//   node scripts/tutorial-review.mjs check <dir>   review.json against what the Worker takes and what state.json holds:
//                                                  each problem a line in <dir>/problems.txt, for Claude to mend once
//   node scripts/tutorial-review.mjs send <dir>    review.json, as Claude wrote it, to the app's Worker
//
// An accepted change to a video, written by Claude as a draft pull request
// (decisions.md 186, amended 2026-11-13), in the workflow's fix jobs:
//
//   node scripts/tutorial-review.mjs queue <dir>                 says which draft pull requests were merged or closed, and
//                                                                starts at most three accepted changes: <dir>/<id>.json each
//   node scripts/tutorial-review.mjs fix-patch <dir>             after Claude: its change as a patch, and its fix.json, checked
//   node scripts/tutorial-review.mjs fix-paths <patch> <video>   refuses a patch that changes more than the video's own file and lines
//   node scripts/tutorial-review.mjs fix-open <dir> <id>         pushes the patch to tutorial-fix/<id>, opens it as a draft pull
//                                                                request, and tells the Worker; or tells it why there is none
//
// fetch, send, queue and fix-open sign in with the OpenID Connect token
// GitHub gives the job (`id-token: write`); the Worker lets in this workflow
// on main and nothing else (apps/web/worker/tutorialReview.ts). Run anywhere
// else, they stop. check, fix-patch and fix-paths need no token and send
// nothing.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API = process.env.TUTORIAL_REVIEW_API ?? 'https://next.langquest.org/api/tutorial-review';
/** What the Worker expects the token to be for (apps/web/worker/tutorialReview.ts REVIEW_RULE). */
export const AUDIENCE = 'https://next.langquest.org/api/tutorial-review';
/** What a change must touch to change what a video shows or says. */
export const APP_PATHS = ['apps/mobile/src', 'apps/mobile/assets', 'packages/core/src', 'e2e/tutorials'];
/** Without a last look (the first night, or a last look on a commit main no longer has), this many days of changes. */
export const FIRST_DAYS = 7;
/** Most changes handed to Claude in a night, newest kept. */
export const CHANGES_MAX = 150;
/** Most files listed for one change. */
const FILES_MAX = 100;

/** A merged change's pull request, from GitHub's squash or merge subject: "Title (#272)" or "Merge pull request #272 from …". */
export function prOf(subject) {
  const m = /\(#(\d{1,7})\)\s*$/.exec(subject) ?? /^Merge pull request #(\d{1,7}) /.exec(subject);
  return m ? Number(m[1]) : null;
}

/** `git log` lines (sha, ISO time, subject, tab-separated), newest first, into changes; files come from `filesOf`. */
export function changesOf(log, filesOf) {
  return log.split('\n').filter(Boolean).slice(0, CHANGES_MAX).map((line) => {
    const [sha, at, ...rest] = line.split('\t');
    const subject = rest.join('\t');
    return { sha, at, subject, pr: prOf(subject), files: filesOf(sha).slice(0, FILES_MAX) };
  });
}

/** The run this is, as the Worker checks it against the token. */
export function runUrl(env) {
  const base = `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  return env.GITHUB_RUN_ATTEMPT && env.GITHUB_RUN_ATTEMPT !== '1' ? `${base}/attempts/${env.GITHUB_RUN_ATTEMPT}` : base;
}

/** What Claude wrote, with the commit it looked up to and this run added. */
export function withRun(review, sha, env) {
  return { ...review, sha, runUrl: runUrl(env) };
}

// ---- the look, checked before it is sent ------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const shown = (v) => (v === undefined ? 'missing' : JSON.stringify(v).slice(0, 80));
const entries = (review, field) => (Array.isArray(review?.[field]) ? review[field] : []);

/**
 * What would make the Worker refuse the look, or lose part of it, each as a line Claude can act on:
 * what `parseReview` (server/tutorialFeedback.ts) says first, then every id that names no open input
 * and no `code` key (a change from changes.json named as if it were an input, most often), and every
 * new input left in no place. Empty when the look is fine. It never stops the look being sent: the
 * Worker decides.
 */
export async function problemsOf(review, state, changes, sha, env) {
  const { parseReview, ReviewError } = await import('../server/tutorialFeedback.ts');
  const problems = [];
  try {
    parseReview(withRun(review, sha, env));
  } catch (e) {
    if (!(e instanceof ReviewError)) throw e;
    problems.push(`The Worker would refuse the whole look: ${e.message}.`);
  }
  const ids = new Set((state.inputs ?? []).map((i) => i.id));
  const keys = new Set(entries(review, 'code').map((c) => c?.key).filter((k) => typeof k === 'string'));
  const waiting = new Set((state.suggestions ?? []).filter((s) => !s.decision).map((s) => s.id));
  const changeOf = (ref) => changes.find((c) => (typeof ref === 'string' && ref.length >= 7 && c.sha.startsWith(ref)) || (ref !== null && c.pr !== null && String(ref).replace(/^(pr-?|#)/i, '') === String(c.pr)));
  const refs = [
    ...entries(review, 'looked').map((l, n) => [`looked[${n}].input`, l?.input]),
    ...entries(review, 'suggestions').flatMap((s, n) => (Array.isArray(s?.inputs) ? s.inputs : []).map((r, k) => [`suggestions[${n}].inputs[${k}]`, r])),
    ...entries(review, 'attach').flatMap((a, n) => (Array.isArray(a?.inputs) ? a.inputs : []).map((r, k) => [`attach[${n}].inputs[${k}]`, r]))
  ];
  for (const [where, ref] of refs) {
    if (ids.has(ref) || keys.has(ref)) continue;
    const change = changeOf(ref);
    if (change) problems.push(`${where} is ${shown(ref)}: a change from changes.json (${change.sha.slice(0, 8)} "${change.subject.slice(0, 60)}"), not an input. A change that needs nothing goes nowhere, not in looked. One a video no longer fits goes in code with a key of your own, and its suggestion's inputs name that key.`);
    else if (ref === undefined && where.endsWith('.input')) problems.push(`${where} is missing: write each entry as { "input": "<an input's id>", "outcome": "<why nothing is suggested>" }.`);
    else if (typeof ref === 'string' && UUID.test(ref)) problems.push(`${where} is ${shown(ref)}, which is no input's id in state.json. Name an input by its "id" from state.json's "inputs".`);
    else problems.push(`${where} is ${shown(ref)}, which is no input's id in state.json and no key in code. Name an input by its "id" from state.json's "inputs", or a code change by its "key".`);
  }
  entries(review, 'attach').forEach((a, n) => {
    if (!waiting.has(a?.suggestion)) problems.push(`attach[${n}].suggestion is ${shown(a?.suggestion)}, which is no waiting suggestion's id in state.json.`);
  });
  const placed = new Set(refs.map(([, ref]) => ref));
  for (const i of state.inputs ?? []) {
    if (!i.lookedAt && !placed.has(i.id)) problems.push(`Input ${i.id} (a ${i.kind}) is in no place: put it in a suggestion's inputs, in attach, or in looked with an outcome.`);
  }
  for (const key of keys) if (!placed.has(key)) problems.push(`code key ${shown(key)} is in no place: name it in the suggestion it is for.`);
  return problems;
}

async function check(dir) {
  const file = join(dir, 'problems.txt');
  rmSync(file, { force: true });
  let problems;
  try {
    const review = JSON.parse(readFileSync(join(dir, 'review.json'), 'utf8'));
    const state = JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8'));
    const changes = JSON.parse(readFileSync(join(dir, 'changes.json'), 'utf8'));
    problems = await problemsOf(review, state, changes, git('rev-parse', 'HEAD').trim(), process.env);
  } catch (e) {
    problems = [`review.json could not be read: ${e instanceof Error ? e.message.slice(0, 200) : e}. Write it as one JSON object, as the skill says.`];
  }
  if (problems.length) writeFileSync(file, problems.join('\n') + '\n');
  for (const p of problems) console.log(`::warning title=Tutorial review::${p.replace(/[\r\n%]/g, ' ')}`);
  console.log(problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'} in the look, in ${file}` : 'the look is fine');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `problems=${problems.length ? 'yes' : 'no'}\n`);
}

async function oidcToken() {
  const url = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const bearer = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  if (!url || !bearer) throw new Error('No GitHub OIDC token here: this runs only in tutorial-review.yml, with id-token: write.');
  const res = await fetch(`${url}&audience=${encodeURIComponent(AUDIENCE)}`, { headers: { authorization: `bearer ${bearer}` } });
  if (!res.ok) throw new Error(`GitHub OIDC token: HTTP ${res.status}`);
  return (await res.json()).value;
}

async function call(method, body, path = '') {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${await oidcToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${API}${path}: HTTP ${res.status} ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const isAncestor = (sha) => {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

async function fetchState(dir) {
  mkdirSync(dir, { recursive: true });
  const state = await call('GET');
  const last = state.last?.sha;
  const range = last && isAncestor(last) ? [`${last}..HEAD`] : [`--since=${FIRST_DAYS}.days`, 'HEAD'];
  const log = git('log', '--first-parent', '--format=%H%x09%cI%x09%s', ...range, '--', ...APP_PATHS);
  const changes = changesOf(log, (sha) => git('show', '--name-only', '--format=', sha).split('\n').filter(Boolean));
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(dir, 'changes.json'), JSON.stringify(changes, null, 2));
  const open = state.inputs.filter((i) => !i.lookedAt).length;
  console.log(`open: ${state.inputs.length} inputs (${open} not looked at yet), ${state.suggestions.filter((s) => !s.decision).length} suggestions waiting; ${changes.length} changes since ${last ? last.slice(0, 8) : `${FIRST_DAYS} days ago`}`);
}

async function send(dir) {
  const review = JSON.parse(readFileSync(join(dir, 'review.json'), 'utf8'));
  const done = await call('POST', withRun(review, git('rev-parse', 'HEAD').trim(), process.env));
  console.log(`sent: ${done.code} code changes, ${done.looked} looked at, ${done.suggested} suggestions${done.skipped ? `, ${done.skipped} ids the database did not know` : ''}`);
  if (done.skipped) console.log(`::warning::${done.skipped} inputs or suggestions named in review.json were not found`);
}

// ---- an accepted change, written by Claude as a draft pull request ---------------------------------

// A person accepted a suggestion to change a video's script, screens or voice on the ops dashboard,
// or an admin wrote there what Claude must do with a video (an instruction, accepted as written).
// Every 30 minutes `queue` asks the Worker for those that wait and starts at most three; `fix` has
// Claude change the video in a checkout with no key and no shell; `check` applies the patch and runs
// typecheck and the videos' tests with no key at all; `open` runs nothing of the patch, pushes it and
// opens a draft pull request with the built-in token, whose pull requests start no checks: a person
// reads it, marks it Ready for review, and merges it, and the merge films the video again (183).

/** The changes Claude makes; a code change goes to Linear and a new video is made by a person (server/tutorialFeedback.ts FIXABLE_KINDS). */
export const FIXABLE = ['script', 'screen', 'voice', 'instruction'];
export const FIX_LIMITS = { files: 20, bytes: 200_000, summary: 3000, noFix: 1000 };
/**
 * How a fix whose draft pull request GitHub would not open is failed; a later run opens it from its pushed
 * branch (migration 20261114070000_tutorial_fix_unopened.sql matches these words).
 */
export const UNOPENED_NOTE = 'GitHub did not let the workflow open the pull request';
/** The phone's disguise (decisions.md 171, server/tutorialFeedback.ts DISGUISE): no video shows or explains it. */
const DISGUISE = /\b(disguis\w*|calculators?|notepads?)\b/i;
const VIDEO = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REPO = 'genesis-ai-dev/langquest-next';
const FIX_BOT = { name: 'github-actions[bot]', email: '41898282+github-actions[bot]@users.noreply.github.com' };
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const said = (v) => (typeof v === 'string' ? v.trim() : '');
const cut = (t, max) => (t.length > max ? `${t.slice(0, max - 1)}…` : t);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** The paths `git apply --numstat -z` lists: one per change, both sides of a rename. */
export function pathsOf(numstatZ) {
  const parts = String(numstatZ).split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const m = /^(?:-|\d+)\t(?:-|\d+)\t(.*)$/s.exec(parts[i]);
    if (!m) continue;
    if (m[1]) out.push(m[1]);
    else {
      out.push(parts[i + 1], parts[i + 2]);
      i += 2;
    }
  }
  return out.filter(Boolean);
}

/**
 * The paths a patch takes away from: renamed or copied from, and changed or deleted (git apply
 * lists only where a rename goes). Quoted paths stay quoted, and fixRefusal refuses them.
 */
export function oldPathsOf(patch) {
  const out = [];
  for (const m of String(patch).matchAll(/^(?:(?:rename|copy) from |--- a\/)(.+)$/gm)) out.push(m[1]);
  for (const m of String(patch).matchAll(/^--- (".+)$/gm)) out.push(m[1]);
  return out;
}

/** The branch a fix goes on. */
export const fixBranch = (id) => `tutorial-fix/${String(id).slice(0, 8)}`;

/** Where a draft pull request is now, as GitHub gives it: merged, closed, or still open (null). */
export function prStateOf(pull) {
  if (pull?.merged || pull?.merged_at) return 'merged';
  return pull?.state === 'closed' ? 'closed' : null;
}

/**
 * Why a fix may not go on, or null. It changes only the video's own file (e2e/tutorials/<video>.ts) and
 * what other languages say (e2e/tutorials/lines/<language>.json): not the app, not the filming, not a test.
 */
export function fixRefusal(paths, bytes, video) {
  if (!VIDEO.test(video ?? '')) return 'it names no video';
  if (!paths.length) return 'it changes nothing';
  const allowed = (p) => p === `e2e/tutorials/${video}.ts` || /^e2e\/tutorials\/lines\/[A-Za-z-]{2,12}\.json$/.test(p);
  const bad = paths.find((p) => !allowed(p));
  if (bad !== undefined) return `it changes ${bad}; a fix changes only e2e/tutorials/${video}.ts and e2e/tutorials/lines/`;
  if (paths.length > FIX_LIMITS.files) return `it changes ${paths.length} files, more than ${FIX_LIMITS.files}`;
  if (bytes > FIX_LIMITS.bytes) return `it is ${Math.round(bytes / 1000)} KB, more than ${FIX_LIMITS.bytes / 1000}`;
  return null;
}

/** fix.json as Claude wrote it: what the change does, or why there is none. */
export function checkFix(raw) {
  const o = isObj(raw) ? raw : {};
  const summary = cut(said(o.summary), FIX_LIMITS.summary);
  const noFix = cut(said(o.noFix), FIX_LIMITS.noFix);
  return { summary, noFix: noFix || (summary ? '' : 'Claude wrote no summary of a change.') };
}

/** check.json from the job with no key: only its fixed words, since the patch's own code ran there. */
export function checkResults(raw) {
  const one = (v) => (['passed', 'failed', 'none'].includes(v) ? v : 'not run');
  return { typecheck: one(raw?.typecheck), tests: one(raw?.tests) };
}

const result = (r, what) => ({ passed: `${what} passed`, failed: `${what} **failed**`, none: `no ${what}`, 'not run': `${what} did not run` })[r];

/** Where an input is, by link; never what a commenter wrote, nor who. */
function inputLine(i) {
  const day = String(i.at ?? '').slice(0, 10);
  if (i.kind === 'comment') return `A comment on the YouTube channel in \`${i.language ?? '?'}\`, ${day}${i.youtubeId && i.ref ? ` ([on YouTube](https://www.youtube.com/watch?v=${i.youtubeId}&lc=${i.ref}))` : ''}`;
  if (i.kind === 'code') return `A change merged into main, ${day}${i.pr ? ` (#${i.pr})` : i.ref ? ` (${String(i.ref).slice(0, 8)})` : ''}`;
  return `A note on the ops dashboard, ${day}`;
}

/** The draft pull request's title and body: the suggestion as accepted, what it answers, Claude's change and its checks. */
export function fixPull(suggestion, fix, checks, run) {
  const title = `Tutorial video ${suggestion.tutorial}: ${suggestion.title}`.slice(0, 200);
  const inputs = Array.isArray(suggestion.inputs) ? suggestion.inputs : [];
  const instruction = suggestion.kind === 'instruction';
  const detail = String(suggestion.detail ?? '');
  const body = [
    instruction
      ? `Claude's change to the tutorial video \`${suggestion.tutorial}\`, from an instruction an admin wrote on the ops dashboard (docs/tutorial-videos.md "Feedback", decisions.md 186).`
      : `Claude's change to the tutorial video \`${suggestion.tutorial}\`, from a suggestion a person accepted on the ops dashboard (docs/tutorial-videos.md "Feedback", decisions.md 186).`,
    '',
    instruction ? `**The problem**${suggestion.language ? ` (${suggestion.language})` : ''}: ${suggestion.title}` : `**The suggestion** (${suggestion.kind}): ${suggestion.title}`,
    '',
    ...(instruction ? ['**The instruction:**', ''] : []),
    // The phone's disguise is never written where the public reads (decisions.md 171).
    ...(DISGUISE.test(detail) ? ['> (Not quoted here: read it on the ops dashboard.)'] : detail.split('\n').map((l) => `> ${l}`)),
    ...(inputs.length ? ['', '**What it answers:**', '', ...inputs.map((i) => `- ${inputLine(i)}`)] : []),
    '',
    `**The change:** ${fix.summary}`,
    '',
    checks
      ? `**In the workflow:** ${result(checks.typecheck, 'typecheck')}; ${result(checks.tests, "the videos' tests")} ([run](${run})).`
      : `**In the workflow:** its typecheck and tests ran in [this run](${run}).`,
    '',
    'Read the change, then mark this pull request Ready for review: CI runs then. When it is merged into main, the video is filmed again at once, and its film names this pull request as the cause.',
    '',
    `Suggestion ${suggestion.id}`
  ].join('\n');
  return { title, body };
}

const output = (values) => {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(''));
};

async function github(method, path, body) {
  if (!process.env.GITHUB_TOKEN) throw new Error('No GITHUB_TOKEN: this job needs it.');
  const res = await fetch(`${process.env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${REPO}${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/**
 * Which draft pull requests were merged or closed since, the ones GitHub would not open opened now,
 * and at most three accepted changes started
 * (only with a Claude token: without one the look says so): each <dir>/<id>.json, and their ids as
 * the step's `fixes` output. Prints ids and videos only: the logs are public.
 */
async function queue(dir) {
  mkdirSync(dir, { recursive: true });
  const waiting = await call('GET', undefined, '/fixes');
  const updates = [];
  for (const { id, pr } of waiting.open ?? []) {
    const got = await github('GET', `/pulls/${pr}`);
    const state = got.status === 200 ? prStateOf(got.json) : null;
    if (got.status !== 200) console.log(`::warning::PR ${pr}: GitHub answered ${got.status}`);
    if (state) updates.push({ id, state, pr });
  }
  for (const s of waiting.unopened ?? []) {
    if (!ID.test(s.id ?? '') || !VIDEO.test(s.tutorial ?? '')) continue;
    const pr = await openUnopened(s);
    if (pr) updates.push({ id: s.id, state: 'open', pr });
  }
  const claude = process.env.HAS_CLAUDE_TOKEN === 'true';
  const take = claude ? (waiting.toFix ?? []).filter((s) => ID.test(s.id) && FIXABLE.includes(s.kind) && VIDEO.test(s.tutorial ?? '')) : [];
  const moved = updates.length;
  updates.push(...take.map((s) => ({ id: s.id, state: 'working', pr: null })));
  const { results = [] } = updates.length ? await call('POST', { runUrl: runUrl(process.env), updates }, '/fixes') : {};
  updates.slice(0, moved).forEach((u, n) => console.log(`PR ${u.pr}: ${u.state}${results[n] === 'ok' ? '' : ` (${results[n]})`}`));
  const started = take.filter((_, n) => results[moved + n] === 'ok');
  for (const s of started) writeFileSync(join(dir, `${s.id}.json`), JSON.stringify(s, null, 2));
  console.log(started.length ? `started: ${started.map((s) => `${s.id.slice(0, 8)} (${s.tutorial})`).join(', ')}` : claude ? 'no accepted change waits' : 'no Claude token: no change started');
  output({ fixes: JSON.stringify(started.map((s) => s.id)) });
}

/** The fix's summary from its commit on the branch: the paragraph after the title (`fixOpen` writes it). */
export function summaryOf(message) {
  const parts = String(message ?? '').split(/\n\s*\n/);
  return cut(said(parts[1] ?? ''), FIX_LIMITS.summary) || 'See the branch\'s commit.';
}

/**
 * A fix whose draft pull request GitHub would not open: the pull request a person opened from its
 * branch, or one this run opens now with the built-in token; null while GitHub still refuses, or
 * when its branch is gone (a person then writes the instruction again).
 */
async function openUnopened(s) {
  const branch = fixBranch(s.id);
  const found = await github('GET', `/pulls?head=${REPO.split('/')[0]}:${branch}&state=all&per_page=5`);
  // One a person opened (or closed, or merged): the next run's look at the open ones says which.
  const theirs = found.status === 200 && Array.isArray(found.json) ? found.json[0] : null;
  if (theirs?.number) return theirs.number;
  const commit = await github('GET', `/commits/${encodeURIComponent(branch)}`);
  if (commit.status !== 200) {
    console.log(`${s.id.slice(0, 8)}: the branch ${branch} is gone (GitHub answered ${commit.status})`);
    return null;
  }
  const pull = fixPull(s, { summary: summaryOf(commit.json.commit?.message), noFix: '' }, null, s.fix?.run ?? runUrl(process.env));
  if (DISGUISE.test(`${pull.title}\n${pull.body}`)) return null;
  const made = await github('POST', '/pulls', { title: pull.title, head: branch, base: 'main', body: pull.body, draft: true });
  if (made.status === 201) {
    console.log(`${s.id.slice(0, 8)}: opened PR ${made.json.number} from ${branch}`);
    return made.json.number;
  }
  console.log(`::warning title=Needs you%3A pull requests from Actions::GitHub still answers ${made.status} to opening ${branch}. Turn on "Allow GitHub Actions to create and approve pull requests" with npm run github:rules -- --apply.`);
  return null;
}

/**
 * After Claude: what it changed, as a patch, and its fix.json, checked, in FIX_OUT. Runs nothing of the
 * change. The workflow runs it from a copy made before Claude, with GIT_DIR a copy of the repository
 * made then too, so nothing Claude wrote in the checkout (its .git included) runs here.
 */
function fixPatch(dir) {
  const out = process.env.FIX_OUT || join(dir, 'out');
  mkdirSync(out, { recursive: true });
  const path = join(dir, 'fix.json');
  let raw = { noFix: 'Claude wrote no fix.json.' };
  if (existsSync(path) && readFileSync(path).length < 100_000) {
    try {
      raw = readJson(path);
    } catch {
      raw = { noFix: 'fix.json is not JSON.' };
    }
  }
  const fix = checkFix(raw);
  git('add', '-A', '--', '.', `:(exclude)${dir}`);
  const patch = git('diff', '--cached', '--binary');
  if (!fix.noFix && !patch) fix.noFix = 'Claude changed no file.';
  if (!fix.noFix && DISGUISE.test(`${patch}\n${fix.summary}`)) fix.noFix = 'The change names the phone\'s disguise (decisions.md 171), which no video shows; a person makes it.';
  writeFileSync(join(out, 'fix.json'), JSON.stringify(fix, null, 2));
  if (!fix.noFix) writeFileSync(join(out, 'fix.patch'), patch);
  console.log(fix.noFix ? 'no fix' : `a fix: ${patch.length} bytes`);
}

/** Refuses a patch that changes more than the video's own file and lines: the paths as git reads them, before it is applied. */
async function fixPaths(patchPath, video) {
  const patch = readFileSync(patchPath);
  const paths = [...new Set([...pathsOf(git('apply', '--numstat', '-z', patchPath)), ...oldPathsOf(patch.toString('utf8'))])];
  const reason = fixRefusal(paths, patch.length, video);
  if (reason) throw new Error(`refused the fix: ${reason}`);
  git('apply', '--check', patchPath);
  console.log(`the fix changes only ${video} and its lines`);
}

/**
 * The fix, from the job that runs nothing of it: on its own branch, as a draft pull request, and the
 * Worker told; or the Worker told why there is none. Never runs npm or the patch's code, and git runs
 * no hook here (no npm install set one).
 */
async function fixOpen(dir, id) {
  if (!ID.test(id ?? '')) throw new Error(`not a suggestion: ${id}`);
  const run = runUrl(process.env);
  const tell = async (state, pr, note) => {
    const { results } = await call('POST', { runUrl: run, updates: [{ id, state, pr, note }] }, '/fixes');
    console.log(`${id.slice(0, 8)}: ${state}${pr ? ` (PR ${pr})` : ''}${results?.[0] === 'ok' ? '' : `, which the Worker answered ${results?.[0]}`}`);
  };
  const suggestion = readJson(join(dir, 'input', `${id}.json`));
  const fixPath = join(dir, 'fix', 'fix.json');
  const fix = existsSync(fixPath) ? checkFix(readJson(fixPath)) : { summary: '', noFix: 'The job that writes it failed.' };
  const patchPath = join(dir, 'fix', 'fix.patch');
  const checkPath = join(dir, 'check', 'check.json');
  const checks = checkResults(existsSync(checkPath) ? readJson(checkPath) : {});
  let reason = fix.noFix || (existsSync(patchPath) ? null : 'Its patch is missing.');
  if (!reason) {
    try {
      await fixPaths(patchPath, suggestion.tutorial);
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
  }
  const pull = reason ? null : fixPull(suggestion, fix, checks, run);
  if (pull && DISGUISE.test(`${pull.title}\n${pull.body}`)) reason = 'The pull request would name the phone\'s disguise (decisions.md 171); a person makes this change.';
  if (reason) return tell('failed', null, cut(reason, 1000));
  const branch = fixBranch(id);
  if (git('ls-remote', '--heads', 'origin', branch).trim()) return tell('failed', null, `The branch ${branch} is there already.`);
  git('checkout', '-q', '-b', branch);
  git('apply', '--index', patchPath);
  execFileSync('git', ['-c', `user.name=${FIX_BOT.name}`, '-c', `user.email=${FIX_BOT.email}`, 'commit', '--no-verify', '-q', '-F', '-'], {
    input: `${pull.title}\n\n${fix.summary}\n\nClaude's change for an accepted suggestion: ${run}\n`
  });
  git('push', '-q', 'origin', `HEAD:refs/heads/${branch}`);
  const made = await github('POST', '/pulls', { title: pull.title, head: branch, base: 'main', body: pull.body, draft: true });
  if (made.status !== 201) {
    console.log(`::error title=Needs you%3A pull requests from Actions::GitHub answered ${made.status} (${String(made.json.message ?? '').slice(0, 200)}) to the fix for ${id}; the branch ${branch} is pushed. Turn on "Allow GitHub Actions to create and approve pull requests" with npm run github:rules -- --apply.`);
    return tell('failed', null, `${UNOPENED_NOTE}; the branch ${branch} is pushed. The next fix run opens it once GitHub lets it.`);
  }
  return tell('open', made.json.number, null);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, dir, arg] = process.argv.slice(2);
  const commands = { fetch: fetchState, check, send, queue, 'fix-patch': fixPatch, 'fix-paths': fixPaths, 'fix-open': fixOpen };
  if (!dir || !Object.hasOwn(commands, command)) {
    console.error(`usage: node scripts/tutorial-review.mjs <${Object.keys(commands).join('|')}> <dir or patch> [suggestion or video]`);
    process.exit(2);
  }
  try {
    await commands[command](dir, arg);
  } catch (e) {
    console.error(`::error::${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
