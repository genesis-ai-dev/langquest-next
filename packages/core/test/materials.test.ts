import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import { referencedBlobs } from '../src/blobs';
import {
  instantiateQuestionSet, keyTermLinksFor, keyTermsForUnit, keyTermsFor, materialsFor, materialView, questionSetsFor, questionsOf,
  questionSetMaterialId, takesLinkingTerm, templateFields
} from '../src/materials';
import { buildFixture, buildStep11Fixture, shuffle } from './fixtures';

describe('reference material: per-field registers, scopes, locks, question sets (audit 5.E)', () => {
  const events = [...buildFixture(), ...buildStep11Fixture()];
  const state = fold(events, emptyState());

  it('folds the same in any order and two people fill different blanks of one material', () => {
    // Why: a TG is one document per language that a translator and a
    // reviewer both add to, offline, in the same week.
    for (let seed = 1; seed <= 40; seed++) expect(fold(shuffle(events, seed), emptyState()).materials).toEqual(state.materials);
    const tg = materialView(state, 'tg:L1')!;
    expect(tg.fields.map((f) => f.fieldId)).toEqual(['general', 'luke1']);
    expect(tg.locked).toBe(false);
    expect(materialView(state, 'tmf')?.locked).toBe(true);
  });

  it('scopes: a unit sees lane and unscoped material; a step sees its own; blanks come from the template', () => {
    const atLuke1 = materialsFor(state, { laneId: 'L1', unitId: 'luke1' }).map((m) => m.materialId);
    expect(atLuke1).toEqual(['questions@1/community_check', 'q-luke1', 'tg:L1', 'tmf']); // by title
    expect(materialsFor(state, { laneId: 'L2' }).map((m) => m.materialId)).toEqual(['questions@1/community_check', 'tmf']);
    const set = materialView(state, 'questions@1/community_check')!;
    expect(templateFields(set.templateRef).length).toBe(4);
    expect(set.blanks).toBe(2); // two of four template questions filled
  });

  it('a step\'s default question set plus the translator\'s attached sets are what the reviewer answers', () => {
    const sets = questionSetsFor(state, 'take2', 'peer');
    expect(sets.map((s) => s.materialId).sort()).toEqual(['questions@1/community_check']);
    const withAttached = fold(
      [...events, { ...events[0]!, id: 'sub-x', type: 'v1.TakeSubmitted', actorId: 't1', hlc: '000000000000001:000000:dB', payload: { takeId: 'take2', questionSetIds: ['q-luke1'] } }],
      emptyState()
    );
    // An earlier-clocked submission wins (grow-only, first wins); its attached set joins the step's default.
    expect(questionSetsFor(withAttached, 'take2', 'peer').map((s) => s.materialId).sort()).toEqual(['q-luke1', 'questions@1/community_check']);
    const qs = questionsOf(sets);
    expect(qs.map((q) => q.id)).toEqual(['questions@1/community_check#meaning', 'questions@1/community_check#natural']);
  });

  it('instantiating a catalog question set is deterministic', () => {
    const a = instantiateQuestionSet('community_check', 'L1');
    expect(a[0]!.payload).toMatchObject({ materialId: questionSetMaterialId('community_check'), kind: 'questions' });
    expect(a.length).toBe(5);
    expect(instantiateQuestionSet('community_check', 'L1')).toEqual(a);
  });
});

describe('key terms: a living glossary', () => {
  const state = fold([...buildFixture(), ...buildStep11Fixture()], emptyState());

  it('shortlists by unit ancestry and shows renderings and recorded adjustments', () => {
    // Why: the translator sees the terms that matter for this book, not the
    // whole glossary; the reviewer sees why the term was rendered that way.
    expect(keyTermsFor(state, 'L1').map((t) => t.term)).toEqual(['flesh (sarx)', 'Word (Logos)']);
    expect(keyTermsForUnit(state, 'L1', 'luke1').map((t) => t.termId)).toEqual(['kt-logos']);
    const logos = keyTermsForUnit(state, 'L1', 'luke1')[0]!;
    expect(logos.renderings[0]?.rendering).toBe('Wët Nhialic');
    expect(logos.adjustments[0]).toMatchObject({ adjustmentId: 'adj1', duringTakeId: 'take2', actorId: 't1' });
  });

  it('links run both ways: take to terms, term to takes', () => {
    expect(keyTermLinksFor(state, 'take2').map((l) => [l.term.termId, l.adjustmentId])).toEqual([['kt-logos', 'adj1']]);
    expect(takesLinkingTerm(state, 'kt-logos')).toEqual([{ takeId: 'take2', note: 'Used the divine sense.', adjustmentId: 'adj1' }]);
    expect(takesLinkingTerm(state, 'kt-sarx')).toEqual([]);
  });

  it('audio on materials and adjustments is referenced audio', () => {
    const withAudio = fold(
      [...buildFixture(), ...buildStep11Fixture(),
        { ...buildFixture()[0]!, id: 'adj-audio', type: 'v1.KeyTermAdjusted', actorId: 't1', hlc: '999999999999990:000000:dB', payload: { termId: 'kt-logos', adjustmentId: 'adj2', note: 'spoken', blobHash: 'cAdj', duringTakeId: 'take2' } },
        { ...buildFixture()[0]!, id: 'fld-audio', type: 'v1.MaterialFieldSet', actorId: 'lead', hlc: '999999999999991:000000:dA', payload: { materialId: 'tg:L1', fieldId: 'intro', blobHash: 'cTg' } }],
      emptyState()
    );
    const refs = referencedBlobs(withAudio);
    expect(refs.get('cAdj')?.unitId).toBe('luke1');
    expect(refs.has('cTg')).toBe(true);
  });
});
