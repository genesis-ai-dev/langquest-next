import { describe, expect, it } from 'vitest';
import { page } from '../src/page';
import { GROUPS } from '../src/pageOps';
import { SUMMARY_LOGIC } from '../src/pageSummary';
import { METRICS } from '../src/sources/history';

type Health = { value: number | null; at: number; usual: [number, number] | null; said: string; tone: string; zero: boolean; grow: number | null };
type Counts = { need: number; decide: number; way: number; watch: number; unread: number; loading: number; off: number; parts: number };
const logic = new Function(`${SUMMARY_LOGIC}; return { usualOf, comparedTo, healthOf, lineBucket, verdictOf, PAGE_TILES };`)() as {
  usualOf: (v: (number | null)[]) => [number, number] | null;
  comparedTo: (v: number | null, u: [number, number] | null) => string;
  healthOf: (s: { agg: string; values: (number | null)[] }, metric: string, unit?: string, counted?: boolean[]) => Health;
  lineBucket: (level: string, fix: string) => string;
  verdictOf: (c: Counts) => { tone: string; text: string };
  PAGE_TILES: Record<string, [string, string][]>;
};
const none: Counts = { need: 0, decide: 0, way: 0, watch: 0, unread: 0, loading: 0, off: 0, parts: 2 };

describe('the usual range of a number', () => {
  it('is the lowest and highest day, less the one most far out at each end from ten days on', () => {
    expect(logic.usualOf([5, 6, 7, 8, 9])).toEqual([5, 9]);
    expect(logic.usualOf([1, 5, 6, 7, 8, 9, 6, 7, 5, 40])).toEqual([5, 9]);
  });
  it('needs five counted days, and skips days with no value', () => {
    expect(logic.usualOf([1, 2, null, 3])).toBeNull();
    expect(logic.usualOf([1, 2, null, 3, 4, 5])).toEqual([1, 5]);
  });
  it('says where a value is against it', () => {
    expect(logic.comparedTo(7, [5, 9])).toBe('normal');
    expect(logic.comparedTo(12, [5, 9])).toBe('high');
    expect(logic.comparedTo(1, [5, 9])).toBe('low');
    expect(logic.comparedTo(1, null)).toBe('none');
  });
});

describe('what a number of 14 days says', () => {
  const days = (last: number, today = 1) => [5, 6, 5, 7, 6, 5, 6, 7, 5, 6, 6, 5, last, today];
  it('reads a count from its last full day, not today, which is not over', () => {
    const h = logic.healthOf({ agg: 'sum', values: days(6, 0) }, 'syncs');
    expect(h).toMatchObject({ value: 6, at: 12, said: 'normal', tone: 'ok' });
  });
  it('calls a change for the worse a warning (more failures, less work) and a change for the better a note', () => {
    expect(logic.healthOf({ agg: 'sum', values: days(30) }, 'uploads_failed')).toMatchObject({ said: 'high', tone: 'warn' });
    expect(logic.healthOf({ agg: 'sum', values: days(30) }, 'uploads')).toMatchObject({ said: 'high', tone: 'note' });
    expect(logic.healthOf({ agg: 'sum', values: days(0) }, 'uploads')).toMatchObject({ said: 'low', tone: 'warn' });
    expect(logic.healthOf({ agg: 'sum', values: days(0) }, 'uploads_failed')).toMatchObject({ said: 'low', tone: 'note' });
    expect(logic.healthOf({ agg: 'sum', values: days(30) }, 'partial')).toMatchObject({ tone: 'warn' });
  });
  it('reads a level from its newest value, and a size by how much it grows a day', () => {
    expect(logic.healthOf({ agg: 'max', values: days(6, 7) }, 'p95_ms', 'ms')).toMatchObject({ value: 7, at: 13 });
    // A day's highest count (people active) is a count: today is not over, so it reads the last full day.
    expect(logic.healthOf({ agg: 'max', values: days(6, 2) }, 'active_accounts')).toMatchObject({ value: 6, at: 12 });
    const size = logic.healthOf({ agg: 'max', values: [100, 110, 120, 130] }, 'db_bytes', 'bytes');
    expect(size).toMatchObject({ said: 'grow', grow: 10, usual: null });
  });
  it('skips a day the job has not counted, and says when the whole range is zero', () => {
    const counted = days(9).map((_, i) => i !== 12);
    expect(logic.healthOf({ agg: 'sum', values: days(9) }, 'syncs', undefined, counted).at).toBe(11);
    expect(logic.healthOf({ agg: 'sum', values: Array(14).fill(0) }, 'refused').zero).toBe(true);
    expect(logic.healthOf({ agg: 'sum', values: [] }, 'refused')).toMatchObject({ value: null, said: 'none' });
  });
});

describe('where a line goes on a summary', () => {
  it('puts a merged fix on its way, Act now and Fix soon as needing you, a choice as yours, the rest to watch', () => {
    expect(logic.lineBucket('problem', 'merged')).toBe('way');
    expect(logic.lineBucket('urgent', 'issue')).toBe('need');
    expect(logic.lineBucket('problem', 'person')).toBe('need');
    expect(logic.lineBucket('watch', 'person')).toBe('decide');
    expect(logic.lineBucket('watch', 'none')).toBe('watch');
  });
});

describe('the sentence under a page title', () => {
  it('says how many need you, and the rest', () => {
    expect(logic.verdictOf({ ...none, need: 2, watch: 1 })).toEqual({ tone: 'need', text: '2 problems need you. 1 thing to watch.' });
    expect(logic.verdictOf({ ...none, way: 1 })).toEqual({ tone: 'ok', text: '1 fix is merged and waits for its check.' });
  });
  it('never says more than the checks found', () => {
    expect(logic.verdictOf(none).text).toBe('Nothing needs you.');
    expect(logic.verdictOf(none).text).not.toMatch(/works/);
    expect(logic.verdictOf({ ...none, off: 1 }).text).toBe('Nothing needs you. 1 part is not connected.');
    expect(logic.verdictOf({ ...none, off: 2 })).toEqual({ tone: 'wait', text: 'Not connected.' });
    expect(logic.verdictOf({ ...none, loading: 1 })).toEqual({ tone: 'wait', text: 'Checking…' });
    expect(logic.verdictOf({ ...none, unread: 1 })).toMatchObject({ tone: 'watch', text: '1 part could not be read.' });
  });
});

describe('each page’s tiles', () => {
  it('name numbers that exist, at most four, of the page’s own parts', () => {
    for (const [id, tiles] of Object.entries(logic.PAGE_TILES)) {
      const g = GROUPS.find((x) => x.id === id);
      expect(g, id).toBeTruthy();
      expect(tiles.length).toBeLessThanOrEqual(4);
      for (const [part, metric] of tiles) {
        expect(g!.parts as readonly string[], `${id} ${part}`).toContain(part);
        expect(METRICS[part]?.[metric], `${part}.${metric}`).toBeTruthy();
      }
    }
  });
});

describe('every detail stays one tap away', async () => {
  const html = await page({ supabaseUrl: 'https://abc.supabase.co', anonKey: 'k' }, 'n').text();
  it('keeps each section’s card under its summary, as All the details', () => {
    expect(html).toContain('<div id="sum"></div>');
    expect(html).toContain('<span class="dt">All the details</span>');
    expect(html).toContain('<p class="verdict" id="view-say" role="status"></p>');
  });
  it('shows each line’s card once on a page: in the summary, not again in the details', () => {
    expect(html).toContain("const lines = cardsUp() ? '' : lineCards(");
    expect(html).toContain('const cardsUp = () => view().name === \'group\';');
  });
});
