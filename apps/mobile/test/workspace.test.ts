import {
  buildIndexes, commands, derivePartVerses, derivePassage, emptyLanguageState, foldLanguage, keyTermLinksFor,
  type AnyEvent, type EventPayloads, type EventSpec, type EventType, type PartMark
} from '@langquest-next/core';
import {
  backTranslationDraftKey, canPublish, cardDurations, draftToOpen, markTerms, mmss, parseBackTranslationDraft, removeCardSpecs,
  termsInText, tiedTermIds, tieTermsSpecs, unsavedParts, withoutPart, withPart, workingCards, slotRows, targetNumber,
  changedParts, historyFits, marksAfterMove, marksKeepingLabels, marksOf, movedList, opensAbove, parsePartsHistory, restoreSpecs,
  type PartsSnap
} from '../src/recording/workspaceModel';
import { didStep, emptyHistory, redoStep, undoStep } from '../src/ui/undoModel';
import { pendingPassageCards } from '../src/recording/recordingFlow';

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

describe('the list of parts', () => {
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

  it('writes lengths as minutes and seconds', () => {
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

describe('deleting a take with several drafts (decisions.md 83)', () => {
  it('changes only the draft open in the workspace', () => {
    // Why: removing a part used to rewrite the person's latest draft, whichever was open.
    const h = history();
    h.record('a'); h.record('b'); h.record('c');
    h.run(h.cmd().keepTake({ commandId: 'k1', unitId: 'passage', cardHashes: ['a', 'b'], actorId: 'me', parentTakeId: null }));
    h.run(h.cmd().keepTake({ commandId: 'k2', unitId: 'passage', cardHashes: ['c'], actorId: 'me', parentTakeId: null }));
    const s = h.state();
    const first = passage(s).drafts.find((d) => d.cardHashes.includes('a'))!;
    const r = removeCardSpecs(s, buildIndexes(s), {
      commandId: 'd1', unitId: 'passage', actorId: 'me', list: ['a', 'b'], hash: 'a', draftTakeId: first.takeId, parentTakeId: first.takeId, pending: new Set()
    });
    h.run(r.specs);
    const drafts = passage(h.state()).drafts;
    expect(drafts.map((d) => d.cardHashes)).toEqual([['b'], ['c']]);
    expect(drafts[0]!.rootTakeId).toBe(first.rootTakeId);
  });
});

describe('which draft the workspace opens (decisions.md 83)', () => {
  const a = { takeId: 'take:a2', rootTakeId: 'take:a1', hlc: '000000000000002:000000:d' };
  const b = { takeId: 'take:b1', rootTakeId: 'take:b1', hlc: '000000000000005:000000:d' };

  it('opens the draft asked for, by its first or a later take', () => {
    expect(draftToOpen([a, b], 'take:a1', false)).toBe('take:a1');
    expect(draftToOpen([a, b], 'take:a2', false)).toBe('take:a1');
  });

  it('opens the latest draft unless it starts a new one', () => {
    expect(draftToOpen([a, b], undefined, false)).toBe('take:b1');
    expect(draftToOpen([a, b], undefined, true)).toBeNull();
  });

  // A fresh device opens the workspace before the record has the draft:
  // nothing to open yet, and the same answer once the draft arrives, which
  // the workspace then follows (REC-007 on the web found it starting a second draft).
  it('says nothing until the draft asked for has arrived', () => {
    expect(draftToOpen([], 'take:a1', false)).toBeNull();
    expect(draftToOpen([], undefined, false)).toBeNull();
    expect(draftToOpen([a], 'take:a1', false)).toBe('take:a1');
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

describe('where the next part goes (LAN-83)', () => {
  it('numbers a gap as the part it will be, and the parts after it as they will be', () => {
    // Why: a deleted part's place is said again as "Part 3", and Part 4 stays Part 4 meanwhile.
    const rows = slotRows(4, [], { before: 2, label: null });
    expect(rows.map((r) => (r.kind === 'gap' ? `gap${r.n}` : `p${r.index}:${r.n}`))).toEqual(['p0:1', 'p1:2', 'gap3', 'p2:4', 'p3:5']);
    expect(targetNumber(rows, { kind: 'end' })).toBe(6);
    expect(targetNumber(rows, { kind: 'gap', before: 2 })).toBe(3);
    expect(targetNumber(rows, { kind: 'over', index: 2 })).toBe(4);
  });

  it('keeps counting in a place once its gap is filled', () => {
    // Why: what is said after the first part in a place goes there too, numbered next.
    const rows = slotRows(5, [], null);
    expect(targetNumber(rows, { kind: 'gap', before: 3 })).toBe(4);
  });
});

describe('opening a place between two parts (Caleb, 2026-10-16)', () => {
  it('opens a numbered place before a part, and the parts after it are numbered as they will be', () => {
    // Why: tapping the line between Part 2 and Part 3 records the next part there, as Part 3.
    const rows = slotRows(4, [], null, 2);
    expect(rows.map((r) => (r.kind === 'gap' ? `gap${r.n}` : `p${r.index}:${r.n}`))).toEqual(['p0:1', 'p1:2', 'gap3', 'p2:4', 'p3:5']);
    expect(targetNumber(rows, { kind: 'gap', before: 2 })).toBe(3);
  });

  it('never opens a second place where a gap already is', () => {
    const rows = slotRows(3, [], { before: 1, label: null }, 1);
    expect(rows.filter((r) => r.kind === 'gap')).toHaveLength(1);
  });

  it('puts a mark on the line above each part that has a part or the top above it', () => {
    // Why: a gap is already a place to record into, so the lines beside it carry no mark.
    const rows = slotRows(3, [{ before: 1, label: { s: 1, e: 1, kind: 'set' } }], null);
    expect(rows.map((_, k) => opensAbove(rows, k))).toEqual([true, false, false, true]);
  });
});

describe('moving a part (Caleb, 2026-10-16)', () => {
  const next = { t: 'next' } as const;
  it('moves one part to where it was dropped', () => {
    expect(movedList(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(movedList(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(movedList(['a', 'b'], 5, 0)).toEqual(['a', 'b']);
  });

  it('clears the moved part\'s verses and keeps every other part\'s', () => {
    // Why: Part 4 said verse 4; moved to the top it is labelled again, and Part 5 still says verse 5.
    const marks = [next, next, next, next, next];
    const after = marksAfterMove(marks, 3, 0, 6);
    expect(after[0]).toBeNull();
    expect(derivePartVerses(after, 6).labels.map((l) => l && l.s + 1)).toEqual([null, 1, 2, 3, 5]);
  });

  it('keeps a part said in pieces on its verse when the part above it moves away', () => {
    // Why: "more of verse 3" stays verse 3, not the verse of whatever is above it now.
    const marks = [next, next, next, { t: 'join' } as const];
    const after = marksAfterMove(marks, 2, 0, 5);
    expect(derivePartVerses(after, 5).labels.map((l) => l && l.s + 1)).toEqual([null, 1, 2, 3]);
  });
});

describe('undo and redo on the recording screen (Caleb, 2026-10-16)', () => {
  const snap = (list: string[]): PartsSnap => ({ list, marks: list.map(() => null) });
  it('undoes the newest change, redoes it, and forgets what was undone once something new is done', () => {
    let h = didStep(emptyHistory, { before: snap(['a']), after: snap(['a', 'b']) });
    h = didStep(h, { before: snap(['a', 'b']), after: snap(['b', 'a']) });
    const u = undoStep(h)!;
    expect(u.to.list).toEqual(['a', 'b']);
    const r = redoStep(u.history)!;
    expect(r.to.list).toEqual(['b', 'a']);
    const again = undoStep(r.history)!;
    const fresh = didStep(again.history, { before: snap(['a', 'b']), after: snap(['a']) });
    expect(redoStep(fresh)).toBeNull();
    expect(undoStep(emptyHistory)).toBeNull();
  });

  it('is not a change when nothing changed', () => {
    expect(didStep(emptyHistory, { before: snap(['a']), after: snap(['a']) })).toBe(emptyHistory);
  });

  it('brings parts back with new events, never by removing any', () => {
    // Why: the record only grows; an undo is a new take continuing the draft.
    const h = history();
    h.record('a');
    h.record('b');
    h.run(h.cmd().keepTake({ commandId: 'k1', unitId: 'passage', cardHashes: ['a', 'b'], actorId: 'me' }));
    const draft = passage(h.state()).drafts[0]!;
    const s = h.state();
    const { specs, cleared } = restoreSpecs(s, buildIndexes(s), {
      commandId: 'u1', unitId: 'passage', actorId: 'me', to: snap(['b', 'a']), verses: [], draftTakeId: draft.takeId, parentTakeId: draft.takeId
    });
    expect(cleared).toBe(false);
    expect(specs.map((x) => x.type)).toEqual(['v1.TakeComposed', 'v1.TakeArchived']);
    h.run(specs);
    expect(passage(h.state()).drafts[0]!.cardHashes).toEqual(['b', 'a']);
  });

  it('sets the draft aside when undoing back to nothing', () => {
    const h = history();
    h.record('a');
    h.run(h.cmd().keepTake({ commandId: 'k1', unitId: 'passage', cardHashes: ['a'], actorId: 'me' }));
    const draft = passage(h.state()).drafts[0]!;
    const s = h.state();
    const { specs, cleared } = restoreSpecs(s, buildIndexes(s), { commandId: 'u1', unitId: 'passage', actorId: 'me', to: snap([]), verses: [], draftTakeId: draft.takeId });
    expect(cleared).toBe(true);
    h.run(specs);
    expect(passage(h.state()).drafts).toEqual([]);
  });

  it('reads each part\'s mark from the list it was shown with', () => {
    expect(marksOf(['b', 'c'], { list: ['a', 'b'], marks: [{ t: 'next' }, { t: 'join' }] })).toEqual([{ t: 'join' }, null]);
  });
});

describe('what an undo or redo shows (Caleb, 2026-10-16)', () => {
  const s = (list: string[], marks: PartMark[] = list.map(() => null)): PartsSnap => ({ list, marks });
  it('shades the parts that came back, moved or changed their verses', () => {
    expect(changedParts(s(['a', 'b']), s(['a', 'x', 'b']))).toEqual(['x']);
    expect(changedParts(s(['a', 'b', 'c', 'd']), s(['d', 'a', 'b', 'c']))).toEqual(['d']);
    expect(changedParts(s(['a', 'b', 'c']), s(['a', 'c', 'b']))).toEqual(['c']);
    expect(changedParts(s(['a', 'b'], [null, null]), s(['a', 'b'], [null, { t: 'next' }]))).toEqual(['b']);
    expect(changedParts(s(['a', 'b']), s(['a']))).toEqual([]);
  });

  it('keeps a history only while the list is where it left it', () => {
    const h = didStep(emptyHistory, { before: s(['a']), after: s(['a', 'b']) });
    expect(historyFits(h, ['a', 'b'])).toBe(true);
    expect(historyFits(h, ['a', 'b', 'c'])).toBe(false);
    expect(historyFits(undoStep(h)!.history, ['a'])).toBe(true);
    expect(historyFits(emptyHistory, ['z'])).toBe(true);
  });

  it('reads back what it stored, and nothing from what it cannot read', () => {
    const h = didStep(emptyHistory, { before: s(['a']), after: s(['a', 'b'], [{ t: 'set', s: 0, e: 1 }, { t: 'join' }]), what: 'New recording' });
    expect(parsePartsHistory(JSON.stringify(h))).toEqual(h);
    expect(parsePartsHistory(null)).toEqual(emptyHistory);
    expect(parsePartsHistory('{')).toEqual(emptyHistory);
    expect(parsePartsHistory('{"done":[{"before":{"list":[1],"marks":[null]}}],"undone":[]}')).toEqual(emptyHistory);
  });

  it('leaves a verse that changed since the step as it is now', () => {
    // Why: undo takes back only what was done here; a label given later (or in another draft sharing the part) stays.
    const h = history();
    h.record('a');
    h.record('b');
    h.run(h.cmd().keepTake({ commandId: 'k1', unitId: 'passage', cardHashes: ['a', 'b'], actorId: 'me' }));
    const st = h.state();
    const verses = ['1:1', '1:2', '1:3'];
    const { specs } = restoreSpecs(st, buildIndexes(st), {
      commandId: 'u1', unitId: 'passage', actorId: 'me', verses, to: s(['a', 'b'], [{ t: 'next' }, { t: 'next' }]),
      from: s(['a', 'b'], [null, null]), now: s(['a', 'b'], [null, { t: 'set', s: 2, e: 2 }])
    });
    const set = specs.filter((x) => x.type === 'v1.CardVerseSet').map((x) => (x.payload as { hash: string; mark: string }));
    expect(set).toEqual([expect.objectContaining({ hash: 'a', mark: 'next' }), expect.objectContaining({ hash: 'b', mark: 'set' })]);
  });
});

describe('recording between two parts (Caleb, 2026-10-16)', () => {
  const next = { t: 'next' } as const;
  it('leaves the new part without verses and every other part on its own', () => {
    // Why: Part 3 is verse 3 and Part 4 verse 4; what is said between them is not labelled for the person, and nothing is renumbered.
    const before = { list: ['a', 'b', 'c', 'd'], marks: [next, next, next, next] as PartMark[] };
    const marks = marksKeepingLabels(before, ['a', 'b', 'c', 'x', 'd'], 5);
    expect(marks[3]).toBeNull();
    expect(derivePartVerses(marks, 5).labels.map((l) => l && l.s + 1)).toEqual([1, 2, 3, null, 4]);
  });

  it('makes what is said inside a verse said in pieces more of that verse', () => {
    // Why: between two pieces of verse 3, the new part is verse 3 too, and the piece after it stays verse 3.
    const before = { list: ['a', 'b', 'c', 'd'], marks: [next, next, next, { t: 'join' }] as PartMark[] };
    const marks = marksKeepingLabels(before, ['a', 'b', 'c', 'x', 'y', 'd'], 5);
    expect(derivePartVerses(marks, 5).labels.map((l) => l && l.s + 1)).toEqual([1, 2, 3, 3, 3, 3]);
  });
});
