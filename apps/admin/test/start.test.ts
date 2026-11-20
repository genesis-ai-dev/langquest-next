import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { forgetSignIns } from '../src/auth';
import { handle } from '../src/index';
import { page } from '../src/page';
import { GROUPS } from '../src/pageOps';
import { START_LOGIC } from '../src/pageStart';
import { detailAsk, GLANCE, METRICS, PART_IDS } from '../src/sources/history';

/** The start page's pure helpers, as the page runs them (pageStart.ts START_LOGIC). */
const logic = new Function(`${START_LOGIC}; return { splitAlert, startPlan, storeWaits, claudeWork, rangeTotal, bucketEnd, runSquares, chartSeries, totalOf, longTime };`)() as {
  totalOf: (agg: string, range: string, step: string, at: number, n: number) => string;
  longTime: (ms: number) => string;
  chartSeries: (all: Hst['series'], wanted?: string) => { total: Hst['series'][number] | null; keys: Hst['series']; shown: Hst['series'][number] | null };
  splitAlert: (t: string) => { title: string; next: string };
  startPlan: (sections: typeof GROUPS, results: Record<string, unknown>, levels: string[]) => {
    cards: { level: string; group: string; part: string; text: string; more: string[] }[]; ok: { group: string; off: string[] }[]; waiting: string[];
  };
  storeWaits: (p: unknown) => { lane: string; title: string }[];
  claudeWork: (u: unknown) => { issue: string; state: string; pr: number | null }[];
  rangeTotal: (agg: string, values: (number | null)[]) => number | null;
  bucketEnd: (buckets: string[], i: number, step: string) => string;
  runSquares: (hst: Hst, sq: { runs: string; failed?: string; partial?: string }) => { key: string; cells: string[]; failed: number; partial: number }[];
};
type Hst = { counted?: boolean[]; series: { metric: string; key: string; values: (number | null)[] }[] };
const LEVELS = ['urgent', 'problem', 'watch'];
const okSection = { state: 'ok', alerts: [], checkedAt: '' };

describe('the Overview, what needs you first', () => {
  it('puts every section with parts somewhere, so every part stays one tap away, whatever has answered', () => {
    const parts = GROUPS.flatMap((g) => [...g.parts]);
    const states = [undefined, okSection, { state: 'off', alerts: [], setup: 'x', checkedAt: '' }, { state: 'error', alerts: [], error: 'down', checkedAt: '' },
      { state: 'ok', alerts: [{ level: 'problem', text: 'Broken. Fix it.' }], checkedAt: '' }];
    for (let seed = 0; seed < 200; seed++) {
      const results: Record<string, unknown> = {};
      parts.forEach((p, i) => { const s = states[(seed * 7 + i * 3 + (seed >> 2)) % states.length]; if (s) results[p] = s; });
      const plan = logic.startPlan(GROUPS, results, LEVELS);
      const landed = new Set([...plan.cards.map((c) => c.group), ...plan.ok.map((o) => o.group), ...plan.waiting]);
      for (const g of GROUPS) if (g.parts.length) expect(landed.has(g.id), `${g.id}, seed ${seed}`).toBe(true);
    }
  });

  it('opens every section on a page that holds all its parts', async () => {
    const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
    // The parts lead (their lines, pictures and numbers), and the charts over the range come after them.
    expect(html).toContain(`'<div class="body" id="body-' + s.id + '"></div><div class="hist" id="hist-' + s.id + '" hidden></div></section>'`);
    // The menu has a line for each section and one for all of them (pageShell.ts).
    expect(html).toContain("navLine('#g/' + id, id, titleOf(id)");
    expect(html).toContain("navLine('#all', 'all', 'All sections'");
  });

  it('shows the most urgent first, an unreadable part as one to watch, and a section with no alert as OK', () => {
    const plan = logic.startPlan(GROUPS, {
      clients: { state: 'ok', alerts: [{ level: 'watch', text: 'Quiet.' }] }, fleet: okSection,
      jobs: { state: 'ok', alerts: [{ level: 'urgent', text: 'Down.' }] }, container: okSection, cron: okSection, push: okSection, v2: { state: 'error', alerts: [], error: 'timeout' },
      people: okSection
    }, LEVELS);
    expect(plan.cards.map((c) => c.level)).toEqual(['urgent', 'watch', 'watch']);
    expect(plan.cards[2]).toMatchObject({ group: 'jobs', part: 'v2', text: 'Could not read: timeout.' });
    expect(plan.ok.map((o) => o.group)).toEqual(['people']);
    expect(plan.waiting).toContain('releases');
    expect(plan.waiting).not.toContain('lookup');
  });

  it('keeps a flood of alerts in one part to one card and one line to watch', () => {
    const alerts = [
      ...Array.from({ length: 30 }, (_, i) => ({ level: 'watch', text: `Error ${i} on 3 installs.` })),
      { level: 'problem', text: 'Crash: A.' }, { level: 'urgent', text: 'Crash: B.' }, { level: 'problem', text: 'Crash: C.' }
    ];
    const plan = logic.startPlan(GROUPS, { clients: { state: 'ok', alerts } }, LEVELS);
    const mine = plan.cards.filter((c) => c.part === 'clients') as unknown as { level: string; text: string; more: string[] }[];
    expect(mine.map((c) => [c.level, c.text, c.more.length])).toEqual([['urgent', 'Crash: B.', 2], ['watch', 'Error 0 on 3 installs.', 29]]);
  });

  it('says what is wrong first and what to do next after it', () => {
    expect(logic.splitAlert('iPhone 2026.11 has waited in TestFlight for 30 h with nothing in review. Check the hourly App Store step (app-store-review.yml) on EAS.'))
      .toEqual({ title: 'iPhone 2026.11 has waited in TestFlight for 30 h with nothing in review.', next: 'Check the hourly App Store step (app-store-review.yml) on EAS.' });
    expect(logic.splitAlert('App Store: version 1.2.3 was rejected in review.')).toEqual({ title: 'App Store: version 1.2.3 was rejected in review.', next: '' });
    expect(logic.splitAlert('Upload delay p95 is 2.5 s')).toEqual({ title: 'Upload delay p95 is 2.5 s', next: '' });
  });

  it('lists builds in a store\'s review, and the watch\'s open issues, on the side', () => {
    const pipeline = { lanes: [
      { id: 'ios', stages: [{ id: 'waiting', title: 'TestFlight', cards: [{ title: '52' }] }, { id: 'review', title: 'App Review', cards: [{ title: '53', at: '2026-11-16T00:00:00Z', state: 'in review' }] }] },
      { id: 'android', stages: [{ id: 'review', title: 'Play review', cards: [] }] }
    ] };
    expect(logic.storeWaits(pipeline)).toEqual([{ lane: 'iPhone', title: '53', stage: 'App Review', at: '2026-11-16T00:00:00Z', state: 'in review' }]);
    expect(logic.storeWaits(null)).toEqual([]);
    const issues = [{ issue: 'LAN-1', verdict: 'filed', closedAt: null, fixedAt: null }, { issue: 'LAN-2', verdict: 'filed', closedAt: '2026-11-01', fixedAt: null },
      { issue: null, verdict: 'fixed', closedAt: null, fixedAt: '2026-11-01' }, { issue: 'LAN-3', verdict: 'known', closedAt: null, fixedAt: null }];
    expect(logic.claudeWork({ issues }).map((i) => i.issue)).toEqual(['LAN-1']);
  });

  it('says Claude works on an issue only while a run works on it, and filed in Linear otherwise', () => {
    const open = (issue: string) => ({ issue, verdict: 'filed', closedAt: null, fixedAt: null });
    const issues = [open('LAN-1'), open('LAN-2'), open('LAN-3'), open('LAN-4')];
    const notes = { 'LAN-1': [{ state: 'answered' }, { state: 'working' }], 'LAN-4': [{ state: 'waiting' }] };
    const fixes = { 'LAN-2': { decision: 'waits', pr: 590 }, 'LAN-3': { decision: 'none', pr: null } };
    expect(logic.claudeWork({ issues, notes, fixes }).map((i) => [i.issue, i.state, i.pr])).toEqual([
      ['LAN-1', 'working', null], ['LAN-2', 'fix', 590], ['LAN-3', 'nofix', null], ['LAN-4', 'filed', null]]);
    expect(logic.claudeWork({ issues: [open('LAN-5')] })[0].state).toBe('filed');
  });

  it('adds a count up over a range and shows a level at its latest, and knows where the last bucket ends', () => {
    expect(logic.rangeTotal('sum', [1, null, 2, 0])).toBe(3);
    expect(logic.rangeTotal('max', [5, 9, null, 7, null])).toBe(7);
    expect(logic.rangeTotal('sum', [null, null])).toBeNull();
    expect(logic.bucketEnd(['2026-11-01T00:00:00.000Z', '2026-11-02T00:00:00.000Z'], 0, 'day')).toBe('2026-11-02T00:00:00.000Z');
    expect(logic.bucketEnd(['2026-11-02T00:00:00.000Z'], 0, 'day')).toBe('2026-11-03T00:00:00.000Z');
    expect(logic.bucketEnd(['2026-11-16T05:00:00.000Z'], 0, 'hour')).toBe('2026-11-16T06:00:00.000Z');
    expect(logic.bucketEnd(['2026-11-09T00:00:00.000Z'], 0, 'week')).toBe('2026-11-16T00:00:00.000Z');
    expect(logic.bucketEnd(['2026-01-01T00:00:00.000Z'], 0, 'month')).toBe('2026-02-01T00:00:00.000Z');
  });

  it('draws a number that is counted only by key, leading with its largest key', () => {
    // A first download's time is counted for open and for fill, never as one total (diag.daily_compute).
    const times = [{ metric: 'first_download_p95_ms', key: 'fill', values: [4800, null, 4000] }, { metric: 'first_download_p95_ms', key: 'open', values: [9200, 14100, 1083000] }];
    const c = logic.chartSeries(times);
    expect([c.total, c.keys.map((k) => k.key), c.shown?.key]).toEqual([null, ['fill', 'open'], 'open']);
    expect(logic.chartSeries(times, 'fill').shown?.key).toBe('fill');
    // A number with a total leads with it, and a key the range no longer has falls back to it.
    const counts = [{ metric: 'first_downloads', key: '', values: [3, 1] }, { metric: 'first_downloads', key: 'open', values: [2, 1] }];
    expect(logic.chartSeries(counts).shown?.key).toBe('');
    expect(logic.chartSeries(counts, 'gone').shown?.key).toBe('');
    expect(logic.chartSeries([]).shown).toBeNull();
  });

  it('gives a button only to a key that counted something over the range, and to the key shown', () => {
    const runs = [{ metric: 'failed', key: '', values: [0, 2, 1] }, { metric: 'failed', key: 'v2_import', values: [0, 2, 0] }, { metric: 'failed', key: 'fold_canary', values: [0, 0, 1] },
      { metric: 'failed', key: 'snapshot', values: [0, 0, 0] }, { metric: 'failed', key: 'projection', values: [null, null, null] }];
    expect(logic.chartSeries(runs).keys.map((k) => k.key)).toEqual(['v2_import', 'fold_canary']);
    // The key a person chose keeps its button when its count falls to nothing, so the way back to All stays beside it.
    const chosen = logic.chartSeries(runs, 'snapshot');
    expect([chosen.shown?.key, chosen.keys.map((k) => k.key)]).toEqual(['snapshot', ['v2_import', 'fold_canary', 'snapshot']]);
    // A number where no key counted anything has no buttons under its total.
    expect(logic.chartSeries([{ metric: 'failed', key: '', values: [0, 0] }, { metric: 'failed', key: 'snapshot', values: [0, 0] }]).keys).toEqual([]);
  });

  it('says what a chart\'s large number is of: the range for a count, the newest bucket for a level', () => {
    expect(['24h', '14d', '90d', '1y', 'all'].map((r) => logic.totalOf('sum', r, 'day', 13, 14))).toEqual(['in 24 h', 'in 14 days', 'in 90 days', 'in 1 year', 'in all time']);
    expect(['hour', 'day', 'week', 'month'].map((s) => logic.totalOf('max', '14d', s, 13, 14))).toEqual(['this hour', 'today', 'this week', 'this month']);
    // A level whose newest bucket has no value yet is not today's: the page names the bucket it is from.
    expect(logic.totalOf('max', '14d', 'day', 12, 14)).toBe('');
  });

  it('writes a time of an hour or more in hours, and of two days or more in days', () => {
    expect([3600000, 3900000, 57600000, 172800000 - 60000, 172800000, 1836000000].map(logic.longTime)).toEqual(['1 h', '1 h 5 min', '16 h', '47 h 59 min', '2 days', '21 days 6 h']);
    // The page's ms hands over to it at 60 minutes, as rounded: 59.96 minutes is 1 h, not 60.0 min.
    const ms = new Function(`${START_LOGIC}; ${/const ms = [^\n]+/.exec(readFileSync('apps/admin/src/page.ts', 'utf8'))![0]} return ms;`)() as (n: number | null) => string;
    expect([null, 420, 5400, 754000, 3597600, 3900000, 57600000].map(ms)).toEqual(['–', '420 ms', '5.4 s', '12.6 min', '1 h', '1 h 5 min', '16 h']);
  });

  it('gives each job a row of squares: failed over part of the work over ran, an empty bucket and one not counted yet apart', () => {
    const hst: Hst = {
      counted: [true, true, true, true, false],
      series: [
        { metric: 'runs', key: '', values: [9, 9, 9, 0, null] },
        { metric: 'runs', key: 'snapshot', values: [2, 2, 0, 0, null] },
        { metric: 'runs', key: 'push_delivery', values: [6, 6, 6, 0, null] },
        { metric: 'runs', key: '_other', values: [1, 1, 1, 0, null] },
        { metric: 'failed', key: 'push_delivery', values: [0, 1, 0, 0, null] },
        { metric: 'partial', key: 'push_delivery', values: [1, 1, 0, 0, null] },
        { metric: 'failed', key: '', values: [0, 1, 0, 0, null] }
      ]
    };
    const rows = logic.runSquares(hst, { runs: 'runs', failed: 'failed', partial: 'partial' });
    expect(rows.map((r) => r.key)).toEqual(['push_delivery', 'snapshot', '_other']);
    expect(rows[0]).toEqual({ key: 'push_delivery', cells: ['part', 'fail', 'ok', 'none', 'gap'], failed: 1, partial: 1 });
    expect(rows[1]!.cells).toEqual(['ok', 'ok', 'none', 'none', 'gap']);
    // pg_cron has no "part of the work": a partial number it lacks never shows.
    expect(logic.runSquares(hst, { runs: 'runs', failed: 'failed' })[0]!.cells).toEqual(['ok', 'fail', 'ok', 'none', 'gap']);
    for (const [part, names] of [['jobs', ['runs', 'failed', 'partial']], ['cron', ['runs', 'failed']]] as const) {
      for (const m of names) expect(METRICS[part]?.[m], `${part}.${m}`).toBeTruthy();
    }
  });

  it('draws a number for each section it names, from a part that section has', () => {
    for (const [group, g] of Object.entries(GLANCE)) {
      const section = GROUPS.find((s) => s.id === group);
      expect(section, group).toBeTruthy();
      expect((section!.parts as readonly string[]).includes(g.part), `${group} has ${g.part}`).toBe(true);
      expect(METRICS[g.part]?.[g.metric], `${g.part}.${g.metric}`).toBeTruthy();
    }
  });
});

describe('a tapped bucket', () => {
  const ask = (q: string) => detailAsk('clients', new URLSearchParams(q));
  const day = 'from=2026-11-16T00:00:00Z&to=2026-11-17T00:00:00Z';

  it('asks for a number the part has, a bucket of at most a month, and a page from 0 to 1000', () => {
    expect(ask(`metric=errors&key=TypeError&${day}&page=2`)).toEqual({
      part: 'clients', metric: 'errors', key: 'TypeError', from: '2026-11-16T00:00:00.000Z', to: '2026-11-17T00:00:00.000Z', page: 2
    });
    expect(ask(`metric=nothing&${day}`)).toMatchObject({ error: expect.stringContaining('errors') });
    expect(ask(`metric=errors&key=${'x'.repeat(161)}&${day}`)).toHaveProperty('error');
    expect(ask('metric=errors&from=2026-11-17T00:00:00Z&to=2026-11-16T00:00:00Z')).toHaveProperty('error');
    expect(ask('metric=errors&from=2026-10-01T00:00:00Z&to=2026-11-16T00:00:00Z')).toHaveProperty('error');
    expect(ask('metric=errors&from=yesterday&to=today')).toHaveProperty('error');
    for (const page of ['-1', '1001', '1.5', 'x']) expect(ask(`metric=errors&${day}&page=${page}`), page).toHaveProperty('error');
  });

  it('has a raw source or says it keeps totals only, for every number', () => {
    // The migration of the detail panel, and the later ones that add a first download's wait and sign-in steps that are no fault.
    const sql = ['20261117143000_ops_detail.sql', '20261118234300_first_download_wait.sql', '20261119192147_sign_in_trouble.sql'].map((f) => readFileSync('supabase/migrations/' + f, 'utf8')).join('\n');
    const filtered = new Set([...sql.matchAll(/\('([a-z0-9_]+)', '([a-z0-9_]+)', '(records|job_runs)'/g)].map((m) => `${m[1]}.${m[2]}`));
    const own = new Set(['cron.runs', 'cron.failed', 'support.feedback', 'support.content_reports', 'userissues.looked_at_first']);
    for (const [part, ms] of Object.entries(METRICS)) for (const metric of Object.keys(ms)) {
      const n = `${part}.${metric}`;
      expect(part === 'people' || own.has(n) || filtered.has(n), n).toBe(true);
    }
  });
});

describe('GET /ops/api/glance and /ops/api/<part>/detail', () => {
  const env = { SUPABASE_URL: 'https://example.supabase.co', SUPABASE_ANON_KEY: 'anon', DIAG: { connectionString: 'postgresql://x@127.0.0.1:1/p' } };
  const signedIn = (async (url: RequestInfo | URL) => String(url).endsWith('get_user_state')
    ? Response.json({ globalViewer: 'on' }) : Response.json({ id: 'p1' })) as typeof fetch;
  const get = (path: string, token = 'tok') => handle(new Request(`https://next.langquest.org${path}`, { headers: { authorization: `Bearer ${token}` } }), env as never);
  const day = 'from=2026-11-16T00:00:00Z&to=2026-11-17T00:00:00Z';

  it('answers only a part the page has and a bucket it can read, before it reads anything', async () => {
    forgetSignIns();
    vi.stubGlobal('fetch', signedIn);
    expect(PART_IDS.has('nothing')).toBe(false);
    expect((await get(`/ops/api/nothing/detail?metric=errors&${day}`)).status).toBe(404);
    const bad = await get(`/ops/api/clients/detail?metric=nothing&${day}`);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain('errors');
    expect((await get('/ops/api/clients/detail?metric=errors&from=2026-01-01T00:00:00Z&to=2026-11-17T00:00:00Z')).status).toBe(400);
    vi.unstubAllGlobals();
  });

  it('says when the database cannot answer, without its address', async () => {
    forgetSignIns();
    vi.stubGlobal('fetch', signedIn);
    for (const path of ['/ops/api/glance', `/ops/api/clients/detail?metric=errors&${day}`]) {
      const r = await get(path);
      expect(r.status, path).toBe(502);
      expect(JSON.stringify(await r.json())).not.toContain('postgresql://');
    }
    vi.unstubAllGlobals();
  });

  it('asks for a sign-in first, like every other call', async () => {
    forgetSignIns();
    vi.stubGlobal('fetch', (async () => new Response('{}', { status: 401 })) as typeof fetch);
    expect((await get('/ops/api/glance', 'stale')).status).toBe(401);
    expect((await get(`/ops/api/clients/detail?metric=errors&${day}`, 'stale')).status).toBe(401);
    vi.unstubAllGlobals();
  });
});
