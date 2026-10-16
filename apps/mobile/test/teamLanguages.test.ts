// The languages a team's reference material may be in (decision 130): the main one, then others added.
import { describe, expect, it } from 'vitest';
import { emptyLanguageState, type LanguageState } from '@langquest-next/core';
import { inLanguages, languagesSays, teamLanguages } from '../src/reference/languages';

const withLanguages = (main: string, added: Record<string, boolean>): LanguageState => {
  const s = emptyLanguageState();
  s.referenceLanguage = { value: main, hlc: 'h', eventId: 'e' };
  s.referenceLanguagesAdded = Object.fromEntries(Object.entries(added).map(([l, v]) => [l, { value: v, hlc: 'h', eventId: `e:${l}` }]));
  return s;
};

describe("a team's material languages", () => {
  it('are the main one, then the others added', () => {
    expect(teamLanguages(null, withLanguages('eng', { hbo: true, grc: true, fra: false }), 'L')).toEqual(['eng', 'grc', 'hbo']);
    expect(teamLanguages(null, emptyLanguageState(), null)).toEqual(['eng']);
  });

  it('take in material in any of them, and material that names none', () => {
    expect(inLanguages('grc', ['eng', 'grc'])).toBe(true);
    expect(inLanguages('fra', ['eng', 'grc'])).toBe(false);
    expect(inLanguages(null, ['eng'])).toBe(true);
  });

  it('change by moving the main one and adding or taking away the others', () => {
    expect(languagesSays(['eng'], ['eng', 'grc', 'hbo'])).toEqual([
      { type: 'v1.ReferenceLanguageAdded', payload: { language: 'grc', added: true } },
      { type: 'v1.ReferenceLanguageAdded', payload: { language: 'hbo', added: true } }
    ]);
    expect(languagesSays(['eng', 'grc'], ['fra'])).toEqual([
      { type: 'v1.ReferenceLanguageSet', payload: { language: 'fra' } },
      { type: 'v1.ReferenceLanguageAdded', payload: { language: 'grc', added: false } }
    ]);
    expect(languagesSays(['eng', 'grc'], ['eng', 'grc'])).toEqual([]);
  });
});
