// The configuration screens' reading (roles, flows, reference, key terms),
// held to the demo's rules against real folds of the event log.
import { describe, expect, it } from 'vitest';
import {
  commands, deriveFlow, fold, foldOrg, formatQuestionField, HlcClock, PRIVILEGES,
  type AnyEvent, type EventPayloads, type EventSpec, type EventType
} from '@langquest-next/core';
import { buildOrgFixture } from '../../../packages/core/test/fixtures';
import {
  catalogFlowOf, draftChanged, draftFromLane, flowLabel, holdersOf, isFiaTerm, laneFlows, matchesTerm, moveStep, newKindId,
  nextFieldId, otherLanguageRenderings, PRIVILEGE_INFO, questionCount, questionDrafts, referenceView, roleRows, stepsToSave,
  termsInPassage, termWords, viewLevelFrom
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
    expect(viewLevelFrom({ level: 'project' }, { level: 'org' })).toBe('project');
    expect(viewLevelFrom({ laneId: 'L1' }, { level: 'org' })).toBe('lane');
    expect(viewLevelFrom({}, { level: 'project', projectId: 'p' })).toBe('project');
    expect(viewLevelFrom({}, null)).toBe('org');
  });
});

describe('review flows', () => {
  it('knows a catalog flow by its steps, kinds in a step in any order', () => {
    expect(catalogFlowOf([{ kindIds: ['bt', 'peer'], checkpoint: false }, { kindIds: ['community'], checkpoint: false },
      { kindIds: ['consultant'], checkpoint: true }, { kindIds: ['final'], checkpoint: false }], null)).toBe('standard_bible');
    expect(catalogFlowOf([{ kindIds: ['peer'], checkpoint: true }, { kindIds: ['final'], checkpoint: false }], 'quick_check')).toBeNull();
    expect(catalogFlowOf([], null)).toBeNull();
    expect(catalogFlowOf([], 'collect_only')).toBe('collect_only');
  });

  it('shows which language uses which flow, and Undo puts the old steps back', () => {
    const p = project();
    const s0 = p.state();
    expect(laneFlows(s0).map((l) => flowLabel(l))).toEqual(['No flow chosen yet', 'No flow chosen yet']);
    p.run(commands(s0).useFlow({ commandId: 'a', laneId: 'L1', flowId: 'quick_check' }));
    const s1 = p.state();
    expect(laneFlows(s1).find((l) => l.laneId === 'L1')!.flowId).toBe('quick_check');
    const before = draftFromLane(s1, 'L1');
    p.run(commands(s1).useFlow({ commandId: 'b', laneId: 'L1', flowId: 'oral_review' }));
    const s2 = p.state();
    expect(laneFlows(s2).find((l) => l.laneId === 'L1')!.flowId).toBe('oral_review');
    // Undo: the old steps, with fresh ids where the old ones were removed.
    p.run(commands(s2).saveFlowSteps({ commandId: 'u', laneId: 'L1', steps: stepsToSave(s2, 'L1', before) }));
    const s3 = p.state();
    expect(laneFlows(s3).find((l) => l.laneId === 'L1')!.flowId).toBe('quick_check');
    expect(laneFlows(s3).find((l) => l.laneId === 'L2')!.flowId).toBeNull();
  });

  it('edits keep the ids the language owns, drop empty steps and never rewrite a project-wide step', () => {
    const p = project();
    p.add('v2.WorkflowStepSet', { stepId: 'proj/s1', order: 's00', kindIds: ['peer'], checkpoint: false });
    const s0 = p.state();
    const shared = draftFromLane(s0, 'L1');
    expect(shared).toHaveLength(1);
    expect(shared[0]!.stepId).toBeUndefined();
    p.run(commands(s0).useFlow({ commandId: 'a', laneId: 'L1', flowId: 'quick_check' }));
    const s1 = p.state();
    const draft = draftFromLane(s1, 'L1');
    expect(draft.every((d) => d.stepId)).toBe(true);
    const edited = [...moveStep(draft, 0, 1), { key: 'new', kindIds: [], checkpoint: false }];
    expect(draftChanged(draft, edited)).toBe(true);
    expect(draftChanged(draft, draft.map((d) => ({ ...d })))).toBe(false);
    const toSave = stepsToSave(s1, 'L1', edited);
    expect(toSave.map((s) => s.kindIds)).toEqual([['final'], ['peer']]);
    p.run(commands(s1).saveFlowSteps({ commandId: 'e', laneId: 'L1', steps: toSave }));
    const s2 = p.state();
    expect(deriveFlow(s2, 'L1').steps.map((s) => s.kindIds[0])).toEqual(['final', 'peer']);
    expect(deriveFlow(s2, 'L2').steps.map((s) => s.kindIds[0])).toEqual(['peer']);
    expect(s2.flowSteps['proj/s1']!.value.laneId).toBeUndefined();
  });

  it('names a new kind from its words, uniquely', () => {
    expect(newKindId('Elder Review', ['peer'])).toBe('elder_review');
    expect(newKindId('Elder Review', ['elder_review'])).toBe('elder_review_2');
    expect(newKindId('  !! ', [])).toBe('kind');
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
