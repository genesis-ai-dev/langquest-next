import { readFileSync } from 'node:fs';
import { apply, cleanDecisions, cleanWhy, commentFor, FIXED_PER_PR, mark, mergesOf, openForCheck, targetFor } from './merge-issues.mjs';

// The check after each merge closes issues in Linear that no commit named
// (docs/decisions/2026-11-24-a-merge-closes-the-issues-it-fixes.md). These
// tests hold what keeps it from closing the wrong ones: only an open issue of
// the list made before Claude, only a merge of the run, a reason each time, no
// flood of fixes from one pull request, and never twice for the same one.

const merge = (pr: number, files: string[] = ['apps/web/worker/x.ts']) => ({ pr, sha: `${pr}`.padEnd(40, 'a'), mergedAt: '2026-11-24T01:00:00Z', title: `Title ${pr}`, files });
const open = (issue: string) => ({ issue, title: 't', state: 'Backlog', labels: [], createdAt: '2026-11-01T00:00:00Z', description: '', prs: [] });
const WHY = 'The change removes the retry loop that sent each file twice.';

describe('the merges of a push', () => {
  it('reads each pull request from main\'s merge commits, and skips other merges', () => {
    const log = [
      `${'a'.repeat(40)}\x1f2026-11-24T01:00:00Z\x1fMerge pull request #674 from genesis-ai-dev/claude/x\x1fOps dashboard: a Resolved button\n\nmore\x1e`,
      `${'b'.repeat(40)}\x1f2026-11-24T00:00:00Z\x1fMerge branch 'main' into y\x1f\x1e`
    ].join('\n');
    expect(mergesOf(log)).toEqual([{ pr: 674, sha: 'a'.repeat(40), mergedAt: '2026-11-24T01:00:00Z', title: 'Ops dashboard: a Resolved button' }]);
  });
});

describe('the open issues Claude judges', () => {
  it('leaves out issues already merged, issues another thread holds, and ids of other teams', () => {
    const issues = [
      { identifier: 'LAN-1', title: 'a', description: 'x'.repeat(5000), state: 'Backlog', labels: ['User issue'], createdAt: 'c', links: ['https://github.com/o/r/pull/12', 'https://linear.app/x'] },
      { identifier: 'LAN-2', title: 'b', state: 'Deploying', createdAt: 'c' },
      { identifier: 'LAN-3', title: 'c', state: 'Todo', createdAt: 'c' },
      { identifier: 'OTHER-4', title: 'd', state: 'Todo', createdAt: 'c' }
    ];
    const got = openForCheck(issues, ['LAN-3']);
    expect(got.map((i) => i.issue)).toEqual(['LAN-1']);
    expect(got[0]!.description.length).toBe(1500);
    expect(got[0]!.prs).toEqual([12]);
  });
});

describe('Claude\'s decisions', () => {
  const issues = [open('LAN-1'), open('LAN-2'), open('LAN-3')];
  it('keep only open issues of the copy, merges of the run, a verdict and a reason', () => {
    const { decisions, refused } = cleanDecisions({ decisions: [
      { issue: 'LAN-1', pr: 674, verdict: 'fixed', why: WHY },
      { issue: 'LAN-9', pr: 674, verdict: 'fixed', why: WHY },
      { issue: 'LAN-2', pr: 600, verdict: 'fixed', why: WHY },
      { issue: 'LAN-3', pr: 674, verdict: 'maybe', why: WHY },
      { issue: 'lan-2', pr: 674, verdict: 'part', why: 'short' }
    ] }, issues, [merge(674)]);
    expect(decisions).toEqual([{ issue: 'LAN-1', pr: 674, verdict: 'fixed', why: WHY }]);
    expect(refused).toHaveLength(4);
  });

  it('keep one per issue: a fix over a part, then the newest pull request', () => {
    const { decisions } = cleanDecisions({ decisions: [
      { issue: 'LAN-1', pr: 675, verdict: 'part', why: WHY },
      { issue: 'LAN-1', pr: 674, verdict: 'fixed', why: WHY },
      { issue: 'LAN-2', pr: 674, verdict: 'part', why: WHY },
      { issue: 'LAN-2', pr: 675, verdict: 'part', why: WHY }
    ] }, issues, [merge(674), merge(675)]);
    expect(decisions.map((d) => `${d.issue}:${d.pr}:${d.verdict}`)).toEqual(['LAN-1:674:fixed', 'LAN-2:675:part']);
  });

  it('apply no fix of a pull request that claims too many', () => {
    const many = Array.from({ length: FIXED_PER_PR + 1 }, (_, n) => open(`LAN-${n + 10}`));
    const { decisions, refused } = cleanDecisions({ decisions: many.map((i) => ({ issue: i.issue, pr: 674, verdict: 'fixed', why: WHY })) }, many, [merge(674)]);
    expect(decisions).toEqual([]);
    expect(refused.at(-1)).toMatch(/claims 9 fixes/);
  });

  it('carry no address or link in a reason', () => {
    expect(cleanWhy('See https://example.com/x and ask someone@example.com about the retry loop.')).toBe('See and ask about the retry loop.');
    expect(cleanWhy(42)).toBeNull();
  });
});

describe('what Linear hears', () => {
  it('a fix moves like a named one: Deploying with the lanes the merge reaches, or Live; the sweep\'s are Live', () => {
    const head = 'c'.repeat(40);
    expect(targetFor(['apps/mobile/src/a.ts'], head, false)).toEqual({ state: 'Deploying', line: `Deploying ccccccc · lanes: ios, android` });
    expect(targetFor(['apps/web/worker/a.ts'], head, false).state).toBe('Live');
    expect(targetFor(['apps/mobile/src/a.ts'], head, true).state).toBe('Live');
  });

  it('each comment names the pull request and carries the mark', () => {
    const body = commentFor({ issue: 'LAN-1', pr: 674, verdict: 'part', why: WHY }, merge(674), 'o/r');
    expect(body).toContain('Part of the work: [PR 674](https://github.com/o/r/pull/674)');
    expect(body).not.toContain('#674');
    expect(body).toContain(mark(674));
  });

  type Issue = { id: string; identifier: string; state: string; comments: string[] };
  const fake = (issues: Issue[]) => {
    const calls: string[] = [];
    return {
      calls,
      getIssue: async (id: string) => issues.find((i) => i.identifier === id) ?? null,
      comment: async (id: string, body: string) => { calls.push(`comment ${id}`); issues.find((i) => i.id === id)!.comments.push(body); },
      setState: async (issue: Issue, name: string) => { calls.push(`move ${issue.identifier} ${name}`); },
      link: async (id: string, url: string) => { calls.push(`link ${id} ${url}`); }
    };
  };

  it('moves a fixed issue, comments on a part, and never tells an issue twice about one pull request', async () => {
    const api = fake([
      { id: 'LAN-1', identifier: 'LAN-1', state: 'Backlog', comments: [] },
      { id: 'LAN-2', identifier: 'LAN-2', state: 'Todo', comments: [] },
      { id: 'LAN-3', identifier: 'LAN-3', state: 'Todo', comments: [`${mark(674)} · fixed`] }
    ]);
    const lines = await apply(api, [
      { issue: 'LAN-1', pr: 674, verdict: 'fixed', why: WHY },
      { issue: 'LAN-2', pr: 674, verdict: 'part', why: WHY },
      { issue: 'LAN-3', pr: 674, verdict: 'fixed', why: WHY }
    ], [merge(674, ['apps/mobile/src/a.ts'])], { head: 'd'.repeat(40), sweep: false, repo: 'o/r' });
    expect(lines).toEqual(['LAN-1 Backlog → Deploying (fixed by PR 674)', 'LAN-2 part of PR 674', 'LAN-3 already heard of PR 674']);
    expect(api.calls).toEqual(['link LAN-1 https://github.com/o/r/pull/674', 'comment LAN-1', 'move LAN-1 Deploying', 'comment LAN-2']);
  });
});

describe('the workflow', () => {
  const yml = readFileSync(new URL('../.github/workflows/linear-sync.yml', import.meta.url), 'utf8');
  it('checks each merge with the agent team\'s token, after the named issues moved, and applies from the copy made before Claude', () => {
    expect(yml).toContain('needs: deploying');
    expect(yml).toContain('secrets.AGENT_TEAM_CLAUDE_TOKEN');
    expect(yml.indexOf('cp scripts/merge-issues.mjs scripts/linear-sync.mjs')).toBeGreaterThan(-1);
    expect(yml.indexOf('cp scripts/merge-issues.mjs scripts/linear-sync.mjs')).toBeLessThan(yml.indexOf('anthropics/claude-code-action'));
    expect(yml).toContain('--from-copy');
    expect(readFileSync(new URL('../.agents/skills/merge-issues/SKILL.md', import.meta.url), 'utf8')).toContain('.merge-issues/decisions.json');
  });
});
