// Bolding what someone typed in search results (src/textMatch.ts).
import { describe, expect, it } from 'vitest';
import { markedParts, matchRanges } from '../src/textMatch';

describe('typed text in a result', () => {
  it('finds every place it appears, ignoring case', () => {
    expect(matchRanges('Nuer · Dialect of Nuer', 'nuer')).toEqual([[0, 4], [18, 22]]);
    expect(markedParts('DIK · Dinka family', 'di')).toEqual([
      { text: 'DI', match: true }, { text: 'K · ', match: false }, { text: 'Di', match: true }, { text: 'nka family', match: false }
    ]);
  });

  it('ignores accents as the search does, and bolds the accented letters themselves', () => {
    // Why: "kele" finds Kélé, so Kélé is what should be bold.
    expect(markedParts('Kélé', 'kele')).toEqual([{ text: 'Kélé', match: true }]);
    expect(markedParts('Español', 'espanol')).toEqual([{ text: 'Español', match: true }]);
    // An accent written as its own character stays with its letter.
    expect(markedParts('Kélé family', 'kele')).toEqual([{ text: 'Kélé', match: true }, { text: ' family', match: false }]);
  });

  it('marks nothing for empty text or no match', () => {
    expect(matchRanges('Nuer', '  ')).toEqual([]);
    expect(markedParts('Nuer', 'xyz')).toEqual([{ text: 'Nuer', match: false }]);
  });
});
