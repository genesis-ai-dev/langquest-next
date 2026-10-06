import { foldLanguage } from '../src/reducer';
import { emptyLanguageState } from '../src/state';
import { questionsForKind } from '../src/passage';
import { referencedBlobs } from '../src/blobs';
import {
  instantiateQuestionSet, keyTermLinksFor, keyTermsForUnit, keyTermsFor, materialsFor, materialView, questionsOf,
  questionSetMaterialId, takesLinkingTerm, templateFields
} from '../src/materials';
import { buildFixture, buildStep11Fixture, shuffle } from './fixtures';

describe('reference material: per-field registers, scopes, locks, question sets (audit 5.E)', () => {
  const events = [...buildFixture(), ...buildStep11Fixture()];
  const state = foldLanguage(events, emptyLanguageState());

  it('folds the same in any order and two people fill different blanks of one material', () => {
    // Why: a TG is one document per language that a translator and a
    // reviewer both add to, offline, in the same week.
    for (let seed = 1; seed <= 40; seed++) expect(foldLanguage(shuffle(events, seed), emptyLanguageState()).materials).toEqual(state.materials);
    const tg = materialView(state, 'tg')!;
    expect(tg.fields.map((f) => f.fieldId)).toEqual(['general', 'luke1']);
    expect(tg.locked).toBe(false);
    expect(materialView(state, 'tmf')?.locked).toBe(true);
  });

  it('scopes: a unit sees its own, its ancestors\' and unscoped material; a step sees its own; blanks come from the template', () => {
    const atLuke1 = materialsFor(state, { unitId: 'luke1' }).map((m) => m.materialId);
    expect(atLuke1).toEqual(['q-luke1', 'tg', 'tmf']); // by title
    expect(materialsFor(state, { unitId: 'elsewhere' }).map((m) => m.materialId)).toEqual(['tg', 'tmf']);
    expect(materialsFor(state, { stepId: 'community' }).map((m) => m.materialId)).toEqual(['questions/community_check', 'tg', 'tmf']);
    const set = materialView(state, 'questions/community_check')!;
    expect(templateFields(set.templateRef).length).toBe(4);
    expect(set.blanks).toBe(2); // two of four template questions filled
  });

  it('a kind\'s question set is the shipped questions, then the language\'s filled ones, then the asker\'s', () => {
    // Why: the reviewer answers one combined list; each question says where
    // it came from so nobody mistakes the organization's for the asker's.
    const sets = materialsFor(state, { stepId: 'community' }).filter((m) => m.kind === 'questions');
    expect(questionsOf(sets).map((q) => q.id)).toEqual(['questions/community_check#meaning', 'questions/community_check#natural']);
    const qs = questionsForKind(state, 'community');
    expect(qs.filter((q) => q.source === 'org')).toHaveLength(4);
    expect(qs.filter((q) => q.source === 'language').map((q) => q.q.id)).toEqual(['questions/community_check#meaning', 'questions/community_check#natural']);
    // A set scoped to a passage is not a kind's set.
    expect(qs.some((q) => q.q.id.startsWith('q-luke1'))).toBe(false);
    expect(questionsForKind(state, 'peer')).toEqual([]);
  });

  it('instantiating a catalog question set is deterministic', () => {
    const a = instantiateQuestionSet('community_check');
    expect(a[0]!.payload).toMatchObject({ materialId: questionSetMaterialId('community_check'), kind: 'questions' });
    expect(a.length).toBe(5);
    expect(instantiateQuestionSet('community_check')).toEqual(a);
  });
});

describe('key terms: a living glossary', () => {
  const state = foldLanguage([...buildFixture(), ...buildStep11Fixture()], emptyLanguageState());

  it('shortlists by unit ancestry and shows renderings and recorded adjustments', () => {
    // Why: the translator sees the terms that matter for this book, not the
    // whole glossary; the reviewer sees why the term was rendered that way.
    expect(keyTermsFor(state).map((t) => t.term)).toEqual(['flesh (sarx)', 'Word (Logos)']);
    expect(keyTermsForUnit(state, 'luke1').map((t) => t.termId)).toEqual(['kt-logos']);
    const logos = keyTermsForUnit(state, 'luke1')[0]!;
    expect(logos.renderings[0]?.rendering).toBe('Wët Nhialic');
    expect(logos.adjustments[0]).toMatchObject({ adjustmentId: 'adj1', duringTakeId: 'take2', actorId: 't1' });
  });

  it('links run both ways: take to terms, term to takes', () => {
    expect(keyTermLinksFor(state, 'take2').map((l) => [l.term.termId, l.adjustmentId])).toEqual([['kt-logos', 'adj1']]);
    expect(takesLinkingTerm(state, 'kt-logos')).toEqual([{ takeId: 'take2', note: 'Used the divine sense.', adjustmentId: 'adj1' }]);
    expect(takesLinkingTerm(state, 'kt-sarx')).toEqual([]);
  });

  it('audio on materials and adjustments is referenced audio', () => {
    const withAudio = foldLanguage(
      [...buildFixture(), ...buildStep11Fixture(),
        { ...buildFixture()[0]!, id: 'adj-audio', type: 'v1.KeyTermAdjusted', actorId: 't1', hlc: '999999999999990:000000:dB', payload: { termId: 'kt-logos', adjustmentId: 'adj2', note: 'spoken', blobHash: 'cAdj', duringTakeId: 'take2' } },
        { ...buildFixture()[0]!, id: 'fld-audio', type: 'v1.MaterialFieldSet', actorId: 'lead', hlc: '999999999999991:000000:dA', payload: { materialId: 'tg', fieldId: 'intro', blobHash: 'cTg' } }],
      emptyLanguageState()
    );
    const refs = referencedBlobs(withAudio);
    expect(refs.get('cAdj')?.unitId).toBe('luke1');
    expect(refs.has('cTg')).toBe(true);
  });
});
