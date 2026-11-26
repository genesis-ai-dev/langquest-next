import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import { alertId, intervalMinutes, KINDS, lineIssues, settleMinutes, watchKeyOf, watchLines, WATCH_LINES_MAX, WORKFLOW_RECHECK, type AlertKind } from '../src/alertKinds';
import { page } from '../src/page';
import { FIX_LOGIC } from '../src/pageFixes';
import { GROUPS } from '../src/pageOps';
import { fixesSection, fixPrs, FIX_DAYS, namedIssues } from '../src/sources/fixes';

// Each line of the ops dashboard, its Linear issue, its fix and when it
// should clear (docs/decisions/2026-11-17-each-ops-line-has-a-linear-issue.md).

type Row = { key: string; verdict: string; issue: string | null; issueUrl?: string | null; state?: string | null; closedAt?: string | null; fixedBy?: number | null; fixedAt?: string | null; lookedAt?: string };
type Fix = { state: string; key: string; issues: string[]; at?: number; from?: number; pr?: { number: number | null }; phones: boolean; fixed?: number; each?: (Fix & { issue: string })[] };
type Line = { key: string; level?: string; subject?: string; watchKey?: string; issues?: string[]; recheck?: Record<string, unknown> };

/** The page's own logic, as it runs there (pageFixes.ts FIX_LOGIC). */
const logic = new Function(`${FIX_LOGIC}; return { lineId, watchKeyOf, nextCheck, clearsAt, rowFor, lineFix, keyKind, resolvedLines, withLiveLines };`)() as {
  lineId: (a: Line) => string;
  watchKeyOf: (a: Line) => string;
  nextCheck: (r: Record<string, unknown>, t: number) => number;
  clearsAt: (r: Record<string, unknown>, merged: number) => number;
  lineFix: (a: Line, kinds: Record<string, AlertKind>, ud: unknown, prs: unknown[], now: number) => Fix;
  keyKind: (key: string, kinds: Record<string, AlertKind>) => { part: string; title: string; subject: string } | null;
  resolvedLines: (ud: unknown, now: Set<string>, answered: (p: string) => boolean, kinds: Record<string, AlertKind>, at: number) => { key: string; issue: string; closed: boolean }[];
  withLiveLines: (ud: unknown, lines: Line[], kinds: Record<string, AlertKind>, prs: unknown[], now: number) => { issues: Record<string, unknown>[]; fixes?: Record<string, { at: string }> };
};

const H = 3_600_000, M = 60_000;
const NOW = Date.parse('2026-11-17T21:00:00Z');
const at = (iso: string) => Date.parse(iso);
const kinds = KINDS as Record<string, AlertKind>;
const pr = (number: number, state: 'open' | 'merged', issues: string[], mergedAt: string | null = null) => ({ number, title: `Fix ${number}`, url: `https://github.com/o/r/pull/${number}`, state, mergedAt, issues });

describe('the pull requests that name a Linear issue', () => {
  it('finds each LAN id once, and no other team\'s', () => {
    expect(namedIssues('Fix the reconcile (LAN-301)', 'Fixes LAN-301 and LAN-12.\nSee ENG-4 and xLAN-9.')).toEqual(['LAN-301', 'LAN-12']);
    expect(namedIssues(null, undefined, '')).toEqual([]);
  });

  it('keeps open ones and those merged in the last 14 days that name an issue', () => {
    const p = (number: number, over: object) => ({ number, title: `PR ${number} LAN-${number}`, html_url: `u${number}`, state: 'closed', merged_at: null, updated_at: '', body: null, ...over });
    const out = fixPrs([
      p(1, { state: 'open' }),
      p(2, { merged_at: new Date(NOW - 2 * 86_400_000).toISOString() }),
      p(3, { merged_at: new Date(NOW - (FIX_DAYS + 1) * 86_400_000).toISOString() }),
      p(4, {}),
      p(5, { state: 'open', title: 'No issue named' }),
      // A copy onto a release branch is not the fix (decisions.md 155).
      p(6, { state: 'open', base: { ref: 'release/ios' } })
    ], NOW);
    expect(out.map((x) => [x.number, x.state, x.issues])).toEqual([[1, 'open', ['LAN-1']], [2, 'merged', ['LAN-2']]]);
  });

  it('reads pages of the newest updated until one is short or older than 14 days', async () => {
    const old = new Date(NOW - 20 * 86_400_000).toISOString();
    const recent = new Date(NOW - 86_400_000).toISOString();
    const full = (updated: string) => Array.from({ length: 100 }, (_, i) => ({ number: i, title: 't', html_url: 'u', state: 'open', merged_at: null, updated_at: updated, body: null }));
    const fetcher = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).endsWith('&page=1') ? full(recent) : full(old)), { status: 200 }));
    const s = await fixesSection({ GITHUB_REPO: 'o/r' }, fetcher as unknown as typeof fetch, NOW);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(s.state).toBe('ok');
    expect(String(fetcher.mock.calls[0]![0])).toContain('/repos/o/r/pulls?state=all&sort=updated&direction=desc&per_page=100&page=1');
  });
});

describe('each line\'s check and when a fix should clear it', () => {
  it('names a line as the server does, so the page finds its Linear issue', () => {
    fc.assert(fc.property(fc.constantFrom(...Object.keys(KINDS)), fc.option(fc.string({ maxLength: 400 }), { nil: undefined }), (key, subject) => {
      const a = { key, ...(subject === undefined ? {} : { subject }) };
      expect(logic.lineId(a)).toBe(alertId(a));
      expect(logic.watchKeyOf(a)).toBe(watchKeyOf(a));
      expect(watchKeyOf(a)).toMatch(/^ops:[A-Za-z0-9 _.:()/#@-]{1,290}$/);
    }));
    expect(logic.watchKeyOf({ key: 'job-stopped', subject: 'blob_reconcile', watchKey: 'job:blob_reconcile:stopped' })).toBe('job:blob_reconcile:stopped');
  });

  it('finds the next daily run and the next of a job that runs every few minutes', () => {
    expect(new Date(logic.nextCheck({ daily: ['04:35'], takesMin: 120 }, at('2026-11-17T21:00:00Z'))).toISOString()).toBe('2026-11-18T06:35:00.000Z');
    expect(new Date(logic.nextCheck({ daily: ['02:30', '22:00'] }, at('2026-11-17T21:00:00Z'))).toISOString()).toBe('2026-11-17T22:00:00.000Z');
    expect(new Date(logic.nextCheck({ everyMin: 15, last: '2026-11-17T20:50:00Z' }, at('2026-11-17T21:00:00Z'))).toISOString()).toBe('2026-11-17T21:05:00.000Z');
    expect(logic.nextCheck({}, NOW)).toBe(NOW);
  });

  it('waits for the deploy, the window the check counts, and the next check after both', () => {
    // A server job's 2-day window: merged at 21:00, deployed 21:30, clear of the window two days on.
    expect(new Date(logic.clearsAt({ windowH: 48 }, NOW)).toISOString()).toBe('2026-11-19T21:30:00.000Z');
    // The nightly R2 reconciliation: the first run after the deploy.
    expect(new Date(logic.clearsAt({ daily: ['04:35'], takesMin: 120 }, NOW)).toISOString()).toBe('2026-11-18T06:35:00.000Z');
    // A count of this month starts again on the 1st.
    expect(new Date(logic.clearsAt({ monthly: true }, NOW)).toISOString()).toBe('2026-12-01T00:00:00.000Z');
    fc.assert(fc.property(fc.integer({ min: 0, max: 10 ** 12 }), fc.constantFrom(...Object.values(KINDS).map((k) => k.recheck as Record<string, unknown>), ...Object.values(WORKFLOW_RECHECK) as Record<string, unknown>[]),
      (t, r) => { expect(logic.clearsAt(r, t)).toBeGreaterThanOrEqual(t + 30 * M); }));
  });
});

describe('a line\'s state, from its Linear issue and the pull requests that name it', () => {
  const r2 = { key: 'r2-missing', level: 'problem' };
  const ud = (lines: Row[], issues: unknown[] = []) => ({ issues, lines });
  const row = (over: Partial<Row> = {}): Row => ({ key: 'ops:r2-missing', verdict: 'filed', issue: 'LAN-301', issueUrl: 'https://linear.app/x/issue/LAN-301', state: 'Todo', lookedAt: '2026-11-17T20:00:00Z', ...over });

  it('says no Linear issue yet, and a person\'s own queue as theirs', () => {
    expect(logic.lineFix(r2, kinds, ud([]), [], NOW).state).toBe('none');
    expect(logic.lineFix({ key: 'join-requests-waiting' }, kinds, ud([]), [], NOW).state).toBe('person');
    expect(logic.lineFix(r2, kinds, ud([row({ issue: null, verdict: 'noise' })]), [], NOW).state).toBe('noise');
  });

  it('shows the issue, then the fix waiting on its merge, then the merged fix waiting for its check', () => {
    const lines = ud([row()]);
    expect(logic.lineFix(r2, kinds, lines, [], NOW)).toMatchObject({ state: 'issue', issues: ['LAN-301'] });
    expect(logic.lineFix(r2, kinds, lines, [pr(7, 'open', ['LAN-301'])], NOW)).toMatchObject({ state: 'open', pr: { number: 7 } });
    const merged = logic.lineFix(r2, kinds, lines, [pr(7, 'merged', ['LAN-301'], '2026-11-17T20:00:00Z')], NOW);
    expect(merged).toMatchObject({ state: 'merged', pr: { number: 7 } });
    expect(new Date(merged.at!).toISOString()).toBe('2026-11-18T06:35:00.000Z');
    // After that check, a line still shown has come back.
    expect(logic.lineFix(r2, kinds, lines, [pr(7, 'merged', ['LAN-301'], '2026-11-17T20:00:00Z')], at('2026-11-18T07:00:00Z')).state).toBe('stuck');
  });

  it('takes the fix Linear closed the issue with when no pull request names it', () => {
    const f = logic.lineFix(r2, kinds, ud([row({ fixedBy: 640, fixedAt: '2026-11-17T20:00:00Z', closedAt: '2026-11-17T20:10:00Z' })]), [], NOW);
    expect(f).toMatchObject({ state: 'merged', pr: { number: 640 } });
    // Past that fix's check, the line on the page says the problem shows again, though Linear closed the issue.
    expect(logic.lineFix(r2, kinds, ud([row({ fixedBy: 640, fixedAt: '2026-11-17T20:00:00Z', closedAt: '2026-11-17T20:10:00Z' })]), [], at('2026-11-18T07:00:00Z')))
      .toMatchObject({ state: 'back', pr: { number: 640 }, closedAt: '2026-11-17T20:10:00Z' });
  });

  it('never calls a close in Linear a fix: the line waits for its check, then says the problem shows again (LAN-312)', () => {
    // LAN-312: closed by hand as Live on Nov 24 with no pull request; the web build failed again on Nov 26 for a new cause.
    const build = { key: 'worker-build-failed', subject: 'langquest-next', level: 'problem' };
    const closed = { issues: [], lines: [row({ key: 'ops:worker-build-failed:langquest-next', issue: 'LAN-312', verdict: 'fixed', state: 'Live', closedAt: '2026-11-24T03:10:53Z', fixedAt: '2026-11-24T03:10:53Z', fixedBy: null })] };
    const now = logic.lineFix(build, kinds, closed, [], at('2026-11-26T19:00:00Z'));
    expect(now).toMatchObject({ state: 'back', pr: null, closedAt: '2026-11-24T03:10:53Z', closedAs: 'Live', issues: ['LAN-312'] });
    // Within the check after the close (a live check: the deploy's 30 minutes), it waits as after a merge, with no pull request.
    const soon = logic.lineFix(build, kinds, closed, [], at('2026-11-24T03:20:00Z'));
    expect(soon).toMatchObject({ state: 'closing', pr: null });
    expect(new Date(soon.at!).toISOString()).toBe('2026-11-24T03:40:53.000Z');
    // A pull request that waits on its merge leads, as for an open issue.
    expect(logic.lineFix(build, kinds, closed, [pr(9, 'open', ['LAN-312'])], at('2026-11-26T19:00:00Z')).state).toBe('open');
    // An open issue with no fix stays "no fix yet": only a merged pull request is a fix.
    const open = { issues: [], lines: [row({ key: 'ops:worker-build-failed:langquest-next', issue: 'LAN-312', fixedAt: '2026-11-24T03:10:53Z', fixedBy: null })] };
    expect(logic.lineFix(build, kinds, open, [], at('2026-11-26T19:00:00Z')).state).toBe('issue');
  });

  it('shows a closed issue whose line is on the page past its check as back on User issues, without what Claude said before the close (LAN-312)', () => {
    const build = { key: 'worker-build-failed', subject: 'langquest-next', level: 'problem' };
    const lan312 = { issue: 'LAN-312', verdict: 'fixed', state: 'Live', keys: ['ops:worker-build-failed:langquest-next'], closedAt: '2026-11-24T03:10:53Z', fixedAt: '2026-11-24T03:10:53Z', fixedBy: null, solution: 'Read the build log.' };
    const other = { issue: 'LAN-5', verdict: 'fixed', state: 'Done', keys: ['ops:r2-missing'], closedAt: '2026-11-24T03:10:53Z', fixedBy: null };
    const ud = { issues: [lan312, other], fixes: { 'LAN-312': { at: '2026-11-22T06:59:49Z' }, 'LAN-5': { at: '2026-11-22T06:59:49Z' } } };
    const live = logic.withLiveLines(ud, [build], kinds, [], at('2026-11-26T19:00:00Z'));
    expect(live.issues[0]).toMatchObject({ issue: 'LAN-312', back: true, closedAt: '2026-11-24T03:10:53Z' });
    expect(String(live.issues[0]!.solution)).toContain('LAN-312 is closed in Linear, but the problem shows on this page now.');
    // Only the issue whose line shows: LAN-5's line is gone, so its close holds.
    expect(live.issues[1]).toBe(other);
    expect(Object.keys(live.fixes ?? {})).toEqual(['LAN-5']);
    // The answer itself is kept as it came.
    expect(ud.issues[0]).toBe(lan312);
    expect(Object.keys(ud.fixes)).toEqual(['LAN-312', 'LAN-5']);
    // A record Claude wrote after the close stays; within the check after the close, nothing is back yet.
    expect(logic.withLiveLines({ ...ud, fixes: { 'LAN-312': { at: '2026-11-25T00:00:00Z' } } }, [build], kinds, [], at('2026-11-26T19:00:00Z')).fixes).toHaveProperty('LAN-312');
    expect(logic.withLiveLines(ud, [build], kinds, [], at('2026-11-24T03:20:00Z'))).toBe(ud);
    expect(logic.withLiveLines(ud, [], kinds, [], at('2026-11-26T19:00:00Z'))).toBe(ud);
  });

  it('uses the issues a nightly line names itself, and the issue of a kind the watch found in the records', () => {
    expect(logic.lineFix({ key: 'nightly-failed', subject: 'Web UI suite', issues: ['LAN-260'] }, kinds, ud([]), [pr(9, 'open', ['LAN-260'])], NOW)).toMatchObject({ state: 'open', issues: ['LAN-260'] });
    const records = ud([], [{ issue: 'LAN-224', verdict: 'filed', keys: ['error:TypeError@passage:-'] }]);
    expect(logic.lineFix({ key: 'app-crash', subject: 'TypeError in passage', watchKey: 'error:TypeError@passage:-' }, kinds, records, [], NOW)).toMatchObject({ state: 'issue', issues: ['LAN-224'] });
  });

  it('gives a line with several issues each issue\'s own fix: one test\'s fix is not the line\'s', () => {
    const suite = { key: 'nightly-failed', subject: 'Phones', issues: ['LAN-156', 'LAN-248', 'LAN-158'], recheck: { daily: ['08:30'], takesMin: 60 } };
    // PR 396 named LAN-158 and PR 409 LAN-248: the page called PR 396 the fix for all three (2026-11-17).
    const part = logic.lineFix(suite, kinds, ud([]), [pr(396, 'open', ['LAN-158']), pr(409, 'open', ['LAN-248'])], NOW);
    expect(part).toMatchObject({ state: 'part', fixed: 2, issues: ['LAN-156', 'LAN-248', 'LAN-158'] });
    expect(part.each!.map((e) => [e.issue, e.state, e.pr?.number ?? null])).toEqual([['LAN-156', 'issue', null], ['LAN-248', 'open', 409], ['LAN-158', 'open', 396]]);
    expect(logic.lineFix(suite, kinds, ud([]), [], NOW)).toMatchObject({ state: 'issue', fixed: 0 });
    // Waits after a merge only when every issue has a merged fix, until the last one's check.
    const all = [pr(1, 'merged', ['LAN-156'], '2026-11-17T09:00:00Z'), pr(2, 'merged', ['LAN-248', 'LAN-158'], '2026-11-17T20:00:00Z')];
    const merged = logic.lineFix(suite, kinds, ud([]), all, NOW);
    expect(merged).toMatchObject({ state: 'merged', pr: { number: 2 } });
    expect(new Date(merged.at!).toISOString()).toBe('2026-11-18T09:30:00.000Z');
    expect(logic.lineFix(suite, kinds, ud([]), all.slice(0, 1), NOW)).toMatchObject({ state: 'part', fixed: 1 });
    // One still there after its fix's check is what to read first.
    const later = at('2026-11-20T12:00:00Z');
    expect(logic.lineFix(suite, kinds, ud([]), all.slice(0, 1), later)).toMatchObject({ state: 'stuck', pr: { number: 1 } });
  });

  it('says a fix in the app clears only as phones update', () => {
    expect(logic.lineFix({ key: 'app-crash', watchKey: 'error:x' }, kinds, ud([]), [], NOW).phones).toBe(true);
    expect(logic.lineFix(r2, kinds, ud([]), [], NOW).phones).toBe(false);
  });
});

describe('the lines resolved', () => {
  const line = (key: string, over: Partial<Row> = {}): Row => ({ key, verdict: 'filed', issue: 'LAN-1', lookedAt: '2026-11-16T00:00:00Z', ...over });
  const ud = { issues: [], lines: [
    line('ops:r2-missing', { closedAt: '2026-11-17T10:00:00Z', issue: 'LAN-301' }),
    line('job:blob_reconcile:stopped', { issue: 'LAN-302' }),
    line('ops:db-disk-full', { issue: 'LAN-303' }),
    line('ops:videos-stuck', { issue: 'LAN-304', closedAt: '2026-10-01T00:00:00Z', lookedAt: '2026-10-01T00:00:00Z' }),
    line('ops:app-version-old', { issue: null, verdict: 'noise' }),
    line('error:TypeError@x:-', { issue: 'LAN-305' })
  ] };

  it('lists a line gone from the page, newest first, only where its part answered', () => {
    const answered = (p: string) => p !== 'capacity';
    const out = logic.resolvedLines(ud, new Set(['ops:db-disk-full']), answered, kinds, NOW);
    expect(out.map((l) => [l.key, l.issue, l.closed])).toEqual([['ops:r2-missing', 'LAN-301', true], ['job:blob_reconcile:stopped', 'LAN-302', false]]);
    // A line still on the page, or one whose part did not answer, is not resolved.
    expect(logic.resolvedLines(ud, new Set(['ops:r2-missing']), () => false, kinds, NOW)).toEqual([]);
  });

  it('names every key a dashboard line can have', () => {
    expect(logic.keyKind('ops:r2-missing', kinds)).toEqual({ part: 'storage', title: KINDS['r2-missing'].title, subject: '' });
    expect(logic.keyKind('ops:workflow-failed:guardrails', kinds)).toMatchObject({ part: 'code', subject: 'guardrails' });
    expect(logic.keyKind('job:blob_reconcile:failing', kinds)).toMatchObject({ part: 'jobs', subject: 'blob_reconcile' });
    expect(logic.keyKind('worker:/api/sync:5xx', kinds)).toMatchObject({ part: 'worker', subject: '/api/sync' });
    expect(logic.keyKind('error:TypeError@x:-', kinds)).toBeNull();
  });
});

describe('the lines the watch hands to Claude', () => {
  const item = (key: string, over: object = {}) => ({ key, level: 'problem', text: `${key} happened.`, section: 'storage', watchKey: watchKeyOf({ key }), ...over });

  it('hands over each new line once, and not a person\'s queue, a nightly with its issues, the watch\'s own kinds, or Could not read', () => {
    const out = watchLines([
      item('r2-missing'), item('r2-missing'),
      item('join-requests-waiting'),
      item('nightly-failed', { issues: ['LAN-260'] }),
      item('job-stopped', { watchKey: 'job:x:stopped' }),
      item('unreadable', { watchKey: watchKeyOf({ key: 'unreadable', subject: 'expo' }) }),
      item('db-disk-full', { link: 'javascript:alert(1)' })
    ]);
    expect(out).toEqual([
      { key: 'ops:r2-missing', level: 'problem', text: 'r2-missing happened.', title: KINDS['r2-missing'].title, part: 'storage', settleMin: 30 + 1440 + 120 },
      { key: 'ops:db-disk-full', level: 'problem', text: 'db-disk-full happened.', title: KINDS['db-disk-full'].title, part: 'storage', settleMin: 30 }
    ]);
    expect(watchLines(Array.from({ length: 80 }, (_, i) => item('r2-missing', { watchKey: `ops:r2-missing:${i}` })))).toHaveLength(WATCH_LINES_MAX);
  });

  it('says for each line when its check can no longer find a problem a fix or a close took away: never before the page says it clears', () => {
    expect(settleMinutes({})).toBe(30);
    expect(settleMinutes({ windowH: 24 })).toBe(30 + 1440);
    // A job's own interval and last run (sources/diag.ts) count too.
    expect(watchLines([item('job-failures', { recheck: { everyMin: 60, last: '2026-11-17T20:00:00Z' } })])[0]!.settleMin).toBe(30 + 48 * 60 + 60);
    fc.assert(fc.property(fc.integer({ min: 0, max: 10 ** 12 }), fc.constantFrom(...Object.values(KINDS).map((k) => k.recheck as Record<string, unknown>), ...Object.values(WORKFLOW_RECHECK) as Record<string, unknown>[]),
      (t, r) => { expect(t + settleMinutes(r) * M).toBeGreaterThanOrEqual(logic.clearsAt(r, t)); }));
  });

  it('names the Linear issues the lines name themselves, each once, for an instruction on one', () => {
    expect(lineIssues([item('nightly-broke', { issues: ['LAN-278'] }), item('nightly-failed', { issues: ['LAN-278', 'LAN-285', 'lan-1', 'LAN-2; x'] }), item('r2-missing')]))
      .toEqual(['LAN-278', 'LAN-285']);
  });

  it('gives each kind a part the page shows', () => {
    const parts = new Set(GROUPS.flatMap((g) => [...g.parts]));
    for (const [key, k] of Object.entries(kinds)) if (k.part) expect(parts.has(k.part), key).toBe(true);
  });
});

describe('the workflows\' schedules', () => {
  /** The minutes between runs of a cron's minute field, each hour. */
  const step = (minute: string) => {
    const every = /^\*\/(\d+)$/.exec(minute);
    if (every) return Number(every[1]);
    const ms = minute.split(',').map(Number);
    return ms.length === 1 ? 60 : Math.min(...ms.map((m, i) => ((ms[(i + 1) % ms.length]! - m + 60) % 60) || 60));
  };

  it('match the times each line\'s next check is worked out from', () => {
    for (const [file, r] of Object.entries(WORKFLOW_RECHECK)) {
      const crons = [...readFileSync(`.github/workflows/${file}`, 'utf8').matchAll(/cron:\s*'([^']+)'/g)].map((m) => m[1]!.split(/\s+/));
      expect(crons.length, file).toBeGreaterThan(0);
      for (const hm of r.daily ?? []) {
        const [h, m] = hm.split(':').map(Number);
        expect(crons.some((c) => Number(c[0]) === m && Number(c[1]) === h && c.slice(2).join(' ') === '* * *'), `${file} ${hm}`).toBe(true);
      }
      if (r.everyMin) expect(crons.some((c) => c[1] === '*' && step(c[0]!) === r.everyMin), `${file} every ${r.everyMin} min`).toBe(true);
    }
  });

  it('reads a job\'s interval as Postgres writes it', () => {
    expect(intervalMinutes('00:10:00')).toBe(10);
    expect(intervalMinutes('1 day')).toBe(1440);
    expect(intervalMinutes('1 day 02:00:00')).toBe(1560);
    expect(intervalMinutes('soon')).toBeNull();
  });
});

describe('the page', () => {
  it('loads the fixes, shows each line\'s state, and keeps Resolved closed until opened', async () => {
    const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
    expect(html).toContain("api('/ops/api/fixes' + q)");
    expect(html).toContain('<details class="resolved" id="start-resolved" hidden></details>');
    expect(html).not.toMatch(/<details class="resolved"[^>]*\sopen/);
    expect(html).toContain('const KINDS = {');
    // The page's script parses.
    const script = /<script nonce="n">([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(() => new Function(script)).not.toThrow();
  });
});
