// How Reports says its bands, sections, dates and texts (src/reports/labels.ts, sectionsModel.ts, format.ts).
import { describe, expect, it } from 'vitest';
import {
  alertsFor, fieldReport,
  type AlertLevel, type LanguageReport, type LanguageRow, type PaceBand, type PassageWork, type RecencyBand, type TargetScope
} from '@langquest-next/core';
import { t } from '../src/i18n';
import {
  bottleneckText, LEVEL_TONE, levelCount, levelLabel, milestoneText, PACE_TONE, paceAdvice, paceLabel, recencyAdvice, recencyDaysLabel, recencyLabel,
  RECENCY_TONE, scopeLabel, scopeShort, stageName, WORK_TONE, workLabel
} from '../src/reports/labels';
import { ago, bookOf, dateTime, dayYear, longDay, monthName, monthShort, partOf, shortDate, signed, utc, utcTime, weekday } from '../src/reports/format';
import { alertText, fieldReportText, fieldTitle, openAlerts, SECTIONS, sectionHelp, sectionLabel } from '../src/reports/sectionsModel';

const WORK: PassageWork[] = ['not_started', 'drafting', 'in_review', 'feedback', 'done'];
const RECENCY: RecencyBand[] = ['active', 'check_in', 'reminder', 'four_weeks', 'five_weeks', 'inactive', 'not_started'];
const PACE: (PaceBand | 'no_target')[] = ['ahead', 'on_pace', 'behind', 'stalled', 'complete', 'no_target'];
const LEVELS: AlertLevel[] = ['attention', 'look', 'fyi'];
const SCOPES: TargetScope[] = ['gospels', 'nt', 'ot', 'bible'];
const TONES = ['brand', 'green', 'amber', 'red', 'gray'];

/** A label that is the catalog's path was never found in it. */
const words = (s: string) => {
  expect(s).toBeTruthy();
  expect(s).not.toMatch(/^[a-z]+(\.[A-Za-z]+)+$/);
};

describe('the report\'s bands, in words and tones', () => {
  it('give every passage stage, recency, pace and alert level a label and a tone', () => {
    for (const w of WORK) { words(workLabel(w)); expect(TONES).toContain(WORK_TONE[w]); }
    for (const r of RECENCY) { words(recencyLabel(r)); words(recencyAdvice(r)); expect(TONES).toContain(RECENCY_TONE[r]); }
    for (const p of PACE) { words(paceLabel(p)); words(paceAdvice(p)); expect(TONES).toContain(PACE_TONE[p]); }
    for (const l of LEVELS) { words(levelLabel(l)); words(levelCount(l, 2)); expect(TONES).toContain(LEVEL_TONE[l]); }
    for (const s of SCOPES) words(scopeLabel(s));
    for (const s of ['gospels', 'nt', 'ot'] as const) words(scopeShort(s));
  });

  it('keep the three alert levels and the pace bands told apart by tone', () => {
    expect(new Set(LEVELS.map((l) => LEVEL_TONE[l])).size).toBe(3);
    expect(PACE_TONE.stalled).toBe('red');
    expect(PACE_TONE.behind).toBe('amber');
    expect(RECENCY_TONE.active).toBe('green');
  });

  it('say how many days a recency band spans', () => {
    for (const r of RECENCY.filter((x) => x !== 'not_started')) words(recencyDaysLabel(r as Exclude<RecencyBand, 'not_started'>));
    expect(recencyDaysLabel('inactive')).toMatch(/\+|\d/);
  });

  it('say a flow step with each shipped kind in the language showing, and a name the organization chose as written', () => {
    expect(stageName('Rare custom check')).toBe('Rare custom check');
    expect(stageName('Custom A + Custom B')).toBe('Custom A + Custom B');
  });
});

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-30T12:00:00Z');
const cov = (g = 0, nt = 0, ot = 0) => ({ gospels: g, nt, ot, bible: 0 });
function report(over: Partial<LanguageReport> & { name: string }): LanguageReport {
  return {
    languageId: over.name.toLowerCase(), code: over.name.slice(0, 3).toLowerCase(), country: 'SS', flowName: 'Quick Check', target: { scope: 'nt', startDate: '2026-01-01', targetDate: '2027-01-01' },
    progress: { total: 10, recorded: 4, done: 2, steps: [], waiting: 0, feedback: 0 },
    work: { not_started: 5, drafting: 1, in_review: 2, feedback: 0, done: 2 },
    stages: [], bottleneck: null,
    attention: { feedback: 0, openRequests: 0, overdueRequests: 0, atCheckpoint: 0 },
    books: [], activity: [], lastActivity: null,
    coverage: { recorded: cov(), done: cov(), weekly: [] },
    milestones: [], progressDaily: [],
    uploads: { cards: 0, chapters: 0, firstAt: null, lastAt: null, daily: [], log: [] },
    ledger: [], alerts: { stuckCards: 0, stuckPassages: 0, stuckSince: null, invalidCards: 0 },
    ...over
  };
}
const row = (r: LanguageReport, updatedAt = '2026-09-30T11:00:00Z'): LanguageRow => ({ orgId: 'o', languageId: r.languageId, updatedAt, report: r });

describe('the Reports sections', () => {
  it('give every section a name and a help line in words, and say which filter by country', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['overview', 'activity', 'languages', 'geography', 'field', 'ledger', 'pace', 'alerts']);
    for (const s of SECTIONS) { words(sectionLabel(s.id)); words(sectionHelp(s.id)); }
    expect(SECTIONS.filter((s) => !s.filterCountry).map((s) => s.id)).toEqual(['geography', 'alerts']);
  });

  it('count only the alerts that need someone, never the for-your-information ones', () => {
    const asOf = '2026-09-30T11:59:00Z';
    // No country and no target are "fyi"; stuck audio and a failed check are not.
    const quiet = [row(report({ name: 'Dinka', country: null, target: null }))];
    expect(alertsFor(quiet, asOf, NOW).map((a) => a.level)).toEqual(['fyi', 'fyi']);
    expect(openAlerts(quiet, asOf, NOW)).toBe(0);
    const trouble = [...quiet, row(report({ name: 'Nuer', alerts: { stuckCards: 3, stuckPassages: 1, stuckSince: null, invalidCards: 2 } }))];
    expect(openAlerts(trouble, asOf, NOW)).toBe(2);
    // Figures read a week ago add the "not current" alert.
    expect(openAlerts(quiet, '2026-09-20T00:00:00Z', NOW)).toBe(1);
  });
});

describe('the alerts, in words', () => {
  it('say each core alert from its id, with the counts it carries', () => {
    const rows = [
      row(report({ name: 'A', country: null, target: null, alerts: { stuckCards: 3, stuckPassages: 1, stuckSince: null, invalidCards: 0 } })),
      row(report({ name: 'B', alerts: { stuckCards: 4, stuckPassages: 1, stuckSince: null, invalidCards: 5 } }))
    ];
    const byId = Object.fromEntries(alertsFor(rows, '2026-09-20T00:00:00Z', NOW).map((a) => [a.id, a]));
    expect(alertText(byId['stale']!, '2026-09-20T00:00:00Z', NOW).body).toBe(t('reports.alerts.stale.body', { ago: ago('2026-09-20T00:00:00Z', NOW) }));
    expect(alertText(byId['stuck']!, '', NOW).body).toBe(t('reports.alerts.stuck.body', { count: 7 }));
    expect(alertText(byId['invalid']!, '', NOW).body).toBe(t('reports.alerts.invalid.body', { count: 5 }));
    expect(alertText(byId['country']!, '', NOW).body).toBe(t('reports.alerts.country.body', { count: 1 }));
    expect(alertText(byId['target']!, '', NOW).body).toBe(t('reports.alerts.target.body', { count: 1 }));
    for (const id of ['stale', 'stuck', 'invalid', 'country', 'target']) {
      const w = alertText(byId[id]!, '', NOW);
      words(w.title); words(w.action);
    }
  });

  it('shows an alert core adds later as core wrote it', () => {
    const later = { id: 'new-thing', level: 'look', title: 'T', body: 'B', action: 'A', rows: [] } as unknown as Parameters<typeof alertText>[0];
    expect(alertText(later, '', NOW)).toEqual({ title: 'T', body: 'B', action: 'A' });
  });
});

describe('the field report, as text to paste', () => {
  const a = report({
    name: 'Dinka', uploads: { cards: 9, chapters: 2, firstAt: null, lastAt: '2026-09-29T00:00:00Z', daily: [{ day: '2026-09-28', cards: 9, chapters: 2 }], log: [] },
    coverage: { recorded: cov(0, 20, 0), done: cov(), weekly: [{ weekEnd: '2026-09-20', recorded: cov(0, 5) }] }
  });
  const b = report({ name: 'Nuer' });

  it('headlines, counts, and leaves out the sections nothing fills', () => {
    const fr = fieldReport([row(a), row(b)], 'week', NOW);
    const text = fieldReportText(fr, 'Wycliffe');
    const lines = text.split('\n');
    expect(lines[0]).toBe(t('reports.fieldText.heading', { org: 'Wycliffe', title: fieldTitle(fr) }));
    expect(lines[1]).toBe(t('reports.fieldText.range', { from: fr.from, to: fr.to }));
    expect(text).toContain('Dinka');
    expect(text.endsWith('\n')).toBe(true);
    expect(text).not.toMatch(/\n\n\n/);
    expect(text).not.toContain(t('reports.fieldText.wentQuiet', { names: '' }).trim());
  });

  it('compares with the period before, except for the year so far', () => {
    const week = fieldReport([row(a)], 'week', NOW);
    expect(week.previousCards).not.toBeNull();
    expect(fieldReportText(week, 'O')).toContain(signed(week.cards - week.previousCards!));
    const ytd = fieldReport([row(a)], 'ytd', NOW);
    expect(ytd.previousCards).toBeNull();
    expect(fieldTitle(ytd)).toBe(t('reports.field.titleYear', { year: '2026' }));
    expect(fieldTitle(week)).toBe(t('reports.field.titleWeek'));
    expect(fieldTitle(fieldReport([], 'month', NOW))).toBe(t('reports.field.titleMonth'));
  });

  it('names a milestone and who went quiet', () => {
    const quiet = report({ name: 'Mursi', uploads: { cards: 1, chapters: 1, firstAt: null, lastAt: new Date(NOW - 16 * DAY).toISOString(), daily: [], log: [] } });
    const fr = fieldReport([row(quiet)], 'week', NOW);
    expect(fr.wentQuiet).toHaveLength(1);
    expect(fieldReportText(fr, 'O')).toContain(t('reports.fieldText.wentQuiet', { names: 'Mursi' }));
  });
});

describe('Reports\' dates fall on UTC days', () => {
  it('read a day, or the day part of a time, as midnight UTC', () => {
    expect(utc('2026-10-03').toISOString()).toBe('2026-10-03T00:00:00.000Z');
    expect(utc('2026-10-03T23:59:59Z').toISOString()).toBe('2026-10-03T00:00:00.000Z');
  });

  it('say the same day wherever the phone is, at both ends of the day', () => {
    for (const iso of ['2026-10-03T00:00:00Z', '2026-10-03T23:59:59Z']) {
      expect(shortDate(iso)).toBe(shortDate('2026-10-03'));
      expect(dayYear(iso)).toBe(dayYear('2026-10-03'));
      expect(weekday(iso)).toBe('Sat');
    }
    expect(weekday('2026-10-04')).toBe('Sun');
    expect(longDay('2026-10-03')).toContain('Saturday');
    expect(shortDate('2026-10-03')).toMatch(/Oct/);
    expect(dayYear('2026-10-03')).toContain('2026');
  });

  it('say a time in UTC with a 24-hour clock', () => {
    expect(utcTime('2026-10-03T00:05:00Z')).toBe(t('reports.timeUtc', { time: '00:05' }));
    expect(utcTime('2026-10-03T23:59:00Z')).toBe(t('reports.timeUtc', { time: '23:59' }));
    expect(dateTime('2026-10-03T14:05:00Z')).toBe(t('reports.dateTimeUtc', { date: dayYear('2026-10-03'), time: '14:05' }));
  });

  it('say months', () => {
    expect(monthName('2026-10')).toMatch(/October/);
    expect(monthShort('2026-10')).toMatch(/Oct/);
  });

  it('say how long ago, in the unit that fits', () => {
    const at = (secs: number) => new Date(NOW - secs * 1000).toISOString();
    expect(ago(at(5), NOW)).toBe(t('reports.ago.justNow'));
    expect(ago(at(-30), NOW)).toBe(t('reports.ago.justNow'));
    expect(ago(at(60), NOW)).toBe(t('reports.ago.minutes', { count: 1 }));
    expect(ago(at(3599), NOW)).toBe(t('reports.ago.minutes', { count: 59 }));
    expect(ago(at(3600), NOW)).toBe(t('reports.ago.hours', { count: 1 }));
    expect(ago(at(86_400), NOW)).toBe(t('reports.ago.days', { count: 1 }));
    expect(ago(at(3 * 86_400 + 5), NOW)).toBe(t('reports.ago.days', { count: 3 }));
  });

  it('say a change with its sign, a part of a whole, and a book as the organization or the Bible names it', () => {
    expect(signed(5)).toBe('+5');
    expect(signed(0)).toBe('+0');
    expect(signed(-3)).toMatch(/^[-−]3$/);
    expect(partOf(12, 40)).toBe(t('reports.partOf', { part: '12', total: '40' }));
    expect(bookOf({ bookId: null, label: 'Our own book' })).toBe('Our own book');
    expect(bookOf({ bookId: 'LUK', label: 'ignored' })).not.toBe('ignored');
  });
});

describe('the language page\'s bottleneck and milestones', () => {
  it('names the step most passages wait at, or nothing when none wait', () => {
    expect(bottleneckText(report({ name: 'A', stages: [] }))).toBeNull();
    const stages = [{ name: 'Draft', passages: 0 }, { name: 'Peer', passages: 4 }, { name: 'Elder', passages: 4 }] as unknown as LanguageReport['stages'];
    expect(bottleneckText(report({ name: 'A', stages }))).toBe(t('reports.language.bottleneckValue', { count: 4, step: stageName('Peer') }));
  });

  it('says a milestone in full for a whole scope and in part otherwise', () => {
    const r = row(report({ name: 'Dinka' }));
    expect(milestoneText({ at: '2026-09-01T00:00:00Z', scope: 'nt', threshold: 100, row: r } as never)).toBe(t('reports.milestone.full', { name: 'Dinka', scope: scopeLabel('nt') }));
    expect(milestoneText({ at: '2026-09-01T00:00:00Z', scope: 'nt', threshold: 50, row: r } as never)).toContain('Dinka');
  });
});
