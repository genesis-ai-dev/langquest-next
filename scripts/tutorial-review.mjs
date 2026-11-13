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
// fetch and send sign in with the OpenID Connect token GitHub gives the job
// (`id-token: write`); the Worker lets in this workflow on main and nothing
// else (apps/web/worker/tutorialReview.ts). Run anywhere else, they stop.
// check needs no token and sends nothing.
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

async function call(method, body) {
  const res = await fetch(API, {
    method,
    headers: { authorization: `Bearer ${await oidcToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${API}: HTTP ${res.status} ${text.slice(0, 500)}`);
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, dir] = process.argv.slice(2);
  const commands = { fetch: fetchState, check, send };
  if (!dir || !Object.hasOwn(commands, command)) {
    console.error('usage: node scripts/tutorial-review.mjs <fetch|check|send> <dir>');
    process.exit(2);
  }
  try {
    await commands[command](dir);
  } catch (e) {
    console.error(`::error::${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
