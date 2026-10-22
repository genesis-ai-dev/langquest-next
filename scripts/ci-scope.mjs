// Which guardrails jobs a pull request needs, from the files that it changes
// (decisions.md 150). `checks` always runs. `server`, `web-smoke` and
// `ui-web` run when a changed file can affect what they test, and the `gate`
// job passes only when every job that the files need has passed.
//
// The files are the pull request's own change: its diff from where it meets
// main. The jobs still test the pull request merged with main, as before.
// A file that no rule below names runs every job, and so does any error:
// this never fails a run. A push to main, the nightly run and a manual run
// run every job.
//
//   node scripts/ci-scope.mjs     in the workflow: reads GITHUB_* and the
//                                 event, writes server=, web-smoke= and
//                                 ui-web= (true|false) to GITHUB_OUTPUT, and
//                                 why to the job summary
//   node scripts/ci-scope.mjs <file>...   what those files would run
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The jobs that scope can leave out. `checks` always runs. */
export const JOBS = ['server', 'web-smoke', 'ui-web'];

const APP = ['web-smoke', 'ui-web'];

/**
 * The first rule whose pattern matches a file says which of JOBS it needs.
 * Order matters: the shared code (core, sync, migrations, scripts, CI,
 * dependencies) comes before the rules for documents, so its README runs
 * everything too. Unit tests anywhere run in `checks`.
 */
export const RULES = [
  // What every job runs on: the shared packages, the database, the
  // dependencies, the CI and its scripts, the library that jobs seed.
  { pattern: /^(packages\/(core|sync)|supabase|library|scripts|\.github|\.githooks)\//, jobs: JOBS },
  { pattern: /(^|\/)(package\.json|package-lock\.json)$|^(vitest\.config\.ts|tsconfig[^/]*\.json)$/, jobs: JOBS },
  // Words for people and agents: the decision log, the plan, the docs, the
  // skills. Their tests (the decision log's format, links) are unit tests.
  { pattern: /^(docs|\.agents|\.claude|\.hermes)\//, jobs: [] },
  { pattern: /\.md$/, jobs: [] },
  // The SQL smokes run only in `server`.
  { pattern: /^server\//, jobs: ['server'] },
  // The app, its Worker and the browser tests run in the two browser jobs.
  { pattern: /^(apps\/mobile|apps\/web|e2e)\//, jobs: APP },
  { pattern: /^app\.json$/, jobs: APP },
  // Lint's rules, the invite email Worker and the v2 import are held by
  // `checks` alone (lint, typecheck, unit tests).
  { pattern: /^(eslint\.config\.mjs|apps\/invite-email\/|packages\/v2-import\/)/, jobs: [] },
];

/** The jobs that a list of changed files needs, and for each, the first file that needs it. */
export function scopeFor(files) {
  const why = {};
  for (const file of files) {
    const rule = RULES.find((r) => r.pattern.test(file));
    for (const job of rule ? rule.jobs : JOBS) why[job] ??= rule ? file : `${file} (no rule names it)`;
  }
  return Object.fromEntries(JOBS.map((job) => [job, why[job] ?? null]));
}

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The files a pull request changes at `head`, from where it meets `base`. */
export function changedFiles(cwd, base, head) {
  const from = git(cwd, ['merge-base', base, head]).trim();
  return git(cwd, ['diff', '--name-only', '--no-renames', from, head]).split('\n').filter(Boolean);
}

function say(scope, reason, env = process.env) {
  const lines = JOBS.map((job) => (scope[job] ? `- ${job} runs: ${scope[job]}` : `- ${job} is not needed`));
  const text = `${reason}\n${lines.join('\n')}`;
  console.log(text);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, JOBS.map((job) => `${job}=${!!scope[job]}\n`).join(''));
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
}

const everything = (why) => Object.fromEntries(JOBS.map((job) => [job, why]));

function main(env = process.env) {
  const args = process.argv.slice(2);
  if (args.length) return say(scopeFor(args), `For ${args.length} file(s):`, {});
  if (env.GITHUB_EVENT_NAME !== 'pull_request') return say(everything(`a ${env.GITHUB_EVENT_NAME ?? 'local'} run`), 'Every job runs.');
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  const files = changedFiles(process.cwd(), `origin/${event.pull_request.base.ref}`, event.pull_request.head.sha);
  if (files.length === 0) return say(everything('the pull request changes no file'), 'Every job runs.');
  say(scopeFor(files), `The pull request changes ${files.length} file(s).`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.log(`::warning::Could not tell which jobs this pull request needs (${err.message.replace(/\s+/g, ' ').trim()}), so every job runs.`);
    say(everything('which jobs are needed could not be told'), 'Every job runs.');
  }
}
