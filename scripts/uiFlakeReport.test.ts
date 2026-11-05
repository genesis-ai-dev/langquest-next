import { describe, expect, it } from 'vitest';
import { MANY, PREFIX } from './nightly-report.mjs';
import { below, tally } from './ui-flakes.mjs';
import { collect, flakeActions, listBody, listed, recentRuns, reportArtifacts, UI_FLAKES } from './ui-flake-report.mjs';

// The tracker exists so a test that fails now and then is seen without anyone
// downloading reports by hand. What these hold: only runs worth counting are
// counted, one outage is not many flakes, a flake is filed once and said again
// only when the list changes.

const SHA = 'abc1234def5678';
const URL = 'https://github.com/o/r/actions/runs/9';
const window = { reports: 12, runs: 6, threshold: 0.95, min: 5 };

const spec = (title: string, status: string) => ({
  title,
  file: '03-home.spec.ts',
  line: 1,
  tests: [{ projectName: 'phone', results: [{ status, duration: 1, error: status === 'passed' ? undefined : { message: 'boom' } }] }]
});
const report = (...specs: ReturnType<typeof spec>[]) => ({ suites: [{ title: 'f', file: '03-home.spec.ts', specs, suites: [] }] });

describe('which runs are counted', () => {
  const run = (id: number, event: string, conclusion: string) => ({ id, event, conclusion });
  const pages = [
    { workflow_runs: [run(1, 'pull_request', 'success'), run(2, 'schedule', 'failure'), run(3, 'push', 'cancelled'), run(4, 'push', 'failure')] },
    { workflow_runs: [run(5, 'pull_request', 'success'), run(6, 'workflow_dispatch', 'success'), run(7, 'merge_group', 'failure')] },
    { workflow_runs: [] }
  ];
  const get = async (path: string) => pages[Number(/&page=(\d+)/.exec(path)![1]) - 1];

  it('takes pull request, merge queue and push runs that succeeded or failed, newest first', async () => {
    expect((await recentRuns(get, 'o/r', 10)).map((r: { id: number }) => r.id)).toEqual([1, 4, 5, 7]);
  });

  it('stops at the number asked for', async () => {
    expect((await recentRuns(get, 'o/r', 2)).map((r: { id: number }) => r.id)).toEqual([1, 4]);
  });

  it('takes only the ui-web report artifacts that have not expired', async () => {
    const artifacts = [
      { name: 'ui-web-p0-results-1', expired: false },
      { name: 'ui-web-p0-results-2', expired: true },
      { name: 'coverage', expired: false },
      { name: 'ui-web-nightly-results', expired: false }
    ];
    expect((await reportArtifacts(async () => ({ artifacts }), 'o/r', 1)).map((a: { name: string }) => a.name)).toEqual(['ui-web-p0-results-1']);
  });
});

describe('collecting the reports', () => {
  it('leaves out a report in which more tests failed than one cause explains', async () => {
    const many = report(...Array.from({ length: MANY + 1 }, (_, i) => spec(`A-${i} t`, 'failed')));
    const fine = report(spec('B-1 ok', 'passed'));
    const get = async (path: string) => ({ artifacts: [{ name: path.includes('/runs/1/') ? 'ui-web-p0-results-1' : 'ui-web-p0-results-2', expired: false }] });
    const download = async (a: { name: string }) => (a.name.endsWith('-1') ? many : fine);
    const { reports, broken } = await collect({ get, download, repo: 'o/r', runs: [{ id: 1 }, { id: 2 }] });
    expect(broken).toBe(1);
    expect(reports).toHaveLength(1);
  });

  it('skips an artifact with no report in it', async () => {
    const get = async () => ({ artifacts: [{ name: 'ui-web-p0-results-1', expired: false }] });
    const { reports } = await collect({ get, download: async () => null, repo: 'o/r', runs: [{ id: 1 }] });
    expect(reports).toEqual([]);
  });
});

describe('pass rates', () => {
  const runs = (flaky: number, total: number) =>
    Array.from({ length: total }, (_, i) => ({ name: `r${i}`, report: report(spec('A-1 flaky', i < flaky ? 'failed' : 'passed'), spec('B-1 steady', 'passed')) }));

  it('lists the tests under the threshold that were seen often enough', () => {
    const rows = below(tally(runs(2, 10)), { min: 5, threshold: 0.95 });
    expect(rows.map((r: { title: string }) => r.title)).toEqual(['03-home.spec.ts › A-1 flaky [phone]']);
    expect(rows[0].passed).toBe(8);
  });

  it('does not list a test seen too few times, or one above the threshold', () => {
    expect(below(tally(runs(1, 4)), { min: 5, threshold: 0.95 })).toEqual([]);
    expect(below(tally(runs(1, 40)), { min: 5, threshold: 0.95 })).toEqual([]);
  });
});

describe('what goes to Linear', () => {
  const rows = [
    { title: 'f › A-1 flaky [phone]', rate: 0.8, runs: 10, passed: 8, failed: [] },
    { title: 'f › B-2 other [phone]', rate: 0.9, runs: 10, passed: 9, failed: [] }
  ];
  const open = (comments: string[] = [], description = '') => ({
    id: 'id-1', identifier: 'LAN-9', title: `${PREFIX}${UI_FLAKES}`, stateType: 'triage', createdAt: '2026-10-19T02:00:00Z', description, comments
  });

  it('opens one issue naming every flaky test', () => {
    const [a] = flakeActions([], rows, window, SHA, URL);
    expect(a.create.title).toBe(`${PREFIX}${UI_FLAKES}`);
    expect(listed(a.create.description)).toEqual(['f › A-1 flaky [phone]', 'f › B-2 other [phone]']);
  });

  it('files nothing when no test is under the threshold and no issue is open', () => {
    expect(flakeActions([], [], window, SHA, URL)).toEqual([]);
  });

  it('says nothing when the list is the one already said, in the description or a comment', () => {
    const said = listBody(rows, window, SHA, URL);
    expect(flakeActions([open([], said)], rows, window, SHA, URL)).toEqual([]);
    expect(flakeActions([open([`Flaky tests changed · x · y\n\n${said}`], 'old')], rows, window, SHA, URL)).toEqual([]);
  });

  it('lists the tests again, once, when the list changes', () => {
    const said = listBody(rows, window, SHA, URL);
    const [a, ...more] = flakeActions([open([], said)], rows.slice(0, 1), window, SHA, URL);
    expect(more).toEqual([]);
    expect(a.comment.body).toMatch(/^Flaky tests changed · abc1234 · /);
    expect(listed(a.comment.body)).toEqual(['f › A-1 flaky [phone]']);
  });

  it('says so when the flakes are gone, and again when they come back', () => {
    const said = listBody(rows, window, SHA, URL);
    const [gone] = flakeActions([open([], said)], [], window, SHA, URL);
    expect(gone.comment.body).toMatch(/^Nightly passed · /);
    const cleared = open([gone.comment.body]);
    const [back, list] = flakeActions([cleared], rows, window, SHA, URL);
    expect(back.comment.body).toMatch(/^Nightly failed · /);
    expect(listed(list.comment.body)).toHaveLength(2);
  });
});
