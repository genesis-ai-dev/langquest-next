import { PASSAGE_READING, SCREEN_IDS, TAB_SCREENS } from '../src/flow';
import { chapterColumns, chromeVisible, frame, layoutKind, WIDE_CHROME } from '../src/layout';
import { measure } from '../src/theme';

describe('responsive layout (decisions.md 55)', () => {
  it('sorts windows into phone, tablet and desktop at 768 and 1100', () => {
    expect(layoutKind(0)).toBe('phone');
    expect(layoutKind(430)).toBe('phone');
    expect(layoutKind(767)).toBe('phone');
    expect(layoutKind(768)).toBe('tablet');
    expect(layoutKind(1099)).toBe('tablet');
    expect(layoutKind(1100)).toBe('desktop');
    expect(layoutKind(2560)).toBe('desktop');
  });

  it("a phone gets the demo's tab rule, but a passage and what you read under it are tasks (decision 71)", () => {
    const tasks: string[] = ['passage_record', ...PASSAGE_READING];
    for (const id of SCREEN_IDS) expect(chromeVisible('phone', id), id).toBe(TAB_SCREENS.includes(id) && !tasks.includes(id));
    for (const id of tasks) expect(chromeVisible('tablet', id), id).toBe(true);
  });

  it('wide windows keep the nav on Manage drill-downs, and still hide it on task screens', () => {
    for (const id of WIDE_CHROME) {
      expect(SCREEN_IDS, id).toContain(id);
      expect(chromeVisible('tablet', id), id).toBe(true);
      expect(chromeVisible('desktop', id), id).toBe(true);
    }
    for (const task of ['workspace', 'review_capture', 'ask_someone', 'add_record', 'sign_in', 'welcome'] as const) {
      expect(chromeVisible('desktop', task), task).toBe(false);
    }
  });

  it('frames add up to the window and leave the detail room to work', () => {
    for (let width = 320; width <= 2560; width += 37) {
      for (const chrome of [false, true]) for (const split of [false, true]) {
        const f = frame(width, { chrome, split });
        expect(f.chromeWidth + f.paneWidth + f.detailWidth).toBe(width);
        if (f.kind === 'phone') expect(f.chromeWidth + f.paneWidth).toBe(0);
        if (f.kind !== 'desktop') expect(f.paneWidth).toBe(0);
        if (f.paneWidth) {
          expect(f.paneWidth).toBeGreaterThanOrEqual(measure.paneMin);
          expect(f.paneWidth).toBeLessThanOrEqual(measure.paneMax);
        }
      }
    }
    expect(frame(1100, { chrome: true, split: true }).detailWidth).toBeGreaterThanOrEqual(480);
    expect(frame(1024, { chrome: true, split: false }).chromeWidth).toBe(measure.rail);
    expect(frame(1440, { chrome: true, split: false }).chromeWidth).toBe(measure.sidebar);
  });

  it('a book grid is five across on every phone and stays tile-sized wider', () => {
    for (let w = 320; w < 768; w++) expect(chapterColumns(w, 'phone')).toBe(5);
    for (let w = 320; w <= 2560; w += 13) {
      for (const kind of ['tablet', 'desktop'] as const) {
        const cols = chapterColumns(w, kind);
        expect(cols).toBeGreaterThanOrEqual(5);
        expect(cols).toBeLessThanOrEqual(10);
      }
    }
    expect(chapterColumns(measure.column, 'desktop')).toBeGreaterThan(5);
  });
});
