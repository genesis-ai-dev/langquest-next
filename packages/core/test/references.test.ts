import { describe, expect, it } from 'vitest';
import {
  biblebrainFileset, canonicalJson, emptyLanguageState, emptyOrgState, foldLanguage as fold, foldOrg, recommendedFor, segmentAt, segmentsFromStarts, sourceOffers,
  testamentOf, usedOn, usedSummary, validateDoc, verseSpan, passageLink, linkedTo, withDeps,
  type SourceDoc, type TimingDoc
} from '../src';
import { buildOrgFixture, buildRecordFixture as buildFixture, shuffle } from './fixtures';

const H = (c: string) => c.repeat(64);

describe('reference recommendations', () => {
  it('a language hides or adds to what the organization recommends', () => {
    const org = foldOrg(buildOrgFixture());
    expect(org.recommendations['langquest.source.bsb']?.value).toBe(true);
    // Same clock from two devices: the higher event id wins the register.
    expect(org.recommendations['langquest.source.esv']?.value).toBe(false);
    const state = fold(buildFixture());
    const recs = recommendedFor(org.recommendations, state);
    // The later "recommended" beats the earlier "hidden" for BSB; ESV follows the organization (not recommended there).
    expect([...recs.entries()]).toEqual([['langquest.source.bsb', 'language']]);
    // Another language with no choices of its own follows the organization.
    expect([...recommendedFor(org.recommendations, emptyLanguageState()).keys()]).toEqual(['langquest.source.bsb']);
    expect(recommendedFor(emptyOrgState().recommendations, null).size).toBe(0);
  });

  it('a passage link is a register: the later hide wins', () => {
    const state = fold(buildFixture());
    expect(passageLink(state, 'luke1', 'health-notes')).toBe(false);
    expect(linkedTo(state, 'luke1')).toEqual([]);
    expect(passageLink(state, 'luke1', 'other')).toBeUndefined();
  });
});

describe('what was used', () => {
  it('keeps the earliest description and is opened once anyone opened it, in any order', () => {
    const events = buildFixture();
    const base = usedOn(fold(events), { takeId: 'take2' });
    for (let seed = 1; seed < 20; seed++) expect(usedOn(fold(shuffle(events, seed)), { takeId: 'take2' })).toEqual(base);
    expect(base.map((u) => [u.itemId, u.opened])).toEqual([
      ['langquest.source.bsb', true], ['biblebrain.ENGESV', true], ['langquest.fia.eng', true]
    ]);
    expect(base[2]!.by).toBe('t1');
    expect(usedOn(fold(events), { reviewId: 'rv1' }).map((u) => u.name)).toEqual(['Translation Guidelines']);
    expect(usedSummary(base, 2)).toBe('Berean Standard Bible, English Standard Version and 1 more');
  });
});

describe('sources and timings', () => {
  const source: SourceDoc = withDeps({
    format: 'source@1', name: 'English Standard Version', abbreviation: 'ESV', language: 'eng', versification: H('a'),
    provider: { kind: 'biblebrain', bibleId: 'ENGESV', text: { OT: 'ENGESVO_ET', NT: 'ENGESVN_ET' }, audio: { NT: 'ENGESVN1DA' } },
    offline: 'allowed', copyright: { text: '© Crossway', audio: '℗ Crossway' },
    books: [{ book: 'GEN', name: 'Genesis' }, { book: 'JHN', name: 'John' }], deps: []
  });

  it('picks Bible Brain filesets by testament, so a New Testament-only audio Bible says it has no Genesis audio', () => {
    expect(testamentOf('MAL')).toBe('OT');
    expect(testamentOf('MAT')).toBe('NT');
    expect(biblebrainFileset(source, 'GEN', 'audio')).toBeNull();
    expect(biblebrainFileset(source, 'JHN', 'audio')).toBe('ENGESVN1DA');
    expect(sourceOffers(source, 'GEN')).toEqual({ text: true, audio: false, offline: true });
    expect(sourceOffers(source, 'REV')).toEqual({ text: false, audio: false, offline: false });
    expect(validateDoc(source)).toBeNull();
  });

  it('turns FCBH verse starts into end-to-end segments and finds verses in them', () => {
    const { introEndMs, segments } = segmentsFromStarts([
      { verse: 0, seconds: 0 }, { verse: 1, seconds: 4.1 }, { verse: 2, seconds: 11.8 }, { verse: 4, seconds: 20 }
    ], 30000);
    expect(introEndMs).toBe(4100);
    expect(segments).toEqual([
      { verseStart: 1, verseEnd: 1, startMs: 4100, endMs: 11800 },
      { verseStart: 2, verseEnd: 3, startMs: 11800, endMs: 20000 },
      { verseStart: 4, verseEnd: 4, startMs: 20000, endMs: 30000 }
    ]);
    const timing: TimingDoc = withDeps({
      format: 'timing@1', book: 'GEN', chapter: 1, versification: H('a'), audio: { sha256: H('b'), durationMs: 30000 },
      introEndMs, segments, source: 'fcbh', deps: []
    });
    expect(validateDoc(timing)).toBeNull();
    expect(verseSpan(timing, 3)).toEqual({ startMs: 11800, endMs: 20000 });
    expect(verseSpan(timing, 1, 4)).toEqual({ startMs: 4100, endMs: 30000 });
    expect(verseSpan(timing, 9)).toBeNull();
    expect(segmentAt(timing, 1000)).toBeNull();
    expect(segmentAt(timing, 12000)).toEqual({ verseStart: 2, verseEnd: 3 });
    expect(segmentAt(timing, 40000)).toEqual({ verseStart: 4, verseEnd: 4 });
    expect(validateDoc({ ...timing, segments: [{ verseStart: 1, verseEnd: 1, startMs: 5, endMs: 2 }] })).toMatch(/segments/);
    expect(validateDoc({ ...timing, deps: [] })).toMatch(/deps/);
  });

  it('validates source books and authored guides', () => {
    const book = withDeps({ format: 'sourceBook@1' as const, book: 'JON', chapters: [{ chapter: 1, verses: [[1, 1, 'Now the word…'], [2, 3, 'A bridge']] as [number, number, string][], audio: { hash: H('c'), durationMs: 1000 }, timing: H('d') }], deps: [] });
    expect(validateDoc(book)).toBeNull();
    expect(book.deps).toEqual([H('d')]);
    expect(validateDoc({ ...book, chapters: [{ chapter: 1, verses: [[1, 'x']] }] })).toMatch(/verses/);
    const guide = withDeps({
      format: 'study@2' as const, title: 'Clean water', pattern: 'Lesson', about: '', source: 'Our team', language: 'eng',
      links: [{ template: 'health', node: 'water' }], license: 'CC-BY-SA-4.0',
      steps: [{ id: 's1', title: 'Listen', text: '> [!culture] Water is fetched at dawn.', audio: { hash: H('e') } }],
      resources: [{ ref: 'm1', kind: 'media' as const, title: 'A well', media: [{ id: 'p1', kind: 'photo' as const, title: 'Well', caption: '', file: { hash: H('f'), lowHash: H('1') } }] }],
      terms: [{ id: 't1', term: 'clean', body: 'Safe to drink.', audio: { hash: H('2') } }], deps: []
    });
    expect(validateDoc(guide)).toBeNull();
    expect(validateDoc({ ...guide, links: undefined })).toMatch(/ref or links/);
    expect(validateDoc({ ...guide, steps: [{ id: 's1', title: 'x', text: '', audio: {} }] })).toMatch(/steps/);
    expect(canonicalJson(guide)).toContain('"format":"study@2"');
  });
});
