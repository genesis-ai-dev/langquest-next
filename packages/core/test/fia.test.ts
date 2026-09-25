import { describe, expect, it } from 'vitest';
import {
  defineFiaProgress, defineFiaStudy, FIA_STAGES, fiaPericopes,
  fiaProgressField, fiaProgressId, fiaStageContent, fiaStudiesFor
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
