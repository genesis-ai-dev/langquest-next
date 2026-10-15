// What Divide a Book derives from the open language (src/templates/bookStructureModel.ts).
import { describe, expect, it } from 'vitest';
import {
  buildIndexes, emptyLanguageState, foldLanguage, HlcClock, selectTemplateSpecs,
  type AnyEvent, type EventSpec, type LanguageState, type TemplateDoc, type VersificationDoc
} from '@langquest-next/core';
import { bibleBook } from '../src/templates/contentTemplates';
import { bookStructureData, chapterNumbers, chapterTileLabel, partsStartingIn } from '../src/templates/bookStructureModel';

const luke = bibleBook('luk')!;
const HASH = 'a'.repeat(64);
const V11N_HASH = 'b'.repeat(64);

const clock = new HlcClock('dev1', () => 1_700_000_000_000);
const v11n: VersificationDoc = { format: 'versification@1', code: 'eng', name: 'English', maxVerses: { LUK: luke.verses }, mappedVerses: {} };

const doc: TemplateDoc = {
  format: 'template@1', name: 'Story units', description: '', structure: 'bible',
  levels: [{ name: 'Book' }, { name: 'Story', display: 'name' }],
  bible: {
    versification: V11N_HASH, books: [{ book: 'LUK', name: 'Luka' }], divide: 'passages',
    passages: [{ ref: 'LUK 15:1-10', name: 'The lost sheep' }, { ref: 'LUK 15:11-32', name: 'The lost son' }]
  },
  deps: [V11N_HASH]
};

function stateWith(d: TemplateDoc): LanguageState {
  const start = emptyLanguageState();
  const specs: EventSpec[] = selectTemplateSpecs(start, { commandId: 'c1', itemId: 'stories.abc', docHash: HASH, doc: d, versification: v11n });
  const events = specs.map((s) => ({ id: s.id, type: s.type, orgId: 'o1', streamId: 'L', actorId: 'admin', deviceId: 'dev1', hlc: clock.next(), payload: s.payload }) as AnyEvent);
  return foldLanguage(events, start);
}

describe('the book as the open language divides it', () => {
  it('lists its parts, labelled in the language, with none recorded yet', () => {
    const state = stateWith(doc);
    const data = bookStructureData(state, buildIndexes(state), luke, null, 'L');
    expect(data.language).toBe('L');
    expect(data.label).toBe('Luka');
    expect(data.segments.map((s) => [s.from.c, s.from.v, s.to.v])).toEqual([[15, 1, 10], [15, 11, 32]]);
    expect(data.recorded.size).toBe(0);
  });

  it('has the words of a verse only where the app holds a reading, and names the translation', () => {
    const state = stateWith(doc);
    const data = bookStructureData(state, buildIndexes(state), luke, null, 'L');
    // Whatever the app holds is keyed by chapter and verse; elsewhere there is nothing, so the screen shows the number.
    expect(data.textOf(1, 1)).toBeUndefined();
    for (const [c, code] of data.translation) {
      expect(c).toBe(15);
      expect(code).toBeTruthy();
      expect(data.textOf(c, 1)).toEqual(expect.any(String));
    }
  });

  it("marks FIA's breaks from the book, not from the language", () => {
    const state = stateWith(doc);
    const data = bookStructureData(state, buildIndexes(state), luke, null, 'L');
    expect(data.fia.size).toBeGreaterThan(10);
  });

  it('has no parts for a language that has not divided the book', () => {
    const state = emptyLanguageState();
    const data = bookStructureData(state, buildIndexes(state), luke, null, 'L');
    expect(data.segments).toEqual([]);
    expect(data.label).toBe('Luke');
  });
});

describe('the chapter jump grid', () => {
  it('lists every chapter of the book', () => {
    const nums = chapterNumbers(luke);
    expect(nums[0]).toBe(1);
    expect(nums).toHaveLength(24);
    expect(nums.at(-1)).toBe(24);
  });

  it('counts the parts that start in a chapter', () => {
    const state = stateWith(doc);
    const { segments } = bookStructureData(state, buildIndexes(state), luke, null, 'L');
    expect(partsStartingIn(segments, 15)).toBe(2);
    expect(partsStartingIn(segments, 14)).toBe(0);
  });

  it('says how many parts a chapter holds only when there are several', () => {
    expect(chapterTileLabel(3, 0, 'Story', 'stories')).toBe('Chapter 3');
    expect(chapterTileLabel(3, 1, 'Story', 'stories')).toBe('Chapter 3');
    expect(chapterTileLabel(15, 2, 'Story', 'stories')).toContain('2 stories');
  });
});
