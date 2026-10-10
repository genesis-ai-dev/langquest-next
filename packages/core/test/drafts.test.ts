import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { HlcClock } from '../src/hlc';
import { CommandError, commands } from '../src/commands';
import { foldLanguage as fold } from '../src/reducer';
import { emptyLanguageState as emptyState } from '../src/state';
import { derivePassage, draftsBy, highlightsFor, latestDraftBy } from '../src/passage';

/**
 * Several drafts of one passage per person (decisions.md 82): each is the
 * line of takes its changes composed, kept apart from the others, and any
 * of them can be changed, deleted (and brought back) or published.
 */

function language() {
  const events: AnyEvent[] = [];
  let wall = 1_700_000_000_000;
  let seq = 0;
  const clocks = new Map<string, HlcClock>();
  const emit = <T extends EventType>(actorId: string, type: T, payload: EventPayloads[T]) => {
    const clock = clocks.get(actorId) ?? new HlcClock(actorId, () => wall);
    clocks.set(actorId, clock);
    wall += 1000;
    seq += 1;
    events.push({ id: `x${seq}`, type, orgId: 'o', streamId: 'din', actorId, deviceId: actorId, hlc: clock.next(), payload } as AnyEvent);
  };
  const state = () => fold(events, emptyState());
  const run = (actorId: string, build: (c: ReturnType<typeof commands>) => { type: EventType; payload: unknown }[]) => {
    for (const spec of build(commands(state()))) emit(actorId, spec.type, spec.payload as never);
  };
  emit('lead', 'v1.UnitAdded', { unitId: 'john', parentUnitId: null, kind: 'book', label: 'John', order: 'a' });
  emit('lead', 'v1.UnitAdded', { unitId: 'john3', parentUnitId: 'john', kind: 'passage', label: 'John 3:1-21', order: 'a1' });
  const passage = () => derivePassage(state(), 'john3');
  return { emit, run, state, passage };
}

const keep = (cards: string[], parentTakeId?: string | null) => (c: ReturnType<typeof commands>) =>
  c.keepTake({ commandId: `k${cards.join('')}${parentTakeId ?? ''}`, unitId: 'john3', cardHashes: cards, actorId: 'akol', ...(parentTakeId !== undefined ? { parentTakeId } : {}) });

describe('several drafts of a passage', () => {
  it('keeps a second draft started empty beside the first, each changed on its own', () => {
    // Why: a translator tries a passage two ways and keeps both until they choose.
    const l = language();
    l.run('akol', keep(['a1']));
    l.run('akol', keep(['b1'], null));
    expect(draftsBy(l.passage(), 'akol').map((d) => d.cardHashes)).toEqual([['a1'], ['b1']]);

    const [first, second] = draftsBy(l.passage(), 'akol');
    l.run('akol', keep(['a1', 'a2'], first!.takeId));
    const after = draftsBy(l.passage(), 'akol');
    expect(after.map((d) => d.cardHashes)).toEqual([['a1', 'a2'], ['b1']]);
    // The changed draft is the same draft: its first take still names it.
    expect(after[0]!.rootTakeId).toBe(first!.rootTakeId);
    expect(after[1]!.takeId).toBe(second!.takeId);
    expect(latestDraftBy(l.passage(), 'akol')!.cardHashes).toEqual(['a1', 'a2']);
  });

  it('starts a draft from a version and says which', () => {
    const l = language();
    l.run('akol', (c) => c.publishVersion({ commandId: 'v1', unitId: 'john3', cardHashes: ['a1'], actorId: 'akol' }));
    const v1 = l.passage().latest!.takeId;
    l.run('akol', keep(['a1', 'a2'], v1));
    const [d] = draftsBy(l.passage(), 'akol');
    expect(d!.basedOnTakeId).toBe(v1);
    expect(l.passage().versions).toHaveLength(1);
  });

  it('deletes one draft and brings it back with Undo', () => {
    const l = language();
    l.run('akol', keep(['a1']));
    l.run('akol', keep(['b1'], null));
    const [first] = draftsBy(l.passage(), 'akol');
    l.run('akol', (c) => c.deleteDraft({ commandId: 'del', unitId: 'john3', takeId: first!.takeId, actorId: 'akol' }));
    expect(draftsBy(l.passage(), 'akol').map((d) => d.cardHashes)).toEqual([['b1']]);
    expect(() => commands(l.state()).deleteDraft({ commandId: 'del2', unitId: 'john3', takeId: first!.takeId, actorId: 'akol' })).toThrow(CommandError);

    // Undo: the same cards, continuing the deleted take, so it is the same draft again.
    l.run('akol', keep(first!.cardHashes, first!.takeId));
    const back = draftsBy(l.passage(), 'akol');
    expect(back.map((d) => d.cardHashes)).toEqual([['a1'], ['b1']]);
    expect(back[0]!.rootTakeId).toBe(first!.rootTakeId);
  });

  it("never deletes or retires a teammate's draft", () => {
    const l = language();
    l.run('deng', (c) => c.keepTake({ commandId: 'd', unitId: 'john3', cardHashes: ['d1'], actorId: 'deng' }));
    const theirs = draftsBy(l.passage(), 'deng')[0]!;
    expect(() => commands(l.state()).deleteDraft({ commandId: 'x', unitId: 'john3', takeId: theirs.takeId, actorId: 'akol' })).toThrow(CommandError);
    const specs = commands(l.state()).keepTake({ commandId: 'copy', unitId: 'john3', cardHashes: ['d1', 'a1'], actorId: 'akol', parentTakeId: theirs.takeId });
    expect(specs.map((s) => s.type)).toEqual(['v1.TakeComposed']);
  });

  it('publishes the draft chosen and leaves the others as they are', () => {
    // Why: publishing used to retire the person's latest draft, whichever it was.
    const l = language();
    l.run('akol', keep(['a1']));
    l.run('akol', keep(['b1'], null));
    const [first, second] = draftsBy(l.passage(), 'akol');
    l.run('akol', (c) => c.publishVersion({ commandId: 'pub', unitId: 'john3', cardHashes: first!.cardHashes, actorId: 'akol', parentTakeId: first!.takeId }));
    const p = l.passage();
    expect(p.versions.map((v) => v.cardHashes)).toEqual([['a1']]);
    expect(p.versions[0]!.parentTakeId).toBe(first!.takeId);
    expect(draftsBy(p, 'akol').map((d) => d.takeId)).toEqual([second!.takeId]);
  });

  it('refuses a draft from another passage', () => {
    const l = language();
    l.emit('lead', 'v1.UnitAdded', { unitId: 'john4', parentUnitId: 'john', kind: 'passage', label: 'John 4', order: 'a2' });
    l.run('akol', (c) => c.keepTake({ commandId: 'other', unitId: 'john4', cardHashes: ['z'], actorId: 'akol' }));
    expect(() => commands(l.state()).keepTake({ commandId: 'x', unitId: 'john3', cardHashes: ['a'], actorId: 'akol', parentTakeId: 'take:other' })).toThrow(CommandError);
  });

  it("puts the person's own draft on My Work even when a teammate changed theirs since", () => {
    const l = language();
    l.run('akol', keep(['a1']));
    l.run('deng', (c) => c.keepTake({ commandId: 'd', unitId: 'john3', cardHashes: ['d1'], actorId: 'deng' }));
    const mine = highlightsFor(l.state(), 'akol', { canRecord: true, canReview: false });
    expect(mine.map((h) => h.kind)).toEqual(['draft']);
  });
});
