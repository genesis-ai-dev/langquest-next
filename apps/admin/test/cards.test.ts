import { describe, expect, it } from 'vitest';
import { page } from '../src/page';
import { CARD_LOGIC } from '../src/pageCards';

type Row = Record<string, unknown>;
interface Way { pill: [string, string]; at: number; steps: [string, string][] }
const logic = new Function(`${CARD_LOGIC}; return { lineCardId, cardHref, viewOf, lineWay, noBoxSaid, nextSaid, LINE_STEPS };`)() as {
  lineCardId: (a: Row) => string;
  cardHref: (group: string, id: string) => string;
  viewOf: (hash: string, sections: { id: string }[]) => { name: string; id?: string; card?: string };
  lineWay: (f: Row, byClaude: boolean, asked: boolean) => Way;
  noBoxSaid: (state: string, read: boolean) => string;
  nextSaid: (state: string, own: boolean, asked: boolean) => string;
  LINE_STEPS: [string, string][];
};
const SECTIONS = [{ id: 'jobs' }, { id: 'userissues' }];

describe('each Overview line opens its card', () => {
  it('names a line\'s card as the Overview\'s row names it, and puts the card in the address', () => {
    expect(logic.lineCardId({ key: 'job-stopped', subject: 'blob_reconcile' })).toBe('line:job-stopped:blob_reconcile');
    expect(logic.lineCardId({ key: 'needs-you' })).toBe('line:needs-you');
    const href = logic.cardHref('jobs', 'line:route-5xx:/api/x y');
    expect(href).toBe('#g/jobs/line%3Aroute-5xx%3A%2Fapi%2Fx%20y');
    expect(logic.viewOf(href, SECTIONS)).toEqual({ name: 'group', id: 'jobs', card: 'line:route-5xx:/api/x y' });
    expect(logic.viewOf('#g/userissues/LAN-12', SECTIONS)).toEqual({ name: 'group', id: 'userissues', card: 'LAN-12' });
  });

  it('keeps the old addresses: a section, All and the Overview', () => {
    expect(logic.viewOf('#g/jobs', SECTIONS)).toEqual({ name: 'group', id: 'jobs' });
    expect(logic.viewOf('#all', SECTIONS)).toEqual({ name: 'all' });
    expect(logic.viewOf('', SECTIONS)).toEqual({ name: 'start' });
    expect(logic.viewOf('#g/nope/x', SECTIONS)).toEqual({ name: 'start' });
    // A broken card name opens the section at its top.
    expect(logic.viewOf('#g/jobs/%E0%A4%A', SECTIONS)).toEqual({ name: 'group', id: 'jobs' });
  });

  it('gives each state of a line its pill and its step, and shows no step that nothing recorded', () => {
    const way = (state: string, extra: Row = {}, byClaude = false, asked = false) => logic.lineWay({ state, issues: ['LAN-1'], ...extra }, byClaude, asked);
    expect([way('none').pill[0], way('none').at]).toEqual(['Not in Linear yet', 2]);
    expect([way('issue').pill[0], way('issue').at]).toEqual(['No fix yet', 3]);
    expect(way('open').pill).toEqual(['Waits on you', 'you']);
    expect(way('open', {}, true).pill).toEqual(['Merges when checks pass', 'claude']);
    expect([way('merged').pill[0], way('merged').at]).toEqual(['Fix merged', 5]);
    expect(way('stuck').steps[4]).toEqual(['Gone', 'still here after its check']);
    expect(way('noise').at).toBe(0);
    expect(way('person').at).toBe(0);
    expect(way('part', { fixed: 1, each: [{}, {}] }).pill[0]).toBe('1 of 2 issues have a fix');
    // An instruction that waits for Claude's answer: Claude acts next.
    expect(way('issue', {}, false, true).pill).toEqual(['Claude acts next', 'claude']);
    expect(logic.LINE_STEPS.map((s) => s[0])).toEqual(['Found', 'In Linear', 'Fix written', 'Merged', 'Gone']);
  });

  it('says why a card has no box to tell Claude what to do', () => {
    expect(logic.noBoxSaid('none', true)).toContain('Claude files this problem in Linear within 15 minutes');
    expect(logic.noBoxSaid('person', true)).toContain('You do this one yourself');
    expect(logic.noBoxSaid('none', false)).toBe('Reading the user issues…');
    expect(logic.noBoxSaid('issue', true)).toBe('');
  });

  it('says who acts next on a nightly test\'s issue, which no agent fixes on its own', () => {
    expect(logic.nextSaid('stuck', true, false)).toContain('No agent works on it now. To get a fix, tell Claude what to do below.');
    expect(logic.nextSaid('issue', true, false)).toContain('No agent writes a fix for it on its own.');
    expect(logic.nextSaid('stuck', false, false)).toContain('tell Claude what to do below');
    expect(logic.nextSaid('stuck', true, true)).toContain('Claude has your instruction.');
    expect(logic.nextSaid('open', false, false)).toBe('');
    expect(logic.nextSaid('issue', false, false)).toBe('');
  });

  it('draws the lines as cards at their part, and the Overview\'s rows link to them', async () => {
    const html = await page({ supabaseUrl: 'https://x.supabase.co', anonKey: 'k' }, 'n').text();
    expect(html).toContain('head + lines + counted(s.data)');
    expect(html).toContain("concat((results.container.alerts || []).map((a) => Object.assign({ part: 'container' }, a)))");
    expect(html).toContain('data-href="\' + esc(href(lines[0]))');
    expect(html).toContain("cardHref('userissues', i.issue)");
    expect(html).toContain('data-card="\' + esc(storeCardId(platform, c.title))');
    expect(html).not.toContain('function partLines(');
    expect(html).not.toMatch(/ style="/);
  });
});
