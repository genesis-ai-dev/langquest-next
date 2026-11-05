import { readFileSync } from 'node:fs';
import { parseRef, validateDoc } from '@langquest-next/core';
import { fiaKeyWordList, fiaTermLanguages, fiaTerms } from './fia-terms';

// FIA's key words linked to Genesis 2:4-25, as FIA's get_terms.py writes them (the sample the seed reads).
const SAMPLE: unknown = JSON.parse(readFileSync(new URL('../library/fia/terms.sample.json', import.meta.url), 'utf8'));
const ENG = 'a'.repeat(64);
const PLACES: Record<string, { ref: string; order: number }> = {
  'gen-p1': { ref: 'GEN 1:1-2:3', order: 1 },
  'gen-p2': { ref: 'GEN 2:4-25', order: 2 },
  'gen-p3': { ref: 'GEN 3:1-24', order: 3 }
};
const place = (id: string) => PLACES[id] ?? null;

describe('FIA key words', () => {
  const eng = fiaKeyWordList(SAMPLE, 'eng', ENG, place)!;

  it('makes a valid key-word list numbered in English, credited to FIA', () => {
    expect(validateDoc(eng)).toBeNull();
    expect(eng).toMatchObject({ format: 'material@1', kind: 'key_terms', title: 'FIA key words (English)', language: 'eng', pattern: 'FIA', versification: ENG });
    expect(eng.deps).toEqual([ENG]);
    // FIA is CC BY-SA 4.0: the list carries its attribution where readers see the source.
    expect(eng.source).toBe('fia.bible · English · © 2025 Word Collective, CC BY-SA 4.0');
  });

  it("keeps FIA's term ids, short meanings, meanings with their links, and recordings", () => {
    const heaven = eng.terms!.find((w) => w.id === 't63')!;
    expect(heaven).toMatchObject({ term: 'heaven', gloss: 'the visible sky or the place where God lives' });
    expect(heaven.audio?.url).toMatch(/^https:\/\/.+\/terms\/audio\/eng\/t63\/.+\.mp3$/);
    expect(heaven.body).toMatch(/\]\(#t\d+\)/);
    expect(eng.terms!.every((w) => w.body && w.body.length > 0)).toBe(true);
  });

  it("places each word on FIA's passages, in FIA's order, and leaves out a passage it does not know", () => {
    // heaven is linked to gen-p1, gen-p2, gen-p13 and later passages; only the first two are known here.
    const heaven = eng.terms!.find((w) => w.id === 't63')!;
    expect(heaven.links).toEqual([{ ref: 'GEN 1:1-2:3' }, { ref: 'GEN 2:4-25' }]);
    expect(eng.terms!.flatMap((w) => w.links ?? []).every((l) => 'ref' in l && parseRef(l.ref))).toBe(true);
    const none = fiaKeyWordList(SAMPLE, 'eng', ENG, () => null)!;
    expect(none.terms!.every((w) => w.links === undefined)).toBe(true);
  });

  it('lists the languages that have words with meanings, English first, and makes nothing for one without', () => {
    const langs = fiaTermLanguages(SAMPLE);
    expect(langs[0]).toMatchObject({ id: 'eng', name: 'English', words: 4 });
    expect(langs.map((l) => l.id)).not.toContain('rus');
    expect(fiaKeyWordList(SAMPLE, 'swh', ENG, place)).toBeNull();
  });

  it('gives the same document whatever order the words came in', () => {
    const json = fiaTerms(SAMPLE);
    const reversed = { ...json, terms: [...json.terms].reverse() };
    expect(JSON.stringify(fiaKeyWordList(reversed, 'eng', ENG, place))).toBe(JSON.stringify(eng));
  });

  it('refuses a file that is not FIA terms', () => {
    expect(() => fiaTerms({ pericope: {} })).toThrow('not an FIA terms file');
  });
});
