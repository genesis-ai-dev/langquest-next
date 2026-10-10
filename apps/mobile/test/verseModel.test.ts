import { describe, expect, it } from 'vitest';
import { passageVerseKeys, spanName, spanShort, verseName } from '../src/simple/verseModel';

const versesIn = (_book: string, chapter: number) => (chapter === 1 ? 31 : 25);

describe('the passage verses for the recorder gutter (decisions.md 81)', () => {
  it('lists one chapter and names verses by number alone', () => {
    const keys = passageVerseKeys({ book: 'LUK', start: { chapter: 15, verse: 1 }, end: { chapter: 15, verse: 7 } }, versesIn);
    expect(keys).toEqual(['15:1', '15:2', '15:3', '15:4', '15:5', '15:6', '15:7']);
    expect(verseName(keys, 3)).toBe('4');
    expect(spanShort(keys, 3, 4)).toBe('4–5');
    expect(spanName(keys, 3, 3)).toBe('Verse 4');
  });

  it('crosses a chapter with the chapter in the name', () => {
    const keys = passageVerseKeys({ book: 'GEN', start: { chapter: 1, verse: 30 }, end: { chapter: 2, verse: 2 } }, versesIn);
    expect(keys).toEqual(['1:30', '1:31', '2:1', '2:2']);
    expect(spanName(keys, 1, 2)).toBe('Verses 31–2:1');
    expect(verseName(keys, 3)).toBe('2:2');
  });

  it('has no verses for a unit without a range', () => {
    expect(passageVerseKeys(null, versesIn)).toEqual([]);
  });
});
