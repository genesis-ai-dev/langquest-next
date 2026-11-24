import { describe, expect, it } from 'vitest';
import { ASK_LOGIC, ASK_SCRIPT } from '../src/pageAsk';
import { SEND_LOGIC } from '../src/pageSends';
import { ISSUE_LOGIC } from '../src/pageIssues';

type Row = Record<string, unknown>;
type Send = { key: string; text: string; at: number; state: 'sending' | 'sent' | 'refused'; error?: string };

/** The page's own logic, as it runs there (pageAsk.ts ASK_LOGIC, with pageSends.ts sendHeld). */
const logic = new Function(`${SEND_LOGIC}; ${ASK_LOGIC}; return { askId, askContext, questionsWithSends, askWaits, askSaid, ASK_MINUTES, nextRun };`)() as {
  askId: (card: string) => string;
  askContext: (text: string) => string;
  questionsWithSends: (q: Record<string, Row[]> | null, sends: Map<string, Send>) => Record<string, Row[]>;
  askWaits: (q: Record<string, Row[]> | null) => boolean;
  askSaid: (q: Row, next: string) => string;
  ASK_MINUTES: number[];
  nextRun: (now: number, minutes: number[]) => number;
};

/** The drawing, with the page's helpers as plain stand-ins (as in sends.test.ts), and a page state to set. */
const draw = new Function(`
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
  const when = (iso) => iso ? 'then' : 'never';
  const safeLink = (l) => String(l || '').startsWith('https://') ? l : '';
  const outLink = (href, label) => '<a href="' + href + '">' + label + '</a>';
  const sendClock = () => '10:05';
  const SENDS = new Map();
  const document = { addEventListener() {}, visibilityState: 'hidden' };
  const setInterval = () => 0;
  ${SEND_LOGIC}
  ${ISSUE_LOGIC}
  ${ASK_LOGIC}
  ${ASK_SCRIPT}
  return { askTalk, askBlock, SENDS, set: (q) => { QUESTIONS = q; } };
`)() as { askTalk: (card: string, page: string, title: string) => string; askBlock: (card: string, page: string, title: string) => string; SENDS: Map<string, Send>; set: (q: Record<string, Row[]> | null) => void };

describe('Ask Claude on every card (pageAsk.ts)', () => {
  it('gives each card an element id of its own, the same each time', () => {
    const a = logic.askId('line:capacity-r2-class-a'), b = logic.askId('line:capacity-r2-class-b');
    expect(a).toMatch(/^ask-[a-z0-9]+-[a-z0-9]+$/i);
    expect(a).toBe(logic.askId('line:capacity-r2-class-a'));
    expect(a).not.toBe(b);
    expect(logic.askId('line:x:"><script>')).toMatch(/^ask-[a-z0-9-]+$/i);
  });

  it('sends the card\'s words one line each, and never more than the database keeps', () => {
    expect(logic.askContext('R2 class A\n\n   past the plan  \n\tabout $20.36 ')).toBe('R2 class A\npast the plan\nabout $20.36');
    const long = logic.askContext('x'.repeat(7000));
    expect(long.length).toBe(6000);
    expect(long.endsWith('…')).toBe(true);
  });

  it('runs every 5 minutes', () => {
    expect(logic.ASK_MINUTES).toHaveLength(12);
    expect(new Date(logic.nextRun(Date.UTC(2026, 10, 23, 23, 31, 10), logic.ASK_MINUTES)).toISOString()).toBe('2026-11-23T23:35:00.000Z');
  });

  it('shows a question sent from the page until the server holds it', () => {
    const at = Date.UTC(2026, 10, 23, 23, 40);
    const sends = new Map<string, Send>([['ask:page:storage', { key: 'ask:page:storage', text: 'Any duplicates?', at, state: 'sent' }]]);
    const mine = logic.questionsWithSends({}, sends)['page:storage']!;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ text: 'Any duplicates?', state: 'waiting', local: true });
    const held = logic.questionsWithSends({ 'page:storage': [{ text: 'Any duplicates?', at: new Date(at).toISOString(), state: 'waiting' }] }, sends);
    expect(held['page:storage']).toHaveLength(1);
    expect(logic.questionsWithSends(null, new Map())).toEqual({});
  });

  it('reads the answers again only while Claude owes one', () => {
    expect(logic.askWaits({ a: [{ state: 'answered', answer: 'x' }] })).toBe(false);
    expect(logic.askWaits({ a: [{ state: 'answered', answer: 'x' }, { state: 'working' }] })).toBe(true);
    expect(logic.askWaits(null)).toBe(false);
  });

  it('says what Claude does with a question in each state', () => {
    expect(logic.askSaid({ state: 'waiting' }, '10:05')).toContain('at about 10:05');
    // The Worker started the workflow at once (apps/web/worker/startRun.ts).
    expect(logic.askSaid({ state: 'waiting', started: true }, '10:05')).toBe('Claude starts on it now. When another run is in progress, Claude starts when that run ends. The answer shows here.');
    expect(logic.askSaid({ state: 'working' }, '')).toContain('works on it now');
    expect(logic.askSaid({ state: 'stopped' }, '')).toContain('Ask again');
    expect(logic.askSaid({ state: 'answered', answer: null }, '')).toContain('without an answer');
    expect(logic.askSaid({ state: 'answered', answer: 'About $20 so far.' }, '')).toBe('About $20 so far.');
  });

  it('draws the talk with who asked, Claude\'s answer, and the box, all escaped', () => {
    draw.set({ 'line:capacity-r2-class-a': [
      { at: '2026-11-23T23:40:00Z', text: 'Why <so> many?', who: 'Caleb', state: 'answered', answeredAt: '2026-11-23T23:50:00Z', answer: 'Each upload <lists> first.' }
    ] });
    const html = draw.askTalk('line:capacity-r2-class-a', 'storage', 'R2 class A "operations"');
    expect(html).toContain('Why &#60;so&#62; many?');
    expect(html).toContain('Caleb · then');
    expect(html).toContain('Each upload &#60;lists&#62; first.');
    expect(html).toContain('data-ask="line:capacity-r2-class-a"');
    expect(html).toContain('data-ask-page="storage"');
    expect(html).toContain('data-ask-title="R2 class A &#34;operations&#34;"');
    expect(html).toContain('>Ask Claude</button>');
    expect(html).toContain('Ask another question');
  });

  it('keeps the box shut while a question goes, and gives the reason when it was not sent', () => {
    draw.set({});
    draw.SENDS.set('ask:page:start', { key: 'ask:page:start', text: 'What first?', at: Date.now(), state: 'sending' });
    expect(draw.askBlock('page:start', 'start', 'Overview')).toContain('disabled aria-busy="true">Sending…');
    draw.SENDS.set('ask:page:start', { key: 'ask:page:start', text: 'What first?', at: Date.now(), state: 'refused', error: 'Three questions on this card wait for Claude already.' });
    const html = draw.askBlock('page:start', 'start', 'Overview');
    expect(html).toContain('Not sent: Three questions');
    expect(html).toContain('Ask Claude about this page');
    draw.SENDS.clear();
  });
});
