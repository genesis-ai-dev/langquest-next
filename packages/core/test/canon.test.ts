import { describe, expect, it } from 'vitest';
import { contentTemplate } from '../src/catalog';
import { bibleRangeLabel } from '../src/dynamicBible';
import { bookMatches, CANON, canonBook, locateLabel, matchesQuery, parseQuery } from '../src/canon';

describe('canon', () => {
  it('covers the Protestant canon with testaments and reading groups', () => {
    // Why: the Map toggles OT/NT and groups books; a book in the wrong
    // testament vanishes from the toggle a translator is looking at.
    expect(CANON).toHaveLength(66);
    expect(CANON.filter((b) => b.testament === 'OT')).toHaveLength(39);
    expect(canonBook('mal')?.testament).toBe('OT');
    expect(canonBook('mat')?.testament).toBe('NT');
    expect(canonBook('psa')).toMatchObject({ group: 'Poetry & Wisdom', chapters: 150 });
    expect(canonBook('act')?.group).toBe('Gospels & Acts');
    expect(canonBook('rev')?.group).toBe('Letters');
    expect(CANON.reduce((n, b) => n + b.chapters, 0)).toBe(1189);
  });

  it('locates every label our templates and dynamic passages write', () => {
    // Why: a unit whose label does not resolve cannot be placed on the
    // chapter grid, so the Map would silently drop recorded work.
    // Leaves only: the FIA template labels two book containers by item id
    // ("mrk", "jhn"), so the Map places passages by their own label.
    for (const id of ['bible', 'fia']) {
      for (const item of contentTemplate(id)!.items.filter((i) => i.kind !== 'book')) {
        expect(locateLabel(item.label), item.label).not.toBeNull();
      }
    }
    expect(locateLabel(bibleRangeLabel({ book: 'luk', start: 1, end: 4 }))).toMatchObject({ chapters: [1] });
  });

  it('reads chapters, not verses, out of a reference', () => {
    expect(locateLabel('Luke 15')?.chapters).toEqual([15]);
    expect(locateLabel('Luke 15:1-10')?.chapters).toEqual([15]);
    expect(locateLabel('Luke 15:1–7')?.chapters).toEqual([15]);
    expect(locateLabel('Genesis 1:1-2:3')?.chapters).toEqual([1, 2]);
    expect(locateLabel('Jonah 1-4')?.chapters).toEqual([1, 2, 3, 4]);
    expect(locateLabel('Luke')?.chapters).toEqual([]);
    // Longest name wins and names end at a word boundary.
    expect(locateLabel('1 John 3')?.book.id).toBe('1jn');
    expect(locateLabel('John 3')?.book.id).toBe('joh');
    expect(locateLabel('Judges 3')?.book.id).toBe('jdg');
    expect(locateLabel('Jude 1')?.book.id).toBe('jud');
    expect(locateLabel('Psalm 23')?.book.id).toBe('psa');
    expect(locateLabel('Opening prayer')).toBeNull();
  });

  it('forgives how people type a search', () => {
    expect(parseQuery('  1 Cor 13:4 ')).toEqual({ book: '1 cor', chapter: 13 });
    expect(parseQuery('luk 15')).toEqual({ book: 'luk', chapter: 15 });
    expect(parseQuery('1 cor')).toEqual({ book: '1 cor' });
    expect(bookMatches(canonBook('1co')!, 'cor')).toBe(true);
    expect(bookMatches(canonBook('2co')!, 'cor')).toBe(true);
    expect(bookMatches(canonBook('rom')!, 'cor')).toBe(false);
    expect(matchesQuery('Luke 15:1-7', 'luk 15')).toBe(true);
    expect(matchesQuery('Luke 15:1-7', 'luke 16')).toBe(false);
    expect(matchesQuery('Luke 15:1-7', 'john 15')).toBe(false);
    expect(matchesQuery('Psalms 23', 'ps 23')).toBe(true);
    expect(matchesQuery('Genesis 1:1-2:3', 'gen 2')).toBe(true);
    expect(matchesQuery('Luke 15', '')).toBe(false);
  });
});
