import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { RLINE_CSS, RLINE_HTML, RLINE_LOGIC } from '../src/pageReleaseLine';
import { RLINE_SCRIPT } from '../src/pageReleaseLineDraw';
import { START_SCRIPT } from '../src/pageStart';
import { ASK_SCRIPT } from '../src/pageAsk';
import { page } from '../src/page';

type Life = { r: number | null; w: number | null; m: number; i: number | null; a: number | null; start: number; end: number };
type Merge = Record<string, unknown> & { n: number; t: string; ti: string; s: string; ar: [string, string[]][]; w: { kind: string; name: string } };
interface Filters { q: string; areas: Set<string>; subs: Set<string>; who: Set<string>; where: Set<string>; how: Set<string>; issue: Set<string>; db: boolean }

/** The line's pure parts, as the page runs them (pageReleaseLine.ts RLINE_LOGIC). */
const logic = new Function(`${RLINE_LOGIC}; return { RL_H, rlWhere, rlLife, rlPack, rlMaxZoom, rlPlace, rlErrHours, rlDur, rlMatches };`)() as {
  RL_H: number;
  rlWhere: (m: Record<string, unknown>) => string;
  rlLife: (m: Record<string, unknown>, issues: Record<string, { createdAt: string }>, now: number) => Life;
  rlPack: (items: { id: number; L: { start: number; end: number } }[]) => { rows: Map<number, number>; count: number };
  rlMaxZoom: (times: number[], cardWidth: number, spanHours: number) => number;
  rlPlace: <T>(list: T[], xs: Map<T, number>, rows: number, cardWidth: number, score: (m: T) => number) => { placed: Map<T, { r: number; left: number }>; hidden: T[] };
  rlErrHours: (kinds: { id: string; s: [number, number, number][] }[], chosen: Set<string>, h0: number) => Map<number, number>;
  rlDur: (ms: number) => string;
  rlMatches: (m: Merge, f: Filters, whoKey: (w: { kind: string; name: string }) => string) => boolean;
};
const H = 3_600_000;
const T = Date.parse('2026-11-20T12:00:00Z');
const at = (h: number) => new Date(T + h * H).toISOString();

describe('where a change is', () => {
  it('is on phones once a production phone ran it, on its way before, and no phone change when the phone app did not change', () => {
    expect(logic.rlWhere({ app: 1, i: at(1) })).toBe('live');
    expect(logic.rlWhere({ app: 1, a: at(1) })).toBe('live');
    expect(logic.rlWhere({ app: 1 })).toBe('onway');
    expect(logic.rlWhere({})).toBe('none');
  });
});

describe('a change’s own line', () => {
  it('starts at its issue’s report when Linear says one before the merge, and at its work when the work came first', () => {
    const m = { t: at(0), ws: at(-5), is: [{ id: 'LAN-1' }, { id: 'LAN-2' }], app: 1, i: at(2), a: at(3) };
    const L = logic.rlLife(m, { 'LAN-1': { createdAt: at(-30) }, 'LAN-2': { createdAt: at(-40) } }, T + 10 * H);
    expect([L.r, L.w, L.m, L.i, L.a, L.start, L.end]).toEqual([T - 40 * H, T - 5 * H, T, T + 2 * H, T + 3 * H, T - 40 * H, T + 3 * H]);
    // An issue reported after the merge is not the reason for it; work cannot start before its report.
    expect(logic.rlLife({ ...m, is: [{ id: 'LAN-1' }] }, { 'LAN-1': { createdAt: at(1) } }, T).r).toBeNull();
    expect(logic.rlLife({ ...m, ws: at(-50), is: [{ id: 'LAN-1' }] }, { 'LAN-1': { createdAt: at(-30) } }, T + 10 * H).w).toBe(T - 30 * H);
  });

  it('runs to now while a platform has yet to run it, and ends at the merge when the phone app did not change', () => {
    expect(logic.rlLife({ t: at(0), ws: at(-1), app: 1, i: at(2) }, {}, T + 9 * H).end).toBe(T + 9 * H);
    expect(logic.rlLife({ t: at(0), ws: at(-1), app: 1 }, {}, T + 9 * H).end).toBe(T + 9 * H);
    const none = logic.rlLife({ t: at(0), ws: at(-1) }, {}, T + 9 * H);
    expect([none.start, none.end]).toEqual([T - H, T]);
    // Work said to start after the merge is not drawn.
    expect(logic.rlLife({ t: at(0), ws: at(2) }, {}, T).w).toBeNull();
  });
});

describe('rows for the lines', () => {
  it('never lets two lines on one row touch, and puts the long ones under the short ones', () => {
    fc.assert(fc.property(fc.array(fc.tuple(fc.integer({ min: 0, max: 500 }), fc.integer({ min: 0, max: 200 })), { maxLength: 60 }), (spans) => {
      const items = spans.map(([s, len], id) => ({ id, L: { start: s * H, end: (s + len) * H } }));
      const { rows, count } = logic.rlPack(items);
      expect(rows.size).toBe(items.length);
      for (const a of items) for (const b of items) {
        if (a.id >= b.id || rows.get(a.id) !== rows.get(b.id)) continue;
        const [p, q] = a.L.start <= b.L.start ? [a, b] : [b, a];
        expect(p.L.end + 0.4 * H).toBeLessThanOrEqual(q.L.start);
      }
      const shortest = items.filter((x) => x.L.end - x.L.start <= 48 * H).map((x) => rows.get(x.id)!);
      const longest = items.filter((x) => x.L.end - x.L.start > 48 * H).map((x) => rows.get(x.id)!);
      if (shortest.length && longest.length) expect(Math.min(...longest)).toBeGreaterThan(Math.max(...shortest));
      expect(count).toBeGreaterThanOrEqual(1);
    }));
  });
});

describe('zoom', () => {
  it('goes deep enough that any three changes in a row fit two rows of cards', () => {
    const times = [0, 60_000, 120_000, 10 * H].map((x) => T + x);
    const px = logic.rlMaxZoom(times, 316, 720);
    // Three changes two minutes apart: two card widths in two minutes.
    expect((px * 2) / 60).toBeGreaterThanOrEqual(316 + 12);
    expect(logic.rlMaxZoom([T], 316, 720)).toBe(240);
  });

  it('never makes the line wider than browsers draw', () => {
    expect(logic.rlMaxZoom([T, T + 1000, T + 2000], 316, 720) * 720).toBeLessThanOrEqual(16e6);
  });

  it('puts every card on the line at the deepest zoom when changes are a minute or more apart', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 1, max: 600 }), { minLength: 1, maxLength: 120 }), (gaps) => {
      let t = T;
      const times = gaps.map((g) => (t += g * 60_000));
      const span = (times[times.length - 1]! - T) / H + 24;
      const px = logic.rlMaxZoom(times, 316, span);
      fc.pre(px < 16e6 / span);
      const xs = new Map(times.map((x) => [x, 24 + ((x - T) / H) * px]));
      expect(logic.rlPlace(times, xs, 2, 316, (x) => x).hidden).toEqual([]);
    }));
  });
});

describe('cards on rows', () => {
  it('never puts two cards over each other, and gives one to the most telling first', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 5000 }), { maxLength: 80 }), fc.integer({ min: 1, max: 4 }), (xsList, rows) => {
      const list = xsList.map((x, i) => ({ i, x }));
      const { placed, hidden } = logic.rlPlace(list, new Map(list.map((m) => [m, m.x])), rows, 220, (m) => -m.i);
      expect(placed.size + hidden.length).toBe(list.length);
      const cards = [...placed.values()];
      for (const [j, a] of cards.entries()) for (const b of cards.slice(j + 1)) if (a.r === b.r) expect(Math.abs(a.left - b.left)).toBeGreaterThanOrEqual(230);
      // The first by score never waits behind a later one.
      if (list.length) expect(hidden.includes(list[0]!) && !placed.has(list[0]!) && list[0]!.x - 16 >= 4).toBe(false);
    }));
  });
});

describe('failures by hour', () => {
  it('adds the chosen kinds hour by hour and spreads a day’s count over its 24 hours', () => {
    const h0 = Date.parse('2026-11-01T00:00:00Z');
    const map = logic.rlErrHours([{ id: 'a', s: [[0, 48, 24], [30, 5, 1]] }, { id: 'b', s: [[30, 2, 1]] }, { id: 'c', s: [[30, 100, 1]] }], new Set(['a', 'b']), h0);
    expect(map.get(h0)).toBe(2);
    expect(map.get(h0 + 23 * H)).toBe(2);
    expect(map.get(h0 + 30 * H)).toBe(7);
    expect([...map.values()].reduce((x, y) => x + y, 0)).toBe(55);
  });
});

describe('durations', () => {
  it('says minutes, hours and minutes, then days and hours', () => {
    expect(logic.rlDur(25 * 60_000)).toBe('25 min');
    expect(logic.rlDur(3 * H + 10 * 60_000)).toBe('3 h 10 min');
    expect(logic.rlDur(5 * H)).toBe('5 h');
    expect(logic.rlDur((7 * 24 + 17) * H)).toBe('7 d 17 h');
  });
});

describe('filters', () => {
  const none = (): Filters => ({ q: '', areas: new Set(), subs: new Set(), who: new Set(), where: new Set(), how: new Set(), issue: new Set(), db: false });
  const key = (w: { kind: string; name: string }) => (w.kind === 'thread' ? 'thread' : w.kind + ':' + w.name);
  const m: Merge = { n: 716, t: at(0), s: 'abc', ti: 'Sync starts again by itself', ar: [['app', ['Sync and data']], ['tests', ['Code tests']]], w: { kind: 'agent', name: 'Issue fix team' }, app: 1, is: [{ id: 'LAN-339', r: 'f', title: 'Sync stops after a network drop' }], mg: ['20261126000000'] };

  it('keeps a change that matches every chosen filter, and an area without a chosen part keeps all its parts', () => {
    expect(logic.rlMatches(m, none(), key)).toBe(true);
    expect(logic.rlMatches(m, { ...none(), areas: new Set(['app']) }, key)).toBe(true);
    expect(logic.rlMatches(m, { ...none(), areas: new Set(['app']), subs: new Set(['app/Translations']) }, key)).toBe(false);
    expect(logic.rlMatches(m, { ...none(), areas: new Set(['app', 'docs']), subs: new Set(['app/Sync and data']) }, key)).toBe(true);
    expect(logic.rlMatches(m, { ...none(), areas: new Set(['docs']) }, key)).toBe(false);
  });

  it('finds words in its number, title, issue and issue title, and filters by who, where, how, issue and database', () => {
    for (const q of ['716', '#716', 'by itself', 'lan-339', 'network drop', 'issue fix']) expect(logic.rlMatches(m, { ...none(), q }, key)).toBe(true);
    expect(logic.rlMatches(m, { ...none(), q: 'tutorial' }, key)).toBe(false);
    expect(logic.rlMatches(m, { ...none(), who: new Set(['agent:Issue fix team']) }, key)).toBe(true);
    expect(logic.rlMatches(m, { ...none(), who: new Set(['thread']) }, key)).toBe(false);
    expect(logic.rlMatches(m, { ...none(), where: new Set(['onway']) }, key)).toBe(true);
    expect(logic.rlMatches(m, { ...none(), how: new Set(['ota']) }, key)).toBe(true);
    expect(logic.rlMatches(m, { ...none(), how: new Set(['store']) }, key)).toBe(false);
    expect(logic.rlMatches(m, { ...none(), issue: new Set(['part']) }, key)).toBe(false);
    expect(logic.rlMatches(m, { ...none(), db: true }, key)).toBe(true);
    expect(logic.rlMatches({ ...m, mg: undefined }, { ...none(), db: true }, key)).toBe(false);
  });
});

describe('the line on the page', () => {
  it('sits above the Releases page’s summary, and the page routes to it, reads it with the rest and draws its answers', async () => {
    const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
    expect(html.indexOf('<div id="rline" hidden>')).toBeGreaterThan(-1);
    expect(html.indexOf('<div id="rline" hidden>')).toBeLessThan(html.indexOf('<div id="sum"></div>'));
    expect(START_SCRIPT).toContain('rlineRoute(v);');
    expect(html).toContain('rlineLoad(fresh),');
    expect(html).toContain('rlineRedraw();');
    expect(ASK_SCRIPT).toContain('rlineAsk();');
    expect(RLINE_SCRIPT).toContain("api('/ops/api/timeline'");
    expect(RLINE_SCRIPT).toContain("post({ kind: 'issue-info', issues: part })");
  });

  it('shows nothing on hover: no tooltips, no hover boxes, no box over its PR and LAN numbers', async () => {
    for (const src of [RLINE_HTML, RLINE_SCRIPT]) {
      expect(src).not.toMatch(/\stitle="|data-tip=|data-hv|hvAttr\(|data-help/);
      expect(src).not.toContain('mouseover');
    }
    const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
    expect(html).toContain("[contenteditable],#rline';");
  });

  it('gives no element a style attribute, which the page’s rules refuse', () => {
    for (const src of [RLINE_HTML, RLINE_SCRIPT]) expect(src).not.toMatch(/style="/);
  });

  it('lights a tapped change and its line and dims the rest, and every class it styles starts with rl', () => {
    expect(RLINE_CSS).toContain('#rl-can.rl-focus .rl-it:not(.rl-on)');
    expect(RLINE_CSS).toContain('#rl-can.rl-focus .rl-lane:not(.rl-hot)');
    const lone = [...RLINE_CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)].flatMap((m) => m[1]!.split(',').map((s) => s.trim()))
      .filter((s) => /^\.[\w-]+/.test(s)).map((s) => /^\.([\w-]+)/.exec(s)![1]!);
    expect(lone.filter((c) => !c.startsWith('rl-'))).toEqual([]);
  });

  it('keeps taps at least 48 points on a touch screen', () => {
    expect(RLINE_CSS).toMatch(/@media \(pointer: coarse\) \{\s*\.rl-chip, \.rl-btn, \.rl-find, \.rl-seg button, \.rl-tile \{ min-height: 48px; \}/);
  });
});
