import { baseWay, NUMBERING_ITEMS } from '../src/breakup/model';
import fs from 'node:fs';
import path from 'node:path';
import { factsOf, QUIZ, resolveNumbering } from '../src/breakup/numberingGuide';
import { bibleBrainBible, bibleBrainBibles, COMMON_BIBLES, firstBibles, KNOWN_BIBLES, withBibleBrain } from '../src/breakup/knownBiblesModel';

const offered = Object.keys(NUMBERING_ITEMS);

describe('finding a Bible\'s numbering (decision 80)', () => {
  it('reads a way the same in every numbering it is published in', () => {
    expect(baseWay('langquest.bible.fia')).toBe('langquest.bible.fia');
    expect(baseWay('langquest.bible.fia.org-66')).toBe('langquest.bible.fia');
    expect(baseWay('langquest.bible.openbible-short.rso-77')).toBe('langquest.bible.openbible-short');
    expect(baseWay('our-own')).toBe('our-own');
  });

  it('gives every known Bible a numbering LangQuest offers, or says why not', () => {
    for (const b of KNOWN_BIBLES) {
      const r = resolveNumbering(b.numbering, b.nearest, offered);
      if (r.code) expect(offered, b.abbr).toContain(r.code);
      else expect(r.note, b.abbr).toMatch(/Greek Old Testament/);
    }
    expect(resolveNumbering('custom', 'eng', offered)).toEqual({ code: 'eng', note: expect.stringMatching(/mixes/) });
    expect(resolveNumbering('unknown', undefined, offered).code).toBeNull();
  });

  it('ends every way through the quiz on an answer, within five questions', () => {
    const walk = (at: string, depth: number): void => {
      const q = QUIZ.questions[at];
      expect(q, at).toBeDefined();
      expect(depth, at).toBeLessThanOrEqual(5);
      for (const o of [...q!.options, q!.notSure]) {
        if (!o) continue;
        if (o.next) walk(o.next, depth + 1);
        else expect(o.to, `${at}: ${o.label}`).toBeDefined();
      }
    };
    walk(QUIZ.start, 1);
  });

  it('lists the common Bibles by their abbreviations, and tells numberings apart at a glance', () => {
    for (const abbr of COMMON_BIBLES) expect(KNOWN_BIBLES.some((b) => b.abbr === abbr), abbr).toBe(true);
    const read = (code: string) => {
      const raw = JSON.parse(fs.readFileSync(path.resolve(__dirname, `../../../library/versifications/${code}.json`), 'utf8'));
      return { maxVerses: Object.fromEntries(Object.entries(raw.maxVerses as Record<string, string[]>).map(([b, vs]) => [b, vs.map(Number)])) };
    };
    expect(factsOf(read('eng'))).toMatchObject({ malachi: 4, headings: false });
    expect(factsOf(read('org'))).toMatchObject({ malachi: 3, headings: true });
  });

  it("lists Bibles in the translators' languages first, then the common ones (decision 195)", () => {
    expect(firstBibles().map((b) => b.abbr)).toEqual(COMMON_BIBLES);
    expect(firstBibles(['hin', 'ara']).map((b) => b.abbr)).toEqual(['HINOV', 'AVD', ...COMMON_BIBLES]);
    // A few in each language, and none twice.
    const english = firstBibles(['eng']).map((b) => b.abbr);
    expect(english.slice(0, 3)).toEqual(['KJV', 'NIV', 'ESV']);
    expect(new Set(english).size).toBe(english.length);
    expect(english.length).toBe(3 + COMMON_BIBLES.filter((a) => !english.slice(0, 3).includes(a)).length);
    expect(firstBibles(['xyz']).map((b) => b.abbr)).toEqual(COMMON_BIBLES);
  });

  it("lists Bible Brain's numbered Bibles beside the app's, once each (decision 198)", () => {
    const thai = { bibleId: 'THATSV', name: 'Thai Standard Version', vname: 'ฉบับมาตรฐาน', language: 'tha', languageName: 'Thai', numbering: 'eng' };
    expect(bibleBrainBible(thai)).toEqual({ name: 'ฉบับมาตรฐาน', abbr: 'THATSV', language: 'Thai', iso: 'tha', numbering: 'eng', checked: true });
    // No numbering, or one the app does not offer for a Bible: not listed.
    expect(bibleBrainBible({ ...thai, numbering: undefined })).toBeNull();
    expect(bibleBrainBible({ ...thai, numbering: 'custom' })).toBeNull();
    // Whole Bibles before a testament alone, unnumbered ones left out.
    const nt = { ...thai, bibleId: 'THANTV', vname: '', name: 'Thai New Testament', text: { NT: 'THANTVN_ET' } };
    const whole = { ...thai, text: { OT: 'THATSVO_ET', NT: 'THATSVN_ET' } };
    expect(bibleBrainBibles([nt, { ...thai, bibleId: 'THAX', numbering: undefined }, whole]).map((b) => b.abbr)).toEqual(['THATSV', 'THANTV']);
    // One of a name in a language: the whole Bible.
    expect(bibleBrainBibles([{ ...nt, vname: 'ฉบับมาตรฐาน' }, whole]).map((b) => b.abbr)).toEqual(['THATSV']);
    // A Thai team sees Thai Bibles first, though the app has none of its own.
    expect(firstBibles(['tha'], bibleBrainBibles([nt, whole])).map((b) => b.abbr)).toEqual(['THATSV', 'THANTV', ...COMMON_BIBLES]);
    // The app's KJV and Bible Brain's ENGKJV are one Bible, and so are two of one name; the app's comes first.
    const english = (bibleId: string, name: string) => bibleBrainBible({ bibleId, name, language: 'eng', languageName: 'English', numbering: 'eng' })!;
    const known = KNOWN_BIBLES.filter((b) => b.language === 'English');
    const brain = [english('ENGKJV', 'KJV 1769'), english('ENGESV', 'English Standard Version'), english('ENGASV', 'American Standard Version')];
    expect(withBibleBrain(known, brain).map((b) => b.abbr)).toEqual([...known.map((b) => b.abbr), 'ENGASV']);
    // The same letters in another language are another Bible.
    expect(withBibleBrain(known, [{ ...english('SPANIV', 'NIV'), name: 'Nueva', language: 'Spanish', iso: 'spa' }]).map((b) => b.abbr)).toContain('SPANIV');
    // Hindi (hin) and Swahili under either code: Bible Brain writes swh.
    const swahili = bibleBrainBible({ bibleId: 'SWHNEN', name: 'Neno', language: 'swh', languageName: 'Swahili', numbering: 'eng' })!;
    expect(firstBibles(['swa'], [swahili]).map((b) => b.abbr)).toContain('SWHNEN');
  });
});
