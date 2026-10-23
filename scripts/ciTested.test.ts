import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ACTIONS_APP, alreadyTested, MAX_AGE_MINUTES, testedByPullRequest, testedCommit, testedTreeArtifact, WORKFLOW } from './ci-tested.mjs';

/**
 * A guardrails run skips its jobs when its commit already passed
 * (scripts/ci-tested.mjs, decisions.md 164). Saying "tested" wrongly lets an
 * untested change into main, so each case asks for the exact evidence: the
 * same tree from the pull request's own run, or a green gate from a merge
 * queue or push run of the same commit. Anything less runs every job.
 */

const NOW = Date.parse('2026-10-23T16:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const prRun = (id: number, over: object = {}) => [id, { id, event: 'pull_request', path: WORKFLOW, html_url: `run/${id}`, ...over }] as const;
const artifact = (runId: number, headSha: string, over: object = {}) =>
  ({ name: testedTreeArtifact('t'), expired: false, created_at: minutesAgo(10), workflow_run: { id: runId, head_sha: headSha }, ...over });

describe('the merge queue takes the pull request run that tested its tree', () => {
  it('takes a recent green pull request run of guardrails with the same head', () => {
    expect(testedByPullRequest([artifact(1, 'head')], new Map([prRun(1)]), { prHead: 'head', now: NOW })).toBe('run/1');
  });

  it('not one for another head, which could be any branch with the same files plus a broken workflow', () => {
    expect(testedByPullRequest([artifact(1, 'other')], new Map([prRun(1)]), { prHead: 'head', now: NOW })).toBeNull();
  });

  it('not one older than the limit, since some checks read the store builds outside the tree', () => {
    const old = artifact(1, 'head', { created_at: minutesAgo(MAX_AGE_MINUTES + 1) });
    expect(testedByPullRequest([old], new Map([prRun(1)]), { prHead: 'head', now: NOW })).toBeNull();
  });

  it('not an expired one, nor one from another event or workflow', () => {
    expect(testedByPullRequest([artifact(1, 'head', { expired: true })], new Map([prRun(1)]), { prHead: 'head', now: NOW })).toBeNull();
    expect(testedByPullRequest([artifact(1, 'head')], new Map([prRun(1, { event: 'push' })]), { prHead: 'head', now: NOW })).toBeNull();
    expect(testedByPullRequest([artifact(1, 'head')], new Map([prRun(1, { path: '.github/workflows/other.yml' })]), { prHead: 'head', now: NOW })).toBeNull();
    expect(testedByPullRequest([artifact(1, 'head')], new Map(), { prHead: 'head', now: NOW })).toBeNull();
  });

  it('takes the newest when there are several', () => {
    const artifacts = [artifact(1, 'head', { created_at: minutesAgo(30) }), artifact(2, 'head', { created_at: minutesAgo(5) })];
    expect(testedByPullRequest(artifacts, new Map([prRun(1), prRun(2)]), { prHead: 'head', now: NOW })).toBe('run/2');
  });
});

describe('a push takes the merge queue run of the same commit', () => {
  const gate = (suite: number, over: object = {}) =>
    ({ name: 'gate', status: 'completed', conclusion: 'success', app: { id: ACTIONS_APP }, check_suite: { id: suite }, details_url: `job/${suite}`, ...over });
  const run = (suite: number, event: string, head = 'sha') => [suite, { event, head_sha: head, path: WORKFLOW, html_url: `run/${suite}` }] as const;

  it('takes a green gate from a merge queue or push run of this commit', () => {
    expect(testedCommit([gate(1)], new Map([run(1, 'merge_group')]), 'sha')).toBe('job/1');
    expect(testedCommit([gate(1)], new Map([run(1, 'push')]), 'sha')).toBe('job/1');
  });

  it("not a pull request run's gate: it sits on the head but tested the head merged with main", () => {
    expect(testedCommit([gate(1)], new Map([run(1, 'pull_request')]), 'sha')).toBeNull();
  });

  it('not a gate that failed, is still running, came from another app or another commit', () => {
    expect(testedCommit([gate(1, { conclusion: 'failure' })], new Map([run(1, 'merge_group')]), 'sha')).toBeNull();
    expect(testedCommit([gate(1, { status: 'in_progress', conclusion: null })], new Map([run(1, 'merge_group')]), 'sha')).toBeNull();
    expect(testedCommit([gate(1, { app: { id: 1 } })], new Map([run(1, 'merge_group')]), 'sha')).toBeNull();
    expect(testedCommit([gate(1)], new Map([run(1, 'merge_group', 'other')]), 'sha')).toBeNull();
  });
});

describe('asking GitHub', () => {
  // A repository with main, a pull request's head and the merge queue's commit of the two.
  const dir = mkdtempSync(join(tmpdir(), 'ci-tested-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.org', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q');
  writeFileSync(join(dir, 'a'), '1');
  git('add', 'a');
  git('commit', '-qm', 'main');
  git('checkout', '-qb', 'pr');
  writeFileSync(join(dir, 'b'), '2');
  git('add', 'b');
  git('commit', '-qm', 'pr');
  const prHead = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main');
  git('merge', '-q', '--no-ff', '-m', 'Merge pull request', 'pr');
  const entry = git('rev-parse', 'HEAD');
  const tree = git('rev-parse', 'HEAD^{tree}');

  it('a merge queue entry looks for the artifact named for its tree, from its pull request head', async () => {
    const asked: string[] = [];
    const api = async (path: string) => {
      asked.push(path);
      if (path.includes('/actions/artifacts')) return { artifacts: [artifact(7, prHead)] };
      return prRun(7)[1];
    };
    const tested = await alreadyTested({ name: 'merge_group', event: { merge_group: { head_sha: entry } }, repo: 'o/r', sha: entry, cwd: dir, api, now: NOW });
    expect(tested?.url).toBe('run/7');
    expect(asked[0]).toBe(`/repos/o/r/actions/artifacts?name=tested-tree-${tree}&per_page=20`);
  });

  it('a pull request, the nightly and a manual run are never taken as tested', async () => {
    const api = async () => { throw new Error('not asked'); };
    for (const name of ['pull_request', 'schedule', 'workflow_dispatch'])
      expect(await alreadyTested({ name, event: {}, repo: 'o/r', sha: entry, cwd: dir, api, now: NOW })).toBeNull();
  });
});
