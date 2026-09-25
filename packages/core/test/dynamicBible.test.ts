import {
  bibleBooks, bibleRangeFromUnit, bibleRangeLabel, bibleRankedTerms,
  bibleSettings, bibleShortlist, bibleText, bibleUnitId, bibleVerseCount,
  nextBiblePassages, validateBibleEvent
} from '../src/dynamicBible';
import { rankTerms, termsAtDensity, termOccurrences } from '../src/keyTermScoring';
import { bsbPassageBounds, passageAudioBounds } from '../src/bibleAudio';
import { SOURCE_BIBLES, sourceAudioUrl, sourceBibleEnabled } from '../src/sourceBibles';
import { emptyOrgState } from '../src/org';
import { fold } from '../src/reducer';
import { buildIndexes, laneLeafUnits } from '../src/indexes';
import { keyTermsForUnit } from '../src/materials';
import { deriveTasks } from '../src/tasks';
import { obtEvent as event } from './obtFixtures';
import { shuffle } from './fixtures';

export function bibleFixture() {
  return [
    event('bible-lane', 'v1.LaneAdded', { laneId: 'bible-lane', languoidId: 'eng' }),
    event('bible-template', 'v1.LaneTemplateSelected', {
      laneId: 'bible-lane', templateId: 'dynamic', catalogVersion: 1
    }),
    event('bible-settings', 'v1.BibleSettingsSet', {
      laneId: 'bible-lane', sourceId: 'bsb', density: 35
    }),
    event('bible-selected', 'v1.BiblePassageSelected', {
      laneId: 'bible-lane', book: 'gen', start: 1, end: 2
    }, 't')
  ];
}

describe('dynamic Bible passages', () => {
  it('imports the complete BSB and offers the real overlapping Genesis boundaries', () => {
    expect(bibleBooks).toHaveLength(66);
    expect(bibleBooks.reduce((n, b) => n + bibleText({ book: b.itemId,
      start: 1, end: bibleVerseCount(b.itemId) }).length, 0)).toBe(31102);
    expect(nextBiblePassages('gen', []).map(r => r.end)).toEqual([34, 31, 2, 38]);
    expect(bibleRangeLabel({ book: 'gen', start: 1, end: 34 })).toBe('Genesis 1:1–2:3');
    expect(bibleText({ book: 'gen', start: 1, end: 1 })[0])
      .toBe('In the beginning God created the heavens and the earth.');
  });
  it('can cover every book without gaps or crossing an already selected range', () => {
    for (const book of bibleBooks) {
      const reserved: { book: string; start: number; end: number }[] = [];
      let end = 0;
      while (true) {
        const next = nextBiblePassages(book.itemId, reserved)[0];
        if (!next) break;
        expect(next.start).toBe(end + 1);
        expect(next.end).toBeGreaterThanOrEqual(next.start);
        reserved.push(next); end = next.end;
      }
      expect(end, book.itemId).toBe(bibleVerseCount(book.itemId));
    }
    expect(nextBiblePassages('gen', [{ book: 'gen', start: 3, end: 5 }]))
      .toEqual([{ book: 'gen', start: 1, end: 2, count: 1 }]);
  });
  it('keeps identities canonical and isolates dynamic units by lane', () => {
    const range = { book: 'gen', start: 1, end: 2 };
    const id = bibleUnitId('lane/with:punctuation', range);
    expect(bibleRangeFromUnit(id)).toEqual({ ...range, laneId: 'lane/with:punctuation' });
    for (const invalid of ['dynamic@1/%/gen/1-2', 'dynamic@1/L/gen/0-2', 'dynamic@1/L/gen/01-2']) {
      expect(bibleRangeFromUnit(invalid)).toBeNull();
    }
    const state = fold(bibleFixture());
    const idx = buildIndexes(state);
    expect(laneLeafUnits(state, idx, 'bible-lane')).toHaveLength(1);
    expect(laneLeafUnits(state, idx, 'other-lane')).toHaveLength(0);
  });
  it('selection creates a task and glossary without marking translation complete', () => {
    const state = fold([...bibleFixture(), event('translator', 'v1.MemberAdded', {
      profileId: 't', role: 'translator'
    })]);
    const tasks = deriveTasks(state, 't');
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ type: 'translate', done: false, takeId: null });
    expect(keyTermsForUnit(state, 'bible-lane', tasks[0]!.unitId).length).toBeGreaterThan(0);
    expect(bibleSettings(state, 'bible-lane').density).toBe(35);
  });
  it('merges concurrent overlapping selections and term audio in either event order', () => {
    const termId = 'bsb-terms@1/bible-lane/god';
    const events = [...bibleFixture(), event('overlap', 'v1.BiblePassageSelected', {
      laneId: 'bible-lane', book: 'gen', start: 1, end: 31
    }, 'other'), event('spoken-term', 'v1.KeyTermAdjusted', {
      termId, adjustmentId: 'spoken', note: '', blobHash: 'audio'
    })];
    const expected = fold(events);
    for (let seed = 0; seed < 30; seed++) expect(fold(shuffle(events, seed))).toEqual(expected);
    expect(fold([...events, ...events])).toEqual(expected);
    expect(Object.keys(expected.units).filter(id => bibleRangeFromUnit(id))).toHaveLength(2);
    expect(expected.keyTerms[termId]?.adjustments.spoken?.blobHash).toBe('audio');
  });
  it('preserves recorded glossary entries when density changes', () => {
    const events = bibleFixture();
    const state = fold(events);
    const unitId = bibleUnitId('bible-lane', { book: 'gen', start: 1, end: 2 });
    const before = Object.keys(state.keyTerms);
    const low = fold([...events, event('density-low', 'v1.BibleSettingsSet', {
      laneId: 'bible-lane', sourceId: 'bsb', density: 0
    })]);
    expect(Object.keys(low.keyTerms)).toEqual(before);
    expect(bibleShortlist(low, 'bible-lane', unitId).length)
      .toBeLessThanOrEqual(bibleShortlist(state, 'bible-lane', unitId).length);
  });
  it('rejects malformed or out-of-range events before folding', () => {
    for (const start of [-1, 0, .5, NaN, Infinity]) {
      expect(validateBibleEvent('v1.BiblePassageSelected', {
        laneId: 'L', book: 'gen', start, end: 3
      })).toBe('Invalid Bible passage');
    }
    expect(validateBibleEvent('v1.BibleSettingsSet', {
      laneId: 'L', sourceId: 'bsb', density: 101
    })).toBe('Invalid Bible settings');
    expect(validateBibleEvent('v1.BibleSettingsSet', {
      laneId: 'L', sourceId: 'bsb', density: 10, audioFilesetId: '../../secret'
    })).toBe('Invalid Bible settings');
  });
});

describe('nesting-aware key terms', () => {
  it('penalizes words embedded in composite terms without dropping standalone content words', () => {
    const stats = { intelligence: [5, 10], artificial: [5, 10],
      'artificial intelligence': [5, 10], wisdom: [5, 10] } satisfies Record<string, [number, number]>;
    const terms = rankTerms(['Artificial intelligence. Artificial intelligence. Wisdom. Wisdom.'], stats, 100);
    expect(terms.find(t => t.term === 'artificial intelligence')!.score)
      .toBeGreaterThan(terms.find(t => t.term === 'intelligence')!.score);
    expect(terms.find(t => t.term === 'wisdom')!.score)
      .toBeGreaterThan(terms.find(t => t.term === 'intelligence')!.score);
    expect(termOccurrences('The Spirit of God. The earth.').has('spirit of god')).toBe(true);
    expect(termOccurrences('God. The earth.').has('god the earth')).toBe(false);
    expect(termOccurrences('earth according to their kinds').has('earth according')).toBe(false);
    expect(termOccurrences('creature that crawls').has('creature that crawls')).toBe(false);
  });
  it('makes density monotonic and includes all non-stopword singles at maximum', () => {
    const range = { book: 'gen', start: 1, end: 5 };
    const ranked = bibleRankedTerms(range);
    for (let density = 1; density <= 100; density++) {
      expect(termsAtDensity(ranked, density).slice(0, termsAtDensity(ranked, density - 1).length))
        .toEqual(termsAtDensity(ranked, density - 1));
    }
    const all = termsAtDensity(ranked, 100).map(t => t.term);
    for (const verse of bibleText(range)) for (const term of termOccurrences(verse).keys()) {
      if (!term.includes(' ')) expect(all).toContain(term);
    }
    expect(all).not.toContain('the');
  });
});

describe('passage audio boundaries', () => {
  it('uses the next verse start or explicit end, and refuses missing timings', () => {
    const timings = [{ verse: 1, start: 4 }, { verse: 2, start: 10 }, { verse: 3, start: 20 }];
    expect(passageAudioBounds(timings, 1, 2)).toEqual({ startSeconds: 4, endSeconds: 20 });
    expect(passageAudioBounds(timings, 3, 3)).toBeNull();
    expect(passageAudioBounds(timings, 1, 0)).toBeNull();
    expect(passageAudioBounds(timings, 0, 0)).toBeNull();
    expect(passageAudioBounds(timings, 1, 2, 15)).toBeNull();
    expect(passageAudioBounds(timings, 3, 3, 30)).toEqual({ startSeconds: 20, endSeconds: 30 });
    expect(passageAudioBounds([timings[0]!, timings[2]!], 1, 2)).toBeNull();
    expect(passageAudioBounds([{ verse: 1, start: 10 }, { verse: 2, start: 5 }], 1, 1)).toBeNull();
  });
  it('matches timings to the Hays track and enables that source by default', () => {
    const hays = SOURCE_BIBLES.find(b => b.id === 'berean-bsb-hays')!;
    expect(sourceBibleEnabled(emptyOrgState(), hays.id)).toBe(true);
    expect(sourceAudioUrl(hays, { book: 'gen', chapter: 1, label: 'Genesis 1' }))
      .toBe('https://openbible.com/audio/hays/BSB_01_Gen_001_H.mp3');
    expect(bsbPassageBounds(bibleUnitId('L', { book: 'gen', start: 1, end: 1 }), 1))
      .toMatchObject({ startSeconds: 4.28 });
  });
});
