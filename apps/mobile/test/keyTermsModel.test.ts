// The key-term screens' rules (TERM-1..6): grouping by passage, the first
// rendering note, where a term was used, and when a draft can be tied.
import { describe, expect, it } from 'vitest';
import {
  adjustDuringTake, adjustmentNote, adjustmentReady, defineTermInput, EMPTY_TERM_DRAFT, firstRenderingNote, groupTerms, ourWord, ourWords, termDraftReady,
  termUsedIn, termVoice, termWords, tieState, versionOfTake, type TermUse
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
    expect(adjustmentNote(firstRenderingNote('nhom'))).toBe('First word: nhom.');
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

// The team's words on the recorder's tiles and in the Bible's text (LAN-233, decision 208).
describe('the team\'s word for a key word', () => {
  const rendering = (id: string, rendering: string, context = '') => ({ renderingId: `rendering:${id}`, rendering, context });
  const change = (id: string, hlc: string, extra: { blobHash?: string; duringTakeId?: string } = {}) => ({ adjustmentId: `adjustment:${id}`, note: 'n', actorId: 'a', hlc, ...extra });

  it('is the newest written word, with the newest voice to play', () => {
    const word = ourWord({ renderings: [rendering('c1', 'tata'), rendering('c2', ' baba ')], adjustments: [change('c1', '1', { blobHash: 'h1' }), change('c2', '2')] });
    expect(word).toEqual({ kind: 'text', text: 'baba', voice: 'h1' });
  });

  it('is a recorded word when it was only said, and none when there is nothing', () => {
    expect(ourWord({ renderings: [], adjustments: [change('c1', '1', { blobHash: 'h1' })] })).toEqual({ kind: 'voice', voice: 'h1' });
    expect(ourWord({ renderings: [rendering('c1', '  ')], adjustments: [change('c1', '1')] })).toEqual({ kind: 'none' });
    expect(ourWord({ renderings: [], adjustments: [] })).toEqual({ kind: 'none' });
  });

  it('keeps the newest voice of the term', () => {
    expect(termVoice({ adjustments: [change('c1', '1', { blobHash: 'h1' }), change('c2', '2'), change('c3', '3', { blobHash: 'h3' })] })).toBe('h3');
    expect(termVoice({ adjustments: [change('c1', '1')] })).toBeUndefined();
  });

  it('is listed for the Bible by term, leaving out the words not yet said', () => {
    const terms = [
      { termId: 'a', renderings: [rendering('c1', 'tata')], adjustments: [] },
      { termId: 'b', renderings: [], adjustments: [] },
      { termId: 'c', renderings: [], adjustments: [change('c2', '1', { blobHash: 'h' })] }
    ];
    expect([...ourWords(terms)]).toEqual([['a', { kind: 'text', text: 'tata' }], ['c', { kind: 'voice', voice: 'h' }]]);
  });
});

describe('the team\'s words for a key word, with where each was said and used', () => {
  const use = (takeId: string, adjustmentId: string | undefined, n: number): TermUse => ({ takeId, unitId: 'luke15', title: 'Luke 15:11-32', n, by: 'a', hlc: '1', ...(adjustmentId ? { adjustmentId } : {}) });
  const versionOf = (takeId: string) => (takeId === 'gone' ? null : { unitId: 'luke15', takeId, title: 'Luke 15:11-32', n: takeId === 'tk2' ? 2 : 1 });
  const term = {
    renderings: [
      { renderingId: 'rendering:c1', rendering: 'tata', context: 'said of God' },
      { renderingId: 'rendering:c3', rendering: 'baba', context: '' }
    ],
    adjustments: [
      { adjustmentId: 'adjustment:c1', note: 'n', actorId: 'a', hlc: '1', blobHash: 'h1', duringTakeId: 'tk1' },
      // A voice with no rendering: a word that was only said.
      { adjustmentId: 'adjustment:c2', note: 'n', actorId: 'a', hlc: '2', blobHash: 'h2', duringTakeId: 'tk2' },
      { adjustmentId: 'adjustment:c3', note: 'n', actorId: 'a', hlc: '3', duringTakeId: 'gone' },
      // A note of why, with neither a rendering nor a voice: not a word.
      { adjustmentId: 'adjustment:c4', note: 'why', actorId: 'a', hlc: '4' }
    ]
  };

  it('lists each word newest first with its voice, context and the version it was said in', () => {
    const words = termWords(term, [], versionOf);
    expect(words.map((w) => w.id)).toEqual(['rendering:c3', 'adjustment:c2', 'rendering:c1']);
    expect(words[2]).toMatchObject({ rendering: 'tata', context: 'said of God', voice: 'h1', saidIn: { takeId: 'tk1', n: 1 } });
    // Said and not written.
    expect(words[1]).toMatchObject({ rendering: '', voice: 'h2', saidIn: { takeId: 'tk2', n: 2 } });
    // A version that no longer exists is not named, and a word with no voice has none.
    expect(words[0]).toMatchObject({ rendering: 'baba' });
    expect(words[0]).not.toHaveProperty('saidIn');
    expect(words[0]).not.toHaveProperty('voice');
  });

  it('says which versions used which word, by the change each version tied the term in with', () => {
    const words = termWords(term, [use('tk1', 'adjustment:c1', 1), use('tk2', 'adjustment:c1', 2), use('tk3', 'adjustment:c3', 3), use('tk4', undefined, 4)], versionOf);
    expect(words.find((w) => w.id === 'rendering:c1')!.usedIn.map((u) => u.takeId)).toEqual(['tk1', 'tk2']);
    expect(words.find((w) => w.id === 'rendering:c3')!.usedIn.map((u) => u.takeId)).toEqual(['tk3']);
    // A version that tied the term in without naming a word belongs to none of them.
    expect(words.find((w) => w.id === 'adjustment:c2')!.usedIn).toEqual([]);
  });

  it('adds the clips recorded as examples of a way: to the written word of that way, else as a word that was only said', () => {
    const clip = (renderingId: string, wayId: string, blobHash: string, duringTakeId?: string) => ({ renderingId, blobHash, durationMs: 1000, actorId: 'a', wayId, ...(duringTakeId ? { duringTakeId } : {}) });
    const words = termWords({ ...term, audioRenderings: [clip('e1', 'rendering:c3', 'x1'), clip('e2', 'rendering:c3', 'x2'), clip('e3', 'way:new', 'x3', 'tk2')] }, [], versionOf);
    // The newest clip of the way becomes the voice of the written word that had none.
    expect(words.find((w) => w.id === 'rendering:c3')).toMatchObject({ rendering: 'baba', voice: 'x2' });
    // A word whose own change holds a voice keeps it.
    expect(words.find((w) => w.id === 'rendering:c1')).toMatchObject({ voice: 'h1' });
    expect(words.find((w) => w.id === 'way:new')).toMatchObject({ rendering: '', voice: 'x3', saidIn: { takeId: 'tk2', n: 2 } });
  });

  it('plays a recorded example for a term with no written word and no voice in a change', () => {
    const only = { renderings: [], adjustments: [], audioRenderings: [{ renderingId: 'e1', blobHash: 'x1', durationMs: 1000, actorId: 'a', wayId: 'way:1' }] };
    expect(termVoice(only)).toBe('x1');
    expect(ourWord(only)).toEqual({ kind: 'voice', voice: 'x1' });
  });

  it('puts a rendering with no change of its own before those that have one, and has nothing for a term with no word', () => {
    const words = termWords({ renderings: [{ renderingId: 'old', rendering: 'ancient', context: '' }, { renderingId: 'rendering:c9', rendering: 'new', context: '' }], adjustments: [{ adjustmentId: 'adjustment:c9', note: 'n', actorId: 'a', hlc: '9' }] }, [], versionOf);
    expect(words.map((w) => w.rendering)).toEqual(['new', 'ancient']);
    expect(termWords({ renderings: [], adjustments: [{ adjustmentId: 'adjustment:c4', note: 'why', actorId: 'a', hlc: '4' }] }, [], versionOf)).toEqual([]);
  });
});
