// The GitHub rulesets in .github/rulesets, applied to the repository
// (decisions.md 150). Each file is one ruleset, matched to the one on
// GitHub by its name. Without --apply it only says what it would do, and
// changes nothing; with it, a person who administers the repository
// creates or updates each ruleset that differs. It never deletes one.
//
//   node scripts/github-rules.mjs            what would change
//   node scripts/github-rules.mjs --apply    make the change
//
// main.json requires one check, the guardrails `gate` job, which needs every
// guardrails job that runs on a pull request; scripts/githubRules.test.ts
// holds the two together.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
export const RULESETS = join(root, '.github/rulesets');

/** Every ruleset file, by its name. */
export function readRulesets(dir = RULESETS) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: f, ruleset: JSON.parse(readFileSync(join(dir, f), 'utf8')) }));
}

/** The check names a ruleset requires. */
export function requiredContexts(ruleset) {
  return ruleset.rules
    .filter((r) => r.type === 'required_status_checks')
    .flatMap((r) => r.parameters.required_status_checks.map((c) => c.context));
}

/**
 * The jobs of a workflow that run on a pull request: every job whose `if:`
 * does not hold it to the nightly run. The workflow is read as text, so a
 * job written in another shape fails the test rather than slipping past.
 */
export function pullRequestJobs(workflow) {
  return jobBlocks(workflow)
    .filter(({ body }) => !/^ {4}if:.*\bschedule\b/m.test(body))
    .map(({ name }) => name);
}

/** The jobs that one job of a workflow needs. */
export function jobNeeds(workflow, job) {
  const body = jobBlocks(workflow).find((j) => j.name === job)?.body ?? '';
  const needs = body.match(/^ {4}needs:\s*(?:\[([^\]]*)\]|(\S+))/m);
  if (!needs) return [];
  return (needs[1] ?? needs[2]).split(',').map((n) => n.trim()).filter(Boolean);
}

function jobBlocks(workflow) {
  return workflow
    .slice(workflow.search(/^jobs:\s*$/m))
    .split(/^ {2}(?=[\w-]+:\s*$)/m)
    .slice(1)
    .map((body) => ({ name: body.match(/^([\w-]+):/)[1], body }));
}

/** True when every value in `want` is the same in `have`; keys GitHub adds are ignored. */
export function matches(want, have) {
  if (Array.isArray(want)) return Array.isArray(have) && want.length === have.length && want.every((w, i) => matches(w, have[i]));
  if (want && typeof want === 'object') return !!have && typeof have === 'object' && Object.keys(want).every((k) => matches(want[k], have[k]));
  return want === have;
}

function gh(args, input) {
  const run = spawnSync('gh', ['api', ...args], { cwd: root, encoding: 'utf8', input });
  if (run.status !== 0) {
    console.error(run.stderr || `x gh api ${args.join(' ')} failed`);
    process.exit(1);
  }
  return run.stdout ? JSON.parse(run.stdout) : null;
}

function main() {
  const apply = process.argv.includes('--apply');
  const repo = 'repos/{owner}/{repo}/rulesets';
  const onGitHub = gh([repo]);
  let changes = 0;
  for (const { file, ruleset } of readRulesets()) {
    const listed = onGitHub.find((r) => r.name === ruleset.name);
    const current = listed && gh([`${repo}/${listed.id}`]);
    if (current && matches(ruleset, current)) {
      console.log(`= ${ruleset.name} (${file}) is as the file says`);
      continue;
    }
    changes += 1;
    const verb = current ? 'update' : 'create';
    console.log(`${current ? '~' : '+'} ${ruleset.name} (${file}): ${verb}, requiring ${requiredContexts(ruleset).join(', ')}`);
    if (!apply) continue;
    gh(current ? ['-X', 'PUT', `${repo}/${current.id}`, '--input', '-'] : ['-X', 'POST', repo, '--input', '-'], JSON.stringify(ruleset));
    console.log(`  done: ${verb}d`);
  }
  if (changes && !apply) console.log('\nNothing was changed. Run again with --apply to make these changes.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
