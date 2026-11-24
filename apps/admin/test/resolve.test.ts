import { describe, expect, it } from 'vitest';
import { FIX_LOGIC } from '../src/pageFixes';
import { RESOLVE_LOGIC, RESOLVE_SCRIPT } from '../src/pageResolve';
import { HELP } from '../src/pageHelp';

type Line = { key: string; subject?: string; level: string; text?: string; measure?: number; back?: string; backWhy?: string };
type Resolve = { line: string; level: string; measure?: number | null; at: string; title?: string; who?: string; checkedAt?: string | null; verdict?: string | null; why?: string | null };

/** The page's own logic, as it runs there (pageResolve.ts RESOLVE_LOGIC after pageFixes.ts FIX_LOGIC). */
const logic = new Function(`${FIX_LOGIC}; ${RESOLVE_LOGIC}; return { resolveBack, splitResolved, resolvePayload, RESOLVE_UNCHECKED_MS };`)() as {
  resolveBack: (a: Line, r: Resolve, now: number) => string;
  splitResolved: (alerts: Line[], resolves: Record<string, Resolve>, now: number) => { shown: Line[]; hidden: { a: Line; r: Resolve }[] };
  resolvePayload: (lines: Line[], part: string, titleOf: (a: Line) => string, textOf?: (a: Line) => string) => unknown[];
  RESOLVE_UNCHECKED_MS: number;
};

const H = 3_600_000;
const AT = Date.parse('2026-11-24T01:00:00Z');
const usage: Line = { key: 'usage-billed', subject: 'R2 class A operations', level: 'watch', measure: 20.25, text: 'R2 class A operations this month are past the plan.' };
const resolve = (over: Partial<Resolve> = {}): Resolve => ({ line: 'usage-billed:R2 class A operations', level: 'watch', measure: 20.25, at: new Date(AT).toISOString(), ...over });

describe('a resolved line comes back when Claude finds its problem came back (pageResolve.ts)', () => {
  it('stays hidden while Claude finds the same problem, whatever its numbers', () => {
    expect(logic.resolveBack(usage, resolve(), AT + 2 * H)).toBe('');
    expect(logic.resolveBack({ ...usage, measure: 400 }, resolve({ checkedAt: new Date(AT + 20 * H).toISOString(), verdict: 'same', why: 'Same month.' }), AT + 40 * H)).toBe('');
    // No fixed rule: a new month, a window or 7 days alone never bring it back while Claude checks it.
    expect(logic.resolveBack(usage, resolve({ checkedAt: '2026-12-08T00:00:00Z', verdict: 'same' }), Date.parse('2026-12-08T03:00:00Z'))).toBe('');
  });

  it('comes back when Claude found that the problem came back', () => {
    expect(logic.resolveBack(usage, resolve({ checkedAt: new Date(AT + 3 * H).toISOString(), verdict: 'back', why: 'A new month.' }), AT + 4 * H)).toBe('claude');
  });

  it('comes back at once when the line is more serious than when it was resolved', () => {
    const stopped: Line = { key: 'job-stopped', subject: 'projection', level: 'urgent' };
    expect(logic.resolveBack(stopped, resolve({ line: 'job-stopped:projection', level: 'problem', measure: null }), AT + H)).toBe('worse');
    expect(logic.resolveBack({ ...stopped, level: 'watch' }, resolve({ line: 'job-stopped:projection', level: 'problem', measure: null }), AT + H)).toBe('');
  });

  it('comes back when Claude has not checked it for 27 hours, and at once when the resolve has no time', () => {
    expect(logic.resolveBack(usage, resolve(), AT + logic.RESOLVE_UNCHECKED_MS - 1)).toBe('');
    expect(logic.resolveBack(usage, resolve(), AT + logic.RESOLVE_UNCHECKED_MS)).toBe('unchecked');
    const checked = resolve({ checkedAt: new Date(AT + 24 * H).toISOString(), verdict: 'same', why: 'Same.' });
    expect(logic.resolveBack(usage, checked, AT + 24 * H + logic.RESOLVE_UNCHECKED_MS - 1)).toBe('');
    expect(logic.resolveBack(usage, checked, AT + 24 * H + logic.RESOLVE_UNCHECKED_MS)).toBe('unchecked');
    expect(logic.resolveBack(usage, resolve({ at: 'not a time' }), AT)).toBe('unchecked');
  });

  it('takes the hidden lines out of a part and marks the ones that came back, with Claude\'s reason', () => {
    const other: Line = { key: 'usage-billed', subject: 'Workers requests', level: 'watch', measure: 6 };
    const out = logic.splitResolved([usage, other], { [resolve().line]: resolve() }, AT + H);
    expect(out.shown).toEqual([other]);
    expect(out.hidden.map((h) => h.a)).toEqual([usage]);
    const r = resolve({ checkedAt: new Date(AT + 3 * H).toISOString(), verdict: 'back', why: 'December has its own count, and it is past the plan again.' });
    const back = logic.splitResolved([usage, other], { [r.line]: r }, AT + 4 * H);
    expect(back.shown).toEqual([{ ...usage, back: 'claude', backWhy: r.why }, other]);
    expect(back.shown[0]).not.toBe(usage);
    expect(usage.back).toBeUndefined();
    // "Could not read" is never resolved.
    expect(logic.splitResolved([{ key: 'unreadable', subject: 'jobs', level: 'watch' }], { 'unreadable:jobs': resolve({ line: 'unreadable:jobs' }) }, AT).hidden).toEqual([]);
  });

  it('sends each line of a row as the page shows it, with its words, at most 20', () => {
    const many = Array.from({ length: 25 }, (_, i): Line => ({ key: 'job-stopped', subject: `job${i}`, level: 'problem' }));
    const sent = logic.resolvePayload([usage, { key: 'unreadable', subject: 'jobs', level: 'watch' }], 'capacity', () => 'Usage past the plan');
    expect(sent).toEqual([{ line: 'usage-billed:R2 class A operations', part: 'capacity', level: 'watch', measure: 20.25, title: 'Usage past the plan', text: usage.text }]);
    expect(logic.resolvePayload([usage], 'capacity', () => 't', () => 'x'.repeat(1200))).toMatchObject([{ text: 'x'.repeat(1000) }]);
    expect(logic.resolvePayload(many, 'jobs', (a) => a.subject ?? '')).toHaveLength(20);
    expect(logic.resolvePayload([{ key: 'expires', level: 'info' }], 'expiry', () => '')).toEqual([{ line: 'expires', part: 'expiry', level: 'watch', measure: null, title: 'expires', text: '' }]);
  });
});

describe('the Resolved button and list (pageResolve.ts RESOLVE_SCRIPT)', () => {
  const draw = new Function(`
    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
    const ago = () => '2 hours ago';
    const icon = (s) => '<svg class="ic s-' + s + '"></svg>';
    const tidy = (t) => t;
    const splitAlert = (t) => ({ title: t });
    const SECTIONS = [], results = {};
    const document = { addEventListener() {} };
    ${FIX_LOGIC}
    ${RESOLVE_LOGIC}
    ${RESOLVE_SCRIPT}
    return { resolveButton, backTag, backWhy, handResolvedHtml, withoutResolved, handResolved, resolvedCard, RAW, set: (r) => { RESOLVES = r; } };
  `)() as {
    resolveButton: (lines: Line[], part: string, cls: string) => string;
    backTag: (a: Line, cls: string) => string;
    backWhy: (a: Line) => string;
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
    // Claude checked it and found the same problem: still on the list, with Claude's reason.
    draw.set([{ ...resolve(), at: new Date().toISOString(), title: 'R2', who: 'Caleb', checkedAt: new Date().toISOString(), verdict: 'same', why: 'Same <month>.' }]);
    expect(draw.handResolvedHtml(draw.handResolved())).toContain('data-help-key="Claude checked"');
    expect(draw.handResolvedHtml(draw.handResolved())).toContain('Same &#60;month&#62;.');
    // Claude found it came back: shown with its tag and reason, and off the list.
    draw.set([{ ...resolve(), at: new Date().toISOString(), title: 'R2', who: 'Caleb', checkedAt: new Date().toISOString(), verdict: 'back', why: 'A new <cause>.' }]);
    const shown = draw.withoutResolved(draw.RAW.capacity).alerts[0]!;
    expect(shown.back).toBe('claude');
    expect(draw.handResolved()).toEqual([]);
    expect(draw.backTag(shown, 'backtag')).toBe('<span class="backtag" data-help-key="Came back: claude">Came back</span>');
    expect(draw.backWhy(shown)).toContain('A new &#60;cause&#62;.');
    expect(draw.backTag(usage, 'backtag')).toBe('');
    expect(draw.backWhy(usage)).toBe('');
  });

  it('has help for the button and for each reason a line comes back', () => {
    for (const key of ['Resolved button', 'Came back: worse', 'Came back: claude', 'Came back: unchecked', 'Claude says', 'Claude checked']) {
      expect(HELP[key], key).toBeTruthy();
    }
  });
});
