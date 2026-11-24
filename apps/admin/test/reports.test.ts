import { describe, expect, it } from 'vitest';
import { page } from '../src/page';
import { REPORT_LOGIC } from '../src/pageReports';

/** The User reports page (docs/decisions/2026-11-24-user-reports-have-their-own-page-and-go-first.md). */
type Row = Record<string, unknown>;
const logic = new Function(`${REPORT_LOGIC}; return { reportTab, reportOrder, reportTabs, reportTitle, reportsOpen };`)() as {
  reportTab: (r: Row) => string;
  reportOrder: (reports: Row[]) => Row[];
  reportTabs: (reports: Row[], chosen: string | null) => { count: Record<string, number>; tab: string };
  reportTitle: (r: Row) => string;
  reportsOpen: (reports: Row[]) => number;
};

const report = (o: Row): Row => ({ id: String(o.id ?? 'r'), at: '2026-11-20T10:00:00Z', kind: 'bug', says: 'It broke', verdict: null, issue: null, closedAt: null, priority: null, ...o });

describe('a report on the User reports page', () => {
  it('has the tab of where it is', () => {
    expect(logic.reportTab(report({ kind: 'idea', issue: 'LAN-1' }))).toBe('idea');
    expect(logic.reportTab(report({ verdict: 'filed', issue: 'LAN-2' }))).toBe('open');
    // Added to an issue the team had: open while that issue is.
    expect(logic.reportTab(report({ verdict: 'known', issue: 'LAN-3' }))).toBe('open');
    expect(logic.reportTab(report({ verdict: 'filed', issue: 'LAN-4', closedAt: '2026-11-21T00:00:00Z' }))).toBe('closed');
    expect(logic.reportTab(report({ verdict: 'fixed' }))).toBe('closed');
    expect(logic.reportTab(report({ verdict: 'noise' }))).toBe('noise');
    expect(logic.reportTab(report({}))).toBe('waiting');
  });

  it('puts the open problems first, the most important first, as the fix team takes them', () => {
    const order = logic.reportOrder([
      report({ id: 'idea', kind: 'idea', at: '2026-11-23T00:00:00Z' }),
      report({ id: 'low', issue: 'LAN-5', priority: 4, at: '2026-11-01T00:00:00Z' }),
      report({ id: 'new', at: '2026-11-22T00:00:00Z' }),
      report({ id: 'none-late', issue: 'LAN-6', priority: 0, at: '2026-11-10T00:00:00Z' }),
      report({ id: 'urgent', issue: 'LAN-7', priority: 1, at: '2026-11-15T00:00:00Z' }),
      report({ id: 'none-early', issue: 'LAN-8', priority: null, at: '2026-11-02T00:00:00Z' }),
      report({ id: 'fixed', verdict: 'fixed', at: '2026-11-24T00:00:00Z' })
    ]).map((r) => r.id);
    expect(order).toEqual(['urgent', 'none-early', 'none-late', 'low', 'new', 'fixed', 'idea']);
  });

  it('counts each tab and opens the first that holds a report', () => {
    const reports = [report({ issue: 'LAN-1' }), report({}), report({ kind: 'idea' }), report({ verdict: 'noise' })];
    const t = logic.reportTabs(reports, null);
    expect(t.count).toEqual({ all: 4, open: 1, waiting: 1, idea: 1, closed: 0, noise: 1 });
    expect(t.tab).toBe('open');
    expect(logic.reportTabs(reports, 'idea').tab).toBe('idea');
    expect(logic.reportTabs(reports, 'closed').tab).toBe('open');
    expect(logic.reportTabs([report({ kind: 'idea' })], null).tab).toBe('idea');
    expect(logic.reportsOpen(reports)).toBe(2);
  });

  it('takes its title from the Linear issue, else from what the person said', () => {
    expect(logic.reportTitle(report({ title: 'User issue: Can not remove old passages' }))).toBe('Can not remove old passages');
    expect(logic.reportTitle(report({ says: 'Short\nand more' }))).toBe('Short');
    const long = 'word '.repeat(40);
    expect(logic.reportTitle(report({ says: long })).length).toBeLessThanOrEqual(91);
    expect(logic.reportTitle(report({ says: '', voiceMs: 4000 }))).toBe('A voice note');
  });

  it('is a page in the menu, before User issues', async () => {
    const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
    expect(html).toContain('function userReportsHtml(d)');
    expect(html).toContain('"id":"userreports","title":"User reports"');
    expect(html.indexOf("'userreports', 'userissues'") >= 0 || html.indexOf('"userreports","userissues"') >= 0).toBe(true);
  });
});
