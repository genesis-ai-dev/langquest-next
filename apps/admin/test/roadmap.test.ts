import { describe, expect, it } from 'vitest';
import { page } from '../src/page';
import { ROADMAP_LOGIC, ROADMAP_SCRIPT } from '../src/pageRoadmap';
import { roadmapAlerts, type Roadmap } from '../src/sources/roadmap';

/** The Roadmap page (docs/roadmap.md): the items with how important people said they are, and the suggestions to answer. */
type Row = Record<string, unknown>;
const logic = new Function(`${ROADMAP_LOGIC}; return { rmOrder, rmBarParts, rmItemAction, rmTotal, rmWrote };`)() as {
  rmOrder: (items: Row[]) => Row[];
  rmBarParts: (counts: number[]) => { k: number; x: number; w: number }[];
  rmItemAction: (id: string, state: string, title: string, body: string, issue: string, picture?: string | null) => Row;
  rmTotal: (i: Row) => number;
  rmWrote: (i: Row) => number;
};

/** The drawing code with the page's helpers as plain stand-ins. */
const draw = new Function(`
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => '&#' + c.charCodeAt(0) + ';');
  const when = (iso) => iso ? 'then' : 'never', num = String, day = () => 'Nov 20', stat = (v, l) => '<b>' + v + ' ' + l + '</b>', NOW = '', LAST_DAY = '';
  const RENDER = {}, results = {}, document = { addEventListener() {} };
  ${ROADMAP_LOGIC}
  ${ROADMAP_SCRIPT}
  return { html: roadmapHtml, open: (id) => { rmOpen = id; } };
`)() as { html: (d: Roadmap) => string; open: (id: string | null) => void };

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const item = (id: string, over: Partial<Roadmap['items'][number]> = {}): Roadmap['items'][number] => ({
  id, state: 'planned', title: 'Item ' + id.slice(0, 1), body: '', issue: null, picture: null, doneAt: null, at: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  counts: [0, 0, 0, 0], notes: [], ...over
});
const data = (over: Partial<Roadmap> = {}): Roadmap => ({ items: [], suggestions: [], day: 0, dayMax: 1000, ...over });

describe('the Roadmap page', () => {
  it('puts the most critical item first, then the most answered, then the newest', () => {
    const order = logic.rmOrder([
      item(A, { counts: [5, 5, 5, 0] }),
      item(B, { counts: [0, 0, 0, 1] }),
      item('33333333-3333-4333-8333-333333333333', { counts: [5, 5, 5, 0], at: '2026-11-20T00:00:00Z' })
    ] as unknown as Row[]);
    expect(order.map((i) => String(i.id).slice(0, 1))).toEqual(['2', '3', '1']);
  });

  it('draws the bar critical first, out of 100, and nothing for an item nobody answered', () => {
    expect(logic.rmBarParts([1, 0, 1, 2])).toEqual([{ k: 3, x: 0, w: 50 }, { k: 2, x: 50, w: 25 }, { k: 0, x: 75, w: 25 }]);
    expect(logic.rmBarParts([0, 0, 0, 0])).toEqual([]);
    expect(logic.rmTotal({ counts: [1, 2, 3, 4] })).toBe(10);
    expect(logic.rmWrote({ notes: [{ words: 'x' }, { words: null }] })).toBe(1);
  });

  it('sends a new item with no id, an issue in capitals, and the picture only when it changed', () => {
    expect(logic.rmItemAction('new', 'considering', ' Map ', ' ', ' lan-12 ')).toEqual({ kind: 'roadmap-item', id: null, state: 'considering', title: 'Map', body: '', issue: 'LAN-12' });
    expect(logic.rmItemAction(A, 'done', 'Map', 'Text', '', null)).toEqual({ kind: 'roadmap-item', id: A, state: 'done', title: 'Map', body: 'Text', issue: null, picture: null });
  });

  it('shows suggestions with their email for the team, escaped, and the board by part', () => {
    const d = data({
      items: [item(A, { title: 'Clean <noise>', counts: [0, 1, 0, 2] }), item(B, { state: 'hidden', title: 'Old' })],
      suggestions: [{ id: B, importance: 3, words: 'Dark <pages>', email: 'a@b.org', language: 'fr', at: '2026-11-27T00:00:00Z' }],
      day: 3
    });
    draw.open(null);
    const html = draw.html(d);
    expect(html).toContain('Clean &#60;noise&#62;');
    expect(html).not.toContain('<noise>');
    expect(html).toContain('Dark &#60;pages&#62;');
    expect(html).toContain('href="mailto:a@b.org"');
    expect(html).toContain(`data-rm-sug="${B}" data-rm-do="new"`);
    expect(html).toContain('Hidden (1)');
    expect(html).toContain('<b>1 suggestions wait</b>');
    expect(html).not.toContain('rmedit');
  });

  it('opens an item in the editor with its counts and notes, and a new one empty', () => {
    const d = data({ items: [item(A, { counts: [1, 2, 3, 4], notes: [{ importance: 3, words: 'We need it', email: null, language: 'en', at: '2026-11-27T00:00:00Z', suggestion: false }] })] });
    draw.open(A);
    const html = draw.html(d);
    expect(html).toContain(`id="rm-title-${A}"`);
    expect(html).toContain('What people wrote (1)');
    expect(html).toContain('We need it');
    draw.open('new');
    const fresh = draw.html(d);
    expect(fresh).toContain('id="rm-title-new"');
    expect(fresh).not.toContain('What people wrote');
    draw.open(null);
  });

  it('warns about suggestions that wait and a day at the cap', () => {
    expect(roadmapAlerts(data())).toEqual([]);
    const one = roadmapAlerts(data({ suggestions: [{ id: A, importance: 1, words: 'x', email: null, language: 'en', at: '' }] }));
    expect(one.map((a) => [a.level, a.key])).toEqual([['watch', 'roadmap-suggestions']]);
    expect(one[0]!.text).toContain('1 roadmap suggestion waits');
    expect(roadmapAlerts(data({ day: 1000 })).map((a) => a.key)).toEqual(['roadmap-full']);
  });

  it('is on the dashboard page', async () => {
    const html = await page({ supabaseUrl: 'https://x.supabase.co', anonKey: 'k' }, 'n').text();
    expect(html).toContain('RENDER.roadmap');
    expect(html).toContain('.rmboard');
  });
});
