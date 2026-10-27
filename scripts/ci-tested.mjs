// Whether the commit a guardrails run is about has already passed guardrails,
// so that the run can skip its jobs (decisions.md 164). scripts/ci-scope.mjs
// asks it before it measures the changed files. Two cases:
//
// - The merge queue. An entry's commit is main merged with the pull request.
//   When main has not moved since the pull request's own run, that run
//   tested the same tree (the files, not the commit). The `gate` job of a
//   pull request run that passed records the tree it tested as an artifact,
//   `tested-tree-<tree>`; the entry takes it only from a guardrails
//   pull_request run whose head is the entry's pull request head, made at
//   most MAX_AGE_MINUTES ago, because some checks read things outside the
//   tree (the store builds that server-calls and test:old-sync read from EAS).
// - A push. The merge queue pushes its entry's commit to main as it is, so a
//   green `gate` on that same commit, from the GitHub Actions app, in a
//   guardrails merge_group or push run of that commit, is the merge queue's
//   run of it. A pull request run's `gate` does not count: it sits on the
//   pull request's head but tested that head merged with main, so a branch
//   fast-forwarded to the head would otherwise skip untested.
//
// Anything else, and any error, says not tested, and every job runs.
import { execFileSync } from 'node:child_process';

export const MAX_AGE_MINUTES = 60;
/** The GitHub Actions app, which reports the `gate` check (.github/rulesets/main.json). */
export const ACTIONS_APP = 15368;
export const WORKFLOW = '.github/workflows/guardrails.yml';
export const testedTreeArtifact = (tree) => `tested-tree-${tree}`;

/** A pull request run that tested this tree, from the artifacts named for it, or null. */
export function testedByPullRequest(artifacts, runs, { prHead, now, maxAgeMinutes = MAX_AGE_MINUTES }) {
  for (const artifact of [...artifacts].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
    if (artifact.expired || artifact.workflow_run?.head_sha !== prHead) continue;
    if (now - Date.parse(artifact.created_at) > maxAgeMinutes * 60_000) continue;
    const run = runs.get(artifact.workflow_run.id);
    if (run?.event === 'pull_request' && run.path === WORKFLOW) return run.html_url;
  }
  return null;
}

/** The green `gate` checks on a commit from the GitHub Actions app. */
export const greenGates = (checkRuns) =>
  checkRuns.filter((c) => c.name === 'gate' && c.app?.id === ACTIONS_APP && c.status === 'completed' && c.conclusion === 'success');

/** A green `gate` from a merge queue or push run of the commit itself, or null. `runs` maps a check suite to its workflow run. */
export function testedCommit(checkRuns, runs, sha) {
  for (const gate of greenGates(checkRuns)) {
    const run = runs.get(gate.check_suite?.id);
    if (run && ['merge_group', 'push'].includes(run.event) && run.head_sha === sha && run.path === WORKFLOW) return gate.details_url ?? run.html_url;
  }
  return null;
}

/** A GitHub REST client on the run's token. */
export function githubApi(env = process.env) {
  const base = env.GITHUB_API_URL ?? 'https://api.github.com';
  return async (path) => {
    const res = await fetch(`${base}${path}`, {
      headers: { authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' }
    });
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for ${path}`);
    return res.json();
  };
}

const git = (cwd, args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/**
 * `{ url, why }` when the run's commit already passed guardrails, else null.
 * `name` and `event` are the run's event; `repo` is owner/name.
 */
export async function alreadyTested({ name, event, repo, sha, cwd = process.cwd(), api = githubApi(), now = Date.now() }) {
  if (name === 'merge_group') {
    const head = event.merge_group.head_sha;
    const tree = git(cwd, ['rev-parse', `${head}^{tree}`]);
    // The entry's commit merges main (its first parent) with the pull request's head (its second).
    const prHead = git(cwd, ['rev-parse', `${head}^2`]);
    const { artifacts } = await api(`/repos/${repo}/actions/artifacts?name=${testedTreeArtifact(tree)}&per_page=20`);
    const runs = new Map();
    for (const id of new Set(artifacts.filter((a) => a.workflow_run?.head_sha === prHead).map((a) => a.workflow_run.id))) {
      runs.set(id, await api(`/repos/${repo}/actions/runs/${id}`));
    }
    const url = testedByPullRequest(artifacts, runs, { prHead, now });
    return url ? { url, why: `the pull request's own run tested this tree (main has not moved since)` } : null;
  }
  if (name === 'push') {
    const { check_runs } = await api(`/repos/${repo}/commits/${sha}/check-runs?check_name=gate&filter=all&per_page=50`);
    const runs = new Map();
    for (const suite of new Set(greenGates(check_runs).map((c) => c.check_suite?.id).filter(Boolean))) {
      const { workflow_runs } = await api(`/repos/${repo}/actions/runs?check_suite_id=${suite}`);
      if (workflow_runs[0]) runs.set(suite, workflow_runs[0]);
    }
    const url = testedCommit(check_runs, runs, sha);
    return url ? { url, why: 'the merge queue passed this commit before it reached the branch' } : null;
  }
  return null;
}
