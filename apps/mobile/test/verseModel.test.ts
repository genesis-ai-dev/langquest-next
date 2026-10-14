import { describe, expect, it } from 'vitest';
import { passageVerseKeys, readPartVerses, spanName, spanShort, verseName, versesHeld } from '../src/simple/verseModel';

const versesIn = (_book: string, chapter: number) => (chapter === 1 ? 31 : 25);

describe('the passage verses for the recorder gutter (decisions.md 82)', () => {
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

describe("a published version's parts, read only (decisions.md 82)", () => {
  it('gives each part its verses and marks more of the verse above, however it was stored', () => {
    const rows = readPartVerses([{ t: 'set', s: 0, e: 0 }, { t: 'join' }, { t: 'set', s: 0, e: 0 }, { t: 'next' }, null, { t: 'set', s: 1, e: 1 }], 5);
    expect(rows.map((r) => (r.label ? `${r.label.s}-${r.label.e}` : null))).toEqual(['0-0', '0-0', '0-0', '1-1', null, '1-1']);
    // A part after an empty one is not more of anything, even with the same verse as the last label.
    expect(rows.map((r) => r.same)).toEqual([false, true, true, false, false, false]);
  });

  it('says which verses a version holds, first to last, and nothing when it has none', () => {
    const keys = ['1:1', '1:2', '1:3', '1:4', '1:5'];
    expect(versesHeld([{ t: 'set', s: 0, e: 0 }, { t: 'join' }, { t: 'next' }, null, { t: 'set', s: 3, e: 4 }], keys)).toBe('Verses 1–5');
    expect(versesHeld([{ t: 'set', s: 2, e: 2 }, null], keys)).toBe('Verse 3');
    expect(versesHeld([null, null], keys)).toBeNull();
    expect(versesHeld([{ t: 'next' }], [])).toBeNull();
  });
});
