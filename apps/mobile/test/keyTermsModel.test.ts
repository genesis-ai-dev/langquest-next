// The key-term screens' rules (TERM-1..6): grouping by passage, the first
// rendering note, where a term was used, and when a draft can be tied.
import { describe, expect, it } from 'vitest';
import {
  adjustDuringTake, adjustmentNote, adjustmentReady, defineTermInput, EMPTY_TERM_DRAFT, firstRenderingNote, groupTerms, termDraftReady,
  termUsedIn, tieState, versionOfTake
} from '../src/keyTerms/model';
import { language } from './configFixtures';

function withTerms() {
  const p = language();
  p.add('v1.KeyTermDefined', { termId: 'kt1', term: 'grace', gloss: 'Undeserved favour', unitScope: ['luke'] });
  p.add('v1.KeyTermDefined', { termId: 'kt2', term: 'Sabbath', gloss: 'Day of rest', unitScope: [] });
  return p;
}

const view = (termId: string, term: string, gloss = '') => ({ termId, term, gloss, unitScope: [], renderings: [], adjustments: [] }) as never;

describe('the first-rendering note', () => {
  it('is stored in English and read back in the language showing', () => {
    expect(firstRenderingNote('nhom')).toBe('First rendering: nhom.');
    expect(adjustmentNote(firstRenderingNote('nhom'))).toBe('First rendering: nhom.');
    expect(adjustmentNote(firstRenderingNote('a. b'))).toContain('a. b');
  });

  it('leaves a note somebody wrote as it was', () => {
    expect(adjustmentNote('We say it this way at home')).toBe('We say it this way at home');
    expect(adjustmentNote('First rendering: but more words after')).toBe('First rendering: but more words after');
  });
});

describe('groupTerms', () => {
  const terms = [view('a', 'grace', 'favour'), view('b', 'Sabbath', 'rest'), view('c', 'mercy', 'favour shown')];

  it('splits the matches into those in the passage and the rest, keeping order', () => {
    const g = groupTerms(terms, new Set(['b', 'c']), '');
    expect(g.inPassage.map((x) => x.termId)).toEqual(['b', 'c']);
    expect(g.rest.map((x) => x.termId)).toEqual(['a']);
  });

  it('searches word and meaning before splitting', () => {
    const g = groupTerms(terms, new Set(['b', 'c']), 'FAVOUR');
    expect(g.inPassage.map((x) => x.termId)).toEqual(['c']);
    expect(g.rest.map((x) => x.termId)).toEqual(['a']);
    expect(groupTerms(terms, new Set(), 'zzz')).toEqual({ inPassage: [], rest: [] });
  });
});

describe('a new term', () => {
  it('needs the word and its first rendering', () => {
    expect(termDraftReady(EMPTY_TERM_DRAFT)).toBe(false);
    expect(termDraftReady({ ...EMPTY_TERM_DRAFT, term: 'grace' })).toBe(false);
    expect(termDraftReady({ ...EMPTY_TERM_DRAFT, term: 'grace', rendering: '  ' })).toBe(false);
    expect(termDraftReady({ ...EMPTY_TERM_DRAFT, term: 'grace', rendering: 'nhom' })).toBe(true);
  });

  it('is scoped to the book of the passage it is made in, and starts as its first adjustment', () => {
    const state = withTerms().state();
    const ids = { commandId: 'c1', termId: 'kt-9' };
    const draft = { term: 'grace', gloss: 'favour', rendering: ' nhom ', context: '' };
    const input = defineTermInput(state, draft, 'luke15', ids);
    expect(input).toMatchObject({ unitScope: ['luke'], note: 'First rendering: nhom.', rendering: ' nhom ' });
    expect(defineTermInput(state, draft, 'luke', ids).unitScope).toEqual(['luke']);
    expect(defineTermInput(state, draft, undefined, ids).unitScope).toEqual([]);
    expect(defineTermInput(state, draft, 'gone', ids).unitScope).toEqual(['gone']);
  });

  it('keeps the note somebody gave as the reason, over the app\'s own', () => {
    const state = withTerms().state();
    const input = defineTermInput(state, { term: 't', gloss: '', rendering: 'r', context: ' used for kin ' }, undefined, { commandId: 'c', termId: 'k' });
    expect(input.note).toBe('used for kin');
  });
});

describe('where a term is used', () => {
  function withLinkedTake() {
    const p = withTerms();
    p.add('v1.TakeComposed', { takeId: 'tk1', unitId: 'luke15', cardHashes: [], parentTakeId: null });
    p.add('v1.TakeSubmitted', { takeId: 'tk1' });
    p.add('v1.KeyTermLinked', { takeId: 'tk1', termId: 'kt1', note: 'said it' });
    p.add('v1.KeyTermLinked', { takeId: 'missing', termId: 'kt1' });
    return p.state();
  }

  it('lists the versions that link it, with passage titles, and drops takes that are gone', () => {
    const used = termUsedIn(withLinkedTake(), 'kt1');
    expect(used.map((u) => u.takeId)).toEqual(['tk1']);
    expect(used[0]).toMatchObject({ unitId: 'luke15', title: 'Luke 15:11-32', note: 'said it' });
    expect(termUsedIn(withLinkedTake(), 'kt2')).toEqual([]);
  });

  it('finds the version a take is, or nothing for a take that is gone', () => {
    const s = withLinkedTake();
    expect(versionOfTake(s, 'tk1')).toMatchObject({ unitId: 'luke15', takeId: 'tk1', title: 'Luke 15:11-32' });
    expect(versionOfTake(s, 'nope')).toBeNull();
    expect(versionOfTake(s, undefined)).toBeNull();
  });

  it('says whether a draft is already tied, and offers tying only from the workspace to a translator who can edit', () => {
    const s = withLinkedTake();
    const can = { translate: true, edit: true };
    expect(tieState(s, 'kt1', 'tk1', undefined, can)).toEqual({ canTie: true, isLinked: true });
    expect(tieState(s, 'kt2', 'tk1', 'tk1', can)).toEqual({ canTie: true, isLinked: false });
    // A version's page passes that version, not the draft: no tying.
    expect(tieState(s, 'kt2', 'tk1', 'other', can).canTie).toBe(false);
    expect(tieState(s, 'kt2', null, undefined, can)).toEqual({ canTie: false, isLinked: false });
    expect(tieState(s, 'kt2', 'tk1', undefined, { translate: false, edit: true }).canTie).toBe(false);
    expect(tieState(s, 'kt2', 'tk1', undefined, { translate: true, edit: false }).canTie).toBe(false);
  });
});

describe('an adjustment', () => {
  it('can be saved with a typed note or a recording, not with neither', () => {
    expect(adjustmentReady('', null)).toBe(false);
    expect(adjustmentReady('   ', null)).toBe(false);
    expect(adjustmentReady('why', null)).toBe(true);
    expect(adjustmentReady('', 'hash')).toBe(true);
  });

  it('is made during the draft, else the passage\'s latest version', () => {
    expect(adjustDuringTake('d1', { latest: { takeId: 'v1' } } as never)).toBe('d1');
    expect(adjustDuringTake(null, { latest: { takeId: 'v1' } } as never)).toBe('v1');
    expect(adjustDuringTake(undefined, { latest: null } as never)).toBeUndefined();
    expect(adjustDuringTake(null, null)).toBeUndefined();
  });
});
