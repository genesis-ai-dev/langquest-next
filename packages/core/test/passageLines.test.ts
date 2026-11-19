import { buildIndexes } from '../src/indexes';
import { derivePassage } from '../src/passage';
import { isOpenForReview, languageLines, openForReviewOf, passageLine, upNextOf } from '../src/passageLines';
import { partEntries, passageInMemory, putEntry, rowId, withoutParts } from '../src/passageParts';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState, type LanguageState } from '../src/state';
import { buildFixture, buildRecordFixture, buildStep11Fixture } from './fixtures';

/**
 * Why: Map, Progress, My Work and the Inbox read one line per passage
 * (decisions.md 143), and a phone that keeps a big language on disk works
 * a line out from that passage's part alone. A line must therefore come
 * out the same from the passage's part as from the whole language, and
 * survive being written to disk and read back.
 */
const whole = foldLanguage([...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture()], emptyLanguageState());

/** What a phone reads from disk to work out one passage's line: the shared language plus that passage's entries. */
function partOf(state: LanguageState, unitId: string): LanguageState {
  const out = withoutParts(state);
  for (const e of partEntries(state)) {
    if (passageInMemory(state, e.part.passage(e.key, e.value as never, e.inner)) === unitId) putEntry(out, e.part, rowId(e), e.value);
  }
  return out;
}

describe('a passage\'s line', () => {
  const lines = languageLines(whole);
  const units = Object.keys(whole.units);

  it('comes out the same from the passage\'s own part as from the whole language', () => {
    for (const unitId of units) expect(languageLines(partOf(whole, unitId)).get(unitId), unitId).toEqual(lines.get(unitId));
  });

  it('survives being written to disk and read back', () => {
    for (const unitId of units) expect(JSON.parse(JSON.stringify(lines.get(unitId)))).toEqual(lines.get(unitId));
  });

  it('reads like the passage it summarizes', () => {
    const idx = buildIndexes(whole);
    for (const unitId of idx.passages) {
      const s = derivePassage(whole, unitId, idx);
      const line = lines.get(unitId);
      expect(line).toMatchObject({ recorded: s.recorded, done: s.done, drafting: s.drafting, reviewed: s.reviews.length > 0 });
      expect(line.steps.map((st) => st.complete)).toEqual(s.steps.map((st) => st.complete));
      expect(passageLine(s).openRequests).toBe(s.openRequests);
    }
  });

  it('lists every passage with anything on its record, and none without', () => {
    const worked = new Set(lines.worked());
    for (const unitId of units) {
      const hasAny = [...partEntries(whole)].some((e) => passageInMemory(whole, e.part.passage(e.key, e.value as never, e.inner)) === unitId);
      expect(worked.has(unitId), unitId).toBe(hasAny);
    }
  });
});

describe('open for review', () => {
  const line = (over: Partial<{ recorded: boolean; reviewed: boolean; steps: unknown[] }>) => ({ recorded: true, reviewed: false, steps: [{}], ...over }) as Parameters<typeof isOpenForReview>[0];

  it('is a recording nobody has checked, in a language with a flow', () => {
    expect(isOpenForReview(line({}))).toBe(true);
    expect(isOpenForReview(line({ recorded: false }))).toBe(false);
    expect(isOpenForReview(line({ reviewed: true }))).toBe(false);
    expect(isOpenForReview(line({ steps: [] }))).toBe(false);
  });

  it('the list and upNextOf share one rule, so what the app suggests is what a phone fetches first', () => {
    const lines = languageLines(whole);
    const passages = buildIndexes(whole).passages;
    const open = openForReviewOf(lines, passages);
    expect(open).toEqual(passages.filter((id) => isOpenForReview(lines.get(id))));
    const next = upNextOf(lines, passages, { canRecord: false, canReview: true });
    expect(next).toEqual(open[0] ? { kind: 'review', unitId: open[0] } : null);
  });

  it('keeps the order it is given', () => {
    const lines = { get: (id: string) => ({ ...line({}), recorded: id !== 'skip' }) as ReturnType<typeof languageLines>['get'] extends (id: string) => infer L ? L : never };
    expect(openForReviewOf(lines, ['c', 'skip', 'a', 'b'])).toEqual(['c', 'a', 'b']);
    expect(upNextOf({ ...lines, worked: () => [] } as unknown as Parameters<typeof upNextOf>[0], ['skip', 'c', 'a'], { canRecord: false, canReview: true })).toEqual({ kind: 'review', unitId: 'c' });
  });
});
