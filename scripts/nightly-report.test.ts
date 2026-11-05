import { describe, expect, it } from 'vitest';
import {
  apply,
  jobKey,
  jobOutcomes,
  lastVerdict,
  MANY,
  plan,
  PREFIX,
  testsOf,
  turnComment,
  UI_RUN,
  uiOutcomes
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
