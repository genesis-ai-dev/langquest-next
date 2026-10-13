// Dividing a book your own way: starts, sections, and the way they make (decision 93).
import { describe, expect, it } from 'vitest';
import { bookParts, withBookBrokenUp, type TemplateDoc, type VersificationDoc } from '@langquest-next/core';
import { namesOfWay, ownWayDoc, sectionLabel, sectionsOf, startsOfWay, verseOrder } from '../src/breakup/ownWay';

const v11n: VersificationDoc = { format: 'versification@1', code: 'eng', name: 'English', maxVerses: { RUT: [22, 23, 18, 22] }, mappedVerses: {} };
const base: TemplateDoc = {
  format: 'template@2', name: 'FIA passages', description: '', structure: 'bible', levels: [{ name: 'Book' }, { name: 'Passage' }],
  bible: { versification: 'hash-eng', books: [{ book: 'RUT', name: 'Ruth' }, { book: 'JON', name: 'Jonah', divide: 'chapters' }] }, deps: []
};
const order = verseOrder(v11n.maxVerses['RUT']!);

describe('own way', () => {
  it('lists every verse in order', () => {
    expect(order).toHaveLength(85);
    expect(order[22]).toBe('2:1');
  });

  it('makes sections from the verses they start at, the first verse always one', () => {
    const secs = sectionsOf(order, new Set(['1:6', '2:1']));
    expect(secs.map(sectionLabel)).toEqual(['1:1–5', '1:6–22', '2:1–4:22']);
    expect(secs[1]!.verses).toBe(17);
  });

  it('starts from a way: its chapters or its passages', () => {
    const chapters: TemplateDoc = { ...base, bible: { ...base.bible!, books: [{ book: 'RUT', name: 'Ruth', divide: 'chapters' }] } };
    expect([...startsOfWay(chapters, 'RUT', v11n)]).toEqual(['1:1', '2:1', '3:1', '4:1']);
    const passages: TemplateDoc = { ...base, bible: { ...base.bible!, books: [{ book: 'RUT', name: 'Ruth', divide: 'passages', passages: [{ ref: 'RUT 1:1-5' }, { ref: 'RUT 1:6-22', name: 'Going home' }] }] } };
    expect([...startsOfWay(passages, 'RUT', v11n)]).toEqual(['1:1', '1:6']);
    expect(namesOfWay(passages, 'RUT')).toEqual({ '1:6': 'Going home' });
    expect(startsOfWay(base, 'RUT', v11n).size).toBe(0);
  });

  it('saves as a way with just this book, which divides it in the template', () => {
    const secs = sectionsOf(order, new Set(['1:6', '2:1']));
    const way = ownWayDoc({ base, book: 'RUT', bookName: 'Ruth', part: 'Section', sections: secs, names: { '1:6': 'Going home ' }, v11n, english: v11n });
    expect(bookParts(way, 'RUT')?.passages).toEqual([{ ref: 'RUT 1:1-5' }, { ref: 'RUT 1:6-22', name: 'Going home' }, { ref: 'RUT 2:1-4:22' }]);
    const after = withBookBrokenUp(base, 'RUT', way);
    expect(bookParts(after, 'RUT')?.divide).toBe('passages');
    expect(bookParts(after, 'JON')?.divide).toBe('chapters');
  });
});
