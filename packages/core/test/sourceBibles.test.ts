import { SOURCE_BIBLES, sourceAudioUrl, sourceChapters } from '../src/sourceBibles';
import { FIA_PERICOPES } from '../src/catalogData';

describe('organization source Bibles', () => {
  it('maps chapter, book and cross-chapter FIA passages', () => {
    expect(sourceChapters('bible@1/jon-2')).toEqual([
      { book: 'jon', chapter: 2, label: 'Jonah 2' }
    ]);
    expect(sourceChapters('fia@1/1jn-p2').map((c) => c.chapter))
      .toEqual([1, 2]);
    expect(sourceChapters('fia@1/1jn-p1').map((c) => c.chapter))
      .toEqual([1]);
    expect(sourceChapters('book@1/jon').map((c) => c.chapter))
      .toEqual([1, 2, 3, 4]);
  });

  it('never infers audio for unknown units or invalid chapters', () => {
    for (const id of ['Jonah 1', 'custom', 'bible@2/jon-1',
      'bible@1/jon-0', 'bible@1/jon-5', 'fia@1/missing']) {
      expect(sourceChapters(id)).toEqual([]);
    }
  });

  it('maps every shipped FIA passage, including Mark and John aliases', () => {
    const unmapped = FIA_PERICOPES.filter((p) =>
      !sourceChapters(`fia@1/${p.itemId}`).length);
    expect(unmapped).toEqual([]);
    expect(sourceChapters('fia@1/mrk-p1')[0]?.book).toBe('mar');
    expect(sourceChapters('fia@1/jhn-p1')[0]?.book).toBe('joh');
  });

  it('keeps editions separate', () => {
    expect(sourceAudioUrl(SOURCE_BIBLES[0],
      sourceChapters('bible@1/joh-1')[0]!))
      .toBe('https://openbible.com/audio/bsb_frederick_surrey/BSB_43_Jhn_001_FS.mp3');
    expect(sourceAudioUrl(SOURCE_BIBLES[1],
      sourceChapters('bible@1/mar-1')[0]!))
      .toBe('https://openbible.com/audio/msb_frederick_surrey/MSB_41_Mrk_001_FS.mp3');
  });
});
