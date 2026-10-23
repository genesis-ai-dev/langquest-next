import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { jobNeeds, matches, pullRequestJobs, readRulesets, requiredContexts } from './github-rules.mjs';

/**
 * main takes a merge only when the guardrails `gate` job is green
 * (.github/rulesets/main.json, decisions.md 150), and `gate` passes only
 * when every needed job passed. GitHub waits forever for a required check
 * that no job reports, and a job that `gate` does not need could fail
 * without holding a merge, so every pull request job has to be in its needs.
 */

const guardrails = readFileSync('.github/workflows/guardrails.yml', 'utf8');
const main = readRulesets().find((r) => r.file === 'main.json')!.ruleset;

describe('the ruleset for main', () => {
  it('requires the gate job, which reports on every pull request', () => {
    expect(requiredContexts(main)).toEqual(['gate']);
    expect(pullRequestJobs(guardrails)).toContain('gate');
  });

  it('the gate job needs every other job that runs on a pull request', () => {
    const others = pullRequestJobs(guardrails).filter((j) => j !== 'gate');
    expect(jobNeeds(guardrails, 'gate'), "add the job to gate's needs in guardrails.yml").toEqual(others);
    expect(guardrails, 'gate must run whatever the jobs it needs did').toMatch(/^ {2}gate:\n(?: {4}#.*\n)*(?: {4}.*\n)*? {4}if: always\(\)$/m);
  });

  it('names a check that the GitHub Actions app reports', () => {
    for (const rule of main.rules.filter((r: { type: string }) => r.type === 'required_status_checks'))
      for (const check of rule.parameters.required_status_checks) expect(check.integration_id, check.context).toBe(15368);
  });

  it('merges through the queue, which runs the gate job too', () => {
    const queue = main.rules.find((r: { type: string }) => r.type === 'merge_queue');
    expect(queue?.parameters.merge_method, 'pull requests merge with a merge commit').toBe('MERGE');
    // GitHub waits for the required check on the queue's own commit; without this trigger nothing reports it.
    expect(guardrails).toMatch(/^on:\n(?: {2}.*\n|\s*\n)*? {2}merge_group:/m);
    expect(queue?.parameters.check_response_timeout_minutes).toBeGreaterThanOrEqual(30);
    // One merge per push to main, minutes apart: release-branches.yml handles only the pushed commit,
    // and its concurrency group keeps one waiting run, so a burst of pushes would skip a merge's copy.
    expect(queue?.parameters.max_entries_to_build).toBe(1);
    expect(queue?.parameters.max_entries_to_merge).toBe(1);
  });

  it('lets nobody merge past a red check', () => {
    expect(main.bypass_actors).toEqual([]);
    expect(main.enforcement).toBe('active');
    expect(main.conditions.ref_name.include).toEqual(['refs/heads/main']);
  });
});

describe('the workflow reader', () => {
  it('reads the jobs that run on a pull request', () => {
    expect(pullRequestJobs(guardrails)).toEqual(['scope', 'checks', 'unit', 'coverage', 'server', 'web-smoke', 'ui-web', 'gate']);
  });

  it('leaves out a nightly job and reads both shapes of needs', () => {
    const yml = "jobs:\n  a:\n    runs-on: x\n  b:\n    needs: a\n    runs-on: x\n  c:\n    if: github.event_name == 'schedule'\n    needs: [a, b]\n";
    expect(pullRequestJobs(yml)).toEqual(['a', 'b']);
    expect(jobNeeds(yml, 'b')).toEqual(['a']);
    expect(jobNeeds(yml, 'c')).toEqual(['a', 'b']);
  });
});

describe('matching a ruleset on GitHub', () => {
  it('ignores what GitHub adds and sees any value that differs', () => {
    expect(matches({ a: 1, b: [{ c: 2 }] }, { a: 1, id: 9, b: [{ c: 2, d: 3 }] })).toBe(true);
    expect(matches({ a: 1, b: [{ c: 2 }] }, { a: 1, b: [{ c: 3 }] })).toBe(false);
    expect(matches({ b: [1, 2] }, { b: [1] })).toBe(false);
  });
});
