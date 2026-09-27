import { encodeHlc } from '../src/hlc';
import type { AnyEvent } from '../src/events';
import {
  CATALOG_VERSION, contentTemplates, effectiveUnitKinds, flowSelectionEvents, FLOW_TEMPLATES, instantiateFlow, instantiateTemplate,
  templateOfUnit, templateUnitId
} from '../src/catalog';
import { buildIndexes, laneLeafUnits } from '../src/indexes';
import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import { derivePieces } from '../src/status';
import { deriveProgress, deriveTasks } from '../src/tasks';
import { deriveFlow, deriveTakeStatus, deriveWorkflow, eligibleReviewers } from '../src/workflow';
import { deriveBlockers } from '../src/blockers';
import { buildFixture, buildStep11Fixture, shuffle } from './fixtures';

describe('catalog: global reference data and deterministic instantiation', () => {
  it('ships the v2 templates at Bible scale', () => {
    const fia = contentTemplates().find((t) => t.id === 'fia')!;
    const bible = contentTemplates().find((t) => t.id === 'bible')!;
    expect(fia.items.filter((i) => i.kind === 'pericope').length).toBe(1352);
    expect(bible.items.filter((i) => i.kind === 'book').length).toBe(66);
    expect(bible.items.filter((i) => i.kind === 'chapter').length).toBe(1189);
    expect(FLOW_TEMPLATES.map((f) => f.id)).toContain('standard_bible');
  });

  it('two admins selecting the same template offline emit identical unit ids, so the fold holds each once', () => {
    // Why: this is what makes template instantiation commutative without a
    // server step or an ordered insert (audit 5.D).
    const a = instantiateTemplate('fia');
    const b = instantiateTemplate('fia', CATALOG_VERSION);
    expect(a).toEqual(b);
    expect(a[0]!.unitId).toBe(templateUnitId('fia', CATALOG_VERSION, a[0]!.unitId.split('/')[1]!));
    const parents = new Set(a.map((u) => u.unitId));
    for (const u of a) if (u.parentUnitId) expect(parents.has(u.parentUnitId), u.unitId).toBe(true);
    const mk = (dev: string) => a.slice(0, 40).map((payload, i) => ({
      id: `${dev}-${i}`, type: 'v1.UnitAdded', orgId: 'o', projectId: 'p', actorId: 'lead', deviceId: dev,
      hlc: encodeHlc(1_700_000_000_000 + i, 0, dev), payload
    }) as AnyEvent);
    const state = fold([...mk('dA'), ...mk('dB')], emptyState());
    expect(Object.keys(state.units).length).toBe(40);
    expect(templateOfUnit(a[0]!.unitId)).toEqual({ templateId: 'fia', catalogVersion: CATALOG_VERSION });
    expect(templateOfUnit('luke1')).toBeNull();
  });

  it('a selected template contributes its unit kinds without a config edit', () => {
    const state = fold([...buildFixture(), ...buildStep11Fixture()], emptyState());
    const kinds = effectiveUnitKinds(state, state.config!.value.unitKinds).map((k) => k.id);
    expect(kinds).toContain('passage');
    expect(kinds).toContain('book');
    expect(instantiateFlow('quick_check', 'L1').map((s) => s.stepId)).toEqual(['quick_check@1/peer_review', 'quick_check@1/approval']);
  });

  it('a lane sees its template\'s units plus hand-added ones; another lane sees everything', () => {
    // Why: content templates apply per language (UX spec A42) while units
    // are project-wide. Filtering by template prefix is the whole rule.
    const events = [...buildFixture(), ...buildStep11Fixture()];
    const extra = instantiateTemplate('book').slice(0, 3).map((payload, i) => ({
      id: `bk-${i}`, type: 'v1.UnitAdded', orgId: 'org1', projectId: 'p1', actorId: 'lead', deviceId: 'dA',
      hlc: encodeHlc(1_760_000_000_000 + i, 0, 'dA'), payload, serverSeq: 900 + i
    }) as AnyEvent);
    const lane2 = { id: 'lane2', type: 'v1.LaneAdded', orgId: 'org1', projectId: 'p1', actorId: 'lead', deviceId: 'dA', hlc: encodeHlc(1_760_000_001_000, 0, 'dA'), payload: { laneId: 'L2', languoidId: 'abc' }, serverSeq: 950 } as AnyEvent;
    const state = fold([...events, ...extra, lane2], emptyState());
    const idx = buildIndexes(state);
    expect(laneLeafUnits(state, idx, 'L2').sort()).toEqual(['book@1/exo', 'book@1/gen', 'book@1/lev', 'luke1']);
    expect(laneLeafUnits(state, idx, 'L1').sort()).toEqual(['book@1/exo', 'book@1/gen', 'book@1/lev', 'luke1']);
    expect(derivePieces(state, 'L2', idx).map((p) => p.unitId)).toContain('book@1/gen');
    expect(deriveProgress(state, 'L2', idx).passages).toBe(4);
    expect(deriveTasks(state, 't1', idx).filter((t) => t.laneId === 'L2').length).toBe(4);
  });
});

describe('per-step workflow registers and review teams (audit 5.F)', () => {
  const events = [...buildFixture(), ...buildStep11Fixture()];
  const state = fold(events, emptyState());

  it('folds the same in any order, with a removed step gone and the lane flow winning over config', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const permuted = fold(shuffle(events, seed), emptyState());
      expect(deriveWorkflow(permuted, 'L1')).toEqual(deriveWorkflow(state, 'L1'));
    }
    expect(deriveWorkflow(state, 'L1').map((s) => s.id)).toEqual(['peer', 'consultant']);
    expect(deriveWorkflow(state, 'L1')[0]?.teamId).toBe('team1');
    // No lane steps for L9 and no project-wide steps: the config workflow still applies.
    expect(deriveWorkflow(state, 'L9').map((s) => s.id)).toEqual(['peer']);
    expect(state.laneFlows['L1']?.value.flowId).toBe('quick_check');
  });

  it('assignment beats team beats role for eligibility', () => {
    const peer = deriveWorkflow(state, 'L1')[0]!;
    // luke1/L1 has r1 and r2 assigned: assignments win.
    expect(eligibleReviewers(state, 'luke1', 'L1', peer)).toEqual(['r1', 'r2']);
    // A unit with no assignments: the team (r1, r2 in; r3 set out).
    expect(eligibleReviewers(state, 'other', 'L1', peer)).toEqual(['r1', 'r2']);
    const noTeam = { ...peer, teamId: 'missing' };
    expect(eligibleReviewers(state, 'other', 'L1', noTeam)).toEqual(['r1', 'r2']); // falls back to role holders
    expect(deriveTakeStatus(state, 'take2').steps.map((s) => s.stepId)).toEqual(['peer', 'consultant']);
  });

  it('the respond loop and spoken comments are on the fold and count as referenced audio', () => {
    expect(state.responses['take2']?.note).toMatch(/card 2/);
    expect(state.responses['take2']?.respondsToTakeId).toBe('take1');
    expect(state.reviewComments['take2']?.['peer']?.['r2']?.blobHash).toBe('c1');
    expect(deriveBlockers(state)).toEqual([]);
  });
});

describe('catalog: re-selecting a template or flow is idempotent', () => {
  const env = (i: number, dev: string, type: AnyEvent['type'], payload: unknown): AnyEvent =>
    ({ id: `${dev}-${type}-${i}`, type, orgId: 'org1', projectId: 'p1', actorId: 'lead', deviceId: dev, hlc: encodeHlc(1_780_000_000_000 + i, 0, dev), payload }) as AnyEvent;

  it('selecting the same content template twice, from two devices, leaves one of each unit and one lane selection', () => {
    // Why: templates_home lets any admin tap the same template again, and two
    // admins can do it offline. The fold must hold each unit once, or Status
    // would double-count passages and derive twice the tasks.
    const select = (dev: string, base: number) => [
      env(base, dev, 'v1.LaneTemplateSelected', { laneId: 'L1', templateId: 'book', catalogVersion: CATALOG_VERSION }),
      ...instantiateTemplate('book').map((payload, i) => env(base + 1 + i, dev, 'v1.UnitAdded', payload))
    ];
    const lane = env(0, 'dA', 'v1.LaneAdded', { laneId: 'L1', languoidId: 'din' });
    const once = fold([lane, ...select('dA', 1)], emptyState());
    const twice = fold([lane, ...select('dA', 1), ...select('dB', 5000), ...select('dA', 9000)], emptyState());

    expect(Object.keys(twice.units).sort()).toEqual(Object.keys(once.units).sort());
    expect(Object.keys(twice.units).length).toBe(instantiateTemplate('book').length);
    expect(derivePieces(twice, 'L1').length).toBe(derivePieces(once, 'L1').length);
    expect(twice.laneTemplates['L1']?.value).toEqual({ templateId: 'book', catalogVersion: CATALOG_VERSION });
  });

  it('selecting the same flow twice leaves one step per stage, in stage order', () => {
    // Why: instantiateFlow emits WorkflowStepSet per stage; a repeat must
    // overwrite the same step ids, never append a second review gate.
    const select = (dev: string, base: number) => [
      env(base, dev, 'v1.LaneFlowSelected', { laneId: 'L1', flowId: 'quick_check', catalogVersion: CATALOG_VERSION }),
      ...instantiateFlow('quick_check', 'L1').map((payload, i) => env(base + 1 + i, dev, 'v1.WorkflowStepSet', payload))
    ];
    const lane = env(0, 'dA', 'v1.LaneAdded', { laneId: 'L1', languoidId: 'din' });
    const once = fold([lane, ...select('dA', 1)], emptyState());
    const twice = fold([lane, ...select('dA', 1), ...select('dB', 100)], emptyState());
    expect(deriveWorkflow(twice, 'L1')).toEqual(deriveWorkflow(once, 'L1'));
    expect(deriveWorkflow(twice, 'L1').map((s) => s.id)).toEqual(['quick_check@1/peer_review', 'quick_check@1/approval']);
  });
});

describe('selecting a flow again brings its steps back (fresh step ids)', () => {
  const at = (n: number) => encodeHlc(1_700_000_000_000 + n * 1000, 0, 'dA');
  /** Apply the flows_home selection against the state so far, as the app does. */
  function apply(events: AnyEvent[], laneId: string, flowId: string, instance: string): AnyEvent[] {
    const state = fold(events, emptyState());
    const next = flowSelectionEvents(state, laneId, flowId, instance).map((e, i) => ({
      id: `${instance}-${i}`, type: e.type, orgId: 'o', projectId: 'p', actorId: 'lead', deviceId: 'dA',
      hlc: at(events.length + i + 1), payload: e.payload
    }) as AnyEvent);
    return [...events, ...next];
  }
  const base = (): AnyEvent[] => [
    { id: 'lane1', type: 'v1.LaneAdded', orgId: 'o', projectId: 'p', actorId: 'lead', deviceId: 'dA', hlc: at(0), payload: { laneId: 'L1', languoidId: 'din' } },
    { id: 'lane2', type: 'v1.LaneAdded', orgId: 'o', projectId: 'p', actorId: 'lead', deviceId: 'dA', hlc: at(0), payload: { laneId: 'L2', languoidId: 'nus' } }
  ] as AnyEvent[];
  const kindsOn = (events: AnyEvent[], laneId: string) => deriveFlow(fold(events, emptyState()), laneId).map((s) => s.kindIds.join('+'));

  it('switching A, B, then back to A (or Undo) shows A\'s steps, not an empty flow', () => {
    // Why (bug found in 2b-A): WorkflowStepRemoved is add-wins, so reusing
    // template step ids left A's steps removed forever after switching back.
    let log = apply(base(), 'L1', 'consultant_checkpoint', 'i1');
    const a = kindsOn(log, 'L1');
    expect(a).toEqual(['kind@1/consultant', 'kind@1/final']);
    log = apply(log, 'L1', 'one_check', 'i2');
    expect(kindsOn(log, 'L1')).toEqual(['kind@1/peer']);
    log = apply(log, 'L1', 'consultant_checkpoint', 'i3');
    expect(kindsOn(log, 'L1')).toEqual(a);
    expect(fold(log, emptyState()).laneFlows['L1']?.value.flowId).toBe('consultant_checkpoint');
  });

  it('two languages on one flow keep their own steps', () => {
    // Why: template step ids carry no lane, so both lanes wrote one register
    // and the later lane took the steps.
    let log = apply(base(), 'L1', 'one_check', 'i1');
    log = apply(log, 'L2', 'one_check', 'i2');
    expect(kindsOn(log, 'L1')).toEqual(['kind@1/peer']);
    expect(kindsOn(log, 'L2')).toEqual(['kind@1/peer']);
  });
});
