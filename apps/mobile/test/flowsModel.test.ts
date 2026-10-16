// The review-flow screens' rules (FLOW-1..4): where the editor starts, what it
// knows, when Save is enabled, how a pick adds a step, who usually does it,
// and what using a flow writes.
import { describe, expect, it } from 'vitest';
import { deriveFlow, type FlowDoc, type KindDef } from '@langquest-next/core';
import {
  addPickedKind, copyFlowSpecs, currentFlowLine, flowEditorBase, flowEditorSeed, flowEditorStatus, knownKinds, newKindDef, usuallyFor,
  withAddedKinds
} from '../src/flows/model';
import { draftFromDoc, type DraftStep } from '../src/config/model';
import { language } from './configFixtures';

const kind = (id: string, extra: Partial<KindDef> = {}): KindDef => ({ id, name: id.toUpperCase(), description: '', usualReviewer: '', ...extra });
const quick: FlowDoc = {
  format: 'flow@1', name: 'Quick Check', description: 'A peer, then sign-off.', deps: [],
  kinds: [kind('peer'), kind('final')],
  steps: [{ stepId: 's1', kindIds: ['peer'] }, { stepId: 's2', kindIds: ['final'], checkpoint: true }]
};

describe('where a new flow starts', () => {
  it('from the language\'s own steps when it was asked to save them, named as the language\'s flow reads', () => {
    const p = language();
    p.run(copyFlowSpecs(p.state(), { commandId: 'a', name: 'Ours', doc: quick, kinds: [] }));
    const seed = flowEditorSeed(p.state(), true, { languageId: 'L1' }, null);
    // Copying a flow into a language makes its steps the language's own (decision 91).
    expect(seed.name).toBe('Custom flow');
    expect(seed.steps.map((s) => [s.kindIds, s.checkpoint])).toEqual([[['peer'], false], [['final'], true]]);
    expect(seed.kinds).toEqual([]);
  });

  it('from another flow\'s document under the name given', () => {
    const seed = flowEditorSeed(language().state(), true, { name: 'Copy of quick' }, quick);
    expect(seed.name).toBe('Copy of quick');
    expect(seed.steps.map((s) => s.stepId)).toEqual(['s1', 's2']);
    expect(seed.kinds).toEqual(quick.kinds);
  });

  it('empty when there is nothing to start from, and not from a document that is not a flow', () => {
    expect(flowEditorSeed(null, true, {}, null)).toEqual({ name: '', description: '', steps: [], kinds: [] });
    const notFlow = { format: 'material@1', kind: 'tg', title: 'x', deps: [] } as never;
    expect(flowEditorSeed(language().state(), true, { name: 'N' }, notFlow)).toEqual({ name: 'N', description: '', steps: [], kinds: [] });
    // The language's steps are only taken when it has chosen a flow.
    expect(flowEditorSeed(language().state(), true, { languageId: 'L1' }, null).steps).toEqual([]);
  });

  it('an existing flow starts from its document, and has no base until that loads', () => {
    const seed = { name: 'seed', description: '', steps: [] };
    expect(flowEditorBase(true, seed, null)).toBe(seed);
    expect(flowEditorBase(false, seed, null)).toBeNull();
    const base = flowEditorBase(false, seed, quick)!;
    expect(base).toMatchObject({ name: 'Quick Check', description: 'A peer, then sign-off.' });
    expect(base.steps).toEqual(draftFromDoc(quick));
  });
});

describe('the kinds a flow editor knows', () => {
  it('lists the language\'s, then the flow\'s and the seed\'s, the first of an id winning', () => {
    const known = knownKinds([kind('peer', { name: 'Language peer' })], [kind('peer', { name: 'Doc peer' }), kind('elder')], [kind('elder', { name: 'Seed' }), kind('x')]);
    expect(known.map((k) => k.id)).toEqual(['peer', 'elder', 'x']);
    expect(known[0]!.name).toBe('Language peer');
    expect(known[1]!.name).toBe('ELDER');
  });

  it('adds those made in this session, unless the id is known already', () => {
    const known = [kind('peer')];
    expect(withAddedKinds(known, [kind('peer', { name: 'again' }), kind('new')]).map((k) => k.id)).toEqual(['peer', 'new']);
    expect(withAddedKinds(known, [])).toEqual(known);
  });

  it('makes a kind of a name, with a unique id and the app\'s words for the rest', () => {
    const k = newKindDef('  Elder Review ', [kind('elder_review')]);
    expect(k.id).toBe('elder_review_2');
    expect(k.name).toBe('Elder Review');
    expect(k.description).toBeTruthy();
    expect(k.usualReviewer).toBeTruthy();
  });
});

describe('when Save is enabled', () => {
  const base = { name: 'Quick', description: 'About', steps: draftFromDoc(quick) };
  const same = { readOnly: false, isNew: false, base, label: 'Quick', desc: 'About', steps: draftFromDoc(quick), added: [] as KindDef[] };

  it('not until something changed in a stored flow', () => {
    expect(flowEditorStatus(same)).toEqual({ dirty: false, canSave: false });
    expect(flowEditorStatus({ ...same, label: ' Quick ' }).dirty).toBe(false);
    expect(flowEditorStatus({ ...same, label: 'Quicker' })).toEqual({ dirty: true, canSave: true });
    expect(flowEditorStatus({ ...same, desc: 'More' }).dirty).toBe(true);
    expect(flowEditorStatus({ ...same, steps: [] }).dirty).toBe(true);
    expect(flowEditorStatus({ ...same, added: [kind('new')] }).dirty).toBe(true);
  });

  it('never without a name', () => {
    expect(flowEditorStatus({ ...same, label: '  ', steps: [] })).toEqual({ dirty: true, canSave: false });
  });

  it('a new flow can be saved as it starts, once it is named', () => {
    const start = { ...same, isNew: true };
    expect(flowEditorStatus(start)).toEqual({ dirty: false, canSave: true });
    expect(flowEditorStatus({ ...start, label: '' }).canSave).toBe(false);
    expect(flowEditorStatus({ ...start, base: null }).canSave).toBe(false);
  });

  it('never for a flow that is read only, or before it loaded', () => {
    expect(flowEditorStatus({ ...same, readOnly: true, label: 'Other' })).toEqual({ dirty: false, canSave: false });
    expect(flowEditorStatus({ ...same, base: null, label: 'Other' })).toEqual({ dirty: false, canSave: false });
  });
});

describe('adding a picked kind', () => {
  const steps: DraftStep[] = [{ key: 'a', kindIds: ['peer'], checkpoint: true }, { key: 'b', kindIds: ['final'], checkpoint: false }];

  it('makes a new step of its own at the end', () => {
    const next = addPickedKind(steps, 'new', 'elder', 'k3');
    expect(next).toHaveLength(3);
    expect(next[2]).toEqual({ key: 'k3', kindIds: ['elder'], checkpoint: false });
    expect(steps).toHaveLength(2);
  });

  it('joins the step it was picked for, in parallel with its kinds', () => {
    const next = addPickedKind(steps, 0, 'elder', 'k3');
    expect(next.map((s) => s.kindIds)).toEqual([['peer', 'elder'], ['final']]);
    expect(next[0]!.checkpoint).toBe(true);
  });

  it('changes nothing when nothing was being picked for', () => {
    expect(addPickedKind(steps, null, 'elder', 'k3')).toBe(steps);
  });
});

describe('who usually does a step', () => {
  const kinds = [kind('peer', { usualReviewer: 'A peer' }), kind('final')];

  it('says who usually does the kind when no review group takes it', () => {
    const s = language().state();
    const usually = usuallyFor(s, kinds, (id) => id);
    expect(usually(['peer'])).toBe('A peer');
  });

  it('names the one member of the group that takes the kind, or the group when it has several', () => {
    const p = language();
    p.add('v1.ReviewTeamDefined', { teamId: 'tm1', name: 'Elders' });
    p.add('v1.ReviewTeamKindSet', { teamId: 'tm1', kindId: 'peer' });
    p.add('v1.ReviewTeamMemberSet', { teamId: 'tm1', profileId: 'akol', member: true });
    expect(usuallyFor(p.state(), kinds, (id) => `Name of ${id}`)(['peer'])).toBe('A peer · Name of akol');
    p.add('v1.ReviewTeamMemberSet', { teamId: 'tm1', profileId: 'deng', member: true });
    expect(usuallyFor(p.state(), kinds, (id) => id)(['peer'])).toBe('Elders');
  });
});

describe('using a flow', () => {
  it('copies its checks into the language, the language\'s own from then on (decision 91)', () => {
    const p = language();
    p.run(copyFlowSpecs(p.state(), { commandId: 'a', name: 'Quick Check', doc: quick, kinds: [kind('other')] }));
    const s = p.state();
    expect(deriveFlow(s).steps.map((x) => [x.kindIds, x.checkpoint])).toEqual([[['peer'], false], [['final'], true]]);
    // Only the kinds its steps use are defined for the language.
    expect(Object.keys(s.reviewKinds).sort()).toEqual(['final', 'peer']);
  });

  it('defines a kind only once, however many flows use it', () => {
    const p = language();
    p.run(copyFlowSpecs(p.state(), { commandId: 'a', name: 'Quick Check', doc: quick, kinds: [] }));
    const again = copyFlowSpecs(p.state(), { commandId: 'b', name: 'Quick Check', doc: quick, kinds: [] });
    expect(again.filter((e) => e.type === 'v1.ReviewKindDefined')).toEqual([]);
  });

  it('describes the flow in use: its version, a newer one coming, where it is from', () => {
    const item = (current: string) => ({
      itemId: 'quick.x1', kind: 'flow', name: 'Quick', description: '', current, archived: false, shared: false, subscribable: false,
      source: 'own', versions: [{ n: 1, docHash: 'h1' }, { n: 2, docHash: 'h2' }]
    }) as never;
    const parts = (current: string, docHash: string | null) => currentFlowLine(item(current), { docHash }).split(' · ');
    // On the newest version: its number and where it is from.
    expect(parts('h2', 'h2')).toHaveLength(2);
    // On an older one, a line says it is moving; on a version unknown here, no number.
    expect(parts('h2', 'h1')).toHaveLength(3);
    expect(parts('h2', 'zzz')).toHaveLength(2);
    expect(parts('h2', 'h1')[0]).not.toBe(parts('h2', 'h2')[0]);
  });
});
