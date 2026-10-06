import {
  buildIndexes, commands, derivePassage, emptyLanguageState, foldLanguage, keyTermLinksFor,
  type AnyEvent, type EventPayloads, type EventSpec, type EventType
} from '@langquest-next/core';
import {
  backTranslationDraftKey, canPublish, cardDurations, cardLabels, markTerms, mmss, parseBackTranslationDraft, removeCardSpecs,
  termsInText, tiedTermIds, tieTermsSpecs, unsavedParts, withoutPart, withPart, workingCards
} from '../src/recording/workspaceModel';
import { pendingPassageCards } from '../src/recordingFlow';

function history() {
  const events: AnyEvent[] = [];
  let n = 0;
  const push = (type: string, payload: unknown, id: string, actorId = 'me') => {
    n++;
    events.push({ type, payload, id, actorId, orgId: 'org', streamId: 'lang', deviceId: 'device',
      hlc: `${String(n).padStart(15, '0')}:000000:device` } as AnyEvent);
  };
  const add = <T extends EventType>(type: T, payload: EventPayloads[T], actorId = 'me') => push(type, payload, `event-${n}`, actorId);
  const state = () => foldLanguage(events, emptyLanguageState());
  const run = (specs: EventSpec[], actorId = 'me') => { for (const s of specs) push(s.type, s.payload, s.id, actorId); };
  const cmd = () => { const s = state(); return commands(s, buildIndexes(s)); };
  const record = (hash: string, kind: 'source' | 'target' = 'target', actorId = 'me') =>
    add('v1.RecordingAdded', { recordingId: `rec-${hash}`, unitId: 'passage', kind, cards: [{ hash, durationMs: 7200 }] }, actorId);
  add('v1.UnitAdded', { unitId: 'passage', parentUnitId: null, kind: 'passage', label: '1:1', order: 'a' });
  return { add, run, state, cmd, record, hlc: () => `${String(n).padStart(15, '0')}:000000:device` };
}

const passage = (s: ReturnType<ReturnType<typeof history>['state']>) => derivePassage(s, 'passage');

describe('the list of takes', () => {
  it('starts from the draft, else the latest version, then saved cards not yet in a take', () => {
    expect(workingCards({ draftCards: ['a', 'b'], latestCards: ['a'], pending: ['c'], cleared: false })).toEqual(['a', 'b', 'c']);
    expect(workingCards({ latestCards: ['a'], pending: ['c'], cleared: false })).toEqual(['a', 'c']);
    expect(workingCards({ latestCards: ['a'], pending: ['c'], cleared: true })).toEqual(['c']);
    expect(workingCards({ draftCards: ['a'], pending: ['a'], cleared: false })).toEqual(['a']);
  });

  it('can publish only when there are cards and they are not the latest version again', () => {
    expect(canPublish([], undefined)).toBe(false);
    expect(canPublish(['a'], undefined)).toBe(true);
    expect(canPublish(['a', 'b'], ['a', 'b'])).toBe(false);
    expect(canPublish(['b', 'a'], ['a', 'b'])).toBe(true);
  });

  it('names takes as the demo does', () => {
    expect(cardLabels(['a', 'b'], undefined)).toEqual(['Take 1', 'Take 2']);
    expect(cardLabels(['a', 'x', 'c', 'y'], ['a', 'b', 'c'])).toEqual(['Take 1', 'New take 1', 'Take 3', 'New take 2']);
    expect(mmss(7200)).toBe('0:07');
    expect(mmss(92_000)).toBe('1:32');
    expect(mmss(undefined)).toBe('0:00');
  });

  it('reads card lengths for the passage', () => {
    const h = history();
    h.record('a');
    expect(cardDurations(h.state(), 'passage').get('a')).toBe(7200);
    expect(cardDurations(h.state(), 'other').size).toBe(0);
  });
});

describe('deleting a take', () => {
  it('keeps the rest as the draft', () => {
    const h = history();
    h.record('a'); h.record('b');
    h.run(h.cmd().keepTake({ commandId: 'k1', unitId: 'passage', cardHashes: ['a', 'b'], actorId: 'me' }));
    const s = h.state();
    const p = passage(s);
    const { specs, cleared } = removeCardSpecs(s, buildIndexes(s), {
      commandId: 'd1', unitId: 'passage', actorId: 'me', list: ['a', 'b'], hash: 'a', draftTakeId: p.draftTakeId!, pending: new Set()
    });
    h.run(specs);
    expect(cleared).toBe(false);
    const after = passage(h.state());
    expect(h.state().takes[after.draftTakeId!]!.cardHashes).toEqual(['b']);
  });

  it('sets the draft aside when nothing is left, and a card never composed does not come back', () => {
    const h = history();
    h.record('a');
    h.run(h.cmd().keepTake({ commandId: 'k1', unitId: 'passage', cardHashes: ['a'], actorId: 'me' }));
    h.record('b');
    let s = h.state();
    expect(pendingPassageCards(s, 'passage', 'me').map((c) => c.hash)).toEqual(['b']);
    // Delete the uncomposed card first, then the last one.
    let r = removeCardSpecs(s, buildIndexes(s), {
      commandId: 'd1', unitId: 'passage', actorId: 'me', list: ['a', 'b'], hash: 'b', draftTakeId: passage(s).draftTakeId!, pending: new Set(['b'])
    });
    h.run(r.specs);
    s = h.state();
    expect(pendingPassageCards(s, 'passage', 'me')).toEqual([]);
    expect(s.takes[passage(s).draftTakeId!]!.cardHashes).toEqual(['a']);
    r = removeCardSpecs(s, buildIndexes(s), {
      commandId: 'd2', unitId: 'passage', actorId: 'me', list: ['a'], hash: 'a', draftTakeId: passage(s).draftTakeId!, pending: new Set()
    });
    h.run(r.specs);
    expect(r.cleared).toBe(true);
    expect(passage(h.state()).drafting).toBe(false);
  });

  it('does not leave a draft that is just the latest version again', () => {
    const h = history();
    h.record('a');
    h.run(h.cmd().publishVersion({ commandId: 'v1', unitId: 'passage', cardHashes: ['a'] }));
    h.record('b');
    h.run(h.cmd().keepTake({ commandId: 'k1', unitId: 'passage', cardHashes: ['a', 'b'], actorId: 'me' }));
    const s = h.state();
    const p = passage(s);
    expect(p.drafting).toBe(true);
    const r = removeCardSpecs(s, buildIndexes(s), {
      commandId: 'd1', unitId: 'passage', actorId: 'me', list: ['a', 'b'], hash: 'b', draftTakeId: p.draftTakeId!, latestCards: p.latest!.cardHashes, pending: new Set()
    });
    h.run(r.specs);
    expect(r.cleared).toBe(false);
    expect(passage(h.state()).drafting).toBe(false);
  });
});

describe('key terms', () => {
  const terms = [
    { termId: 't-son', term: 'son' },
    { termId: 't-som', term: 'son of man' },
    { termId: 't-wind', term: 'wind' }
  ];

  it('underlines whole words only, longest first, whatever the case', () => {
    const parts = markTerms('The Son of Man and the winds; the wind, a son.', terms);
    expect(parts.filter((p) => p.termId).map((p) => [p.text, p.termId])).toEqual([
      ['Son of Man', 't-som'], ['wind', 't-wind'], ['son', 't-son']
    ]);
    expect(parts.map((p) => p.text).join('')).toBe('The Son of Man and the winds; the wind, a son.');
    expect(markTerms('son of many', terms).filter((p) => p.termId).map((p) => p.termId)).toEqual(['t-son']);
    expect(markTerms('', terms)).toEqual([]);
    expect(markTerms('plain', [])).toEqual([{ text: 'plain' }]);
  });

  it('lists the terms that appear in the text', () => {
    expect(termsInText('a wind blew', terms).map((t) => t.termId)).toEqual(['t-wind']);
  });

  it('reads ties along the draft back to the version it started from, and carries them onto the next version', () => {
    const h = history();
    h.add('v1.KeyTermDefined', { termId: 'grace', term: 'grace', gloss: '', unitScope: [] });
    h.add('v1.KeyTermDefined', { termId: 'lord', term: 'lord', gloss: '', unitScope: [] });
    h.record('a');
    h.run(h.cmd().publishVersion({ commandId: 'v1', unitId: 'passage', cardHashes: ['a'] }));
    const v1 = passage(h.state()).latest!.takeId;
    h.add('v1.KeyTermLinked', { takeId: v1, termId: 'lord' });
    h.record('b');
    h.run(h.cmd().keepTake({ commandId: 'k1', unitId: 'passage', cardHashes: ['a', 'b'], actorId: 'me' }));
    h.add('v1.KeyTermLinked', { takeId: passage(h.state()).draftTakeId!, termId: 'grace' });
    h.record('c');
    h.run(h.cmd().keepTake({ commandId: 'k2', unitId: 'passage', cardHashes: ['a', 'b', 'c'], actorId: 'me' }));
    const s = h.state();
    const tied = tiedTermIds(s, passage(s).draftTakeId);
    expect([...tied].sort()).toEqual(['grace', 'lord']);
    expect([...tiedTermIds(s, v1)]).toEqual(['lord']);

    const publish = h.cmd().publishVersion({ commandId: 'v2', unitId: 'passage', cardHashes: ['a', 'b', 'c'], note: 'Added the ending.', actorId: 'me' });
    const ties = tieTermsSpecs(h.state(), publish, tied, 'v2');
    expect(ties.every((t) => t.type === 'v1.KeyTermLinked')).toBe(true);
    // Its own command id: no event id is shared with the publish.
    expect(ties.some((t) => publish.some((p) => p.id === t.id))).toBe(false);
    h.run([...publish, ...ties]);
    const v2 = passage(h.state()).latest!;
    expect(v2.n).toBe(2);
    expect(keyTermLinksFor(h.state(), v2.takeId).map((l) => l.term.termId).sort()).toEqual(['grace', 'lord']);
    expect(tieTermsSpecs(h.state(), publish, [], 'v2')).toEqual([]);
  });
});

describe('a back translation in progress', () => {
  const card = (hash: string) => ({ hash, durationMs: 4000, format: 'wav' as const });

  it('is kept per language, person, passage and kind', () => {
    const k = { languageId: 'l', actorId: 'me', unitId: 'u', kindId: 'bt' };
    expect(backTranslationDraftKey(k)).not.toBe(backTranslationDraftKey({ ...k, actorId: 'you' }));
    expect(backTranslationDraftKey(k)).not.toBe(backTranslationDraftKey({ ...k, languageId: 'q' }));
    expect(backTranslationDraftKey(k)).not.toBe(backTranslationDraftKey({ ...k, kindId: 'retell' }));
  });

  it('adds parts in order, once each, and a deleted part is gone for good', () => {
    let d = withPart(null, 'v1', card('a'));
    d = withPart(d, 'v2', card('b'));
    d = withPart(d, 'v1', card('a'));
    expect(d).toEqual({ fromTakeId: 'v1', cards: [card('a'), card('b')] });
    const after = withoutPart(d, 'a');
    expect(after?.cards.map((c) => c.hash)).toEqual(['b']);
    // Undo puts it back where it was.
    expect(withPart(after, 'v1', card('a'), 0).cards.map((c) => c.hash)).toEqual(['a', 'b']);
    expect(withoutPart(null, 'a')).toBeNull();
  });

  it('reads back what it stored, and treats anything else as no draft', () => {
    const d = withPart(withPart(null, 'v1', card('a')), 'v1', card('b'));
    expect(parseBackTranslationDraft(JSON.stringify(d))).toEqual(d);
    expect(parseBackTranslationDraft(null)).toBeNull();
    expect(parseBackTranslationDraft('not json')).toBeNull();
    expect(parseBackTranslationDraft('{"cards":[]}')).toBeNull();
    expect(parseBackTranslationDraft('{"fromTakeId":"v1","cards":[{"hash":"a","durationMs":1},{"hash":""},{"hash":"b"}]}'))
      .toEqual({ fromTakeId: 'v1', cards: [{ hash: 'a', durationMs: 1 }] });
  });

  it('saves only the parts on screen, and never offers saved parts again', () => {
    const h = history();
    h.record('a');
    h.run(h.cmd().publishVersion({ commandId: 'v1', unitId: 'passage', cardHashes: ['a'] }));
    const v1 = passage(h.state()).latest!.takeId;
    let d = withPart(withPart(withPart(null, v1, card('bt1')), v1, card('gone')), v1, card('bt2'));
    d = withoutPart(d, 'gone');
    expect(unsavedParts(h.state(), d).map((c) => c.hash)).toEqual(['bt1', 'bt2']);
    h.run(h.cmd().produceContent({ commandId: 'p1', fromTakeId: v1, kindId: 'bt', cards: unsavedParts(h.state(), d) }), 'reviewer');
    const s = h.state();
    const review = Object.values(s.kindReviews).find((r) => r.kindId === 'bt')!;
    expect(review.artifacts?.map((c) => c.hash)).toEqual(['bt1', 'bt2']);
    // Nothing of the draft reached the log as a recording, and the deleted part is nowhere.
    expect(Object.values(s.recordings).flatMap((r) => r.cards.map((c) => c.hash))).toEqual(['a']);
    expect(JSON.stringify(s)).not.toContain('gone');
    // A draft the save could not clear offers nothing twice.
    expect(unsavedParts(s, d)).toEqual([]);
    expect(unsavedParts(s, null)).toEqual([]);
  });
});
