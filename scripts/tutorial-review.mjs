#!/usr/bin/env node
// Claude's nightly look at the tutorial videos' feedback, around Claude
// (.github/workflows/tutorial-review.yml, docs/tutorial-videos.md "Feedback",
// decisions.md 186). Plain Node, no packages, so the workflow needs no
// `npm ci`.
//
//   node scripts/tutorial-review.mjs fetch <dir>   what is open (state.json) and what main changed since the last look (changes.json)
//   node scripts/tutorial-review.mjs send <dir>    review.json, as Claude wrote it, to the app's Worker
//
// Both sign in with the OpenID Connect token GitHub gives the job
// (`id-token: write`); the Worker lets in this workflow on main and nothing
// else (apps/web/worker/tutorialReview.ts). Run anywhere else, they stop.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
  if (!dir || (command !== 'fetch' && command !== 'send')) {
    console.error('usage: node scripts/tutorial-review.mjs <fetch|send> <dir>');
    process.exit(2);
  }
  try {
    await (command === 'fetch' ? fetchState(dir) : send(dir));
  } catch (e) {
    console.error(`::error::${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}
