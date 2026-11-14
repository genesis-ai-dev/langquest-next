import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { nightNotice } from '../../../scripts/nightly-report.mjs';
import { phoneNights } from '../../../scripts/phone-tests.mjs';
import { NIGHTLIES, nightlyAlerts, nightlySection, parseLine, STALE_H, type Nightly } from '../src/sources/nightly';

// Last night's tests on the ops dashboard (decisions.md 209). These hold the
// line between the reporters that write it and the page that reads it, and
// what is loud: a failed test is a watch, a suite that broke or a nightly that
// stopped is a problem.

const NOW = Date.parse('2026-11-13T12:00:00Z');
const hAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

/** A notice as GitHub keeps it: the workflow command's title and message, unescaped. */
function annotation(notice: string) {
  const m = /^::notice title=([^:]*)::(.*)$/s.exec(notice)!;
  const unescape = (s: string) => s.replace(/%0A/g, '\n').replace(/%0D/g, '\r').replace(/%3A/g, ':').replace(/%2C/g, ',').replace(/%25/g, '%');
  return { title: unescape(m[1]!), message: unescape(m[2]!), annotation_level: 'notice' };
}

/** A fetch that answers by URL substring, in order of the routes given. */
function routes(table: [string, unknown][]): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const hit = table.find(([part]) => String(input).includes(part));
    return hit ? Response.json(hit[1]) : new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('the line each nightly suite leaves', () => {
  it('reads back what the reporter writes: counts, a broken suite, a job without counts, and each issue', () => {
    const line = (suite: string, night: object) => { const a = annotation(nightNotice(suite, night)); return parseLine(a.title, a.message); };
    expect(line('Web UI suite', { ran: 682, passed: 680, broke: null, issues: [{ id: 'LAN-260', url: 'https://linear.app/t/issue/LAN-260/x' }, { id: 'LAN-261', url: null }] }))
      .toEqual({ suite: 'Web UI suite', ran: 682, passed: 680, failed: true, broke: null, issues: [{ id: 'LAN-260', url: 'https://linear.app/t/issue/LAN-260/x' }, { id: 'LAN-261', url: null }] });
    expect(line('Web UI suite', { ran: null, passed: null, broke: '16 tests failed, which is one cause: 100%, it seems.', issues: [{ id: 'LAN-7', url: null }] }))
      .toMatchObject({ failed: true, broke: '16 tests failed, which is one cause: 100%, it seems.', issues: [{ id: 'LAN-7' }] });
    expect(line('Fleet simulation', { ran: null, passed: null, ok: true, broke: null })).toMatchObject({ ran: null, failed: false, broke: null });
    expect(line('Mutation tests on core', { ran: null, passed: null, ok: false, broke: null })).toMatchObject({ failed: true, broke: null });
  });

  it("reads each phone's line as the phone reporter writes it", () => {
    const summary = { platforms: [{ platform: 'android', status: 'failure', broke: null, ran: 3, passed: 2, failed: 1,
      flows: [{ name: 'REC-020', passed: false, issue: 'LAN-401', issueUrl: 'https://linear.app/t/issue/LAN-401' }, { name: 'SYNC-015', passed: true }] }] };
    const [n] = phoneNights(summary);
    const a = annotation(nightNotice(n!.suite, n!.night));
    expect(parseLine(a.title, a.message)).toEqual({ suite: 'Android emulator flows', ran: 3, passed: 2, failed: true, broke: null, issues: [{ id: 'LAN-401', url: 'https://linear.app/t/issue/LAN-401' }] });
  });

  it('leaves out every other annotation, and an address that is not Linear\'s', () => {
    expect(parseLine('Needs you: Gemini credit', 'x')).toBeNull();
    expect(parseLine(null, 'Node.js 20 actions are deprecated.')).toBeNull();
    expect(parseLine('Nightly: Web UI suite', 'something else')).toBeNull();
    expect(parseLine('Nightly: Web UI suite', '1 of 2 passed\nLAN-1 javascript:alert(1)')!.issues).toEqual([{ id: 'LAN-1', url: null }]);
  });

  it('names jobs that exist in their workflows, and each calls a reporter that leaves the line', () => {
    for (const n of NIGHTLIES) {
      const text = readFileSync(`.github/workflows/${n.workflow}`, 'utf8');
      expect(text, n.workflow).toMatch(/^\s+schedule:\s*$/m);
      const jobs = text.split(/\n(?=  [a-z][a-z0-9-]*:\n)/);
      for (const name of n.jobs) {
        const job = jobs.find((j) => new RegExp(`^  ${name}:\\n|^    name: ${name}$`, 'm').test(j));
        expect(job, `${n.workflow} ${name}`).toBeTruthy();
        expect(job, `${n.workflow} ${name}`).toMatch(/scripts\/nightly-report\.mjs (ui|job)|scripts\/phone-tests\.mjs notices/);
      }
    }
  });
});

describe('the Nightly tests part', () => {
  const run = (over: Partial<Nightly['runs'][number]> = {}): Nightly['runs'][number] => ({
    workflow: 'guardrails.yml', title: 'Guardrails nightly', run: { number: 9, url: 'https://github.com/o/r/actions/runs/9', at: hAgo(10), sha: 'abcdef12', conclusion: 'failure' }, suites: [], ...over
  });
  const suite = { suite: 'Web UI suite', ran: 682, passed: 682, failed: false, broke: null, issues: [] };

  it('is quiet when every suite passed', () => {
    expect(nightlyAlerts({ repo: 'o/r', runs: [run({ suites: [suite, { ...suite, suite: 'Fleet simulation', ran: null, passed: null }] })] }, NOW)).toEqual([]);
  });

  it('calls failed tests a watch, with their issues, linked to the first', () => {
    const failed = { ...suite, passed: 680, failed: true, issues: [{ id: 'LAN-260', url: 'https://linear.app/t/issue/LAN-260' }, { id: 'LAN-261', url: null }] };
    expect(nightlyAlerts({ repo: 'o/r', runs: [run({ suites: [failed] })] }, NOW))
      .toEqual([{ level: 'watch', text: 'Nightly Web UI suite: 2 of 682 failed (LAN-260, LAN-261).', link: 'https://linear.app/t/issue/LAN-260' }]);
  });

  it('calls a suite that broke, or a nightly that stopped running, a problem', () => {
    const broke = { ...suite, ran: null, passed: null, failed: true, broke: 'The job failed and left no report.' };
    const alerts = nightlyAlerts({ repo: 'o/r', runs: [run({ suites: [broke] }), run({ workflow: 'phone-tests.yml', title: 'Phone tests', run: { ...run().run!, at: hAgo(STALE_H + 1) } })] }, NOW);
    expect(alerts).toEqual([
      { level: 'problem', text: 'Nightly Web UI suite broke: The job failed and left no report.', link: 'https://github.com/o/r/actions/runs/9' },
      { level: 'problem', text: `The Phone tests last ran on its schedule ${STALE_H + 1} h ago: the schedule may have stopped.`, link: 'https://github.com/o/r/actions/workflows/phone-tests.yml' }
    ]);
  });

  it("reads each nightly's latest scheduled run, its reporting jobs' lines, and a job that left none", async () => {
    const ui = annotation(nightNotice('Web UI suite', { ran: 682, passed: 680, broke: null, issues: [{ id: 'LAN-260', url: null }] }));
    const fetcher = routes([
      ['/actions/workflows/guardrails.yml/runs', { workflow_runs: [{ id: 9, head_sha: 'abcdef1234', created_at: hAgo(10), html_url: 'https://github.com/o/r/actions/runs/9', run_number: 9, conclusion: 'failure' }] }],
      ['/actions/workflows/phone-tests.yml/runs', { workflow_runs: [] }],
      ['/actions/runs/9/jobs', { jobs: [
        { id: 1, name: 'nightly-ui-web', conclusion: 'failure', status: 'completed' },
        { id: 2, name: 'nightly-fleet', conclusion: 'failure', status: 'completed' },
        { id: 3, name: 'nightly-mutation', conclusion: 'success', status: 'completed' },
        { id: 4, name: 'checks', conclusion: 'success', status: 'completed' }
      ] }],
      ['/check-runs/1/annotations', [{ title: '', message: 'Process completed with exit code 1.', annotation_level: 'failure' }, ui]],
      ['/check-runs/2/annotations', []],
      ['/check-runs/3/annotations', []]
    ]);
    // The section reads the clock, so the run's age is from NOW and not from today.
    vi.useFakeTimers({ toFake: ['Date'], now: NOW });
    const s = await nightlySection({ GITHUB_REPO: 'o/r' }, fetcher).finally(() => vi.useRealTimers());
    const d = s.data as Nightly;
    expect(String(vi.mocked(fetcher).mock.calls[0]![0])).toContain('branch=main&event=schedule&status=completed');
    expect(d.runs.map((r) => [r.workflow, r.run?.number ?? null])).toEqual([['guardrails.yml', 9], ['phone-tests.yml', null]]);
    expect(d.runs[0]!.suites).toEqual([
      { suite: 'Web UI suite', ran: 682, passed: 680, failed: true, broke: null, issues: [{ id: 'LAN-260', url: null }] },
      { suite: 'nightly-fleet job', ran: null, passed: null, failed: true, broke: 'the job failed and left no line for this page.', issues: [] },
      { suite: 'nightly-mutation job', ran: null, passed: null, failed: false, broke: null, issues: [] }
    ]);
    expect(s.alerts.map((a) => a.level)).toEqual(['problem', 'watch']);
    expect(vi.mocked(fetcher).mock.calls.some(([u]) => String(u).includes('/check-runs/4/'))).toBe(false);
  });
});
