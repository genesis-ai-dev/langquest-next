// The configuration screens' reading (roles, flows, reference, key terms),
// held to the demo's rules against real folds of the event log.
import { describe, expect, it } from 'vitest';
import {
  commands, deriveFlow, deriveKinds, fold, foldOrg, formatQuestionField, HlcClock, isItemId, materialView, PRIVILEGES, questionsForKind, selectFlowSpecs,
  validateDoc, type AnyEvent, type EventPayloads, type EventSpec, type EventType, type FlowDoc, type MaterialDoc
} from '@langquest-next/core';
import { buildOrgFixture } from '../../../packages/core/test/fixtures';
import {
  draftChanged, draftFromDoc, draftFromLane, flowDocFrom, flowLabel, flowUndoFor, holdersOf, isFiaTerm, laneFlows, libraryMaterialLine,
  libraryQuestions, listNames, matchesTerm, materialDocFrom, materialItemId, moveStep, newKindId, nextFieldId, otherLanguageRenderings,
  parseRefLinks, PRIVILEGE_INFO, questionCount, questionDrafts, questionSetToReviews, referenceView, roleRows, termsInPassage, termWords,
  viewLevelFrom
} from '../src/screens/configModel';

function project() {
  const log: AnyEvent[] = [];
  let wall = 1_700_000_000_000;
  let seq = 0;
  const clock = new HlcClock('d', () => wall);
  const add = <T extends EventType>(type: T, payload: EventPayloads[T], id = `e${++seq}`) => {
    wall += 1000;
    log.push({ id, type, orgId: 'o', projectId: 'p', actorId: 'admin', deviceId: 'd', hlc: clock.next(), payload, serverSeq: log.length + 1 } as AnyEvent);
  };
  add('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
  add('v1.ProjectConfigChanged', { config: { unitKinds: [{ id: 'book', label: 'Book', childKinds: ['passage'] }, { id: 'passage', label: 'Passage', childKinds: [] }], workflow: [] } });
  add('v1.MemberAdded', { profileId: 'admin', role: 'owner' });
  add('v1.MemberAdded', { profileId: 't1', role: 'translator' });
  add('v1.LaneAdded', { laneId: 'L1', languoidId: 'din' });
  add('v1.LaneNamed', { laneId: 'L1', name: 'Dinka' });
  add('v1.LaneAdded', { laneId: 'L2', languoidId: 'nus' });
  add('v1.LaneNamed', { laneId: 'L2', name: 'Nuer' });
  add('v1.UnitAdded', { unitId: 'luke', parentUnitId: null, kind: 'book', label: 'Luke', order: 'a' });
  add('v1.UnitAdded', { unitId: 'luke15', parentUnitId: 'luke', kind: 'passage', label: 'Luke 15:11-32', order: 'a' });
  const run = (specs: EventSpec[]) => { for (const s of specs) add(s.type, s.payload as never, s.id); };
  return { add, run, state: () => fold(log) };
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

  it('lists live roles, built-in first, and marks them view only below the organization (ORG-3)', () => {
    const org = foldOrg(buildOrgFixture());
    const atOrg = roleRows(org, null, 'org');
    expect(atOrg.map((r) => r.roleId)).toEqual(['org_admin', 'translator']);
    expect(atOrg.every((r) => !r.inherited && r.builtIn)).toBe(true);
    expect(roleRows(org, null, 'lane').every((r) => r.inherited)).toBe(true);
  });

  it('counts holders at any scope and project members with the matching fixed role, once each', () => {
    const org = foldOrg(buildOrgFixture());
    const p = project().state();
    const translators = holdersOf(org, p, 'translator');
    expect(translators.map((h) => h.profileId)).toEqual(['t1']);
    expect(translators[0]!.scope).toMatchObject({ level: 'lane', laneId: 'L1' });
    expect(holdersOf(org, p, 'org_admin').map((h) => h.profileId)).toEqual(['lead', 'admin']);
  });

  it('reads the level the roles are seen from', () => {
    // No project level (decision 34): a project reads as the organization.
    expect(viewLevelFrom({ level: 'project' }, { level: 'org' })).toBe('org');
    expect(viewLevelFrom({ laneId: 'L1' }, { level: 'org' })).toBe('lane');
    expect(viewLevelFrom({}, { level: 'project', projectId: 'p' })).toBe('org');
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

  it('names each language\'s flow: a library one by its name, a legacy one by the catalog\'s', () => {
    const p = project();
    const s0 = p.state();
    expect(laneFlows(s0).map((l) => flowLabel(l))).toEqual(['No flow chosen yet', 'No flow chosen yet']);
    p.run(commands(s0).useFlow({ commandId: 'a', laneId: 'L2', flowId: 'oral_review' }));
    p.run(selectFlowSpecs(p.state(), { commandId: 'b', laneId: 'L1', itemId: 'quick.x1', docHash: H1, doc: quick }));
    const uses = laneFlows(p.state());
    expect(uses.map((u) => [u.name, flowLabel(u), u.itemId])).toEqual([['Dinka', 'Quick Check', 'quick.x1'], ['Nuer', 'Oral Review Path', null]]);
    expect(uses[0]!.steps.map((s) => s.kindIds)).toEqual([['peer'], ['final']]);
  });

  it('Undo re-applies a library flow at its version, and restores a legacy one', () => {
    const p = project();
    p.run(selectFlowSpecs(p.state(), { commandId: 'a', laneId: 'L1', itemId: 'quick.x1', docHash: H1, doc: quick }));
    const lib = flowUndoFor(p.state(), 'L1');
    expect(lib).toEqual({ kind: 'library', itemId: 'quick.x1', docHash: H1 });
    const other: FlowDoc = { ...quick, name: 'Other', steps: [{ stepId: 's1', kindIds: ['final'] }] };
    p.run(selectFlowSpecs(p.state(), { commandId: 'b', laneId: 'L1', itemId: 'other.x2', docHash: H2, doc: other }));
    expect(deriveFlow(p.state(), 'L1').name).toBe('Other');
    p.run(selectFlowSpecs(p.state(), { commandId: 'u', laneId: 'L1', itemId: 'quick.x1', docHash: H1, doc: quick }));
    expect(deriveFlow(p.state(), 'L1').steps.map((s) => s.kindIds[0])).toEqual(['peer', 'final']);

    // A language on the old catalog: its steps were never removed, so restoreFlow brings it back.
    p.run(commands(p.state()).useFlow({ commandId: 'c', laneId: 'L2', flowId: 'oral_review' }));
    const legacy = flowUndoFor(p.state(), 'L2');
    expect(legacy?.kind).toBe('legacy');
    p.run(selectFlowSpecs(p.state(), { commandId: 'd', laneId: 'L2', itemId: 'quick.x1', docHash: H1, doc: quick }));
    if (legacy?.kind !== 'legacy') throw new Error('legacy');
    p.run(commands(p.state()).restoreFlow({ commandId: 'e', laneId: 'L2', previous: legacy.previous }));
    expect(flowLabel(laneFlows(p.state()).find((l) => l.laneId === 'L2')!)).toBe('Oral Review Path');
    expect(flowUndoFor(project().state(), 'L1')).toBeNull();
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
    const p = project();
    p.run(selectFlowSpecs(p.state(), { commandId: 'a', laneId: 'L1', itemId: 'elders.x1', docHash: H1, doc }));
    const s = p.state();
    expect(deriveFlow(s, 'L1').steps.map((x) => x.kindIds)).toEqual([['final'], ['peer'], ['elder_review', 'peer']]);
    expect(s.reviewKinds['elder_review']?.value.name).toBe('Elder Review');
  });

  it('starts a new flow from a legacy language\'s steps, with fresh ids', () => {
    const p = project();
    p.run(commands(p.state()).useFlow({ commandId: 'a', laneId: 'L1', flowId: 'quick_check' }));
    const draft = draftFromLane(p.state(), 'L1');
    expect(draft.map((d) => [d.stepId, d.kindIds])).toEqual([[undefined, ['peer']], [undefined, ['final']]]);
    expect(flowDocFrom({ name: 'Ours', description: '', steps: draft, kinds: deriveKinds(p.state()) }).steps.map((s) => s.stepId)).toEqual(['step1', 'step2']);
  });

  it('names a new kind from its words, uniquely, and lists names', () => {
    expect(newKindId('Elder Review', ['peer'])).toBe('elder_review');
    expect(newKindId('Elder Review', ['elder_review'])).toBe('elder_review_2');
    expect(newKindId('  !! ', [])).toBe('kind');
    expect(listNames(['Dinka'])).toBe('Dinka');
    expect(listNames(['Dinka', 'Nuer', 'Shilluk'])).toBe('Dinka, Nuer and Shilluk');
  });
});

describe('reference material', () => {
  it('adds levels up: a language sees its own and the project\'s, the project sees each language\'s', () => {
    const p = project();
    p.add('v1.MaterialDefined', { materialId: 'tmf', kind: 'tmf', title: 'Framework', scope: {} });
    p.add('v1.MaterialDefined', { materialId: 'tg1', kind: 'tg', title: 'Dinka guidelines', scope: { laneId: 'L1' } });
    p.add('v1.MaterialDefined', { materialId: 'tg2', kind: 'tg', title: 'Nuer guidelines', scope: { laneId: 'L2' } });
    p.add('v1.MaterialDefined', { materialId: 'qs', kind: 'questions', title: 'Peer questions', scope: { laneId: 'L1', stepId: 'peer' } });
    p.add('v1.MaterialFieldSet', { materialId: 'qs', fieldId: 'q1', text: formatQuestionField({ text: 'Is it clear?', type: 'yesno', required: true }) });
    p.add('v1.MaterialFieldSet', { materialId: 'qs', fieldId: 'q2', text: '' });
    const s = p.state();
    const lang = referenceView(s, 'L1');
    expect(lang.atLevel.map((m) => m.materialId)).toEqual(['tg1']);
    expect(lang.higher.map((m) => m.materialId)).toEqual(['tmf']);
    expect(lang.questionSets.map((m) => m.materialId)).toEqual(['qs']);
    expect(referenceView(s, 'L2').questionSets).toEqual([]);
    const proj = referenceView(s, null);
    expect(proj.atLevel.map((m) => m.materialId)).toEqual(['tmf']);
    expect(proj.byLanguage.map((g) => g.laneId).sort()).toEqual(['L1', 'L2']);
    expect(questionCount(lang.questionSets[0]!)).toBe(1);
    expect(questionDrafts(lang.questionSets[0]!)).toEqual([{ fieldId: 'q1', text: 'Is it clear?', type: 'yesno', required: true }]);
    expect(nextFieldId(['q1', 'q2'])).toBe('q3');
  });
});

describe('reference material in the library', () => {
  it('publishes an in-app question set as a valid material document, under an id taken from the material', () => {
    const p = project();
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
    const p = project();
    p.add('v1.MaterialDefined', { materialId: 'tg1', kind: 'tg', title: 'Names', scope: { unitId: 'fia-eng.ab12/LUK.15.11-32' } });
    p.add('v1.MaterialFieldSet', { materialId: 'tg1', fieldId: 'body', text: 'Say the names slowly.' });
    const doc = materialDocFrom(materialView(p.state(), 'tg1')!, (f) => f);
    expect(validateDoc(doc)).toBeNull();
    expect(doc).toMatchObject({ body: 'Say the names slowly.', links: [{ template: 'fia-eng.ab12', node: 'LUK.15.11-32' }] });
    expect(doc.fields).toBeUndefined();
  });

  it('Use in reviews: reviewers of the kind see the questions; again updates the same set; Undo empties it', () => {
    const p = project();
    const doc: MaterialDoc = {
      format: 'material@1', kind: 'questions', title: 'Community questions', reviewKindId: 'community', deps: [],
      questions: [{ id: 'c1', text: 'Did they understand?', type: 'yesno', required: true }, { id: 'c2', text: 'What did they retell?', type: 'text' }]
    };
    const first = questionSetToReviews(p.state(), { commandId: 'a', itemId: 'cq.x1', doc });
    p.run(first.specs);
    expect(questionsForKind(p.state(), 'community', 'L1').filter((q) => q.q.id.startsWith('qs.cq.x1#')).map((q) => [q.q.text, q.required]))
      .toEqual([['Did they understand?', true], ['What did they retell?', false]]);
    const second = questionSetToReviews(p.state(), { commandId: 'b', itemId: 'cq.x1', doc: { ...doc, questions: [doc.questions![0]!] } });
    expect(second.materialId).toBe(first.materialId);
    p.run(second.specs);
    expect(questionsForKind(p.state(), 'community', 'L1').filter((q) => q.q.id.startsWith('qs.')).map((q) => q.q.text)).toEqual(['Did they understand?']);
    p.run(second.undo);
    expect(questionsForKind(p.state(), 'community', 'L1').filter((q) => q.q.id.startsWith('qs.')).map((q) => q.q.text)).toEqual(['Did they understand?', 'What did they retell?']);
    p.run(first.undo);
    expect(questionsForKind(p.state(), 'community', 'L1').filter((q) => q.q.id.startsWith('qs.'))).toEqual([]);
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
    const p = project();
    p.add('v1.KeyTermDefined', { termId: 'kt1', laneId: 'L1', term: 'Word (Logos)', gloss: 'The eternal Word', unitScope: [] });
    p.add('v1.KeyTermDefined', { termId: 'kt2', laneId: 'L1', term: 'grace', gloss: 'Undeserved favour', unitScope: ['luke'] });
    p.add('v1.KeyTermDefined', { termId: 'fia:t63', laneId: 'L1', term: 'Sabbath', gloss: 'Day of rest', unitScope: [] });
    p.add('v1.KeyTermDefined', { termId: 'kt3', laneId: 'L2', term: 'Grace', gloss: '', unitScope: [] });
    p.add('v1.KeyTermRenderingAdded', { termId: 'kt3', renderingId: 'r', rendering: 'mɛth', context: 'always' });
    const s = p.state();
    const terms = Object.keys(s.keyTerms).filter((id) => s.keyTerms[id]!.laneId === 'L1').map((termId) => ({ termId, ...s.keyTerms[termId]!, renderings: [], adjustments: [] }));
    expect(termWords('Word (Logos)')).toEqual(['word', 'logos']);
    const here = termsInPassage(s, terms, 'luke15', 'In the beginning was the Word.');
    expect([...here].sort()).toEqual(['kt1', 'kt2']);
    expect([...termsInPassage(s, terms, 'luke15', 'Swordfish')].sort()).toEqual(['kt2']);
    expect(isFiaTerm({ termId: 'fia:t63' })).toBe(true);
    expect(isFiaTerm({ termId: 'kt1' })).toBe(false);
    expect(matchesTerm({ term: 'grace', gloss: 'Undeserved favour' }, 'FAVOUR')).toBe(true);
    const grace = { termId: 'kt2', laneId: 'L1', term: 'grace', gloss: '', unitScope: [], renderings: [], adjustments: [] };
    expect(otherLanguageRenderings(s, grace)).toEqual([{ laneId: 'L2', lane: 'Nuer', rendering: 'mɛth', context: 'always' }]);
  });
});
