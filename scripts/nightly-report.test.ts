import { describe, expect, it } from 'vitest';
import {
  apply,
  issuesOf,
  jobKey,
  jobOutcomes,
  lastVerdict,
  MANY,
  nightLine,
  nightNotice,
  plan,
  PREFIX,
  testsOf,
  turnComment,
  UI_RUN,
  uiBroke,
  uiOutcomes,
  withUrls
} from './nightly-report.mjs';

// The report exists so a red night is seen. These tests hold what keeps it
// worth reading: every failure is filed once and only once, a failure that
// persists stays quiet, a turn either way is said once, and one outage is one
// issue rather than dozens.

const SHA = 'abc1234def5678';
const URL = 'https://github.com/o/r/actions/runs/1';

type Issue = { id: string; identifier: string; title: string; stateType: string; createdAt: string; comments: string[] };

const issue = (key: string, over: Partial<Issue> = {}): Issue => ({
  id: `id-${key}`,
  identifier: 'LAN-1',
  title: `${PREFIX}${key}`,
  stateType: 'triage',
  createdAt: '2026-10-16T02:00:00Z',
  comments: [],
  ...over
});

function spec(title: string, status: string, project = 'phone', message = 'Error: expect(locator).toBeVisible() failed') {
  return {
    title,
    file: '03-home.spec.ts',
    line: 12,
    tests: [{ projectName: project, results: [{ status, error: status === 'passed' ? undefined : { message: `\x1b[31m${message}\x1b[39m` } }] }]
  };
}
const report = (...specs: ReturnType<typeof spec>[]) => ({ suites: [{ title: 'f', specs, suites: [] }] });

describe('reading a Playwright report', () => {
  it('keys each test by its title and project, and keeps the error without colour', () => {
    const [t] = testsOf(report(spec('NAV-095 The sync chip', 'failed', 'wide')));
    expect(t.key).toBe('NAV-095 The sync chip [wide]');
    expect(t.passed).toBe(false);
    expect(t.error).toBe('Error: expect(locator).toBeVisible() failed');
  });

  it('counts a test marked test.fail that failed as passed, and one that passed unexpectedly as failed', () => {
    const marked = (status: string) => ({
      title: 'JRN-005 known gap', file: '16.spec.ts', line: 1,
      tests: [{ projectName: 'wide', expectedStatus: 'failed', results: [{ status, error: status === 'failed' ? { message: 'Error: gap' } : undefined }] }]
    });
    expect(testsOf(report(marked('failed') as never))[0].passed).toBe(true);
    expect(testsOf(report(marked('passed') as never))[0].passed).toBe(false);
  });

  it('leaves out tests that did not run', () => {
    expect(testsOf(report(spec('A-1 skipped', 'skipped')))).toEqual([]);
  });

  it('finds tests in nested describe blocks', () => {
    const nested = { suites: [{ title: 'f', suites: [{ title: 'inner', specs: [spec('A-1 deep', 'passed')] }] }] };
    expect(testsOf(nested).map((t) => t.key)).toEqual(['A-1 deep [phone]']);
  });
});

describe('what a UI run says', () => {
  it('a failing test is an outcome with what failed and how to run it here', () => {
    const out = uiOutcomes(report(spec('NAV-095 The sync chip', 'failed')), 'failure', SHA, URL);
    expect(out).toHaveLength(1); // a few failing tests are not the run failing
    const [test] = out;
    expect(test).toMatchObject({ key: 'NAV-095 The sync chip [phone]', passed: false });
    expect(test.body).toContain('e2e/ui/03-home.spec.ts:12');
    expect(test.body).toContain('-g "NAV-095"');
    expect(test.body).toContain(URL);
  });

  it('a green run says the run and every test passed', () => {
    const out = uiOutcomes(report(spec('A-1 x', 'passed')), 'success', SHA, URL);
    expect(out).toEqual([{ key: UI_RUN, passed: true }, { key: 'A-1 x [phone]', passed: true }]);
  });

  it('more than MANY failures is one issue for the run, listing them, and none per test', () => {
    const specs = Array.from({ length: MANY + 1 }, (_, i) => spec(`T-${i} t`, 'failed', 'phone', 'TypeError: fetch failed'));
    const out = uiOutcomes(report(...specs), 'failure', SHA, URL);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ key: UI_RUN, passed: false });
    expect(out[0].body).toContain('TypeError: fetch failed');
    expect(out[0].body).toContain(`- T-${MANY} t [phone]`);
  });

  it('exactly MANY failures are still filed one by one', () => {
    const specs = Array.from({ length: MANY }, (_, i) => spec(`T-${i} t`, 'failed'));
    expect(uiOutcomes(report(...specs), 'failure', SHA, URL).filter((o) => !o.passed)).toHaveLength(MANY);
  });

  it('no report is the run failing', () => {
    expect(uiOutcomes(null, 'cancelled', SHA, URL)).toEqual([expect.objectContaining({ key: UI_RUN, passed: false })]);
  });

  it('a failed job whose tests all passed is the run failing, and the tests still count as passing', () => {
    const out = uiOutcomes(report(spec('A-1 x', 'passed')), 'failure', SHA, URL);
    expect(out[0]).toMatchObject({ key: UI_RUN, passed: false });
    expect(out[1]).toEqual({ key: 'A-1 x [phone]', passed: true });
  });

  it('another job is one outcome by its status', () => {
    expect(jobOutcomes('nightly-fleet', 'success', URL)).toEqual([{ key: jobKey('nightly-fleet'), passed: true, body: undefined }]);
    expect(jobOutcomes('nightly-fleet', 'failure', URL)[0]).toMatchObject({ passed: false });
  });
});

describe('what to tell Linear', () => {
  const failing = { key: 'A-1 x [phone]', passed: false, body: 'what failed' };
  const passing = { key: 'A-1 x [phone]', passed: true };

  it('a new failure opens an issue, unassigned, titled by what failed', () => {
    expect(plan([], [failing], SHA, URL)).toEqual([{ create: { title: `${PREFIX}A-1 x [phone]`, description: 'what failed' } }]);
  });

  it('a failure with its issue open says nothing more', () => {
    expect(plan([issue('A-1 x [phone]')], [failing], SHA, URL)).toEqual([]);
  });

  it('a pass on an open issue says so once, then stays quiet', () => {
    const open = issue('A-1 x [phone]');
    const [first] = plan([open], [passing], SHA, URL);
    expect(first).toEqual({ comment: { issue: open, body: turnComment('passed', SHA, URL) } });
    open.comments.push(first.comment!.body);
    expect(plan([open], [passing], SHA, URL)).toEqual([]);
  });

  it('failing again after passing says so on the same issue', () => {
    const open = issue('A-1 x [phone]', { comments: [turnComment('passed', 'old0000', URL)] });
    expect(plan([open], [failing], SHA, URL)).toEqual([{ comment: { issue: open, body: turnComment('failed', SHA, URL) } }]);
  });

  it('a pass with no open issue says nothing', () => {
    expect(plan([], [passing], SHA, URL)).toEqual([]);
  });

  it('a failure after its issue was closed opens a new one naming the old', () => {
    const closed = issue('A-1 x [phone]', { identifier: 'LAN-7', stateType: 'completed' });
    const [a] = plan([closed], [failing], SHA, URL);
    expect(a.create?.description).toBe('what failed\n\nIt failed before in LAN-7.');
  });

  it('of two open issues for one test, the newest hears', () => {
    const old = issue('A-1 x [phone]', { id: 'old', createdAt: '2026-10-01T00:00:00Z' });
    const recent = issue('A-1 x [phone]', { id: 'new', createdAt: '2026-10-10T00:00:00Z' });
    expect(plan([old, recent], [passing], SHA, URL)[0].comment?.issue.id).toBe('new');
  });

  it('the latest turn in the comments decides, whatever is said around it', () => {
    expect(lastVerdict([])).toBe('failed');
    expect(lastVerdict([turnComment('passed', SHA, URL), 'Looking at it', turnComment('failed', SHA, URL)])).toBe('failed');
    expect(lastVerdict([turnComment('failed', SHA, URL), 'Nightly passed, I think?'])).toBe('failed');
  });

  it('carries out a plan and says what it did', async () => {
    const done: string[] = [];
    const api = {
      create: async (title: string) => { done.push(`create ${title}`); return 'LAN-9'; },
      comment: async (id: string, body: string) => { done.push(`comment ${id} ${body}`); }
    };
    const open = issue('B-2 y [phone]');
    const lines = await apply(api, plan([open], [failing, { key: 'B-2 y [phone]', passed: true }], SHA, URL));
    expect(done).toEqual([`create ${PREFIX}A-1 x [phone]`, `comment ${open.id} ${turnComment('passed', SHA, URL)}`]);
    expect(lines).toEqual([`opened LAN-9: ${PREFIX}A-1 x [phone]`, 'LAN-1: Nightly passed']);
    expect(await apply(api, [])).toEqual(['nothing new to tell Linear']);
  });
});

describe('the line on the run (decision 209)', () => {
  it('says the counts, or that the suite broke, or how a job without counts ended, then each issue', () => {
    expect(nightLine({ ran: 682, passed: 680, broke: null, issues: [{ id: 'LAN-260', url: 'https://linear.app/t/issue/LAN-260/x' }, { id: 'LAN-261', url: null }] }))
      .toBe('680 of 682 passed\nLAN-260 https://linear.app/t/issue/LAN-260/x\nLAN-261');
    expect(nightLine({ ran: null, passed: null, broke: 'The job failed and left no report:\n  the suite did not run.', issues: [] }))
      .toBe('Broke: The job failed and left no report: the suite did not run.');
    expect(nightLine({ ran: null, passed: null, ok: true, broke: null })).toBe('Passed');
    expect(nightLine({ ran: null, passed: null, ok: false, broke: null, issues: [{ id: 'LAN-5', url: null }] })).toBe('Failed\nLAN-5');
  });

  it('is a notice GitHub reads as one annotation: a title with its colon escaped, and lines escaped', () => {
    expect(nightNotice('Web UI suite', { ran: 2, passed: 1, broke: null, issues: [{ id: 'LAN-1', url: null }] }))
      .toBe('::notice title=Nightly%3A Web UI suite::1 of 2 passed%0ALAN-1');
    expect(nightNotice('a, b', { ran: null, passed: null, broke: '100% down', issues: [] })).toBe('::notice title=Nightly%3A a%2C b::Broke: 100%25 down');
  });

  it('says a UI run broke for the same reasons it is filed as one issue', () => {
    const ok = testsOf(report(spec('A-1 x', 'passed')));
    const many = testsOf(report(...Array.from({ length: MANY + 1 }, (_, i) => spec(`F-${i} x`, 'failed'))));
    expect(uiBroke(ok, 'success')).toBeNull();
    expect(uiBroke(testsOf(report(spec('A-1 x', 'failed'))), 'failure')).toBeNull();
    expect(uiBroke(null, 'failure')).toMatch(/left no report/);
    expect(uiBroke(many, 'failure')).toBe(`${MANY + 1} tests failed, which is one cause rather than ${MANY + 1}.`);
    expect(uiBroke(ok, 'failure')).toMatch(/a step around the tests broke/);
  });

  it('names the issue of each failure: the one opened now, or the newest open one, once each', async () => {
    const failing = { key: 'A-1 x [phone]', passed: false, body: 'b' };
    const known = [issue('B-2 y [phone]', { identifier: 'LAN-3' }), issue('B-2 y [phone]', { identifier: 'LAN-4', createdAt: '2026-10-20T00:00:00Z' }),
      issue('C-3 z [phone]', { identifier: 'LAN-5', stateType: 'completed' })];
    const outcomes = [failing, { key: 'B-2 y [phone]', passed: false, body: 'b' }, { key: 'C-3 z [phone]', passed: false, body: 'b' }, { key: 'D-4 w [phone]', passed: true }];
    const created = new Map<string, string>();
    await apply({ create: async () => 'LAN-9', comment: async () => {} }, plan(known, outcomes, SHA, URL), created);
    expect(issuesOf(known, outcomes, created)).toEqual(['LAN-9', 'LAN-4']);
    expect(created.get(`${PREFIX}C-3 z [phone]`)).toBe('LAN-9');
    expect(await withUrls({ urlOf: async (id: string) => (id === 'LAN-9' ? 'https://linear.app/t/issue/LAN-9' : Promise.reject(new Error('no'))) }, ['LAN-9', 'LAN-4']))
      .toEqual([{ id: 'LAN-9', url: 'https://linear.app/t/issue/LAN-9' }, { id: 'LAN-4', url: null }]);
  });
});
