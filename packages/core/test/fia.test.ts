import { describe, expect, it } from 'vitest';
import {
  defineFiaProgress, defineFiaStudy, FIA_STAGES, fiaPericopes,
  fiaProgressField, fiaProgressId, fiaStageContent, fiaStudiesFor, fiaStudyId, fiaStudyStatus
} from '../src/fia';
import { materialView, templateFields } from '../src/materials';
import { emptyState, type Material } from '../src/state';
import { fold } from '../src/reducer';
import { buildFixture } from './fixtures';
import { EVENT_PRIVILEGE, SEED_ROLES } from '../src/org';

function material(scope: Material['scope'], fields: Record<string, string> = {}): Material {
  return { kind: 'fia_study', title: 'Study', scope, createdBy: 'manager',
    hlc: '1', locked: { value: false, hlc: '1', eventId: 'lock' },
    fields: Object.fromEntries(Object.entries(fields).map(([key, value]) =>
      [key, { value: { text: value }, hlc: '1', eventId: key }])) };
}

describe('FIA study templates and guided stages', () => {
  it('uses real catalog passages and deterministic language-scoped IDs', () => {
    const study = defineFiaStudy('L1', 'gen-p1');
    expect(study).toEqual(defineFiaStudy('L1', 'gen-p1'));
    expect(study.payload.scope).toEqual({ laneId: 'L1', unitId: 'fia@1/gen-p1' });
    expect(study.payload.materialId).not.toBe(
      defineFiaStudy('L2', 'gen-p1').payload.materialId);
    expect(fiaPericopes('Genesis 1:1')).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: 'gen-p1', label: 'Genesis 1:1-2:3' })
    ]));
    expect(() => defineFiaStudy('L1', 'missing')).toThrow('Unknown FIA passage');
    expect(() => defineFiaStudy('')).toThrow('Choose a language');
  });

  it('provides six empty fields without fabricating licensed lessons', () => {
    const study = defineFiaStudy('L1');
    expect(templateFields(study.payload.templateRef)).toEqual(
      FIA_STAGES.map(stage => stage.id));
    expect(templateFields('fia_study/legacy')).toEqual([
      'summary', 'key_ideas', 'scenes', 'discussion'
    ]);
    expect(study.payload).not.toHaveProperty('fields');
    expect(fiaStageContent([], 'hear')).toEqual([]);
  });

  it('respects both language and unit scope, with passage content first', () => {
    const state = emptyState();
    state.units.book = { parentUnitId: null, label: 'Book', kind: 'book', order: '1' };
    state.units.passage = { parentUnitId: 'book', label: 'Passage', kind: 'pericope', order: '1' };
    state.materials = {
      lane: material({ laneId: 'L1' }),
      passage: material({ laneId: 'L1', unitId: 'passage' }),
      book: material({ laneId: 'L1', unitId: 'book' }),
      otherLanguage: material({ laneId: 'L2', unitId: 'passage' }),
      otherPassage: material({ laneId: 'L1', unitId: 'other' }),
      reviewOnly: material({ laneId: 'L1', stepId: 'review' })
    };
    const found = fiaStudiesFor(state, 'L1', 'passage').map(m => m.materialId);
    expect(found).toEqual(['passage', 'book', 'lane']);
    expect(found).not.toContain('otherLanguage');
    expect(found).not.toContain('reviewOnly');
  });

  it('prefers explicit stage content and supports legacy fields', () => {
    const state = emptyState();
    state.materials.study = material({}, { hear: 'New audio notes',
      summary: 'Legacy summary', key_ideas: 'Setting', discussion: 'Questions' });
    const study = materialView(state, 'study')!;
    expect(fiaStageContent([study], 'hear')[0]?.text).toBe('New audio notes');
    expect(fiaStageContent([study], 'stage')[0]?.text).toBe('Setting');
    expect(fiaStageContent([study], 'gaps')[0]?.text).toBe('Questions');
    expect(fiaStageContent([study], 'embody')).toEqual([]);
  });

  it('persists participant progress independently of locked guidance', () => {
    const base = buildFixture();
    const definition = defineFiaProgress('L1');
    const study = defineFiaStudy('L1');
    const fieldId = fiaProgressField('t1', 'luke1', 'hear');
    const events = [
      { ...base[0]!, id: 'fia-study', hlc: '000000000000800:000000:dB', ...study },
      { ...base[0]!, id: 'fia-progress', hlc: '000000000000801:000000:dB', ...definition },
      { ...base[0]!, id: 'fia-lock', hlc: '000000000000802:000000:dB',
        type: 'v1.MaterialLocked' as const,
        payload: { materialId: study.payload.materialId, locked: true } },
      { ...base[0]!, id: 'fia-hear', actorId: 't1', hlc: '000000000000803:000000:dB',
        type: 'v1.MaterialFieldSet' as const,
        payload: { materialId: fiaProgressId('L1'), fieldId, text: 'complete' } }
    ];
    const state = fold([...base, ...events], emptyState());
    expect(state.materials[study.payload.materialId]?.locked.value).toBe(true);
    expect(state.materials[fiaProgressId('L1')]?.locked.value).not.toBe(true);
    expect(state.materials[fiaProgressId('L1')]?.fields[fieldId]?.value.text)
      .toBe('complete');
    expect(fold([...base, ...events.slice().reverse()], emptyState()).materials)
      .toEqual(state.materials);
    expect(EVENT_PRIVILEGE['v1.MaterialFieldSet']).toBe('fill_reference');
    expect(SEED_ROLES.find(r => r.roleId === 'translator')?.privileges)
      .toContain('fill_reference');
    expect(fieldId).not.toBe(fiaProgressField('t2', 'luke1', 'hear'));
    expect(fieldId).not.toBe(fiaProgressField('t1', 'luke2', 'hear'));
    expect(fiaProgressField('a:b', 'c', 'hear'))
      .not.toBe(fiaProgressField('a', 'b:c', 'hear'));
  });
});

describe('FIA study status (team progress from the existing progress fields)', () => {
  // Why: study is team work and a reviewer reads it as evidence. A step is
  // done when anyone finished it, "Done by" is the first finisher, an undo
  // (the field set back to '') stops counting, and progress for another
  // passage never leaks in. All of it comes from existing registers.
  function stateWith(fields: Record<string, string>, hlcs: Record<string, string> = {}) {
    const state = emptyState();
    state.units['fia@1/gen-p2'] = { parentUnitId: null, label: 'Genesis 2:4-25', kind: 'pericope', order: '1' };
    state.materials[fiaStudyId('L1')] = material({ laneId: 'L1' }, { hear: 'Listen twice.' });
    state.materials[fiaProgressId('L1')] = { ...material({ laneId: 'L1' }), kind: 'fia_progress',
      fields: Object.fromEntries(Object.entries(fields).map(([k, v]) =>
        [k, { value: { text: v }, hlc: hlcs[k] ?? '5', eventId: k }])) };
    return state;
  }

  it('counts a step once anyone finished it and credits the first finisher', () => {
    const unit = 'fia@1/gen-p2';
    const state = stateWith({
      [fiaProgressField('akol', unit, 'hear')]: 'complete',
      [fiaProgressField('mary', unit, 'hear')]: 'complete',
      [fiaProgressField('mary', unit, 'stage')]: 'complete',
      [fiaProgressField('akol', 'fia@1/gen-p3', 'scenes')]: 'complete'
    }, { [fiaProgressField('mary', unit, 'hear')]: '1' });
    const s = fiaStudyStatus(state, 'L1', unit)!;
    expect(s.doneCount).toBe(2);
    expect(s.steps[0]!.done).toEqual({ by: 'mary', hlc: '1' });
    expect(s.next?.stage.id).toBe('scenes');
    expect(s.people).toEqual(['mary']);
    expect(s.steps[0]!.content[0]?.text).toBe('Listen twice.');
    expect(s.progressMaterialId).toBe(fiaProgressId('L1'));
  });

  it('forgets a step whose finisher undid it', () => {
    const unit = 'fia@1/gen-p2';
    const s = fiaStudyStatus(stateWith({ [fiaProgressField('akol', unit, 'hear')]: '' }), 'L1', unit)!;
    expect(s.doneCount).toBe(0);
    expect(s.next?.stage.id).toBe('hear');
  });

  it('is null for a passage with no FIA study', () => {
    expect(fiaStudyStatus(emptyState(), 'L1', 'x')).toBeNull();
  });

  it('groups the six steps into FIA\'s three phases', () => {
    expect([...new Set(FIA_STAGES.map((s) => s.phase))]).toEqual(['Familiarize', 'Internalize', 'Articulate']);
  });
});
