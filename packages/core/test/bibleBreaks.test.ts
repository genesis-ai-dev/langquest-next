// Where English Bibles start sections (OpenBible.info's counts), for dividing a book your own way.
import { describe, expect, it } from 'vitest';
import { bibleBreaks, bibleBreaksIn, BIBLES_COUNTED } from '../src';
import type { VersificationDoc } from '../src';

const v11n = (code: string, mapped: Record<string, string> = {}): VersificationDoc => ({
  format: 'versification@1', code, name: code, maxVerses: { MAL: [14, 17, 18, 6], ROM: [32] }, mappedVerses: mapped
});

describe('bibleBreaks', () => {
  it('counts the Bibles that start a section at each verse', () => {
    const rom = bibleBreaks('ROM');
    expect(rom.get('1:18')).toBe(BIBLES_COUNTED);
    expect(rom.get('1:8')).toBe(18);
    expect(rom.has('1:2')).toBe(false);
  });

  it('knows nothing of a book OpenBible does not have', () => {
    expect(bibleBreaks('TOB').size).toBe(0);
  });

  it('moves the counts into another numbering through the Original', () => {
    // English Malachi 4:1 is Original (Hebrew) Malachi 3:19.
    const english = { ...v11n('eng', { 'MAL 4:1': 'MAL 3:19' }), maxVerses: { MAL: [14, 17, 18, 6] } };
    const hebrew = { ...v11n('org'), maxVerses: { MAL: [14, 17, 24] } };
    const counts = bibleBreaksIn('MAL', english, hebrew);
    expect(counts.get('3:19')).toBe(bibleBreaks('MAL').get('4:1'));
    expect(counts.has('4:1')).toBe(false);
    expect(bibleBreaksIn('ROM', english, english)).toBe(bibleBreaks('ROM'));
  });
});
