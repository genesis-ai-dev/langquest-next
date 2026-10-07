import { readFileSync } from 'node:fs';
import { parseRef, validateDoc } from '@langquest-next/core';
import { fiaLanguages, fiaPericope, fiaRef, fiaStudyDoc } from './fia-adapter';

// The FIA API's own material for Genesis 2:4-25, the copy the seed reads.
const GEN_P2: unknown = JSON.parse(readFileSync(new URL('../library/fia/pericope_gen-p2.json', import.meta.url), 'utf8'));
const ENG = 'a'.repeat(64);

describe('FIA adapter', () => {
  const doc = fiaStudyDoc(GEN_P2, 'eng', ENG)!;

  it('makes a valid study document numbered in English', () => {
    expect(validateDoc(doc)).toBeNull();
    expect(doc.ref).toBe('GEN 2:4-25');
    expect(doc.title).toBe('Genesis 2:4–25');
    expect(doc.versification).toBe(ENG);
    expect(doc.deps).toEqual([ENG]);
    // FIA is CC BY-SA 4.0: every guide carries its attribution where readers see the source.
    expect(doc.source).toBe('fia.bible · English · © 2025 Word Collective, CC BY-SA 4.0');
    expect(doc.language).toBe('eng');
  });

  it('keeps the six steps in order, with phases and the smallest audio', () => {
    expect(doc.steps.map((s) => s.id)).toEqual(['hear', 'stage', 'scenes', 'embody', 'gaps', 'speak']);
    expect(doc.steps.map((s) => s.phase)).toEqual(['Familiarize', 'Familiarize', 'Internalize', 'Internalize', 'Articulate', 'Articulate']);
    expect(doc.steps[0]!.title).toBe('Hear and Heart');
    expect(doc.steps[0]!.text).toMatch(/^Hear Genesis 2:4-25/);
    expect(doc.steps[0]!.audio).toEqual({ url: 'https://s3.amazonaws.com/cbbt-er.public/pericopes/eng/gen/p2/s1/v1/vbr6.mp3', seconds: 38 });
    expect(doc.steps.every((s) => s.audio?.url?.endsWith('/vbr6.mp3'))).toBe(true);
  });

  it('carries the pictures, the map and the glossary', () => {
    expect(doc.resources.map((r) => r.ref)).toEqual(['m302', 'm385', 'm386', 'm387', 'c47', 't63', 't173', 't174', 't187']);
    expect(doc.resources.find((r) => r.ref === 'c47')).toMatchObject({ kind: 'map', title: 'Garden of Eden' });
    expect(doc.terms.find((t) => t.id === 't63')).toMatchObject({
      term: 'heaven', hint: 'the visible sky or the place where God lives', audioUrl: 'https://s3.amazonaws.com/cbbt-er.public/terms/audio/eng/t63/v1/vbr4.mp3'
    });
    expect(doc.terms.every((t) => t.body.length > 0)).toBe(true);
  });

  it('means what the app read from the API before the library (steps, resources, glossary)', () => {
    // The app used to parse this JSON itself; these are the facts its tests held it to.
    expect(doc.steps.map((st) => st.id)).toEqual(['hear', 'stage', 'scenes', 'embody', 'gaps', 'speak']);
    expect(doc.steps[0]!.title).toBe('Hear and Heart');
    expect(doc.steps[1]!.audio?.url).toMatch(/^https:/);
    expect(doc.resources.map((r) => r.ref).sort()).toEqual(['c47', 'm302', 'm385', 'm386', 'm387', 't173', 't174', 't187', 't63']);
    expect(doc.about.length).toBeGreaterThan(20);
    expect(doc.terms.find((t) => t.id === 't63')?.body).toMatch(/^The word heaven/);
  });

  it('makes one document per language FIA renders, and none for others', () => {
    expect(fiaLanguages(GEN_P2).map((l) => l.id)).toEqual(['cmn', 'eng', 'fra', 'hin', 'por']);
    const fra = fiaStudyDoc(GEN_P2, 'fra', ENG)!;
    expect(validateDoc(fra)).toBeNull();
    expect(fra.title).toBe('Genèse 2:4–25');
    expect(fra.source).toBe('fia.bible · French · © 2025 Word Collective, CC BY-SA 4.0');
    expect(fra.steps[0]!.text).not.toBe(doc.steps[0]!.text);
    expect(fiaStudyDoc(GEN_P2, 'deu', ENG)).toBeNull();
  });

  it('gives a step with no title in its language the English title, else its own name', () => {
    const blank = structuredClone(GEN_P2) as typeof GEN_P2;
    const fra = (blank as { pericope: { pericopeTranslations: { edges: { node: { language: { id: string }; stepRenderings: { edges: { node: { stepTranslation: { title: string | null } | null } }[] } } }[] } } })
      .pericope.pericopeTranslations.edges.find((e) => e.node.language.id === 'fra')!.node;
    fra.stepRenderings.edges[0]!.node.stepTranslation = { title: null };
    fra.stepRenderings.edges[1]!.node.stepTranslation = null;
    const doc = fiaStudyDoc(blank, 'fra', ENG)!;
    expect(validateDoc(doc)).toBeNull();
    expect(doc.steps[0]!.title).toBe('Hear and Heart');
    const eng = (blank as { pericope: { pericopeTranslations: { edges: { node: { language: { id: string } } }[] } } }).pericope.pericopeTranslations;
    eng.edges = eng.edges.filter((e) => e.node.language.id !== 'eng');
    expect(fiaStudyDoc(blank, 'fra', ENG)!.steps[0]!.title).toBe('Hear and heart');
  });

  it('keeps verse portions and chapter crossings in the ref', () => {
    const p = fiaPericope(GEN_P2);
    expect(fiaRef({ ...p, book: { id: 'jdg' }, startChapter: 5, startVerse: 11, startPortion: 'b', endChapter: 5, endVerse: 18, endPortion: null })).toBe('JDG 5:11b-18');
    expect(fiaRef({ ...p, book: { id: '1sa' }, startChapter: 3, startVerse: 15, endChapter: 4, endVerse: 1, endPortion: 'a' })).toBe('1SA 3:15-4:1a');
    expect(parseRef('1SA 3:15-4:1a')).toEqual({ book: '1SA', start: { chapter: 3, verse: 15 }, end: { chapter: 4, verse: 1 } });
  });
});
