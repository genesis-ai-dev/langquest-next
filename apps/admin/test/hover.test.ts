import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { page } from '../src/page';
import { HOVER_LOGIC, HOVER_SCRIPT } from '../src/pageHover';
import { LISTS_SCRIPT } from '../src/pageLists';
import { METERS_SCRIPT } from '../src/pageMeters';
import { OVERVIEW_SCRIPT } from '../src/pageOverview';
import { START_SCRIPT } from '../src/pageStart';

interface Hv { x: number; w: number; h: string[]; l: [string, string, string[]][]; a?: number; b?: number }

/** Where the line and the box go, as the page works it out (pageHover.ts HOVER_LOGIC). */
const logic = new Function(`${HOVER_LOGIC}; return { hvPack, hvIndex, hvAt, hvPlace };`)() as {
  hvPack: (x: number, step: number, heads: string[], lines: Hv['l'], from?: number, to?: number) => string;
  hvIndex: (hv: Hv, x: number) => number;
  hvAt: (hv: Hv, i: number) => { x: number; head: string; lines: { mark: string; name: string; value: string }[] };
  hvPlace: (x: number, top: number, bottom: number, w: number, h: number, winW: number) => { left: number; top: number };
};
const days = (n: number) => Array.from({ length: n }, (_, i) => `day ${i}`);

describe('what a chart says under the pointer', () => {
  it('says the day and each value of the bucket the pointer is over, with the line in the middle of that bucket', () => {
    const hv = JSON.parse(logic.hvPack(34, 37.571, ['Nov 6 UTC', 'Nov 7 UTC', 'Nov 8 UTC'], [['a', 'Errors', ['14', '9', '22']], ['b', 'Crashes', ['0', '0', '1']]], 8, 168)) as Hv;
    const i = logic.hvIndex(hv, 34 + 37.571 * 2 + 3);
    expect(i).toBe(2);
    expect(logic.hvAt(hv, i)).toMatchObject({ head: 'Nov 8 UTC', lines: [{ mark: 'a', name: 'Errors', value: '22' }, { mark: 'b', name: 'Crashes', value: '1' }] });
    expect(logic.hvAt(hv, i).x).toBeCloseTo(34 + 2.5 * 37.571, 1);
    expect([hv.a, hv.b]).toEqual([8, 168]);
  });

  it('gives a row of squares the box and no line', () => {
    const hv = JSON.parse(logic.hvPack(-1, 12, days(3), [['', 'blob_reconcile', ['Ran', 'Failed', 'No run']]])) as Hv;
    expect(hv.b).toBeUndefined();
    expect(logic.hvAt(hv, 1).lines).toEqual([{ mark: '', name: 'blob_reconcile', value: 'Failed' }]);
  });

  it('is over the bucket a tap there opens, however many buckets the chart has, and over the nearest bucket past either end (a finger that slides off the chart)', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1000 }), fc.nat(), fc.double({ min: 0.02, max: 0.98, noNaN: true }), (n, pick, inside) => {
      const w = 300, k = pick % n, hv = JSON.parse(logic.hvPack(0, w / n, days(n), [['', 'x', days(n)]], 0, 96)) as Hv;
      const across = (k + inside) / n;
      // bucketAt in pageStart.ts: the bucket a tap or a click opens.
      expect(Math.max(0, Math.min(n - 1, Math.floor(across * n)))).toBe(k);
      expect(logic.hvIndex(hv, across * w)).toBe(k);
      expect(logic.hvAt(hv, k).head).toBe(`day ${k}`);
      // The line is inside the bucket it speaks for.
      expect(logic.hvIndex(hv, logic.hvAt(hv, k).x)).toBe(k);
      expect(logic.hvIndex(hv, -40)).toBe(0);
      expect(logic.hvIndex(hv, w + 40)).toBe(n - 1);
    }));
  });

  it('keeps the box in the window: above the chart, under it when there is no room above, and never past a side', () => {
    fc.assert(fc.property(fc.integer({ min: 320, max: 2000 }), fc.integer({ min: 40, max: 300 }), fc.integer({ min: 20, max: 120 }), fc.double({ min: -50, max: 2050, noNaN: true }), fc.integer({ min: -200, max: 900 }),
      (winW, w, h, x, top) => {
        const p = logic.hvPlace(x, top, top + 96, w, h, winW);
        expect(p.left).toBeGreaterThanOrEqual(8);
        expect(p.left + w).toBeLessThanOrEqual(winW - 8);
        // Never on the chart itself: the box is all above it or all under it.
        expect(p.top + h <= top || p.top >= top + 96).toBe(true);
        if (p.top < top) expect(p.top).toBeGreaterThanOrEqual(4);
      }));
    expect(logic.hvPlace(500, 300, 396, 120, 40, 1280)).toEqual({ left: 440, top: 254 });
    expect(logic.hvPlace(500, 20, 116, 120, 40, 1280).top).toBe(122);
  });

  it('is on every chart the page draws, and a mark of a list says its words in the same box, not in a second one of the browser', async () => {
    // Each drawer of a chart with a bucket for each day, hour, week or month hands its values to hvAttr.
    for (const [drawer, script] of [['function miniSvg', START_SCRIPT], ['function squareSvg', START_SCRIPT], ['function chartSvg', START_SCRIPT], ['function daysSvg', OVERVIEW_SCRIPT], ['function lineSvg', LISTS_SCRIPT]] as const) {
      const from = script.indexOf(drawer);
      expect(from, drawer).toBeGreaterThan(-1);
      const next = script.indexOf('\nfunction ', from + 1);
      expect(script.slice(from, next < 0 ? undefined : next), drawer).toContain('hvAttr(');
    }
    // Both small pictures of the Overview pass what the pointer says.
    expect(OVERVIEW_SCRIPT.match(/miniSvg\([^)]*gl\.say\)/g)).toHaveLength(2);
    expect(OVERVIEW_SCRIPT).toContain("daysSvg(days, errs, crashes, 'Errors', 'Crashes')");
    // A dot, a square, a bar and a part of a bar carry their words on themselves.
    expect(LISTS_SCRIPT.match(/data-tip="/g)).toHaveLength(3);
    expect(METERS_SCRIPT.match(/data-tip="/g)).toHaveLength(2);
    for (const script of [START_SCRIPT, OVERVIEW_SCRIPT, LISTS_SCRIPT, METERS_SCRIPT]) expect(script).not.toContain('<title>');
    const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
    expect(html).toContain("document.addEventListener('pointermove', hvPoint);");
    expect(html).toContain('function hvPack(');
  });

  it('follows a finger that slides along a chart, and leaves a slide up or down to scroll the page', async () => {
    const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
    expect(html).toContain('svg[data-hv] { touch-action: pan-y pinch-zoom;');
    expect(HOVER_SCRIPT).toContain("document.addEventListener('pointerdown', hvPoint);");
    expect(HOVER_SCRIPT).toContain("document.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') hvHide(); });");
    expect(HOVER_SCRIPT).toContain("document.addEventListener('pointercancel', hvHide);");
  });
});
