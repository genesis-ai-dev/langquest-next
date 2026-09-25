import { describe, expect, it } from 'vitest';
import { createTextTranslation, textTranslationsFor, validateTextTranslation, type TextTranslation } from '../src/textTranslations';
import { applyEvent, fold } from '../src/reducer';
import { emptyState } from '../src/state';
import type { AnyEvent } from '../src/events';

const draft: TextTranslation = { translationId: 'original', unitId: 'U', laneId: 'L',
  parentTranslationId: null, text: 'First rendering', origin: 'written' };
function project() {
  const state = emptyState();
  state.units.U = { parentUnitId: null, kind: 'passage', label: 'Passage', order: 'a' };
  state.lanes.L = { languoidId: 'fra' };
  return state;
}
function event(payload: TextTranslation, number: number): AnyEvent {
  return { id: `e${number}`, type: 'v1.TextTranslationCreated', payload,
    actorId: 'translator', orgId: 'O', projectId: 'P', deviceId: 'd',
    hlc: `00000000000000${number}:000000:d` };
}

describe('optional written translation versions', () => {
  it('creates a child without changing its original and keeps source provenance', () => {
    const state = project();
    const original = createTextTranslation(state, 'first', draft);
    expect(original).toHaveLength(1);
    applyEvent(state, event(draft, 1));
    const child = { ...draft, translationId: 'child', parentTranslationId: 'original',
      text: 'Revised rendering', sourceText: 'Original source', origin: 'ai' as const };
    expect(createTextTranslation(state, 'second', child)).toHaveLength(1);
    applyEvent(state, event(child, 2));
    expect(state.textTranslations.original?.value.text).toBe('First rendering');
    expect(textTranslationsFor(state, 'U', 'L').map(t => t.value.translationId)).toEqual(['child', 'original']);
    expect(state.textTranslations.child?.value.sourceText).toBe('Original source');
    expect(() => createTextTranslation(state, 'duplicate', draft)).toThrow('already exists');
  });
  it('rejects a parent from another passage or language', () => {
    const state = project();
    applyEvent(state, event({ ...draft, unitId: 'other' }, 1));
    expect(() => createTextTranslation(state, 'child', {
      ...draft, translationId: 'child', parentTranslationId: 'original'
    })).toThrow('another passage or language');
  });
  it('folds offline versions deterministically even when the child arrives first', () => {
    const events = [event(draft, 1), event({ ...draft, translationId: 'child',
      parentTranslationId: 'original', text: 'Child' }, 2)];
    expect(fold(events).textTranslations).toEqual(fold([...events].reverse()).textTranslations);
    expect(fold([...events, ...events]).textTranslations).toEqual(fold(events).textTranslations);
  });
  it('does not allow source assistance in an isolated back translation workspace', () => {
    const state = project();
    state.obt.workspace = { value: { unitId: 'U', laneId: 'L', inputTakeId: 'input', language: 'French' }, actorId: 'admin', hlc: '', eventId: '' };
    expect(() => createTextTranslation(state, 'first', draft)).toThrow('unavailable');
  });
  it.each([{ text: ' ' }, { text: 'x'.repeat(50001) }, { origin: 'unknown' },
    { parentTranslationId: 'original' }, { sourceText: 1 }])('rejects invalid payload %j', patch => {
    expect(validateTextTranslation({ ...draft, ...patch })).not.toBeNull();
  });
});
