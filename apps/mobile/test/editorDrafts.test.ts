// What the library editors and key-word sheets keep on the phone while
// unfinished (decision 126, src/drafts/editorDrafts.ts).
import { describe, expect, it } from 'vitest';
import { hasContent, parseDraft, serializeDraft } from '../src/drafts/draftModel';
import {
  draftBehind, editorDraft, EMPTY_RENDERING, isFlowDraft, isLibraryMaterialDraft, isMaterialDraft, isRenderingDraft, isTemplateDraft, isTermDraft,
  NO_FLOW_EDITS, NO_LIBRARY_MATERIAL_EDITS, NO_MATERIAL_EDITS
} from '../src/drafts/editorDrafts';
import type { TemplateForm } from '../src/templates/contentTemplates';

const form: TemplateForm = {
  name: 'Stories', description: '', structure: 'outline', levels: [{ name: 'Section' }, { name: 'Lesson', display: 'name' }],
  versification: null, books: [], divide: 'chapters', passages: [],
  outline: [{ id: 'n1', title: 'Creation', children: [{ id: 'n2', title: 'Day one' }] }]
};

describe('an editor’s draft', () => {
  it('is nothing while the form is as it started, so opening and closing an editor leaves nothing', () => {
    expect(editorDraft(form, { ...form }, 'h1')).toBeNull();
    expect(editorDraft(NO_FLOW_EDITS, { ...NO_FLOW_EDITS }, null)).toBeNull();
  });

  it('keeps a change with the version it was begun on, even a field emptied', () => {
    const d = editorDraft({ ...form, name: '' }, form, 'h1');
    expect(d).toEqual({ v: 1, form: { ...form, name: '' }, basis: 'h1' });
    // A plain "has anything in it" would drop a draft whose only change empties a field.
    expect(hasContent(d)).toBe(true);
    const cleared = editorDraft({ ...NO_MATERIAL_EDITS, texts: { summary: '' } }, NO_MATERIAL_EDITS, null);
    expect(hasContent(cleared)).toBe(true);
  });

  it('says when someone published a version after the draft began', () => {
    const d = editorDraft({ ...form, name: 'Stories 2' }, form, 'h1');
    expect(draftBehind(d, 'h1')).toBe(false);
    expect(draftBehind(d, 'h2')).toBe(true);
    expect(draftBehind(null, 'h2')).toBe(false);
    expect(draftBehind(editorDraft({ ...form, name: 'New' }, form, null), 'h2')).toBe(false);
  });

  it('reads back each editor’s draft as written, and drops one of another shape', () => {
    const round = <T,>(value: T, valid: (x: unknown) => x is T) => parseDraft(serializeDraft(value, 5), valid)?.value;
    const template = editorDraft({ ...form, bookParts: [{ book: 'GEN', name: 'Genesis' } as never] }, form, 'h1');
    expect(round(template, isTemplateDraft)).toEqual(template);
    const flow = editorDraft({ ...NO_FLOW_EDITS, steps: [{ key: 'a#0', stepId: 'peer', kindIds: ['peer'], checkpoint: true }],
      added: [{ id: 'elder', name: 'Elder check', description: 'Ours', usualReviewer: 'Elders' }] }, NO_FLOW_EDITS, 'f1');
    expect(round(flow, isFlowDraft)).toEqual(flow);
    const material = editorDraft({ ...NO_MATERIAL_EDITS, title: 'Names', forLanguage: false, texts: { body: 'Say it slowly' },
      questions: [{ fieldId: 'q1', text: 'Clear?', type: 'yesno', required: true }] }, NO_MATERIAL_EDITS, null);
    expect(round(material, isMaterialDraft)).toEqual(material);
    const library = editorDraft({ ...NO_LIBRARY_MATERIAL_EDITS, refsText: 'RUT 1:1', parts: [{ template: 't', node: 'n' }],
      v11n: { key: 'own:x', label: 'English', hash: 'v1' } }, NO_LIBRARY_MATERIAL_EDITS, 'm1');
    expect(round(library, isLibraryMaterialDraft)).toEqual(library);

    expect(isTemplateDraft({ v: 1, form: { ...form, structure: 'map' }, basis: null })).toBe(false);
    expect(isTemplateDraft({ v: 2, form, basis: null })).toBe(false);
    expect(isFlowDraft({ v: 1, form: { ...NO_FLOW_EDITS, steps: [{ key: 'a', kindIds: 'peer', checkpoint: false }] }, basis: null })).toBe(false);
    expect(isMaterialDraft({ v: 1, form: { ...NO_MATERIAL_EDITS, texts: { body: 3 } }, basis: null })).toBe(false);
    expect(isLibraryMaterialDraft({ v: 1, form: { ...NO_LIBRARY_MATERIAL_EDITS, parts: [{ template: 't' }] }, basis: null })).toBe(false);
  });

  it('reads back a key word’s new rendering and a new term', () => {
    const rendering = { ...EMPTY_RENDERING, rendering: 'mchungaji', note: 'As the elders say it', hash: 'abc' };
    expect(parseDraft(serializeDraft(rendering, 1), isRenderingDraft)?.value).toEqual(rendering);
    expect(hasContent(EMPTY_RENDERING)).toBe(false);
    expect(isRenderingDraft({ ...rendering, hash: 4 })).toBe(false);
    expect(isTermDraft({ term: 'grace', gloss: '', rendering: 'neema', context: '' })).toBe(true);
    expect(isTermDraft({ term: 'grace' })).toBe(false);
  });
});
