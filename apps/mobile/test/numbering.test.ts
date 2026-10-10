import { baseWay, NUMBERING_ITEMS } from '../src/breakup/model';
import { KNOWN_BIBLES, QUIZ, resolveNumbering } from '../src/breakup/numberingGuide';

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
      else expect(r.note, b.abbr).toMatch(/Septuagint/);
    }
    expect(resolveNumbering('custom', 'eng', offered)).toEqual({ code: 'eng', note: expect.stringMatching(/mixes/) });
    expect(resolveNumbering('unknown', undefined, offered).code).toBeNull();
  });

  it('ends every way through the quiz on an answer, within five questions', () => {
    const walk = (at: string, depth: number): void => {
      const q = QUIZ.questions[at];
      expect(q, at).toBeDefined();
      expect(depth, at).toBeLessThanOrEqual(5);
      for (const o of [...q!.options, q!.notSure, q!.skip]) {
        if (!o) continue;
        if (o.next) walk(o.next, depth + 1);
        else expect(o.to, `${at}: ${o.label}`).toBeDefined();
      }
    };
    walk(QUIZ.start, 1);
  });
});
