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
// An accepted change to a video (a clear fix Claude accepted itself, a
// suggestion a person accepted, or an admin's instruction), written by Claude
// as a pull request that merges itself when its checks pass (decisions.md 186,
// amended 2026-11-13 and 2026-11-16), in the workflow's fix jobs:
//
//   node scripts/tutorial-review.mjs queue <dir>                 says which pull requests were merged, closed or failed (closing
//                                                                one whose checks failed or that waited a day), and starts at
//                                                                most three accepted changes: <dir>/<id>.json each
//   node scripts/tutorial-review.mjs fix-patch <dir>             after Claude: its change as a patch, and its fix.json, checked
//   node scripts/tutorial-review.mjs fix-paths <patch> <video>   refuses a patch that changes more than the video's own file and
//                                                                lines, or adds code that reaches outside the video's steps
//   node scripts/tutorial-review.mjs vet-out <dir>               after the second Claude: its verdict.json, checked
//   node scripts/tutorial-review.mjs fix-open <dir> <id>         pushes the patch to tutorial-fix/<id>, opens its pull request
//                                                                with LangQuest's GitHub App and turns on auto-merge, and tells
//                                                                the Worker; or tells it why there is none
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

// ---- an accepted change, written by Claude as a pull request that merges itself ----------------------

// The nightly look found a clear fix to a video and accepted it itself, a person accepted a suggestion
// to change a video's script, screens or voice on the ops dashboard, or an admin wrote there what
// Claude must do with a video (an instruction, accepted as written). Every 30 minutes `queue` asks
// the Worker for those that wait and starts at most three; `fix` has Claude change the video in a
// checkout with no key and no shell; `check` applies the patch and runs typecheck and the videos'
// tests with no key at all; `vet` has a second Claude read only the patch, never what was asked;
// `open` runs nothing of the patch, pushes it, opens its pull request with LangQuest's GitHub App
// (whose pull requests start the checks) and turns on auto-merge: no person reads it, and the merge
// queue merges it when guardrails pass. The merge films the video again (183). A pull request whose
// checks fail, or that has not merged within a day, is closed by a later `queue`, and its fix failed.

/** The changes Claude makes; a code change goes to Linear and a new video is made by a person (server/tutorialFeedback.ts FIXABLE_KINDS). */
export const FIXABLE = ['script', 'screen', 'voice', 'instruction'];
export const FIX_LIMITS = { files: 20, bytes: 200_000, summary: 3000, noFix: 1000, already: 1000, why: 1000 };
/** A fix's pull request that has not merged in this long is closed, and its fix failed. */
export const OPEN_HOURS = 24;
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

/** Where a fix's pull request is now, as GitHub gives it: merged, closed, or still open (null). */
export function prStateOf(pull) {
  if (pull?.merged || pull?.merged_at) return 'merged';
  return pull?.state === 'closed' ? 'closed' : null;
}

/**
 * What to do with a fix's pull request that is still open: nothing yet (null), or close it and fail the
 * fix, with why. Its checks failed: the newest `gate` check run on its head has finished and did not pass.
 * It has waited more than OPEN_HOURS since it was opened (`at`, from the Worker): the merge queue or
 * auto-merge let it go (a conflict with main, most often).
 */
export function openVerdict(gateRuns, at, now = Date.now()) {
  const newest = [...(gateRuns ?? [])].sort((a, b) => String(b.started_at ?? '').localeCompare(String(a.started_at ?? '')))[0];
  if (newest?.status === 'completed' && !['success', 'neutral', 'skipped'].includes(newest.conclusion)) {
    return `Its checks failed (gate: ${newest.conclusion}), so the pull request is closed.`;
  }
  const opened = Date.parse(at ?? '');
  if (Number.isFinite(opened) && now - opened > OPEN_HOURS * 3600_000) return `It did not merge within ${OPEN_HOURS} hours, so the pull request is closed.`;
  return null;
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

/**
 * What a video's code may not gain, since no person reads a fix before it merges (decisions.md 186, amended
 * 2026-11-16): a video says, lights, taps, types and waits through the helpers next to it; it never reaches
 * the network, files, the environment, other programs, the database or code run in the page. A narration
 * line that only says one of these words is fine: the patterns look for code.
 */
export const CODE_REFUSED = [
  [/\brequire\s*\(|\bimport\s*\((?!\s*'playwright'\s*\))|\bimport\.meta\b/, 'loads code'],
  [/\bprocess\s*[.[]|\bglobalThis\b|\bglobal\s*[.[]|\b__dirname\b|\b__filename\b/, 'reads the process or the environment'],
  [/\beval\s*\(|\bFunction\s*\(|\bnew\s+Function\b|\bsetTimeout\s*\(\s*['"`]/, 'runs code from text'],
  [/\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bsendBeacon\b/, 'reaches the network'],
  [/\bchild_process\b|\bexecFile(Sync)?\s*\(|\bexecSync\s*\(|\bspawn(Sync)?\s*\(|['"]node:/, 'runs another program'],
  [/\b(read|write|append)File(Sync)?\s*\(|\b(rm|unlink|mkdir|rename|copyFile)(Sync)?\s*\(|\bcreate(Read|Write)Stream\b/, 'reads or writes files'],
  [/\.(evaluate|evaluateHandle|addInitScript|exposeFunction|exposeBinding|route|routeFromHAR|setExtraHTTPHeaders|addCookies)\s*\(/, 'runs code in the page or changes its traffic'],
  [/\bserviceClient\b|\bsupabase\b|SERVICE_ROLE|\bsecrets?\./i, 'reaches the database or a key'],
  [/https?:\/\/(?!next\.langquest\.org\b)/, 'names a web address other than next.langquest.org']
];

/** The lines a patch adds to one file: `diff --git a/<path> b/<path>` sections, `+` lines (not `+++`). */
export function addedLines(patch, path) {
  const out = [];
  let inFile = false;
  for (const line of String(patch).split('\n')) {
    if (line.startsWith('diff --git ')) inFile = line === `diff --git a/${path} b/${path}` || line.endsWith(` b/${path}`);
    else if (inFile && line.startsWith('+') && !line.startsWith('+++')) out.push(line.slice(1));
  }
  return out;
}

/**
 * Why a fix's code may not go on, or null: a line it adds to the video's own file that matches CODE_REFUSED,
 * or that imports anything but a helper next to the video (`./<name>`), the app's pure core or a type from
 * Playwright: a fix never brings in the test fixtures, which hold the database's keys. The lines files
 * (`lines/<language>.json`) are words, and are only parsed by the filming.
 */
export function codeRefusal(patch, video) {
  for (const line of addedLines(patch, `e2e/tutorials/${video}.ts`)) {
    if (/^\s*(import|export)\b[^;]*\bfrom\b|^\s*import\s+['"]/.test(line) && !/^\s*import\s+(type\s+)?[\w{}\s,*]+\s+from\s+'(\.\/[a-z0-9-]+|@langquest-next\/core)'\s*;?\s*$|^\s*import\s+type\s+[\w{}\s,*]+\s+from\s+'playwright'\s*;?\s*$/.test(line)) {
      return `it adds an import that is not a helper next to the video: ${cut(line.trim(), 120)}`;
    }
    for (const [pattern, what] of CODE_REFUSED) if (pattern.test(line)) return `it adds code that ${what}: ${cut(line.trim(), 120)}`;
  }
  return null;
}

/**
 * fix.json as Claude wrote it: what the change does, why there is none, or how the video already does what
 * was asked (`already`: no change needed, decisions.md 186 amended 2026-11-16). One of the three, in that
 * order of weight: `already`, then `noFix`, then `summary`.
 */
export function checkFix(raw) {
  const o = isObj(raw) ? raw : {};
  const already = cut(said(o.already), FIX_LIMITS.already);
  if (already) return { summary: '', noFix: '', already };
  const summary = cut(said(o.summary), FIX_LIMITS.summary);
  const noFix = cut(said(o.noFix), FIX_LIMITS.noFix);
  return { summary, noFix: noFix || (summary ? '' : 'Claude wrote no summary of a change.'), already: '' };
}

/** The second Claude's verdict.json: only `ok: true` lets the fix open; `why` says what it found, in a line. */
export function checkVet(raw) {
  const o = isObj(raw) ? raw : {};
  const why = cut(said(o.why), FIX_LIMITS.why);
  return { ok: o.ok === true && !!why, why: why || 'The second check wrote no verdict.' };
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

/**
 * The pull request's title and body: the suggestion as accepted (by Claude as a clear fix, by a person, or an
 * admin's instruction), what it answers, Claude's change, its checks and the second check's verdict.
 */
export function fixPull(suggestion, fix, checks, run, vet) {
  const title = `Tutorial video ${suggestion.tutorial}: ${suggestion.title}`.slice(0, 200);
  const inputs = Array.isArray(suggestion.inputs) ? suggestion.inputs : [];
  const instruction = suggestion.kind === 'instruction';
  const detail = String(suggestion.detail ?? '');
  const from = instruction ? 'from an instruction an admin wrote on the ops dashboard'
    : suggestion.clear ? "from a clear fix Claude found in its nightly look and accepted itself, with no person's yes"
    : 'from a suggestion a person accepted on the ops dashboard';
  const body = [
    `Claude's change to the tutorial video \`${suggestion.tutorial}\`, ${from} (docs/tutorial-videos.md "Feedback", decisions.md 186).`,
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
    `**In the workflow:** ${result(checks.typecheck, 'typecheck')}; ${result(checks.tests, "the videos' tests")} ([run](${run})).`,
    '',
    `**The second check** (a Claude that read only this change, never what was asked): ${vet?.why ?? 'not run'}`,
    '',
    'This pull request merges itself when its checks pass: no person needs to read or merge it (decisions.md 186, amended 2026-11-16). When it is merged into main, the video is filmed again at once, and its film names this pull request as the cause. To stop it, close it.',
    '',
    `Suggestion ${suggestion.id}`
  ].join('\n');
  return { title, body };
}

const output = (values) => {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(''));
};

async function github(method, path, body, token = process.env.GITHUB_TOKEN) {
  if (!token) throw new Error('No GITHUB_TOKEN: this job needs it.');
  const res = await fetch(`${process.env.GITHUB_API_URL ?? 'https://api.github.com'}/repos/${REPO}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

/**
 * Which pull requests were merged or closed since, which are closed now because their checks failed or
 * they waited a day (their fix failed), and at most three accepted changes started (only with a Claude
 * token: without one the look says so): each <dir>/<id>.json, and their ids as the step's `fixes`
 * output. Prints ids and videos only: the logs are public.
 */
async function queue(dir) {
  mkdirSync(dir, { recursive: true });
  const waiting = await call('GET', undefined, '/fixes');
  const updates = [];
  for (const { id, pr, at } of waiting.open ?? []) {
    const got = await github('GET', `/pulls/${pr}`);
    if (got.status !== 200) {
      console.log(`::warning::PR ${pr}: GitHub answered ${got.status}`);
      continue;
    }
    const state = prStateOf(got.json);
    if (state) {
      updates.push({ id, state, pr });
      continue;
    }
    const runs = await github('GET', `/commits/${got.json.head?.sha}/check-runs?check_name=gate&per_page=20`);
    const why = openVerdict(runs.status === 200 ? runs.json.check_runs : [], at);
    if (!why) continue;
    const closed = await github('PATCH', `/pulls/${pr}`, { state: 'closed' });
    if (closed.status !== 200) {
      console.log(`::warning::PR ${pr}: GitHub answered ${closed.status} to closing it`);
      continue;
    }
    updates.push({ id, state: 'failed', pr, note: why });
  }
  const claude = process.env.HAS_CLAUDE_TOKEN === 'true';
  const take = claude ? (waiting.toFix ?? []).filter((s) => ID.test(s.id) && FIXABLE.includes(s.kind) && VIDEO.test(s.tutorial ?? '')) : [];
  const moved = updates.length;
  updates.push(...take.map((s) => ({ id: s.id, state: 'working', pr: null })));
  const { results = [] } = updates.length ? await call('POST', { runUrl: runUrl(process.env), updates }, '/fixes') : {};
  updates.slice(0, moved).forEach((u, n) => console.log(`PR ${u.pr}: ${u.state}${u.note ? `: ${u.note}` : ''}${results[n] === 'ok' ? '' : ` (${results[n]})`}`));
  const started = take.filter((_, n) => results[moved + n] === 'ok');
  for (const s of started) writeFileSync(join(dir, `${s.id}.json`), JSON.stringify(s, null, 2));
  console.log(started.length ? `started: ${started.map((s) => `${s.id.slice(0, 8)} (${s.tutorial})`).join(', ')}` : claude ? 'no accepted change waits' : 'no Claude token: no change started');
  output({ fixes: JSON.stringify(started.map((s) => s.id)) });
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
  if (fix.already && patch) Object.assign(fix, { already: '', noFix: 'Claude said the video already does it, and changed it too.' });
  if (!fix.noFix && !fix.already && !patch) fix.noFix = 'Claude changed no file.';
  if (!fix.noFix && !fix.already && DISGUISE.test(`${patch}\n${fix.summary}`)) fix.noFix = 'The change names the phone\'s disguise (decisions.md 171), which no video shows; a person makes it.';
  writeFileSync(join(out, 'fix.json'), JSON.stringify(fix, null, 2));
  if (!fix.noFix && !fix.already) writeFileSync(join(out, 'fix.patch'), patch);
  console.log(fix.already ? 'no change needed' : fix.noFix ? 'no fix' : `a fix: ${patch.length} bytes`);
}

/** Refuses a patch that changes more than the video's own file and lines: the paths as git reads them, before it is applied. */
async function fixPaths(patchPath, video) {
  const patch = readFileSync(patchPath);
  const paths = [...new Set([...pathsOf(git('apply', '--numstat', '-z', patchPath)), ...oldPathsOf(patch.toString('utf8'))])];
  const reason = fixRefusal(paths, patch.length, video) ?? codeRefusal(patch.toString('utf8'), video);
  if (reason) throw new Error(`refused the fix: ${reason}`);
  git('apply', '--check', patchPath);
  console.log(`the fix changes only ${video} and its lines, and adds no code that reaches outside them`);
}

/** After the second Claude: its verdict, checked, in VET_OUT. Runs nothing of the patch. */
function vetOut(dir) {
  const out = process.env.VET_OUT || join(dir, 'out');
  mkdirSync(out, { recursive: true });
  const path = join(dir, 'verdict.json');
  let raw = {};
  if (existsSync(path) && readFileSync(path).length < 100_000) {
    try {
      raw = readJson(path);
    } catch {
      raw = {};
    }
  }
  const vet = checkVet(raw);
  writeFileSync(join(out, 'verdict.json'), JSON.stringify(vet, null, 2));
  console.log(vet.ok ? 'the second check passed the change' : 'the second check stopped the change');
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
  const fix = existsSync(fixPath) ? checkFix(readJson(fixPath)) : { summary: '', noFix: 'The job that writes it failed.', already: '' };
  if (fix.already) return tell('unneeded', null, fix.already);
  const patchPath = join(dir, 'fix', 'fix.patch');
  const checkPath = join(dir, 'check', 'check.json');
  const checks = checkResults(existsSync(checkPath) ? readJson(checkPath) : {});
  const vetPath = join(dir, 'vet', 'verdict.json');
  const vet = checkVet(existsSync(vetPath) ? readJson(vetPath) : {});
  let reason = fix.noFix || (existsSync(patchPath) ? null : 'Its patch is missing.');
  if (!reason) {
    try {
      await fixPaths(patchPath, suggestion.tutorial);
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
  }
  if (!reason && !vet.ok) reason = `The second check stopped it: ${vet.why}`;
  if (!reason && !process.env.PR_TOKEN) reason = 'No token from LangQuest\'s GitHub App (secrets RELEASE_APP_ID and RELEASE_APP_PRIVATE_KEY), which opens the pull request.';
  const pull = reason ? null : fixPull(suggestion, fix, checks, run, vet);
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
  // LangQuest's GitHub App opens it, so its checks start (a pull request the built-in token opens starts none).
  const made = await github('POST', '/pulls', { title: pull.title, head: branch, base: 'main', body: pull.body, draft: false }, process.env.PR_TOKEN);
  if (made.status !== 201) {
    console.log(`::error title=Needs you%3A tutorial fix pull request::GitHub answered ${made.status} (${String(made.json.message ?? '').slice(0, 200)}) to the App opening the fix for ${id}; the branch ${branch} is pushed. The App needs Pull requests write on this repository.`);
    return tell('failed', null, `GitHub did not let the App open the pull request (${made.status}); the branch ${branch} is pushed.`);
  }
  // Merges itself through the merge queue once its checks pass; a later queue closes it if they fail.
  try {
    execFileSync('gh', ['pr', 'merge', String(made.json.number), '--auto', '-R', REPO], { env: { ...process.env, GH_TOKEN: process.env.PR_TOKEN }, stdio: 'inherit' });
  } catch {
    console.log(`::warning::PR ${made.json.number}: auto-merge was not turned on; if it has not merged in ${OPEN_HOURS} hours, a fix run closes it.`);
  }
  return tell('open', made.json.number, null);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, dir, arg] = process.argv.slice(2);
  const commands = { fetch: fetchState, check, send, queue, 'fix-patch': fixPatch, 'fix-paths': fixPaths, 'vet-out': vetOut, 'fix-open': fixOpen };
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
