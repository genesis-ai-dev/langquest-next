import { emptyState, type LibraryDoc, type ProjectState, type StudyDoc } from '@langquest-next/core';
import { buildLibrary } from '../../../scripts/library-seed';
import { bestGuide, glossaryEntryOf, guideFromDoc, passageVerses } from '../src/study/guideMatch';
import { overlap, parseRange, versesOf } from '../src/study/range';
import { clock, inlineParts, isQuestion, secondsOf, sectionLabel, studySections } from '../src/study/text';
import { readingSeconds, readingsFor, sourceText, verseAt } from '../src/scripture';

function withUnits(units: Record<string, string>): ProjectState {
  const s = emptyState();
  for (const [id, label] of Object.entries(units)) s.units[id] = { parentUnitId: null, kind: 'passage', label, order: id };
  return s;
}

describe('study text', () => {
  it('breaks a step into paragraphs, list items, headings and "Stop here" boxes', () => {
    const md = 'First line\ncontinues here.\n\n1. What do you like?\n2. Who needs it?\n\n- The father\n\n## Scenes\n\n> [!action]\n> Stop here and discuss.\n> Pause this audio here.\n\nLast.';
    const s = studySections(md);
    expect(s.map((x) => x.kind)).toEqual(['para', 'item', 'item', 'item', 'heading', 'action', 'para']);
    expect(s[0]!.text).toBe('First line continues here.');
    expect(s[1]).toMatchObject({ id: 's1', n: 1 });
    expect(s[5]!.text).toBe('Stop here and discuss. Pause this audio here.');
    expect(isQuestion(s[1]!)).toBe(true);
    expect(isQuestion(s[0]!)).toBe(false);
  });

  it('keeps bold words and links to pictures, maps and glossary terms', () => {
    expect(inlineParts('See [heaven](#t63) and __share__ or **this**.')).toEqual([
      { type: 'text', text: 'See ' }, { type: 'link', text: 'heaven', ref: 't63' }, { type: 'text', text: ' and ' },
      { type: 'bold', text: 'share' }, { type: 'text', text: ' or ' }, { type: 'bold', text: 'this' }, { type: 'text', text: '.' }
    ]);
    expect(sectionLabel({ id: 's0', kind: 'para', text: 'A [very](#m1) long sentence that runs past the limit of the label' }, 20)).toBe('A very long senten…');
  });

  it('turns seconds into m:ss and back', () => {
    expect(clock(62.9)).toBe('1:02');
    expect(clock(-3)).toBe('0:00');
    expect(secondsOf('1:02')).toBe(62);
    expect(secondsOf('soon')).toBe(-1);
  });
});

describe('verse ranges', () => {
  it('reads the references units are labelled with', () => {
    expect(parseRange('luk', '15:11-32')).toEqual({ book: 'luk', start: { chapter: 15, verse: 11 }, end: { chapter: 15, verse: 32 } });
    expect(parseRange('gen', '1:1–2:3')).toEqual({ book: 'gen', start: { chapter: 1, verse: 1 }, end: { chapter: 2, verse: 3 } });
    expect(parseRange('luk', '15')).toEqual({ book: 'luk', start: { chapter: 15, verse: 1 }, end: { chapter: 15, verse: null } });
    expect(parseRange('luk', '14-16')).toEqual({ book: 'luk', start: { chapter: 14, verse: 1 }, end: { chapter: 16, verse: null } });
    expect(parseRange('luk', 'intro')).toBeNull();
    expect(parseRange('luk', '15:32-11')).toBeNull();
  });

  it('measures overlap and lists verses', () => {
    const a = parseRange('luk', '15:1-10')!;
    const b = parseRange('luk', '15:11-32')!;
    expect(overlap(a, b)).toBe(0);
    expect(overlap(parseRange('luk', '15')!, b)).toBeGreaterThan(0);
    expect(overlap(parseRange('joh', '15')!, b)).toBe(0);
    expect(versesOf(parseRange('gen', '1:30-2:2')!, (c) => (c === 1 ? 31 : 25))!.map((v) => `${v.chapter}:${v.verse}`)).toEqual(['1:30', '1:31', '2:1', '2:2']);
    expect(versesOf(parseRange('gen', '5')!, () => undefined)).toBeNull();
  });
});

describe('guides from the library', () => {
  // The LangQuest organization's seed (docs/library.md): FIA in five
  // languages, English also holding the two guides written for the demo.
  const build = buildLibrary();
  const docs = new Map<string, LibraryDoc>([...build.documents.values()].map((d) => [d.hash, d.body]));
  const get = (h: string | null | undefined) => (h ? docs.get(h) ?? null : null);
  // Every language's FIA collection, Mandarin first: the reader's language (English) must still win.
  const collections = build.items.filter((i) => get(i.docHash)?.format === 'collection@1')
    .sort((a, b) => (a.itemId.endsWith('.cmn') ? -1 : b.itemId.endsWith('.cmn') ? 1 : 0));
  const sources = [collections.map((i) => ({ key: i.itemId, hash: i.docHash }))];
  const guideFor = (state: ProjectState, unitId: string) => {
    const passage = passageVerses(state, unitId, null, get);
    const choice = passage ? bestGuide(passage, sources, get) : null;
    return choice ? guideFromDoc(choice.id, get(choice.hash) as StudyDoc) : null;
  };

  it('turns each guide into steps with stable ids that can sit in a study mark key', () => {
    const s = withUnits({ gen: 'Genesis 2:4-25', son: 'Luke 15:11–32', john: 'John 3:1-21' });
    for (const unit of ['gen', 'son', 'john']) {
      const guide = guideFor(s, unit)!;
      expect(guide.id).not.toContain(':');
      expect(guide.steps.map((st) => st.id)).toEqual(['hear', 'stage', 'scenes', 'embody', 'gaps', 'speak']);
      for (const st of guide.steps) {
        expect(st.text.length).toBeGreaterThan(20);
        expect(st.audio.seconds).toBeGreaterThan(0);
      }
      // Every link in a step's text opens something the guide has.
      const refs = new Set(guide.resources.map((r) => r.ref));
      for (const st of guide.steps) {
        for (const sec of studySections(st.text)) {
          for (const p of inlineParts(sec.text)) if (p.type === 'link') expect(refs, `${guide.id} ${st.id} ${p.ref}`).toContain(p.ref);
        }
      }
    }
    const genesis = guideFor(s, 'gen')!;
    expect(genesis.steps[0]!.title).toBe('Hear and Heart');
    expect(genesis.steps[1]!.audio.url).toMatch(/^https:/);
    expect(genesis.resources.map((r) => r.ref).sort()).toEqual(['c47', 'm302', 'm385', 'm386', 'm387', 't173', 't174', 't187', 't63']);
  });

  it('matches a unit by book and verse overlap, whatever the unit is called', () => {
    const s = withUnits({
      'fia@1/gen-p2': 'Genesis 2:4-25', 'fia@1/gen-p1': 'Genesis 1:1-2:3', 'bible@1/luk-15': 'Luke 15',
      sheep: 'Luke 15:1-10', son: 'Luke 15:11–32', 'fia@1/jhn-p5': 'John 3:1-21', 'bible@1/luk': 'Luke', other: 'Welcome',
      'langquest.x/GEN.2.4-25': 'Kuɛ̈ɛ̈r 2:4–25'
    });
    expect(guideFor(s, 'fia@1/gen-p2')?.passage).toMatch(/Genesis 2/);
    expect(guideFor(s, 'fia@1/gen-p1')).toBeNull();
    expect(guideFor(s, 'bible@1/luk-15')?.passage).toMatch(/Luke 15/);
    expect(guideFor(s, 'son')?.passage).toMatch(/Luke 15/);
    expect(guideFor(s, 'fia@1/jhn-p5')?.passage).toMatch(/John 3/);
    // A library unit is read from its id, not its label in the language.
    expect(guideFor(s, 'langquest.x/GEN.2.4-25')?.passage).toMatch(/Genesis 2/);
    expect(guideFor(s, 'other')).toBeNull();
    expect(guideFor(s, 'missing')).toBeNull();
  });

  it('shows the Master Glossary entry for FIA material and the description otherwise', () => {
    const s = withUnits({ gen: 'Genesis 2:4-25', son: 'Luke 15:11–32' });
    const genesis = guideFor(s, 'gen')!;
    expect(glossaryEntryOf(genesis, 't63')).toMatchObject({ term: 'heaven', hint: 'the visible sky or the place where God lives' });
    expect(glossaryEntryOf(genesis, 't63')!.body).toMatch(/^The word heaven/);
    const son = guideFor(s, 'son')!;
    expect(glossaryEntryOf(son, 't-kt7')?.term).toBe('heaven');
    expect(glossaryEntryOf(son, 'm1')).toBeNull();
  });
});

describe('scripture', () => {
  const s = withUnits({
    son: 'Luke 15:11-32', 'bible@1/luk-15': 'Luke 15', gen: 'Genesis 1:1-2:3', far: 'Luke 22', john: 'John 3:1-21', book: 'Luke'
  });

  it('has the guide passages in three translations with simulated timings', () => {
    const r = readingsFor(s, 'son');
    expect(r.map((x) => x.code)).toEqual(['BSB', 'WEB', 'KJV']);
    expect(r[0]!.translation).toBe('Berean Standard Bible');
    expect(r[0]!.verses.map((v) => v.ref)).toEqual(Array.from({ length: 22 }, (_, i) => `15:${i + 11}`));
    expect(r[0]!.verses[0]!.start).toBe(0);
    expect(r[0]!.verses[1]!.start).toBeGreaterThan(0);
    expect(readingSeconds(r[0]!)).toBeGreaterThan(r[0]!.verses[21]!.start!);
    expect(verseAt(r[0]!, 0)).toBeUndefined();
    expect(verseAt(r[0]!, r[0]!.verses[3]!.start! + 0.1)?.ref).toBe('15:14');
    expect(verseAt(r[0]!, 9999)?.ref).toBe('15:32');
    expect(readingsFor(s, 'john').map((x) => x.code)).toEqual(['BSB', 'WEB', 'KJV']);
  });

  it('has whole WEB chapters, across chapter breaks', () => {
    const chapter = readingsFor(s, 'bible@1/luk-15');
    expect(chapter.map((x) => x.code)).toEqual(['WEB']);
    expect(chapter[0]!.verses).toHaveLength(32);
    const gen = readingsFor(s, 'gen');
    expect(gen.map((x) => x.code)).toEqual(['WEB']);
    expect(gen[0]!.verses.map((v) => v.ref).slice(-4)).toEqual(['1:31', '2:1', '2:2', '2:3']);
  });

  it('has nothing for other passages', () => {
    expect(readingsFor(s, 'far')).toEqual([]);
    expect(readingsFor(s, 'book')).toEqual([]);
    expect(sourceText(s, 'far')).toBeNull();
    expect(sourceText(s, 'son')).toMatch(/^Jesus continued: “There was a man who had two sons\./);
  });
});
