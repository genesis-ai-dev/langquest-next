import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import type { AnyEvent } from '../src/events';
import { bookOfChapter, chapterNumber, SCOPE_VERSES, unitChapters, unitVerses } from '../src/coverage';

/** Coverage counts verses of the canon, so the parse of each unit kind decides what "90% of the Gospels" means. */

const withUnits = (units: [string, string][]) => fold(units.map(([unitId, label], i) => ({
  id: `u${i}`, type: 'v1.UnitAdded', orgId: 'o', projectId: 'p', actorId: 'a', deviceId: 'a', hlc: `00000000000000${i}:000000:a`,
  payload: { unitId, parentUnitId: null, kind: 'passage', label, order: String(i) }
}) as AnyEvent), emptyState());

describe('unitVerses', () => {
  const state = withUnits([
    ['fia@1/gen-p1', 'Genesis 1:1-2:3'], ['bible@1/joh-3', 'John 3'], ['bible@1/jhn-3', 'John 3'], ['book@1/gen', 'Genesis'],
    ['h1', 'Luke 15:11-32'], ['h2', '1 John 2'], ['h3', 'Mark 1-16'], ['h4', 'Introduction'], ['h5', 'Luke 99:1-3']
  ]);
  it('reads each kind of unit', () => {
    expect(unitVerses(state, 'fia@1/gen-p1')).toHaveLength(31 + 3);
    expect(unitVerses(state, 'bible@1/joh-3')).toHaveLength(36);
    expect(unitVerses(state, 'bible@1/jhn-3')).toEqual(unitVerses(state, 'bible@1/joh-3'));
    expect(unitVerses(state, 'h1')).toHaveLength(22);
    expect(unitVerses(state, 'h2')).toHaveLength(29);
    expect(unitVerses(state, 'h3')).toHaveLength(678);
  });
  it('a book overview, a non-scripture label or a chapter past the book covers nothing', () => {
    expect(unitVerses(state, 'book@1/gen')).toEqual([]);
    expect(unitVerses(state, 'h4')).toEqual([]);
    expect(unitVerses(state, 'h5')).toEqual([]);
  });
  it('lists the chapters a pericope touches', () => {
    expect(unitChapters(state, 'fia@1/gen-p1').map((c) => [bookOfChapter(c), chapterNumber(c)])).toEqual([[0, 1], [0, 2]]);
  });
});

describe('SCOPE_VERSES', () => {
  it('matches the Protestant canon', () => {
    expect(SCOPE_VERSES).toEqual({ gospels: 3779, nt: 7957, ot: 23145, bible: 31102 });
  });
});
