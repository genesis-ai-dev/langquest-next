#!/usr/bin/env node
// The web UI suite's flake tracker (docs/testing.md, "Zero retries,
// quarantine instead"; decisions.md 102, amended 2026-10-20). Retries are off,
// so every pull request and main run is one verdict per test, and a test that
// fails now and then without a product cause only shows over many runs. This
// downloads the ui-web report artifacts (ui-web-p0-results-*) of the last
// completed guardrails runs, tallies pass rates with scripts/ui-flakes.mjs,
// prints the tests under a threshold, and files them in Linear as one issue,
// the way scripts/nightly-report.mjs files a nightly failure (it is that
// script's Linear code, its plan and its dry run): one open issue titled for
// the flakes; a comment when the list changes, when it turns empty, and when
// it turns non-empty again. It never closes the issue.
//
//   node scripts/ui-flake-report.mjs --sha <sha> --url <run> [--runs 40] [--threshold 0.95] [--min 5] [--dry-run]
//
// GITHUB_TOKEN (the job needs `actions: read`) and GITHUB_REPOSITORY read the
// artifacts (by hand they default to the gh CLI's sign-in and repository); LINEAR_API_KEY files the issue unless --dry-run (the workflow
// dry-runs off main).
//
// Counted: runs of the pull_request and push events that ended in success or
// failure, newest first. A pull request that broke a test and fixed it in its
// next push is counted as a failure: that is why the threshold is not 100%
// and why a test must be seen in several runs (--min). A report in which more
// than MANY tests failed is one cause (the stack down), not many flakes, and
// is left out (scripts/nightly-report.mjs does the same).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { apply, dryApi, flags, linearApi, MANY, plan, PREFIX, testsOf } from './nightly-report.mjs';
import { below, tally } from './ui-flakes.mjs';

export const UI_FLAKES = 'the web UI tests that do not pass every run';
const WORKFLOW = 'guardrails.yml';
const ARTIFACT = /^ui-web-p0-results-\d+$/;
const EVENTS = ['pull_request', 'push'];

// --- Reading the runs ---------------------------------------------------------

/** The last `count` completed runs worth counting, newest first. `get(path)` is a GitHub REST GET returning JSON. */
export async function recentRuns(get, repo, count, maxPages = 5) {
  const runs = [];
  for (let page = 1; page <= maxPages && runs.length < count; page++) {
    const { workflow_runs: batch } = await get(`/repos/${repo}/actions/workflows/${WORKFLOW}/runs?status=completed&per_page=100&page=${page}`);
    if (!batch.length) break;
    for (const run of batch) {
      if (EVENTS.includes(run.event) && ['success', 'failure'].includes(run.conclusion)) runs.push(run);
    }
  }
  return runs.slice(0, count);
}

/** The ui-web report artifacts of a run that are still there. */
export async function reportArtifacts(get, repo, runId) {
  const { artifacts } = await get(`/repos/${repo}/actions/runs/${runId}/artifacts?per_page=100`);
  return artifacts.filter((a) => ARTIFACT.test(a.name) && !a.expired);
}

/** report.json out of a downloaded artifact (a zip), or null when it has none. */
export function reportFromZip(bytes) {
  const dir = mkdtempSync(join(tmpdir(), 'ui-flake-'));
  try {
    const zip = join(dir, 'artifact.zip');
    writeFileSync(zip, bytes);
    const out = spawnSync('unzip', ['-p', zip, 'report.json'], { maxBuffer: 256 * 1024 * 1024 });
    if (out.status !== 0 || !out.stdout.length) return null;
    return JSON.parse(out.stdout.toString('utf8'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A GET against api.github.com, JSON back. */
export function githubGet(token, fetchImpl = fetch) {
  return async (path) => {
    const res = await fetchImpl(`https://api.github.com${path}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
    });
    if (!res.ok) throw new Error(`GitHub ${path}: HTTP ${res.status}`);
    return res.json();
  };
}

/** Every report of the runs: [{ name, report }], and how many were left out as one cause. */
export async function collect({ get, download, repo, runs }) {
  const reports = [];
  let broken = 0;
  const queue = [...runs];
  async function worker() {
    for (let run = queue.shift(); run; run = queue.shift()) {
      for (const artifact of await reportArtifacts(get, repo, run.id)) {
        const report = await download(artifact);
        if (!report) continue;
        if (testsOf(report).filter((t) => !t.passed).length > MANY) broken++;
        else reports.push({ name: `${run.id}/${artifact.name}`, run, report });
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  // Newest run first, whatever order the downloads finished in.
  reports.sort((a, b) => b.run.id - a.run.id);
  return { reports, broken };
}

// --- What to say --------------------------------------------------------------

const percent = (r) => `${Math.round(r.rate * 100)}%`;
/** A test's line, and the runs it failed in (the newest few), linked from the url of this run. */
function line(r, url) {
  const base = url.replace(/\/runs\/\d+.*$/, '/runs/');
  const ids = [...new Set(r.failed.map((name) => name.split('/')[0]))].slice(0, 5);
  const links = ids.map((id) => `[${id}](${base}${id})`).join(', ');
  return `- \`${r.title}\` · passed ${r.passed} of ${r.runs} (${percent(r)})${links ? `\n  failed in ${links}` : ''}`;
}

/** The titles a comment listed, so a list that has not changed is not said again. */
export const listed = (comment) => [...comment.matchAll(/^- `(.+?)` · passed /gm)].map((m) => m[1]);

const NEXT = 'Fix the cause and name this issue in the commit, or, if the test fails without a product cause, ' +
  'tag it `@quarantine` and name this issue beside the tag (docs/testing.md). ' +
  'A pull request that broke a test and fixed it later counts as failures here, so look at the failing runs before deciding.';

export function listBody(rows, window, sha, url) {
  const { reports, runs, threshold, min } = window;
  return [
    `${rows.length} test(s) passed under ${Math.round(threshold * 100)}% of their runs in the ${reports} ui-web reports of the last ${runs} guardrails runs ` +
      `(pull requests and main), counting tests seen in at least ${min} runs. Worst first:`,
    '',
    ...rows.map((r) => line(r, url)),
    '',
    NEXT,
    '',
    `Counted at ${sha.slice(0, 7)}: ${url}`
  ].join('\n');
}

/**
 * What to tell Linear. `issues` are every issue titled with the nightly
 * prefix (api.issues()). Opens one when none is open and tests are under the
 * threshold; says when it turns (plan, as for a nightly job); and lists the
 * tests again as a comment whenever the list differs from the last one said.
 */
export function flakeActions(issues, rows, window, sha, url) {
  const outcome = { key: UI_FLAKES, passed: rows.length === 0, body: rows.length ? listBody(rows, window, sha, url) : undefined };
  const actions = plan(issues, [outcome], sha, url);
  const open = issues
    .filter((i) => i.title === `${PREFIX}${UI_FLAKES}` && !['completed', 'canceled'].includes(i.stateType))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (open && rows.length && !actions.some((a) => a.create)) {
    // The list last said: a comment's, or the description's when none has been made since the issue opened.
    const last = [...[open.description ?? '', ...open.comments]].reverse().find((c) => /^- `/m.test(c));
    const same = last && [...listed(last)].sort().join('\n') === rows.map((r) => r.title).sort().join('\n');
    if (!same) actions.push({ comment: { issue: open, body: `Flaky tests changed · ${sha.slice(0, 7)} · ${url}\n\n${listBody(rows, window, sha, url)}` } });
  }
  return actions;
}

// --- CLI ----------------------------------------------------------------------

async function main() {
  const opt = flags(process.argv.slice(2));
  const { sha, url } = opt;
  const runs = Number(opt.runs ?? 40);
  const threshold = Number(opt.threshold ?? 0.95);
  const min = Number(opt.min ?? 5);
  // In Actions both come from the environment; by hand, from the gh CLI's sign-in.
  const fromGh = (...args) => spawnSync('gh', args, { encoding: 'utf8' }).stdout?.trim();
  const token = process.env.GITHUB_TOKEN || fromGh('auth', 'token');
  const repo = process.env.GITHUB_REPOSITORY || fromGh('repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner');
  if (!sha || !url || !token || !repo) {
    console.error('usage: [GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo] ui-flake-report.mjs --sha <sha> --url <run> [--runs 40] [--threshold 0.95] [--min 5] [--dry-run]');
    process.exit(2);
  }
  if (!opt['dry-run'] && !process.env.LINEAR_API_KEY) {
    console.error('::error::Add the LINEAR_API_KEY secret; the flaky tests cannot be filed without it.');
    process.exit(1);
  }
  const get = githubGet(token);
  const download = async (artifact) => {
    const res = await fetch(artifact.archive_download_url, { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`GitHub artifact ${artifact.name}: HTTP ${res.status}`);
    return reportFromZip(Buffer.from(await res.arrayBuffer()));
  };
  const found = await recentRuns(get, repo, runs);
  const { reports, broken } = await collect({ get, download, repo, runs: found });
  console.log(`${found.length} guardrails run(s), ${reports.length} ui-web report(s)${broken ? `, ${broken} left out (more than ${MANY} tests failed: one cause)` : ''}`);
  if (!reports.length) {
    console.log('::warning::no ui-web reports found (expired, or the runs left none); nothing to track');
    return;
  }
  const rows = below(tally(reports), { min, threshold });
  console.log(`${rows.length} test(s) under ${Math.round(threshold * 100)}% in at least ${min} runs`);
  for (const r of rows) console.log(`${percent(r).padStart(4)}  ${r.passed}/${r.runs}  ${r.title}`);
  const api = opt['dry-run'] ? dryApi() : linearApi(process.env.LINEAR_API_KEY);
  const window = { reports: reports.length, runs: found.length, threshold, min };
  for (const out of await apply(api, flakeActions(await api.issues(), rows, window, sha, url))) console.log(out);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
