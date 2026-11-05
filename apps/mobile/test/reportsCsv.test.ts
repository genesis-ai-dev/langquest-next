// The report CSVs: core's cells under the app's headers (src/reports/csvModel.ts).
import { describe, expect, it } from 'vitest';
import type { LanguageReport, LanguageRow } from '@langquest-next/core';
import { t } from '../src/i18n';
import { languageCsv, languagesCsv, ledgerCsv } from '../src/reports/csvModel';

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
const row = (r: LanguageReport): LanguageRow => ({ orgId: 'o', languageId: r.languageId, updatedAt: '2026-09-30T11:00:00Z', report: r });

describe('the report CSVs', () => {
  it('write one line per language and per book, under headers in the language showing', () => {
    const r = report({ name: 'Dinka', books: [{ bookId: 'luk', label: 'Luke', total: 4, recorded: 2, done: 1 }] });
    const langs = languagesCsv([row(r)], NOW).split('\r\n');
    expect(langs[0]!.startsWith(`${t('reports.csv.language')},${t('reports.csv.code')}`)).toBe(true);
    expect(langs[1]).toMatch(/^Dinka,din,SS,,Quick Check,10,4,2,40,20,0,0,0,0,,not_started,/);
    const books = languageCsv(r).split('\r\n');
    expect(books[0]).toContain(t('reports.csv.book'));
    expect(books[1]).toBe('Luke,4,2,1,50,25');
  });

  it('write the ledger with a total line', () => {
    const r = report({ name: 'Dinka', ledger: [{ month: '2026-08', chapters: 12, books: [{ bookId: 'luk', label: 'Luke', chapters: 12 }] }] });
    const csv = ledgerCsv([row(r)], '2026-08').split('\r\n');
    expect(csv[1]).toMatch(/^2026-08,Dinka,din,.*,12,1,Luke 12$/);
    expect(csv[2]).toBe(`2026-08,${t('reports.csv.total')},,,12,1,`);
  });
});
