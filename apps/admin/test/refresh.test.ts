import { describe, expect, it } from 'vitest';
import { page } from '../src/page';
import { OVERVIEW_SCRIPT } from '../src/pageOverview';
import { START_SCRIPT } from '../src/pageStart';
import { SYSMAP_SCRIPT } from '../src/pageSysMap';

/** The page's script between two markers. */
function between(text: string, from: string, to: string): string {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a + from.length);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(b).toBeGreaterThan(a);
  return text.slice(a, b);
}

describe('the five-minute refresh keeps the page still', async () => {
  const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
  const load = between(html, 'async function load(fresh) {', '\nasync function start()');

  it('keeps every answer, chart and status on the page until its new answer comes', () => {
    expect(load).not.toMatch(/delete results\[/);
    expect(load).not.toMatch(/glanceData = null|fixData = null/);
    expect(load).not.toMatch(/Loading…/);
    // renderHist draws each chart as "Loading…" first: a refresh draws over the old charts (refreshCharts).
    expect(load).not.toMatch(/renderHist\(/);
    expect(load).toMatch(/refreshCharts\(\)/);
  });

  it('draws a section, the attention list, the Overview and a chart over the old one in place', () => {
    expect(between(html, 'function show(id, s) {', '\nfunction attention()')).toMatch(/redraw\(\$\('body-' \+ g\.id\)/);
    expect(between(html, 'function attention() {', '\n/** The CLI')).toMatch(/redraw\(\$\('attention-list'\)/);
    for (const box of ['start-you', 'start-tiles', 'start-charts', 'start-shipped']) {
      expect(OVERVIEW_SCRIPT).toContain(`redraw($('${box}')`);
      expect(OVERVIEW_SCRIPT).not.toContain(`$('${box}').innerHTML`);
    }
    // The map of where problems happen is drawn once; a refresh changes only its states, so its zoom, scroll and panel stay.
    expect(between(SYSMAP_SCRIPT, 'function smBuild() {', '\nfunction ')).toContain('if (!canvas || sm.built) return;');
    expect(SYSMAP_SCRIPT).toContain('function drawSysMap() { smBuild(); smLive(); }');
    expect(between(START_SCRIPT, 'function drawPart(part, hst) {', '\nfunction bucketLabel')).toMatch(/redraw\(box,/);
  });
});
