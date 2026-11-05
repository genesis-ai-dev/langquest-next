// The material editors' rules (ORG-8): which fields a save writes, when Save
// is enabled, what the commands are given, and the library editor's
// versification choices, template parts and published document.
import { describe, expect, it } from 'vitest';
import { formatQuestionField, materialView, validateDoc, type KindDef, type MaterialDoc } from '@langquest-next/core';
import {
  addPart, baseVersificationChoice, defineMaterialInput, fieldRestores, fieldWrites, libraryMaterialDoc, materialChanges, materialFieldIds,
  materialReady, materialScopeName, normalizedQuestion, partOfUnit, questionTypes, sortQuestionSets, storedQuestion, templatePartChoices,
  versificationChoices
} from '../src/reference/materialModel';
import { questionDrafts, type QuestionDraft } from '../src/config/model';
import { language } from './configFixtures';

const q = (fieldId: string, text: string, extra: Partial<QuestionDraft> = {}): QuestionDraft => ({ fieldId, text, type: 'text', required: false, ...extra });
const set = (stepId?: string) => ({ scope: stepId ? { stepId } : {} });

describe('questions as stored', () => {
  it('writes type and requirement into the field, and clears a question left empty', () => {
    expect(storedQuestion(q('q1', '  Is it clear? ', { type: 'yesno', required: true }))).toBe(formatQuestionField({ text: 'Is it clear?', type: 'yesno', required: true }));
    expect(storedQuestion(q('q1', '   '))).toBe('');
  });

  it('reads text without a type prefix as the same question once formatted', () => {
    expect(normalizedQuestion('Anything missing?')).toBe(storedQuestion(q('q2', 'Anything missing?')));
    expect(normalizedQuestion(formatQuestionField({ text: 'Clear?', type: 'rating', required: true }))).toBe(storedQuestion(q('x', 'Clear?', { type: 'rating', required: true })));
    expect(normalizedQuestion('  ')).toBe('');
  });

  it('names the three ways to answer', () => {
    expect(questionTypes().map((x) => x.id)).toEqual(['text', 'yesno', 'rating']);
    expect(new Set(questionTypes().map((x) => x.label)).size).toBe(3);
  });
});

describe('question sets in order', () => {
  it('follow the order of the review kinds, those tied to none or to a kind not known last', () => {
    const kinds = [{ id: 'peer' }, { id: 'final' }] as KindDef[];
    const sets = [set('final'), set(), set('peer'), set('gone')].map((s, i) => ({ ...s, id: i }));
    expect(sortQuestionSets(sets, kinds).map((s) => s.id)).toEqual([2, 0, 1, 3]);
    expect(sets.map((s) => s.id)).toEqual([0, 1, 2, 3]);
  });
});

describe('what saving material would write', () => {
  const before = (fields: Record<string, string>) => (id: string) => fields[id] ?? '';

  it('writes only the sections that were typed into and differ, trimmed', () => {
    const changes = materialChanges({
      isQuestions: false, questions: [], baseQuestions: [], fieldIds: ['body', 'names', 'notes'],
      texts: { body: ' New text ', names: 'Same', notes: '' }, before: before({ body: 'Old', names: 'Same' })
    });
    expect(changes).toEqual([{ fieldId: 'body', text: 'New text', before: 'Old' }]);
  });

  it('clears a section whose text was emptied, but not one never touched', () => {
    const changes = materialChanges({ isQuestions: false, questions: [], baseQuestions: [], fieldIds: ['a', 'b'], texts: { a: '  ' }, before: before({ a: 'x', b: 'y' }) });
    expect(changes).toEqual([{ fieldId: 'a', text: '', before: 'x' }]);
  });

  it('for a question set compares stored forms, so a legacy question reformatted is not a change', () => {
    const base = [q('q1', 'Anything missing?'), q('q2', 'Clear?', { type: 'yesno' })];
    const stored = before({ q1: 'Anything missing?', q2: formatQuestionField({ text: 'Clear?', type: 'yesno', required: false }) });
    const none = materialChanges({ isQuestions: true, questions: base, baseQuestions: base, fieldIds: [], texts: {}, before: stored });
    expect(none).toEqual([]);
    const edited = materialChanges({ isQuestions: true, questions: [base[0]!, { ...base[1]!, required: true }, q('q3', 'New?')], baseQuestions: base, fieldIds: [], texts: {}, before: stored });
    expect(edited.map((c) => [c.fieldId, c.text === '' ? 'cleared' : 'written'])).toEqual([['q2', 'written'], ['q3', 'written']]);
  });

  it('for a question set clears the questions that were removed, and counts an emptied one as cleared', () => {
    const base = [q('q1', 'One?'), q('q2', 'Two?')];
    const stored = before({ q1: 'One?', q2: 'Two?' });
    const removed = materialChanges({ isQuestions: true, questions: [base[0]!], baseQuestions: base, fieldIds: [], texts: {}, before: stored });
    expect(removed).toEqual([{ fieldId: 'q2', text: '', before: 'Two?' }]);
    const emptied = materialChanges({ isQuestions: true, questions: [base[0]!, q('q2', '')], baseQuestions: base, fieldIds: [], texts: {}, before: stored });
    expect(emptied).toEqual([{ fieldId: 'q2', text: '', before: 'Two?' }]);
  });

  it('writes the new text and puts back the old on Undo', () => {
    const changes = [{ fieldId: 'a', text: 'new', before: 'old' }];
    expect(fieldWrites(changes)).toEqual([{ fieldId: 'a', text: 'new' }]);
    expect(fieldRestores(changes)).toEqual([{ fieldId: 'a', text: 'old' }]);
  });
});

describe('the sections of a material', () => {
  const none = { existing: null, isNew: true, materialKind: 'tg', extraFields: [] as string[] };

  it('new material starts with one body; a new FIA study follows its template', () => {
    expect(materialFieldIds(none)).toEqual(['body']);
    expect(materialFieldIds({ ...none, materialKind: 'fia_study' })).toEqual(['summary', 'key_ideas', 'scenes', 'discussion']);
  });

  it('adds the sections made in this session once each, after those it has', () => {
    const p = language();
    p.add('v1.MaterialDefined', { materialId: 'tg1', kind: 'tg', title: 'T', scope: {} });
    p.add('v1.MaterialFieldSet', { materialId: 'tg1', fieldId: 'body', text: 'x' });
    const existing = materialView(p.state(), 'tg1')!;
    expect(materialFieldIds({ existing, isNew: false, materialKind: 'tg', extraFields: ['names', 'body', 'names'] })).toEqual(['body', 'names']);
  });
});

describe('when Save is enabled', () => {
  const some = [{ fieldId: 'a', text: 'x', before: '' }];
  const empty = [{ fieldId: 'a', text: '', before: 'x' }];
  const base = { isNew: true, title: 'T', isQuestions: false, changes: [], toLibrary: false, hasLanguage: true };

  it('new material needs a title and a place to go: a language, or the library', () => {
    expect(materialReady(base)).toBe(true);
    expect(materialReady({ ...base, title: '  ' })).toBe(false);
    expect(materialReady({ ...base, hasLanguage: false })).toBe(false);
    expect(materialReady({ ...base, hasLanguage: false, toLibrary: true })).toBe(true);
  });

  it('a new question set also needs a question with text', () => {
    expect(materialReady({ ...base, isQuestions: true })).toBe(false);
    expect(materialReady({ ...base, isQuestions: true, changes: empty })).toBe(false);
    expect(materialReady({ ...base, isQuestions: true, changes: some })).toBe(true);
  });

  it('an edit needs a change, and nothing else', () => {
    expect(materialReady({ ...base, isNew: false, title: '', hasLanguage: false })).toBe(false);
    expect(materialReady({ ...base, isNew: false, title: '', hasLanguage: false, changes: empty })).toBe(true);
  });
});

describe('defineMaterial\'s input', () => {
  const changes = [{ fieldId: 'q1', text: 'Is it clear?', before: '' }];

  it('scopes a question set to the review kind it is for, and gives other material no scope', () => {
    expect(defineMaterialInput({ commandId: 'c', materialId: 'm', materialKind: 'questions', title: ' Peer ', changes, isQuestions: true, reviewKind: 'final' }))
      .toEqual({ commandId: 'c', materialId: 'm', kind: 'questions', title: 'Peer', fields: [{ fieldId: 'q1', text: 'Is it clear?' }], scope: { stepId: 'final' } });
    expect(defineMaterialInput({ commandId: 'c', materialId: 'm', materialKind: 'tg', title: 'T', changes, isQuestions: false, reviewKind: 'final' }).scope).toEqual({});
  });

  it('refers a new FIA study to its template', () => {
    const input = defineMaterialInput({ commandId: 'c', materialId: 'm', materialKind: 'fia_study', title: 'T', changes: [], isQuestions: false, reviewKind: 'peer' });
    expect(input.templateRef).toBe('fia_study');
    expect(defineMaterialInput({ commandId: 'c', materialId: 'm', materialKind: 'tg', title: 'T', changes: [], isQuestions: false, reviewKind: 'peer' })).not.toHaveProperty('templateRef');
  });

  it('reads a draft of a stored set back to the same drafts', () => {
    const p = language();
    p.add('v1.MaterialDefined', { materialId: 'qs', kind: 'questions', title: 'Q', scope: { stepId: 'peer' } });
    p.add('v1.MaterialFieldSet', { materialId: 'qs', fieldId: 'q1', text: storedQuestion(q('q1', 'Clear?', { type: 'yesno', required: true })) });
    const m = materialView(p.state(), 'qs')!;
    const drafts = questionDrafts(m);
    expect(materialChanges({ isQuestions: true, questions: drafts, baseQuestions: drafts, fieldIds: [], texts: {}, before: (id) => m.fields.find((f) => f.fieldId === id)?.text ?? '' })).toEqual([]);
  });
});

describe('where a material applies', () => {
  it('names the unit it is scoped to, else the language\'s team', () => {
    const state = language().state();
    expect(materialScopeName(state, { scope: { unitId: 'luke15' } }, 'Dinka')).toBe('Luke 15:11-32');
    expect(materialScopeName(state, { scope: {} }, 'Dinka')).toContain('Dinka');
  });
});

describe('versification choices', () => {
  const own = [{ itemId: 'v.mine', name: 'Ours', current: 'h-own' }] as never;
  const shared = [
    { org_id: 'o2', item_id: 'v.theirs', name: 'Theirs', org_name: 'Other Org', latest_hash: 'h-theirs', subscribable: true },
    { org_id: 'o3', item_id: 'v.followed', name: 'Followed', org_name: 'Third Org', latest_hash: 'h-f', subscribable: false }
  ] as never;

  it('offers each language\'s own first, then the organization\'s, then shared ones not yet followed', () => {
    const choices = versificationChoices(own, shared, (s) => s.item_id === 'v.followed');
    expect(choices.map((c) => [c.key, c.hash])).toEqual([['none', null], ['v.mine', 'h-own'], ['o2/v.theirs', 'h-theirs']]);
    expect(choices[2]!.label).toBe('Theirs · Other Org');
    expect(choices[2]!.shared).toBeTruthy();
    expect(choices[1]!.shared).toBeUndefined();
  });

  it('starts from the document\'s own versification, or a stand-in named once it loads', () => {
    const choices = versificationChoices(own, shared, () => false);
    expect(baseVersificationChoice(choices, 'h-own', null).key).toBe('v.mine');
    expect(baseVersificationChoice(choices, null, null).key).toBe('none');
    // A shared one is not "its own": the document's choice is a stand-in, labelled by name.
    expect(baseVersificationChoice(choices, 'h-theirs', 'Theirs')).toEqual({ key: 'doc', label: 'Theirs', hash: 'h-theirs' });
    expect(baseVersificationChoice(choices, 'h-unknown', null).key).toBe('doc');
  });
});

describe('template parts a material links', () => {
  function withTemplate() {
    const p = language();
    p.add('v1.UnitAdded', { unitId: 'fia-eng.ab12/LUK.15', parentUnitId: null, kind: 'passage', label: 'Lost son', order: 'b' });
    p.add('v1.UnitAdded', { unitId: 'fia-eng.ab12/RUT.1', parentUnitId: null, kind: 'passage', label: 'Ruth arrives', order: 'c' });
    return p.state();
  }

  it('lists only template units, by title, filtered by the search', () => {
    const s = withTemplate();
    expect(templatePartChoices(s, '').map((u) => u.label)).toEqual(['Lost son', 'Ruth arrives']);
    expect(templatePartChoices(s, ' RUTH ').map((u) => u.unitId)).toEqual(['fia-eng.ab12/RUT.1']);
    expect(templatePartChoices(s, 'zzz')).toEqual([]);
  });

  it('splits a unit id into template and node, and adds a part once', () => {
    const part = partOfUnit('fia-eng.ab12/LUK.15.11-32');
    expect(part).toEqual({ template: 'fia-eng.ab12', node: 'LUK.15.11-32' });
    const linked = [{ template: 'a', node: 'b' }];
    const added = addPart(linked, part);
    expect(added).toEqual([...linked, part]);
    expect(addPart(added, { ...part })).toBe(added);
  });
});

describe('the document a library material publishes', () => {
  const base = { material: null, kind: 'tg', title: '  Names ', language: 'fra', body: ' Say them slowly. ', refs: ['RUT 1:1-16'], linked: [{ template: 't', node: 'n' }], versification: 'a'.repeat(64) };

  it('is a valid material document with the form\'s fields trimmed and verse links before template parts', () => {
    const doc = libraryMaterialDoc(base);
    // Publishing fills in the documents it depends on (the versification), so the whole is checked without one.
    expect(validateDoc(libraryMaterialDoc({ ...base, versification: null }))).toBeNull();
    expect(doc).toMatchObject({
      format: 'material@1', kind: 'tg', title: 'Names', language: 'fra', body: 'Say them slowly.', versification: 'a'.repeat(64),
      links: [{ ref: 'RUT 1:1-16' }, { template: 't', node: 'n' }]
    });
  });

  it('leaves out what is empty', () => {
    const doc = libraryMaterialDoc({ ...base, language: null, body: '  ', refs: [], linked: [], versification: null });
    expect(doc).not.toHaveProperty('language');
    expect(doc).not.toHaveProperty('body');
    expect(doc).not.toHaveProperty('links');
    expect(doc).not.toHaveProperty('versification');
  });

  it('keeps the rest of the stored document and replaces what the form owns', () => {
    const stored: MaterialDoc = {
      format: 'material@1', kind: 'tg', title: 'Old', deps: [], body: 'old body', language: 'eng', versification: 'old', links: [{ ref: 'JHN 3:16' }],
      fields: [{ id: 'f', text: 'kept' }]
    };
    const doc = libraryMaterialDoc({ ...base, material: stored, refs: [], linked: [], versification: null });
    expect(doc.fields).toEqual([{ id: 'f', text: 'kept' }]);
    expect(doc.title).toBe('Names');
    expect(doc.links).toBeUndefined();
    expect(doc.versification).toBeUndefined();
  });
});
