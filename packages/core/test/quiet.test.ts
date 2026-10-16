import fc from 'fast-check';
import type { AnyEvent } from '../src/events';
import { buildIndexes } from '../src/indexes';
import { unitTitle, updatesFor } from '../src/passage';
import { languageProgress } from '../src/passageLines';
import { eventsThatCannotChangeInbox, onlyQuietEvents } from '../src/quiet';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState, type LanguageState } from '../src/state';
import { buildFixture, buildRecordFixture, buildStep11Fixture } from './fixtures';

/** What the projection pass writes for a language that is not also a listing change. */
function projected(state: LanguageState, people: string[]) {
  const idx = buildIndexes(state);
  return {
    progress: languageProgress(state, idx),
    rows: people.map((p) => updatesFor(state, p, idx).map((u) => ({
      id: u.id, kind: u.kind, unitId: u.unitId, title: unitTitle(state, u.unitId)
    })))
  };
}

describe('eventsThatCannotChangeInbox (decisions.md 68)', () => {
  const language = [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture()];
  const people = [...new Set(language.flatMap((e) => [e.actorId, ...(JSON.stringify(e.payload).match(/"(?:profileId|by)":"([^"]+)"/g) ?? [])
    .map((m) => m.replace(/.*:"|"$/g, ''))]))];
  const quiet = language.filter((e) => eventsThatCannotChangeInbox.has(e.type));
  const loud = language.filter((e) => !eventsThatCannotChangeInbox.has(e.type));

  it('the fixtures hold every quiet type, and the set never holds a redaction', () => {
    const seen = new Set(language.map((e) => e.type));
    for (const type of eventsThatCannotChangeInbox) expect(seen.has(type), type).toBe(true);
    expect(eventsThatCannotChangeInbox.has('v1.Redacted')).toBe(false);
    expect(onlyQuietEvents([])).toBe(true);
    expect(onlyQuietEvents([{ type: 'v1.Redacted' }])).toBe(false);
  });

  it('a tail of only quiet events leaves every Inbox row, every title and the progress unchanged', () => {
    // Why: the projection pass moves a language's mark past such a tail
    // without downloading its snapshot. If one of these types could change a
    // row, a person's Inbox would stay stale until some later pass.
    const pick = (pool: AnyEvent[]) => fc.shuffledSubarray(pool, { minLength: 0, maxLength: pool.length });
    fc.assert(
      fc.property(pick(loud), pick(quiet), pick(quiet), (loudPart, before, tail) => {
        const base = foldLanguage([...loudPart, ...before], emptyLanguageState());
        const wanted = projected(base, people);
        // Fold a copy: the fold mutates its state.
        const after = foldLanguage([...loudPart, ...before, ...tail], emptyLanguageState());
        expect(projected(after, people)).toEqual(wanted);
      }),
      { numRuns: 300 }
    );
  });

  it('the people checked are not empty, and the loud events do change the rows', () => {
    // Guards the property above against passing because nothing is compared.
    expect(people.length).toBeGreaterThan(2);
    const all = projected(foldLanguage(language, emptyLanguageState()), people);
    expect(all.rows.flat().length).toBeGreaterThan(0);
    expect(projected(foldLanguage(quiet, emptyLanguageState()), people).rows.flat()).toEqual([]);
  });
});
