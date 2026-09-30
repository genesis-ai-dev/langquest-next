import type { LaneReport } from '@langquest-next/core';
import {
  activityWindow, alertsFor, attentionCount, combinedActivity, coverageAverage, coverageOn, csvCell, dayPercents, defaultLedgerMonth,
  fieldReport, isSettled, laneCsv, lanesCsv, ledgerCsv, ledgerFor, logByDay, orgTotals, paceGroups, portfolioCounts, reportText,
  sortLanes, timeAgo, toCsv, watchList, workingScope
} from '../src/aggregate';
import { hrefFor, parseRoute, type Route } from '../src/routes';
import type { LaneRow } from '../src/types';

/**
 * Organization figures are summed in the browser from the rows row-level
 * security returned (decision 40), so these sums are the whole of what a
 * coordinator reads as "the organization".
 */

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-30T12:00:00Z');
const cov = (g = 0, nt = 0, ot = 0) => ({ gospels: g, nt, ot, bible: 0 });
const days = (from: string, n: number, cards: (i: number) => number) =>
  Array.from({ length: n }, (_, i) => ({ day: new Date(Date.parse(`${from}T00:00:00Z`) + i * DAY).toISOString().slice(0, 10), cards: cards(i), chapters: cards(i) ? 1 : 0 }));

function report(over: Partial<LaneReport> & { name: string }): LaneReport {
  return {
    laneId: over.name.toLowerCase(), languoidId: over.name.slice(0, 3).toLowerCase(), country: null, flowName: 'Quick Check', target: null,
    progress: { total: 10, recorded: 4, done: 2, steps: [], waiting: 0, feedback: 0 },
    work: { not_started: 5, drafting: 1, in_review: 2, feedback: 0, done: 2 },
    stages: [], bottleneck: null,
    attention: { feedback: 0, openRequests: 0, overdueRequests: 0, atCheckpoint: 0 },
    books: [], activity: [], lastActivity: null,
    coverage: { recorded: cov(), done: cov(), weekly: [] },
    milestones: [],
    uploads: { cards: 0, chapters: 0, firstAt: null, lastAt: null, daily: [], log: [] },
    ledger: [],
    alerts: { stuckCards: 0, stuckPassages: 0, stuckSince: null, invalidCards: 0 },
    ...over
  };
}

const row = (r: LaneReport, updatedAt = '2026-09-30T11:00:00Z'): LaneRow => ({ orgId: 'o', projectId: 'work', laneId: r.laneId, updatedAt, report: r });
const uploadedDaysAgo = (d: number) => ({ cards: 1, chapters: 1, firstAt: null, lastAt: new Date(NOW - d * DAY).toISOString(), daily: [], log: [] });

describe('orgTotals', () => {
  it('sums every visible language and keeps the stalest update', () => {
    const t = orgTotals([
      row(report({ name: 'Dinka', attention: { feedback: 1, openRequests: 3, overdueRequests: 1, atCheckpoint: 0 }, lastActivity: '2026-09-20T00:00:00Z' }), '2026-09-29T12:00:00Z'),
      row(report({ name: 'Nuer', progress: { total: 5, recorded: 5, done: 5, steps: [], waiting: 0, feedback: 0 }, work: { not_started: 0, drafting: 0, in_review: 0, feedback: 0, done: 5 }, lastActivity: '2026-09-25T00:00:00Z' }), '2026-09-29T08:00:00Z')
    ]);
    expect(t).toMatchObject({ languages: 2, total: 15, recorded: 9, done: 7, feedback: 1, openRequests: 3, overdueRequests: 1 });
    expect(t.work).toEqual({ not_started: 5, drafting: 1, in_review: 2, feedback: 0, done: 7 });
    expect(t.lastActivity).toBe('2026-09-25T00:00:00Z');
    expect(t.oldestUpdate).toBe('2026-09-29T08:00:00Z');
  });
});

describe('coverage across languages', () => {
  it('averages shares (every language has the same canon, so this is also the share of all verses)', () => {
    expect(coverageAverage([row(report({ name: 'A', coverage: { recorded: cov(100, 50, 0), done: cov(), weekly: [] } })), row(report({ name: 'B', coverage: { recorded: cov(20, 10, 3), done: cov(), weekly: [] } }))], 'recorded'))
      .toEqual({ gospels: 60, nt: 30, ot: 1.5, bible: 0 });
  });
  it('a language works toward its target, else the first part of the canon it has not finished', () => {
    expect(workingScope(report({ name: 'A' }))).toBeNull();
    expect(workingScope(report({ name: 'A', uploads: uploadedDaysAgo(1), coverage: { recorded: cov(100, 60, 0), done: cov(), weekly: [] } }))).toBe('nt');
    expect(workingScope(report({ name: 'A', target: { scope: 'ot', startDate: '2026-01-01', targetDate: '2027-01-01' } }))).toBe('ot');
  });
  it('reads coverage on a day from the week that ended before it', () => {
    const r = report({ name: 'A', coverage: { recorded: cov(), done: cov(), weekly: [{ weekEnd: '2026-09-20', recorded: cov(10) }, { weekEnd: '2026-09-27', recorded: cov(20) }] } });
    expect(coverageOn(r, 'gospels', '2026-09-24')).toBe(10);
    expect(coverageOn(r, 'gospels', '2026-09-28')).toBe(20);
    expect(coverageOn(r, 'gospels', '2026-09-01')).toBe(0);
  });
});

describe('recency', () => {
  const rows = [
    row(report({ name: 'Fresh', uploads: uploadedDaysAgo(2) })),
    row(report({ name: 'Check', uploads: uploadedDaysAgo(16) })),
    row(report({ name: 'Warn', uploads: uploadedDaysAgo(33) })),
    row(report({ name: 'Gone', uploads: uploadedDaysAgo(90) })),
    row(report({ name: 'New' }))
  ];
  it('counts the portfolio', () => {
    expect(portfolioCounts(rows, NOW)).toEqual({ active: 1, quiet: 2, inactive: 1, not_started: 1 });
  });
  it('lists who to contact, longest quiet first, with the days left before inactive', () => {
    expect(watchList(rows, NOW).map((w) => [w.row.report.name, w.band, w.untilInactive])).toEqual([['Warn', 'four_weeks', 12], ['Check', 'check_in', 29]]);
  });
});

describe('activity windows', () => {
  const a = report({ name: 'A', uploads: { cards: 30, chapters: 3, firstAt: null, lastAt: null,
    daily: days('2026-09-17', 14, (i) => (i < 7 ? 1 : 3)),
    log: [
      { day: '2026-09-29', at: '2026-09-29T10:00:00.000Z', unitId: 'u1', label: 'Luke 1', book: 'Luke', cards: 3, verses: 80 },
      { day: '2026-09-30', at: '2026-09-30T09:00:00.000Z', unitId: 'u2', label: 'Luke 2', book: 'Luke', cards: 3, verses: 52 },
      { day: '2026-09-20', at: '2026-09-20T09:00:00.000Z', unitId: 'u0', label: 'Mark 1', book: 'Mark', cards: 1, verses: 45 }
    ] } });
  it('compares the last week with the one before', () => {
    const w = activityWindow([row(a)], 7, NOW);
    expect([w.cards, w.previousCards, w.passages, w.books, w.languages]).toEqual([21, 7, 2, 1, 1]);
    expect(w.daily).toHaveLength(7);
  });
  it('groups the log by day, newest first', () => {
    expect(logByDay([row(a)], 7, NOW).map((d) => [d.day, d.cards])).toEqual([['2026-09-30', 3], ['2026-09-29', 3]]);
  });
  it('adds weeks across languages, oldest first', () => {
    const w = (weekStart: string, cards: number) => ({ weekStart, cards, versions: 1, reviews: 0, requests: 0 });
    expect(combinedActivity([row(report({ name: 'A', activity: [w('2026-09-21', 1), w('2026-09-28', 2)] })), row(report({ name: 'B', activity: [w('2026-09-28', 3)] }))]))
      .toEqual([{ weekStart: '2026-09-21', cards: 1, versions: 1, reviews: 0, requests: 0 }, { weekStart: '2026-09-28', cards: 5, versions: 2, reviews: 0, requests: 0 }]);
  });
});

describe('field report', () => {
  it('says what happened, and copies as text', () => {
    const a = report({ name: 'Dinka', country: 'SS', uploads: { ...uploadedDaysAgo(0), daily: days('2026-08-27', 35, (i) => (i >= 28 ? 10 : 0)) },
      coverage: { recorded: cov(40, 20), done: cov(), weekly: [{ weekEnd: '2026-09-20', recorded: cov(30, 15) }] },
      milestones: [{ scope: 'gospels', threshold: 25, at: '2026-09-28T00:00:00.000Z' }] });
    const b = report({ name: 'Nuer', uploads: uploadedDaysAgo(20) });
    const fr = fieldReport([row(a), row(b)], 'week', NOW);
    expect([fr.cards, fr.previousCards, fr.languagesRecording, fr.countries]).toEqual([70, 0, 1, 1]);
    expect(fr.advanced.map((x) => [x.row.report.name, x.scope, x.before, x.after])).toEqual([['Dinka', 'gospels', 30, 40]]);
    expect(fr.milestones).toHaveLength(1);
    expect(fr.wentQuiet.map((r) => r.report.name)).toEqual(['Nuer']);
    const text = reportText(fr, 'Demo Org');
    expect(text).toMatch(/^Demo Org: This week in the field\n2026-09-24 to 2026-09-30\n/);
    expect(text).toContain('70 recordings reached the server from 1 of 2 languages (+70 on the period before).');
    expect(text).toContain('- Dinka (Gospels): 30% to 40%');
    expect(text).toContain('Went quiet (no new recordings in 14+ days): Nuer.');
  });
  it('year to date starts on 1 January and has no comparison', () => {
    const fr = fieldReport([], 'ytd', NOW);
    expect([fr.from, fr.to, fr.previousCards]).toEqual(['2026-01-01', '2026-09-30', null]);
  });
});

describe('ledger', () => {
  const m = (month: string, chapters: number) => ({ month, chapters, books: chapters ? [{ bookId: 'luk', label: 'Luke', chapters }] : [] });
  const rows = [row(report({ name: 'Dinka', country: 'SS', ledger: [m('2026-08', 12), m('2026-09', 3)] })), row(report({ name: 'Nuer', ledger: [m('2026-08', 0), m('2026-09', 5)] }))];
  it('opens on the newest settled month', () => {
    expect(isSettled('2026-09', NOW)).toBe(false);
    expect(isSettled('2026-08', NOW)).toBe(true);
    expect(defaultLedgerMonth(['2026-08', '2026-09'], NOW)).toBe('2026-08');
    expect(defaultLedgerMonth(['2026-09'], NOW)).toBe('2026-09');
  });
  it('lists languages with chapters that month, most first, and exports them with a total', () => {
    expect(ledgerFor(rows, '2026-09').lines.map((l) => [l.row.report.name, l.chapters])).toEqual([['Nuer', 5], ['Dinka', 3]]);
    expect(ledgerFor(rows, '2026-08')).toMatchObject({ chapters: 12, books: 1, languages: 1 });
    const csv = ledgerCsv(rows, '2026-08', (c) => c ?? 'None').split('\r\n');
    expect(csv[1]).toBe('2026-08,Dinka,din,SS,12,1,Luke 12');
    expect(csv[2]).toBe('2026-08,Total,,,12,1,');
  });
});

describe('pace groups', () => {
  it('puts languages without a target last', () => {
    const t = { scope: 'nt' as const, startDate: '2026-01-01', targetDate: '2027-01-01' };
    const groups = paceGroups([row(report({ name: 'A', target: t, coverage: { recorded: cov(0, 90), done: cov(), weekly: [] } })), row(report({ name: 'B' }))], NOW);
    expect(groups.find((g) => g.band === 'ahead')!.items.map((i) => i.row.report.name)).toEqual(['A']);
    expect(groups.at(-1)).toMatchObject({ band: 'no_target' });
    expect(groups.at(-1)!.items.map((i) => i.row.report.name)).toEqual(['B']);
  });
});

describe('alerts', () => {
  it('raises stuck audio, stale figures and missing settings, the serious first', () => {
    const stuck = report({ name: 'Berom', country: 'NG', target: { scope: 'nt', startDate: '2026-01-01', targetDate: '2027-01-01' },
      alerts: { stuckCards: 400, stuckPassages: 30, stuckSince: '2026-08-01T00:00:00.000Z', invalidCards: 0 } });
    const alerts = alertsFor([row(stuck, '2026-09-29T00:00:00Z'), row(report({ name: 'Nuer' }))], 2, NOW);
    expect(alerts.map((a) => [a.id, a.level])).toEqual([['stuck', 'attention'], ['stale', 'look'], ['pending', 'fyi'], ['country', 'fyi'], ['target', 'fyi']]);
    expect(alertsFor([row(report({ name: 'Ok', country: 'SS', target: { scope: 'nt', startDate: '2026-01-01', targetDate: '2027-01-01' } }))], 0, NOW)).toEqual([]);
  });
});

describe('sortLanes', () => {
  const rows = [
    row(report({ name: 'nuer', progress: { total: 10, recorded: 9, done: 1, steps: [], waiting: 0, feedback: 0 } })),
    row(report({ name: 'Dinka', progress: { total: 4, recorded: 1, done: 1, steps: [], waiting: 0, feedback: 0 }, attention: { feedback: 2, openRequests: 0, overdueRequests: 1, atCheckpoint: 1 } })),
    row(report({ name: 'Bari', progress: { total: 0, recorded: 0, done: 0, steps: [], waiting: 0, feedback: 0 } }))
  ];
  const names = (key: Parameters<typeof sortLanes>[1], dir: 'asc' | 'desc') => sortLanes(rows, key, dir).map((r) => r.report.name);
  it('sorts names without regard to case, and shares not counts', () => {
    expect(names('name', 'asc')).toEqual(['Bari', 'Dinka', 'nuer']);
    expect(names('recorded', 'desc')).toEqual(['nuer', 'Dinka', 'Bari']);
    expect(attentionCount(rows[1]!.report)).toBe(4);
  });
});

describe('CSV', () => {
  it('quotes commas, quotes and line breaks, and never lets a name run as a formula', () => {
    expect(csvCell('Luke 15:11-32, the lost son')).toBe('"Luke 15:11-32, the lost son"');
    expect(csvCell('say "hello"')).toBe('"say ""hello"""');
    expect(csvCell('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell(null)).toBe('');
    expect(toCsv([['a']])).toBe('a\r\n');
  });
  it('writes one line per language and per book', () => {
    const r = report({ name: 'Dinka', country: 'SS', books: [{ bookId: 'luk', label: 'Luke', total: 4, recorded: 2, done: 1 }] });
    expect(lanesCsv([row(r)], NOW).split('\r\n')[1]).toMatch(/^Dinka,din,SS,Quick Check,10,4,2,40,20,0,0,0,0,,not_started,/);
    expect(laneCsv(r).split('\r\n')[1]).toBe('Luke,4,2,1,50,25');
  });
});

describe('dayPercents and timeAgo', () => {
  it('reads an empty day as zero, and says how old figures are in words', () => {
    expect(dayPercents([{ day: '2026-09-28', total: 0, recorded: 0, done: 0 }])).toEqual([{ day: '2026-09-28', recorded: 0, done: 0 }]);
    expect(timeAgo('2026-09-30T11:59:30Z', NOW)).toBe('just now');
    expect(timeAgo('2026-09-30T09:00:00Z', NOW)).toBe('3 hours ago');
  });
});

describe('routes', () => {
  it('round-trips every page, with filters in the query', () => {
    const routes: Route[] = [
      { name: 'orgs' },
      { name: 'org', orgId: 'org 1', section: 'overview', query: {} },
      { name: 'org', orgId: 'o', section: 'ledger', query: { month: '2026-08', country: 'SS' } },
      { name: 'language', orgId: 'o', projectId: 'work', laneId: 'din/1' }
    ];
    for (const route of routes) {
      const href = hrefFor(route);
      const q = href.indexOf('?');
      expect(parseRoute(q < 0 ? href : href.slice(0, q), q < 0 ? '' : href.slice(q))).toEqual(route);
    }
  });
  it('anything else is not found', () => {
    expect(parseRoute('/orgs')).toEqual({ name: 'not_found' });
    expect(parseRoute('/orgs/o/elsewhere')).toEqual({ name: 'not_found' });
  });
});
