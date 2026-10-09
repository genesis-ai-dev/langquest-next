import { encodeHlc } from '../src/hlc';
import { buildIndexes, languagePassages, unitPrefixOf } from '../src/indexes';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState } from '../src/state';
import { derivePassage, highlightsFor, languageProgress, unitsAskedOf, updatesFor, upNext, waitingOn } from '../src/passage';
import { languageReport } from '../src/reports';
import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { buildFixture, buildRecordFixture, buildStep11Fixture } from './fixtures';

const NOW = Date.parse('2026-09-30T12:00:00Z');
const INFO = { languageId: 'L1', name: 'Dinka', code: 'din', sourceCode: 'eng', country: null, target: null };

/**
 * A larger, messier language than the fixture: books from a template it
 * partly covers, a part its current version hides, units from another
 * template, units added by hand, drafts, archived and superseded takes,
 * reviews, requests to people and to a team. Deterministic so the two
 * derivation paths can be compared.
 */
function bigLanguage(passages = 24, translators = 5): AnyEvent[] {
  const out: AnyEvent[] = [];
  let seq = 0;
  const emit = <T extends EventType>(type: T, payload: EventPayloads[T], actorId = 'lead', deviceId = 'dA') => {
    seq += 1;
    out.push({
      id: `e${seq}`, type, orgId: 'o', streamId: 'L1', actorId, deviceId,
      hlc: encodeHlc(1_700_000_000_000 + seq, 0, deviceId), payload, serverSeq: seq
    } as AnyEvent);
  };
  emit('v1.TemplateSelected', { itemId: 'tpl', docHash: 'a'.repeat(64), unitPrefix: 'tpl', books: ['LUK', 'MRK'] });
  emit('v1.FlowSelected', { flowId: 'quick_check', name: 'Quick Check' });
  emit('v1.FlowStepSet', { stepId: 'quick_check/s1', order: 's00', kindIds: ['peer'], checkpoint: false });
  emit('v1.FlowStepSet', { stepId: 'quick_check/s2', order: 's01', kindIds: ['final'], checkpoint: true });
  emit('v1.ReviewTeamDefined', { teamId: 'team', name: 'Reviewers' });
  for (let r = 0; r < 3; r++) emit('v1.ReviewTeamMemberSet', { teamId: 'team', profileId: `r${r}`, member: true });
  const books = ['LUK', 'MRK', 'JHN'];
  for (const [b, book] of books.entries()) {
    emit('v1.UnitAdded', { unitId: `tpl/${book}`, parentUnitId: null, kind: 'book', label: book, order: `a${b}` });
  }
  // Another template's units, and a unit added by hand.
  emit('v1.UnitAdded', { unitId: 'old/LUK.1.1-4', parentUnitId: null, kind: 'passage', label: 'Old', order: 'a00' });
  emit('v1.UnitAdded', { unitId: 'intro', parentUnitId: null, kind: 'passage', label: 'Introduction', order: 'z' });
  const units: string[] = [];
  for (let u = 0; u < passages; u++) {
    const book = books[u % 3]!;
    const unitId = `tpl/${book}.${u + 1}.1-5`;
    units.push(unitId);
    emit('v1.UnitAdded', { unitId, parentUnitId: `tpl/${book}`, kind: 'passage', label: `${book} ${u + 1}:1-5`, order: `a${u % 3}p${String(u).padStart(4, '0')}` });
  }
  emit('v1.UnitHidden', { unitId: units[0]!, hidden: true });
  for (const [u, unitId] of units.entries()) {
    const who = `t${u % translators}`;
    if (u % 5 === 4) continue; // nothing recorded
    const t = `take-${u}`;
    emit('v1.RecordingAdded', { recordingId: `rec-${u}`, unitId, kind: 'target', cards: [{ hash: `h${u}`, durationMs: 1000 }] }, who, 'dB');
    emit('v1.TakeComposed', { takeId: t, unitId, cardHashes: [`h${u}`], parentTakeId: null }, who, 'dB');
    if (u % 7 === 3) continue; // a draft
    emit('v1.TakeSubmitted', { takeId: t }, who, 'dB');
    if (u % 4 === 0) emit('v1.RequestMade', { requestId: `ask-${u}`, unitId, what: 'review', kindId: 'peer', profileId: `r${u % 3}`, dueDate: '2026-09-01' }, who, 'dB');
    if (u % 6 === 0) emit('v1.RequestMade', { requestId: `team-${u}`, unitId, what: 'review', kindId: 'final', teamId: 'team' });
    if (u % 3 === 0) emit('v1.ReviewRecorded', { reviewId: `rv-${u}`, takeId: t, kindId: 'peer', outcome: 'looks_good', via: 'app' }, 'r0', 'dC');
    if (u % 8 === 1) emit('v1.ReviewRecorded', { reviewId: `rx-${u}`, takeId: t, kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Slower.' }, 'r1', 'dC');
    if (u % 8 === 0) {
      emit('v1.TakeComposed', { takeId: `${t}b`, unitId, cardHashes: [`h${u}`, `h${u}b`], parentTakeId: t }, who, 'dB');
      emit('v1.TakeSubmitted', { takeId: `${t}b` }, who, 'dB');
      emit('v1.TakeArchived', { takeId: `${t}b-draft` }, who, 'dB');
    }
    if (u % 9 === 0) emit('v1.ReviewRecorded', { reviewId: `fin-${u}`, takeId: t, kindId: 'final', outcome: 'looks_good', via: 'app', requestId: `team-${u}` }, 'r2', 'dD');
  }
  return out;
}

const ACTORS = ['lead', 't0', 't1', 't2', 't3', 't4', 'r0', 'r1', 'r2', 'nobody'];

describe('read indexes', () => {
  const cases = { fixture: [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture()], big: bigLanguage() };

  for (const [name, events] of Object.entries(cases)) {
    it(`${name}: every derivation gives the same answer with a prebuilt index as with none`, () => {
      // Why: the index is a pure view of the fold. If a derivation ever
      // read something the index does not carry, the two paths would
      // diverge and the language screen would disagree with My Work. Two
      // folds, because the record's own caches are per state object.
      const withIdx = foldLanguage(events, emptyLanguageState());
      const without = foldLanguage(events, emptyLanguageState());
      const idx = buildIndexes(withIdx);
      const opts = { canRecord: true, canReview: true };

      expect(languageProgress(withIdx, idx)).toEqual(languageProgress(without));
      expect(upNext(withIdx, opts, idx)).toEqual(upNext(without, opts));
      expect(languageReport(withIdx, INFO, NOW, idx)).toEqual(languageReport(without, INFO, NOW));
      for (const unitId of Object.keys(withIdx.units)) {
        expect(derivePassage(withIdx, unitId, idx)).toEqual(derivePassage(without, unitId));
      }
      for (const actorId of ACTORS) {
        expect(highlightsFor(withIdx, actorId, opts, idx)).toEqual(highlightsFor(without, actorId, opts));
        expect(waitingOn(withIdx, actorId, idx)).toEqual(waitingOn(without, actorId));
        expect(updatesFor(withIdx, actorId, idx)).toEqual(updatesFor(without, actorId));
        expect([...unitsAskedOf(withIdx, actorId, idx)]).toEqual([...unitsAskedOf(without, actorId)]);
      }
    });
  }

  it('lists the passages the language works on, in display order, and the containers apart', () => {
    // Why: a passage is a unit nothing contains, from the language's
    // template less what its version hides and the books it does not cover,
    // plus units added by hand. Units of a template it left stay in the log
    // but are not its work.
    const state = foldLanguage(bigLanguage(), emptyLanguageState());
    const idx = buildIndexes(state);
    expect(idx.containers).toEqual(['tpl/LUK', 'tpl/MRK', 'tpl/JHN']);
    expect(idx.passages).not.toContain('tpl/LUK.1.1-5'); // hidden
    expect(idx.passages.some((u) => u.startsWith('tpl/JHN'))).toBe(false); // book not covered
    expect(idx.passages).not.toContain('old/LUK.1.1-4'); // another template
    expect(idx.passages.at(-1)).toBe('intro'); // added by hand, last by order
    expect(idx.passages.slice(0, 3)).toEqual(['tpl/LUK.4.1-5', 'tpl/LUK.7.1-5', 'tpl/LUK.10.1-5']);
    expect(languagePassages(state)).toEqual(idx.passages);
    expect(unitPrefixOf('tpl/LUK.1.1-5')).toBe('tpl');
    expect(unitPrefixOf('intro')).toBeNull();
  });

  it('with no template, every unit nothing contains is a passage', () => {
    const state = foldLanguage(buildFixture(), emptyLanguageState());
    expect(buildIndexes(state)).toEqual({ passages: ['luke1'], containers: ['luke'], waiting: [] });
  });

  it('keeps My Work and progress linear in passages, not passages times people', () => {
    // Why: at Bible scale (1,200 pericopes, 40 translators) a derivation
    // that rescans the record per passage and per person freezes the phone.
    // This is a coarse guard, not a benchmark.
    const state = foldLanguage(bigLanguage(1200, 40), emptyLanguageState());
    const t0 = performance.now();
    const idx = buildIndexes(state);
    languageProgress(state, idx);
    for (let t = 0; t < 40; t++) highlightsFor(state, `t${t}`, { canRecord: true, canReview: true }, idx);
    for (const r of ['r0', 'r1', 'r2']) waitingOn(state, r, idx);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
