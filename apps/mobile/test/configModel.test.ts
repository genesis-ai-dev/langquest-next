// The configuration screens' reading (roles, flows, reference, key terms),
// held to the demo's rules against real folds of the event log.
import { describe, expect, it } from 'vitest';
import {
  commands, deriveFlow, deriveKinds, foldLanguage, foldOrg, formatQuestionField, HlcClock, isItemId, materialView, PRIVILEGES, questionsForKind,
  selectFlowSpecs, validateDoc, type AnyEvent, type EventPayloads, type EventSpec, type EventType, type FlowDoc, type MaterialDoc
} from '@langquest-next/core';
import { buildOrgFixture } from '../../../packages/core/test/fixtures';
import {
  draftChanged, draftFromDoc, draftFromLanguage, flowDocFrom, flowLabel, flowUndoFor, flowUse, holdersOf, isFiaTerm, libraryMaterialLine,
  libraryQuestions, matchesTerm, materialDocFrom, materialItemId, moveStep, newKindId, nextFieldId, parseRefLinks, PRIVILEGE_INFO,
  questionCount, questionDrafts, questionSetToReviews, referenceKindName, referenceView, roleRows, scopeName, termsInPassage, termWords,
  viewLevelFrom
} from '../src/screens/configModel';

/** One language's stream, with a book and a passage. */
function language() {
  const log: AnyEvent[] = [];
  let wall = 1_700_000_000_000;
  let seq = 0;
  const clock = new HlcClock('d', () => wall);
  const add = <T extends EventType>(type: T, payload: EventPayloads[T], id = `e${++seq}`) => {
    wall += 1000;
    log.push({ id, type, orgId: 'o', streamId: 'L1', actorId: 'admin', deviceId: 'd', hlc: clock.next(), payload, serverSeq: log.length + 1 } as AnyEvent);
  };
  add('v1.UnitAdded', { unitId: 'luke', parentUnitId: null, kind: 'book', label: 'Luke', order: 'a' });
  add('v1.UnitAdded', { unitId: 'luke15', parentUnitId: 'luke', kind: 'passage', label: 'Luke 15:11-32', order: 'a' });
  const run = (specs: EventSpec[]) => { for (const s of specs) add(s.type, s.payload as never, s.id); };
  return { add, run, state: () => foldLanguage(log) };
}

describe('roles', () => {
  it('names every privilege in the catalog, with what it lets someone do', () => {
    for (const p of PRIVILEGES) {
      expect(PRIVILEGE_INFO[p].label).toBeTruthy();
      expect(PRIVILEGE_INFO[p].desc).toBeTruthy();
    }
    expect(PRIVILEGE_INFO.override_checkpoints.label).toBe('Override Checkpoints');
    expect(PRIVILEGE_INFO.shape_templates.label).toBe('Shape Content Templates');
  });

  it('lists live roles, built-in first, and marks them view only from a language (ORG-3)', () => {
    const org = foldOrg(buildOrgFixture());
    const atOrg = roleRows(org, 'org');
    expect(atOrg.map((r) => r.roleId)).toEqual(['org_admin', 'translator']);
    expect(atOrg.every((r) => !r.inherited && r.builtIn)).toBe(true);
    expect(roleRows(org, 'language').every((r) => r.inherited)).toBe(true);
  });

  it('counts holders at any scope, and names where they hold it', () => {
    const org = foldOrg(buildOrgFixture());
    const translators = holdersOf(org, 'translator');
    expect(translators.map((h) => h.profileId)).toEqual(['t1']);
    expect(translators[0]!.scope).toEqual({ level: 'language', languageId: 'L1' });
    expect(holdersOf(org, 'org_admin').map((h) => h.profileId)).toEqual(['lead']);
    expect(scopeName(translators[0]!.scope, org)).toBe('Dinka');
    expect(scopeName({ level: 'org' }, org)).toBe('Wycliffe Associates');
  });

  it('reads the level the roles are seen from', () => {
    expect(viewLevelFrom({ level: 'org' }, { level: 'language', languageId: 'L1' })).toBe('org');
    expect(viewLevelFrom({ level: 'language' }, { level: 'org' })).toBe('language');
    expect(viewLevelFrom({ languageId: 'L1' }, { level: 'org' })).toBe('language');
    expect(viewLevelFrom({}, { level: 'language', languageId: 'L1' })).toBe('language');
    expect(viewLevelFrom({}, null)).toBe('org');
  });
});

describe('review flows', () => {
  const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64);
  const quick: FlowDoc = {
    format: 'flow@1', name: 'Quick Check', description: 'A peer, then sign-off.', deps: [],
    kinds: [{ id: 'peer', name: 'Peer Review', description: '', usualReviewer: '' }, { id: 'final', name: 'Final', description: '', usualReviewer: '' }],
    steps: [{ stepId: 's1', kindIds: ['peer'] }, { stepId: 's2', kindIds: ['final'], checkpoint: true }]
  };

  it('names the language\'s flow: none yet, a library one by its name, its own steps as a custom flow', () => {
    const p = language();
    expect(flowLabel(flowUse(p.state()))).toBe('No flow chosen yet');
    p.run(selectFlowSpecs(p.state(), { commandId: 'b', itemId: 'quick.x1', docHash: H1, doc: quick }));
    const use = flowUse(p.state());
    expect([flowLabel(use), use.itemId, use.docHash]).toEqual(['Quick Check', 'quick.x1', H1]);
    expect(use.steps.map((s) => s.kindIds)).toEqual([['peer'], ['final']]);
    p.run(commands(p.state()).saveFlowSteps({ commandId: 'c', steps: [{ kindIds: ['peer'], checkpoint: false }] }));
    expect([flowLabel(flowUse(p.state())), flowUse(p.state()).itemId]).toEqual(['Custom flow', null]);
  });

  it('Undo puts back the flow the language had, a library one or its own steps', () => {
    const p = language();
    expect(flowUndoFor(p.state())).toBeNull();
    p.run(selectFlowSpecs(p.state(), { commandId: 'a', itemId: 'quick.x1', docHash: H1, doc: quick }));
    const lib = flowUndoFor(p.state())!;
    expect(lib.flow).toMatchObject({ itemId: 'quick.x1', docHash: H1 });
    const other: FlowDoc = { ...quick, name: 'Other', steps: [{ stepId: 's1', kindIds: ['final'] }] };
    p.run(selectFlowSpecs(p.state(), { commandId: 'b', itemId: 'other.x2', docHash: H2, doc: other }));
    expect(deriveFlow(p.state()).name).toBe('Other');
    p.run(commands(p.state()).restoreFlow({ commandId: 'u', previous: lib }));
    expect(deriveFlow(p.state()).name).toBe('Quick Check');
    expect(deriveFlow(p.state()).steps.map((s) => s.kindIds[0])).toEqual(['peer', 'final']);

    // Its own steps come back as they were.
    p.run(commands(p.state()).saveFlowSteps({ commandId: 'c', steps: [{ kindIds: ['final'], checkpoint: true }] }));
    const own = flowUndoFor(p.state())!;
    p.run(selectFlowSpecs(p.state(), { commandId: 'd', itemId: 'quick.x1', docHash: H1, doc: quick }));
    p.run(commands(p.state()).restoreFlow({ commandId: 'e', previous: own }));
    expect(flowLabel(flowUse(p.state()))).toBe('Custom flow');
    expect(deriveFlow(p.state()).steps.map((s) => [s.kindIds, s.checkpoint])).toEqual([[['final'], true]]);
  });

  it('publishes a valid flow document: empty steps dropped, ids kept, kinds carried whole', () => {
    const draft = draftFromDoc(quick);
    const edited = [...moveStep(draft, 0, 1), { key: 'n', kindIds: ['elder_review', 'peer'], checkpoint: false }, { key: 'e', kindIds: [], checkpoint: true }];
    expect(draftChanged(draft, edited)).toBe(true);
    expect(draftChanged(draft, draft.map((d) => ({ ...d })))).toBe(false);
    const elder = { id: 'elder_review', name: 'Elder Review', description: 'Defined by your organization.', usualReviewer: 'Elders' };
    const doc = flowDocFrom({ name: ' Elders ', description: '', steps: edited, kinds: [...quick.kinds, elder] });
    expect(validateDoc(doc)).toBeNull();
    expect(doc.name).toBe('Elders');
    expect(doc.steps).toEqual([
      { stepId: 's2', kindIds: ['final'], checkpoint: true }, { stepId: 's1', kindIds: ['peer'] }, { stepId: 'step1', kindIds: ['elder_review', 'peer'] }
    ]);
    expect(doc.kinds.map((k) => k.id)).toEqual(['final', 'peer', 'elder_review']);
    // A language using it gets the new kind and the steps.
    const p = language();
    p.run(selectFlowSpecs(p.state(), { commandId: 'a', itemId: 'elders.x1', docHash: H1, doc }));
    const s = p.state();
    expect(deriveFlow(s).steps.map((x) => x.kindIds)).toEqual([['final'], ['peer'], ['elder_review', 'peer']]);
    expect(s.reviewKinds['elder_review']?.value.name).toBe('Elder Review');
  });

  it('starts a new flow from the language\'s own steps, with fresh ids', () => {
    const p = language();
    p.run(commands(p.state()).saveFlowSteps({ commandId: 'a', steps: [{ kindIds: ['peer'], checkpoint: false }, { kindIds: ['final'], checkpoint: true }] }));
    const draft = draftFromLanguage(p.state());
    expect(draft.map((d) => [d.stepId, d.kindIds])).toEqual([[undefined, ['peer']], [undefined, ['final']]]);
    expect(flowDocFrom({ name: 'Ours', description: '', steps: draft, kinds: deriveKinds(p.state()) }).steps.map((s) => s.stepId)).toEqual(['step1', 'step2']);
  });

  it('names a new kind from its words, uniquely', () => {
    expect(newKindId('Elder Review', ['peer'])).toBe('elder_review');
    expect(newKindId('Elder Review', ['elder_review'])).toBe('elder_review_2');
    expect(newKindId('  !! ', [])).toBe('kind');
  });
});

describe('reference material', () => {
  it('sorts the language\'s own material into study, question sets and general', () => {
    const p = language();
    p.add('v1.MaterialDefined', { materialId: 'tmf', kind: 'tmf', title: 'Framework', scope: {} });
    p.add('v1.MaterialDefined', { materialId: 'tg1', kind: 'tg', title: 'Dinka guidelines', scope: {} });
    p.add('v1.MaterialDefined', { materialId: 'fia', kind: 'fia_study', title: 'Lost son', scope: { unitId: 'luke15' } });
    p.add('v1.MaterialDefined', { materialId: 'qs', kind: 'questions', title: 'Peer questions', scope: { stepId: 'peer' } });
    p.add('v1.MaterialFieldSet', { materialId: 'qs', fieldId: 'q1', text: formatQuestionField({ text: 'Is it clear?', type: 'yesno', required: true }) });
    p.add('v1.MaterialFieldSet', { materialId: 'qs', fieldId: 'q2', text: '' });
    const view = referenceView(p.state());
    expect(view.general.map((m) => m.materialId)).toEqual(['tg1', 'tmf']);
    expect(view.study.map((m) => m.materialId)).toEqual(['fia']);
    expect(view.questionSets.map((m) => m.materialId)).toEqual(['qs']);
    expect(questionCount(view.questionSets[0]!)).toBe(1);
    expect(questionDrafts(view.questionSets[0]!)).toEqual([{ fieldId: 'q1', text: 'Is it clear?', type: 'yesno', required: true }]);
    expect(nextFieldId(['q1', 'q2'])).toBe('q3');
    expect([referenceKindName('tg'), referenceKindName('note'), referenceKindName('our_own')]).toEqual(['Translation Guidelines', 'Note for translators', 'Our own']);
  });

  it('makes material for every language into a valid library document', () => {
    const doc = materialDocFrom({ kind: 'tmf', title: 'Framework', scope: {}, fields: [{ fieldId: 'body', text: 'How we work.' }, { fieldId: 'names', text: '' }] }, (f) => f);
    expect(validateDoc(doc)).toBeNull();
    expect(doc).toMatchObject({ kind: 'tmf', title: 'Framework', body: 'How we work.' });
    expect(doc.fields).toBeUndefined();
  });
});

describe('reference material in the library', () => {
  it('publishes an in-app question set as a valid material document, under an id taken from the material', () => {
    const p = language();
    p.add('v1.MaterialDefined', { materialId: 'questions-9F3/x', kind: 'questions', title: 'Peer questions', scope: { stepId: 'peer' } });
    p.add('v1.MaterialFieldSet', { materialId: 'questions-9F3/x', fieldId: 'q1', text: formatQuestionField({ text: 'Is it clear?', type: 'yesno', required: true }) });
    p.add('v1.MaterialFieldSet', { materialId: 'questions-9F3/x', fieldId: 'q2', text: 'Anything missing?' });
    p.add('v1.MaterialFieldSet', { materialId: 'questions-9F3/x', fieldId: 'q3', text: '' });
    const m = materialView(p.state(), 'questions-9F3/x')!;
    const id = materialItemId(m.materialId);
    expect(id).toBe('m.questions-9f3-x');
    expect(isItemId(id)).toBe(true);
    const doc = materialDocFrom(m, (f) => f.toUpperCase());
    expect(validateDoc(doc)).toBeNull();
    expect(doc.reviewKindId).toBe('peer');
    expect(doc.questions).toEqual([{ id: 'q1', text: 'Is it clear?', type: 'yesno', required: true }, { id: 'q2', text: 'Anything missing?', type: 'text' }]);
    expect(libraryMaterialLine(doc, null, deriveKinds(p.state()))?.line).toBe('Question set · Peer Review · 2 questions');
  });

  it('links a material scoped to a template part by that part, and keeps a lone body as the body', () => {
    const p = language();
    p.add('v1.MaterialDefined', { materialId: 'tg1', kind: 'tg', title: 'Names', scope: { unitId: 'fia-eng.ab12/LUK.15.11-32' } });
    p.add('v1.MaterialFieldSet', { materialId: 'tg1', fieldId: 'body', text: 'Say the names slowly.' });
    const doc = materialDocFrom(materialView(p.state(), 'tg1')!, (f) => f);
    expect(validateDoc(doc)).toBeNull();
    expect(doc).toMatchObject({ body: 'Say the names slowly.', links: [{ template: 'fia-eng.ab12', node: 'LUK.15.11-32' }] });
    expect(doc.fields).toBeUndefined();
  });

  it('Use in reviews: reviewers of the kind see the questions; again updates the same set; Undo empties it', () => {
    const p = language();
    const doc: MaterialDoc = {
      format: 'material@1', kind: 'questions', title: 'Community questions', reviewKindId: 'community', deps: [],
      questions: [{ id: 'c1', text: 'Did they understand?', type: 'yesno', required: true }, { id: 'c2', text: 'What did they retell?', type: 'text' }]
    };
    const first = questionSetToReviews(p.state(), { commandId: 'a', itemId: 'cq.x1', doc });
    p.run(first.specs);
    expect(questionsForKind(p.state(), 'community').filter((q) => q.q.id.startsWith('qs.cq.x1#')).map((q) => [q.q.text, q.required]))
      .toEqual([['Did they understand?', true], ['What did they retell?', false]]);
    const second = questionSetToReviews(p.state(), { commandId: 'b', itemId: 'cq.x1', doc: { ...doc, questions: [doc.questions![0]!] } });
    expect(second.materialId).toBe(first.materialId);
    p.run(second.specs);
    expect(questionsForKind(p.state(), 'community').filter((q) => q.q.id.startsWith('qs.')).map((q) => q.q.text)).toEqual(['Did they understand?']);
    p.run(second.undo);
    expect(questionsForKind(p.state(), 'community').filter((q) => q.q.id.startsWith('qs.')).map((q) => q.q.text)).toEqual(['Did they understand?', 'What did they retell?']);
    p.run(first.undo);
    expect(questionsForKind(p.state(), 'community').filter((q) => q.q.id.startsWith('qs.'))).toEqual([]);
    expect(() => questionSetToReviews(p.state(), { commandId: 'c', itemId: 'x', doc: { ...doc, reviewKindId: undefined } })).toThrow(/kind of review/);
  });

  it('reads a question set\'s fields as questions when it has no question list', () => {
    const doc: MaterialDoc = { format: 'material@1', kind: 'questions', title: 'Q', deps: [], fields: [{ id: 'a', text: '[rating] How natural is it?' }] };
    expect(libraryQuestions(doc)).toEqual([{ id: 'a', text: 'How natural is it?', type: 'rating' }]);
  });

  it('reads verse links typed one per line, and says which could not be read', () => {
    expect(parseRefLinks('RUT 1:1-16\nrut 2:1; RUT1:1-16\n\nRuth one')).toEqual({ refs: ['RUT 1:1-16', 'RUT 2:1'], bad: ['Ruth one'] });
  });

  it('says what a study document is, with its passage count and versification', () => {
    const hash = 'c'.repeat(64);
    expect(libraryMaterialLine({ format: 'collection@1', title: 'FIA', description: '', versification: hash, entries: [
      { ref: 'LUK 15:11-32', title: 'Lost son', doc: hash }, { ref: 'JHN 3:1-21', title: 'Nicodemus', doc: hash }
    ], deps: [] }, 'English', [])).toEqual({ type: 'study', line: 'Study guides · 2 passages · English' });
    expect(libraryMaterialLine(null, null, [])).toBeNull();
  });
});

describe('key terms', () => {
  it('finds terms by their words, in the passage by scope or by the source text', () => {
    const p = language();
    p.add('v1.KeyTermDefined', { termId: 'kt1', term: 'Word (Logos)', gloss: 'The eternal Word', unitScope: [] });
    p.add('v1.KeyTermDefined', { termId: 'kt2', term: 'grace', gloss: 'Undeserved favour', unitScope: ['luke'] });
    p.add('v1.KeyTermDefined', { termId: 'fia:t63', term: 'Sabbath', gloss: 'Day of rest', unitScope: [] });
    const s = p.state();
    const terms = Object.keys(s.keyTerms).map((termId) => ({ termId, ...s.keyTerms[termId]!, renderings: [], adjustments: [] }));
    expect(termWords('Word (Logos)')).toEqual(['word', 'logos']);
    const here = termsInPassage(s, terms, 'luke15', 'In the beginning was the Word.');
    expect([...here].sort()).toEqual(['kt1', 'kt2']);
    expect([...termsInPassage(s, terms, 'luke15', 'Swordfish')].sort()).toEqual(['kt2']);
    expect(isFiaTerm({ termId: 'fia:t63' })).toBe(true);
    expect(isFiaTerm({ termId: 'kt1' })).toBe(false);
    expect(matchesTerm({ term: 'grace', gloss: 'Undeserved favour' }, 'FAVOUR')).toBe(true);
  });
});

describe('the role editor groups', () => {
  it('puts every permission in exactly one group (demo ADR-039)', async () => {
    const { PRIVILEGE_GROUPS } = await import('../src/screens/configModel');
    const { PRIVILEGES } = await import('@langquest-next/core');
    const all = PRIVILEGE_GROUPS.flatMap((g) => g.privileges);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...PRIVILEGES].sort());
  });
});
