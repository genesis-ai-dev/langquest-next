import { baseWay, NUMBERING_ITEMS } from '../src/breakup/model';
import fs from 'node:fs';
import path from 'node:path';
import { COMMON_BIBLES, factsOf, KNOWN_BIBLES, QUIZ, resolveNumbering } from '../src/breakup/numberingGuide';

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
});
