import { describe, expect, it } from 'vitest';
import { FIX_LOGIC } from '../src/pageFixes';
import { RESOLVE_LOGIC, RESOLVE_SCRIPT } from '../src/pageResolve';
import { KINDS } from '../src/alertKinds';
import { HELP } from '../src/pageHelp';

type Line = { key: string; subject?: string; level: string; text?: string; measure?: number; recheck?: Record<string, unknown>; back?: string };
type Resolve = { line: string; level: string; measure?: number | null; at: string; title?: string; who?: string };

/** The page's own logic, as it runs there (pageResolve.ts RESOLVE_LOGIC after pageFixes.ts FIX_LOGIC). */
const logic = new Function(`${FIX_LOGIC}; ${RESOLVE_LOGIC}; return { resolveBack, splitResolved, resolvePayload, RESOLVE_MAX_MS };`)() as {
  resolveBack: (a: Line, r: Resolve, kinds: unknown, now: number) => string;
  splitResolved: (alerts: Line[], resolves: Record<string, Resolve>, kinds: unknown, now: number) => { shown: Line[]; hidden: { a: Line; r: Resolve }[] };
  resolvePayload: (lines: Line[], part: string, titleOf: (a: Line) => string) => unknown[];
  RESOLVE_MAX_MS: number;
};

const H = 3_600_000;
const AT = Date.parse('2026-11-24T01:00:00Z');
const usage: Line = { key: 'usage-billed', subject: 'R2 class A operations', level: 'watch', measure: 20.25, text: 'R2 class A operations this month are past the plan.' };
const resolve = (over: Partial<Resolve> = {}): Resolve => ({ line: 'usage-billed:R2 class A operations', level: 'watch', measure: 20.25, at: new Date(AT).toISOString(), ...over });

describe('a resolved line comes back with its problem (pageResolve.ts)', () => {
  it('stays hidden while the problem is the same one', () => {
    expect(logic.resolveBack(usage, resolve(), KINDS, AT + 2 * 24 * H)).toBe('');
    expect(logic.resolveBack({ ...usage, measure: 39 }, resolve(), KINDS, AT + 2 * 24 * H)).toBe('');
  });

  it('comes back when the line is more serious than when it was resolved', () => {
    const stopped: Line = { key: 'job-stopped', subject: 'projection', level: 'urgent' };
    expect(logic.resolveBack(stopped, resolve({ line: 'job-stopped:projection', level: 'problem', measure: null }), KINDS, AT + H)).toBe('worse');
    expect(logic.resolveBack({ ...stopped, level: 'watch' }, resolve({ line: 'job-stopped:projection', level: 'problem', measure: null }), KINDS, AT + H)).toBe('');
  });

  it('comes back when its measure doubled (the cost of usage past the plan)', () => {
    expect(logic.resolveBack({ ...usage, measure: 40.5 }, resolve(), KINDS, AT + H)).toBe('grew');
    // A resolve with no measure, or a line without one, never grows.
    expect(logic.resolveBack({ ...usage, measure: 400 }, resolve({ measure: null }), KINDS, AT + H)).toBe('');
    expect(logic.resolveBack({ ...usage, measure: undefined }, resolve(), KINDS, AT + H)).toBe('');
  });

  it('comes back when a monthly count starts again', () => {
    expect(logic.resolveBack(usage, resolve(), KINDS, Date.parse('2026-11-30T23:59:00Z'))).toBe('');
    expect(logic.resolveBack(usage, resolve(), KINDS, Date.parse('2026-12-01T00:01:00Z'))).toBe('month');
  });

  it('comes back when the check counts only what happened after the resolve', () => {
    const errors: Line = { key: 'sync-errors', level: 'watch' };
    const r = resolve({ line: 'sync-errors', measure: null });
    expect(logic.resolveBack(errors, r, KINDS, AT + 23 * H)).toBe('');
    expect(logic.resolveBack(errors, r, KINDS, AT + 24 * H)).toBe('window');
    // A line's own check overrides its kind's.
    expect(logic.resolveBack({ ...errors, recheck: { windowH: 2 } }, r, KINDS, AT + 3 * H)).toBe('window');
  });

  it('comes back when a daily check runs again after the resolve and still finds it', () => {
    const missing: Line = { key: 'r2-missing', level: 'problem' };
    const r = resolve({ line: 'r2-missing', level: 'problem', measure: null });
    // The check starts at 04:35 UTC and takes 120 minutes: its next answer after 01:00 is at 06:35.
    expect(logic.resolveBack(missing, r, KINDS, Date.parse('2026-11-24T06:30:00Z'))).toBe('');
    expect(logic.resolveBack(missing, r, KINDS, Date.parse('2026-11-24T06:40:00Z'))).toBe('check');
  });

  it('comes back after 7 days at the latest, and at once when the resolve has no time', () => {
    const stopped: Line = { key: 'job-stopped', subject: 'projection', level: 'problem' };
    const r = resolve({ line: 'job-stopped:projection', level: 'problem', measure: null });
    expect(logic.resolveBack(stopped, r, KINDS, AT + logic.RESOLVE_MAX_MS - 1)).toBe('');
    expect(logic.resolveBack(stopped, r, KINDS, AT + logic.RESOLVE_MAX_MS)).toBe('week');
    expect(logic.resolveBack(stopped, { ...r, at: 'not a time' }, KINDS, AT)).toBe('week');
  });

  it('takes the hidden lines out of a part and marks the ones that came back', () => {
    const other: Line = { key: 'usage-billed', subject: 'Workers requests', level: 'watch', measure: 6 };
    const grew = { ...usage, measure: 50 };
    const out = logic.splitResolved([usage, other], { [resolve().line]: resolve() }, KINDS, AT + H);
    expect(out.shown).toEqual([other]);
    expect(out.hidden.map((h) => h.a)).toEqual([usage]);
    const back = logic.splitResolved([grew, other], { [resolve().line]: resolve() }, KINDS, AT + H);
    expect(back.shown).toEqual([{ ...grew, back: 'grew' }, other]);
    expect(back.shown[0]).not.toBe(grew);
    expect(grew.back).toBeUndefined();
    // "Could not read" is never resolved.
    expect(logic.splitResolved([{ key: 'unreadable', subject: 'jobs', level: 'watch' }], { 'unreadable:jobs': resolve({ line: 'unreadable:jobs' }) }, KINDS, AT).hidden).toEqual([]);
  });

  it('sends each line of a row as the page shows it, at most 20', () => {
    const many = Array.from({ length: 25 }, (_, i): Line => ({ key: 'job-stopped', subject: `job${i}`, level: 'problem' }));
    const sent = logic.resolvePayload([usage, { key: 'unreadable', subject: 'jobs', level: 'watch' }], 'capacity', () => 'Usage past the plan');
    expect(sent).toEqual([{ line: 'usage-billed:R2 class A operations', part: 'capacity', level: 'watch', measure: 20.25, title: 'Usage past the plan' }]);
    expect(logic.resolvePayload(many, 'jobs', (a) => a.subject ?? '')).toHaveLength(20);
    expect(logic.resolvePayload([{ key: 'expires', level: 'info' }], 'expiry', () => '')).toEqual([{ line: 'expires', part: 'expiry', level: 'watch', measure: null, title: 'expires' }]);
  });
});

describe('the Resolved button and list (pageResolve.ts RESOLVE_SCRIPT)', () => {
  const draw = new Function(`
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
    const ago = () => '2 hours ago';
    const icon = (s) => '<svg class="ic s-' + s + '"></svg>';
    const tidy = (t) => t;
    const splitAlert = (t) => ({ title: t });
    const KINDS = ${JSON.stringify(KINDS)};
    const SECTIONS = [], results = {};
    const document = { addEventListener() {} };
    ${FIX_LOGIC}
    ${RESOLVE_LOGIC}
    ${RESOLVE_SCRIPT}
    return { resolveButton, backTag, handResolvedHtml, withoutResolved, handResolved, resolvedCard, RAW, set: (r) => { RESOLVES = r; } };
  `)() as {
    resolveButton: (lines: Line[], part: string, cls: string) => string;
    backTag: (a: Line, cls: string) => string;
    handResolvedHtml: (list: Resolve[]) => string;
    withoutResolved: (s: { state: string; alerts: Line[] }) => { state: string; alerts: Line[] };
    handResolved: () => Resolve[];
    resolvedCard: (card: string) => boolean;
    RAW: Record<string, { state: string; alerts: Line[] }>;
    set: (r: Resolve[] | null) => void;
  };

  it('puts each line on the button, escaped, and draws none for "Could not read"', () => {
    const b = draw.resolveButton([usage], 'capacity', 'go');
    expect(b).toContain('data-resolve="[{&#34;line&#34;:&#34;usage-billed:R2 class A operations&#34;');
    expect(b).toContain('data-help-key="Resolved button"');
    expect(b).toMatch(/>Resolved<\/button>$/);
    expect(draw.resolveButton([{ key: 'unreadable', subject: 'jobs', level: 'watch' }], 'jobs', 'go')).toBe('');
  });

  it('hides a resolved line from its part, keeps the answer as it came, and lists it with who resolved it', () => {
    const s = { state: 'ok', alerts: [usage] };
    draw.set(null);
    expect(draw.withoutResolved(s)).toBe(s);
    draw.set([{ ...resolve(), at: new Date().toISOString(), title: 'R2 <b>', who: 'Caleb' }]);
    expect(draw.withoutResolved(s).alerts).toEqual([]);
    expect(s.alerts).toEqual([usage]);
    draw.RAW.capacity = s;
    expect(draw.handResolved().map((r) => r.line)).toEqual(['usage-billed:R2 class A operations']);
    expect(draw.resolvedCard('line:usage-billed:R2 class A operations')).toBe(true);
    const html = draw.handResolvedHtml(draw.handResolved());
    expect(html).toContain('R2 &#60;b&#62;');
    expect(html).toContain('Resolved by Caleb · 2 hours ago');
    expect(html).toContain('data-unresolve="usage-billed:R2 class A operations">Show again</button>');
    // Back with twice the cost: shown with its tag, and off the list.
    draw.RAW.capacity = { state: 'ok', alerts: [{ ...usage, measure: 41 }] };
    expect(draw.withoutResolved(draw.RAW.capacity).alerts[0]!.back).toBe('grew');
    expect(draw.handResolved()).toEqual([]);
    expect(draw.backTag({ ...usage, back: 'grew' }, 'backtag')).toBe('<span class="backtag" data-help-key="Came back: grew">Came back</span>');
    expect(draw.backTag(usage, 'backtag')).toBe('');
  });

  it('has help for the button and for each reason a line comes back', () => {
    for (const key of ['Resolved button', 'Came back: worse', 'Came back: grew', 'Came back: month', 'Came back: window', 'Came back: check', 'Came back: week']) {
      expect(HELP[key], key).toBeTruthy();
    }
  });
});
