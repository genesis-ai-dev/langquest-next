// The files that `npm run guardrails` last passed on, so that the pre-push
// hook does not run the same checks on the same files again
// (decisions.md 164, amended 2026-11-19). The hook's typecheck, lint, unit
// tests and push delivery bundle are all in guardrails' `checks` level, and
// the same files give the same results, so a push of a commit whose tree
// guardrails passed skips them. Anything else, and any error, runs them.
//
// Only a run on committed work counts: the checks read the working tree
// (and the decision log's test reads untracked files too), so the tree is
// recorded only when nothing was uncommitted or untracked when the run began,
// and the same is true, with the same tree, when it passes.
//
//   node scripts/guardrails-passed.mjs state            the clean tree, or nothing
//   node scripts/guardrails-passed.mjs record <state>   in guardrails.sh after its
//                                                       checks pass, given the state
//                                                       from before they began
//   node scripts/guardrails-passed.mjs covers           in the pre-push hook, with
//                                                       git's lines on stdin: exits 0
//                                                       when every commit pushed has
//                                                       the recorded tree, else 1
//
// The record is this worktree's (.git/guardrails-passed, or the worktree's
// own folder under .git/worktrees), so worktrees do not overwrite each other.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ZERO = /^0+$/;

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Where this worktree keeps the record. */
export const recordPath = (cwd) => git(cwd, ['rev-parse', '--path-format=absolute', '--git-path', 'guardrails-passed']);

/** HEAD's tree when nothing is uncommitted or untracked (ignored files aside), else ''. */
export function cleanTree(cwd) {
  if (git(cwd, ['status', '--porcelain', '--untracked-files=normal']) !== '') return '';
  return git(cwd, ['rev-parse', 'HEAD^{tree}']);
}

/**
 * Records the tree when the run began and ended clean on the same tree.
 * Returns what to say: recorded or why not.
 */
export function record(cwd, before, now = new Date()) {
  const after = cleanTree(cwd);
  if (!before || before !== after) {
    return 'Not recorded for the pre-push hook: there were uncommitted or untracked files, or a commit during the run, so the hook runs its checks again.';
  }
  writeFileSync(recordPath(cwd), `${JSON.stringify({ tree: after, commit: git(cwd, ['rev-parse', 'HEAD']), at: now.toISOString() })}\n`);
  return `Recorded for the pre-push hook: a push of a commit with this tree (${after.slice(0, 12)}) skips its checks.`;
}

/** The commits a push sends, from the lines git gives pre-push (`<local ref> <local sha> <remote ref> <remote sha>`); a deletion sends none. */
export function pushedCommits(lines) {
  return lines
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((fields) => fields.length === 4 && !ZERO.test(fields[1]))
    .map((fields) => fields[1]);
}

/** Whether a push whose commits have these trees is covered by the recorded tree: at least one commit, and every one has it. */
export const covered = (trees, recorded) => !!recorded && trees.length > 0 && trees.every((tree) => tree === recorded);

/** The recorded run, or null when there is none or it cannot be read. */
export function readRecord(cwd) {
  try {
    const { tree, commit, at } = JSON.parse(readFileSync(recordPath(cwd), 'utf8'));
    return typeof tree === 'string' && tree ? { tree, commit, at } : null;
  } catch {
    return null;
  }
}

/** `{ skip, say }` for the pre-push hook. */
export function decide(cwd, lines) {
  const passed = readRecord(cwd);
  const commits = pushedCommits(lines);
  const trees = commits.map((sha) => git(cwd, ['rev-parse', `${sha}^{tree}`]));
  if (!covered(trees, passed?.tree)) return { skip: false, say: '' };
  return {
    skip: true,
    say: `pre-push: npm run guardrails passed on these files (tree ${passed.tree.slice(0, 12)}, ${passed.at}), so typecheck, lint, tests and the bundle check are not run again.`
  };
}

function main([command, arg], cwd = process.cwd()) {
  if (command === 'state') return console.log(cleanTree(cwd));
  if (command === 'record') return console.log(record(cwd, arg ?? ''));
  if (command === 'covers') {
    const { skip, say } = decide(cwd, readFileSync(0, 'utf8'));
    if (say) console.log(say);
    process.exitCode = skip ? 0 : 1;
    return;
  }
  throw new Error('usage: node scripts/guardrails-passed.mjs state | record <state> | covers < pushed refs');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (err) {
    // Never fails a push or a guardrails run: an error only means the checks run.
    console.error(`guardrails-passed: ${err.message.replace(/\s+/g, ' ').trim()} (so the checks run)`);
    process.exitCode = 1;
  }
}
