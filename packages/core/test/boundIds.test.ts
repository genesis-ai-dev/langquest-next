import { checkHelpSpecs, checkPeopleSpecs, checkShowsSpecs, checkTeamSpecs } from '../src/checks';
import { commands, newCommandId, unboundId, type Commands, type EventSpec } from '../src/commands';
import { encodeHlc } from '../src/hlc';
import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { selectBookNamesSpec, selectFlowSpecs } from '../src/libraryApply';
import type { FlowDoc } from '../src/libraryDocs';
import { isBoundToAuthor } from '../src/nearbyDoor';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState, type LanguageState } from '../src/state';
import { EVENT_FIELD_MAX_CHARS, idAuthor, validateEvent } from '../src/validate';

/**
 * Why: a nearby phone hands teammates ids before the server has seen them, and the
 * server gives an id to whoever arrives first. A batch event must be bound to its
 * author or the door refuses it, and `signUnsigned` leaves it out, so a command that
 * misses this costs sharing silently (docs/nearby-sync-plan.md 5.4).
 */
const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '33333333-3333-4333-8333-333333333333';
const UNIQUE = '22222222-2222-4222-8222-222222222222';
const CMD = newCommandId(ME, UNIQUE);
const HASH = 'a'.repeat(64);

let clock = 0;
const stamp = <T extends EventType>(spec: { id: string; type: T; payload: EventPayloads[T] }, actorId = ME): AnyEvent =>
  ({ ...spec, orgId: 'org', streamId: 'lang', actorId, deviceId: 'dev', hlc: encodeHlc(1_700_000_000_000 + ++clock, 0, 'dev') }) as unknown as AnyEvent;
const on = (state: LanguageState, specs: readonly EventSpec[]) => foldLanguage(specs.map((s) => stamp(s)), state);

/** A passage with something for every command to act on, all of it by this person. */
function world(): LanguageState {
  let s = emptyLanguageState();
  const cmd = (tail: string) => newCommandId(ME, tail);
  s = on(s, [
    { id: cmd('u:0'), type: 'v1.UnitAdded', payload: { unitId: 'u1', parentUnitId: null, kind: 'passage', label: 'P1', order: 'a0' } },
    { id: cmd('k:0'), type: 'v1.ReviewKindDefined', payload: { kindId: 'peer', name: 'Peer', description: '', usualReviewer: '' } }
  ]);
  s = on(s, commands(s).publishVersion({ commandId: cmd('v1'), unitId: 'u1', cardHashes: ['h1'], actorId: ME }));
  s = on(s, commands(s).keepTake({ commandId: cmd('draft'), unitId: 'u1', cardHashes: ['h1', 'h2'], actorId: ME }));
  s = on(s, commands(s).cleanUpPart({ commandId: cmd('clean'), unitId: 'u1', actorId: ME, cardHashes: ['h2'], hash: 'h2', tool: 't', use: 'original' }));
  return s;
}

const flow: FlowDoc = {
  format: 'flow@1', name: 'F', description: '', deps: [],
  kinds: [{ id: 'k1', name: 'K', description: 'd', usualReviewer: 'u' }], steps: [{ stepId: 's1', kindIds: ['k1'] }]
};

/** Every method, so a new one does not compile until it is here. */
const DRIVE: { [K in keyof Commands]: (c: Commands, s: LanguageState) => EventSpec[] } = {
  addRecording: (c) => c.addRecording({ commandId: CMD, recordingId: CMD, unitId: 'u1', kind: 'target', card: { hash: HASH, durationMs: 5 } }),
  keepTake: (c) => c.keepTake({ commandId: CMD, unitId: 'u1', cardHashes: ['h9'], actorId: ME }),
  deleteDraft: (c, s) => c.deleteDraft({ commandId: CMD, unitId: 'u1', takeId: draftOf(s), actorId: ME }),
  deleteVersion: (c) => c.deleteVersion({ commandId: CMD, unitId: 'u1', takeId: `take:${newCommandId(ME, 'v1')}`, actorId: ME }),
  setCardVerses: (c) => c.setCardVerses({ commandId: CMD, unitId: 'u1', cards: ['h1'], marks: [{ t: 'next' }], verses: ['1:1', '1:2'] }),
  cleanUpPart: (c) => c.cleanUpPart({ commandId: CMD, unitId: 'u1', actorId: ME, cardHashes: ['h1', 'h2'], hash: 'h1', tool: 't', use: 'cleaned', cleaned: { hash: 'c1', format: 'wav' } }),
  cleanUpParts: (c) => c.cleanUpParts({ commandId: CMD, unitId: 'u1', actorId: ME, cardHashes: ['h1', 'h2'], tool: 't', parts: [{ hash: 'h1', use: 'cleaned', cleaned: { hash: 'c1', format: 'wav' } }] }),
  undoCleanUp: (c) => c.undoCleanUp({ commandId: CMD, unitId: 'u1', actorId: ME, cardHashes: ['h2'], hash: 'h2' }),
  discardCards: (c) => c.discardCards({ commandId: CMD, unitId: 'u1', cardHashes: ['h9'] }),
  savePassageNote: (c) => c.savePassageNote({ commandId: CMD, unitId: 'u1', text: 'note', recordingId: CMD, card: { hash: HASH, durationMs: 5 } }),
  publishVersion: (c) => c.publishVersion({ commandId: CMD, unitId: 'u1', cardHashes: ['h9'], note: 'why', actorId: ME }),
  recordReview: (c) => c.recordReview({ commandId: CMD, takeIds: [`take:${newCommandId(ME, 'v1')}`], kindId: 'peer', outcome: 'looks_good', via: 'app' }),
  produceContent: (c) => c.produceContent({ commandId: CMD, fromTakeId: `take:${newCommandId(ME, 'v1')}`, kindId: 'peer', cards: [{ hash: HASH, durationMs: 5 }] }),
  depart: (c) => c.depart({ commandId: CMD, unitId: 'u1', type: 'skip', kindId: 'peer', reason: 'why' }),
  undoDeparture: (c) => c.undoDeparture({ commandId: CMD, departureId: 'dep:old' }),
  ask: (c) => c.ask({ commandId: CMD, unitId: 'u1', what: 'record', profileId: OTHER }),
  withdrawRequest: (c) => c.withdrawRequest({ commandId: CMD, requestId: 'req:old' }),
  withdrawReviews: (c) => c.withdrawReviews({ commandId: CMD, reviewIds: ['review:old'] }),
  withdrawNote: (c) => c.withdrawNote({ commandId: CMD, noteId: 'note:old' }),
  addNote: (c) => c.addNote({ commandId: CMD, unitId: 'u1', anchor: { kind: 'passage' }, text: 'note' }),
  markStudyStep: (c) => c.markStudyStep({ commandId: CMD, unitId: 'u1', guideId: 'g', stepId: 's', done: true }),
  defineKind: (c) => c.defineKind({ commandId: CMD, kindId: 'k2', name: 'Kind', description: '', usualReviewer: '' }),
  linkKeyTerms: (c) => c.linkKeyTerms({ commandId: CMD, takeId: `take:${newCommandId(ME, 'v1')}`, termIds: ['t1'] }),
  defineKeyTerm: (c) => c.defineKeyTerm({ commandId: CMD, termId: 'kt-1', term: 'word', gloss: '', unitScope: [], rendering: 'r', note: 'why' }),
  // A term someone else named: the part after the term is what says whose this is (decision 75).
  adjustKeyTermRendering: (c) => c.adjustKeyTermRendering({ commandId: CMD, termId: newCommandId(OTHER, 'term'), rendering: 'r', note: 'why' }),
  defineMaterial: (c) => c.defineMaterial({ commandId: CMD, materialId: 'm1', kind: 'note', title: 'T', scope: {}, fields: [{ fieldId: 'f', text: 'x' }] }),
  setMaterialFields: (c) => c.setMaterialFields({ commandId: CMD, materialId: 'm1', fields: [{ fieldId: 'f', text: 'x' }] }),
  lockMaterial: (c) => c.lockMaterial({ commandId: CMD, materialId: 'm1', locked: true }),
  saveFlowSteps: (c) => c.saveFlowSteps({ commandId: CMD, steps: [{ kindIds: ['peer'], checkpoint: false }] }),
  copyFlow: (c) => c.copyFlow({ commandId: CMD, name: 'F', kinds: [{ id: 'k3', name: 'K', description: 'd', usualReviewer: 'u' }], steps: [{ kindIds: ['k3'] }] }),
  restoreFlow: (c) => c.restoreFlow({ commandId: CMD, previous: { flow: null, steps: [{ id: 'custom/s', kindIds: ['peer'], checkpoint: false }] } }),
  referencesUsed: (c) => c.referencesUsed({ commandId: CMD, unitId: 'u1', takeId: `take:${newCommandId(ME, 'v1')}`, items: [{ itemId: 'i', name: 'I', kind: 'source', opened: true }] })
};
function draftOf(s: LanguageState): string {
  const draft = Object.entries(s.takes).find(([id, t]) => t.cardHashes.includes('h2') && !s.submissions[id] && !t.archived);
  if (!draft) throw new Error('no draft in the world');
  return draft[0];
}

describe('every command makes what can be signed', () => {
  const state = world();

  it('drives every method of Commands', () => {
    expect(Object.keys(DRIVE).sort()).toEqual(Object.keys(commands(state)).sort());
  });

  it.each(Object.keys(DRIVE) as (keyof Commands)[])('%s', (method) => {
    const specs = DRIVE[method](commands(state), state);
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      const e = stamp(spec);
      expect(validateEvent(e), `${spec.type} ${spec.id}`).toBeNull();
      expect(isBoundToAuthor(e), `${spec.type} ${spec.id}`).toBe(true);
      expect(spec.id.length).toBeLessThanOrEqual(EVENT_FIELD_MAX_CHARS);
    }
  });

  it('the same command under someone else cannot be signed by this person', () => {
    const [spec] = commands(state).keepTake({ commandId: newCommandId(OTHER, UNIQUE), unitId: 'u1', cardHashes: ['h9'], actorId: ME });
    expect(isBoundToAuthor(stamp(spec!))).toBe(false);
    expect(isBoundToAuthor(stamp(spec!, OTHER))).toBe(true);
  });

  it('what does not start with a command id does not read as bound, and old ids stay as they were', () => {
    const [old] = commands(state).keepTake({ commandId: UNIQUE, unitId: 'u1', cardHashes: ['h9'], actorId: ME });
    expect(old!.id).toBe(`${UNIQUE}:0`);
    expect((old!.payload as { takeId: string }).takeId).toBe(`take:${UNIQUE}`);
    expect(isBoundToAuthor(stamp(old!))).toBe(false);
  });
});

describe('the other things in core that make events', () => {
  const state = world();
  const flowDoc = flow;
  const makers: [string, () => readonly { id: string; type: EventType; payload: unknown }[]][] = [
    ['selectFlowSpecs', () => selectFlowSpecs(state, { commandId: CMD, itemId: 'f', docHash: HASH, doc: flowDoc })],
    ['selectBookNamesSpec', () => [selectBookNamesSpec({ commandId: CMD, itemId: 'n', docHash: HASH, doc: { format: 'names@1', language: 'eng', books: [{ book: 'LUK', name: 'Luke' }] } as never })]],
    ['checkTeamSpecs', () => checkTeamSpecs(state, { commandId: `${CMD}:0`, kindId: 'peer', name: 'Peers' })],
    ['checkHelpSpecs', () => checkHelpSpecs(state, { commandId: CMD, kindId: 'peer', help: { text: 'help' } as never, linked: true })],
    ['checkShowsSpecs', () => checkShowsSpecs(state, { commandId: `${CMD}:0`, kindId: 'peer', what: 'bibleText', shown: false })],
    ['checkPeopleSpecs', () => checkPeopleSpecs(state, { commandId: CMD, kindId: 'peer', people: [OTHER], kinds: ['peer'], nameOf: () => 'Peer' }).specs]
  ];
  it.each(makers)('%s', (_name, make) => {
    const specs = make();
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) expect(isBoundToAuthor(stamp(s as EventSpec)), s.id).toBe(true);
  });
});

describe('how long a bound id gets', () => {
  it('the longest stays under the limit, with the longest ids the app makes', () => {
    // The worst the app builds: a note sent with a review, on a command already extended, naming a review in its own id.
    const reviewCmd = newCommandId(ME, UNIQUE);
    const reviewId = `review:${reviewCmd}:0`;
    const longest = [
      commands(world()).referencesUsed({ commandId: reviewCmd, unitId: 'u1', reviewId, items: [{ itemId: 'i', name: 'I', kind: 'source', opened: true }] })[0]!.id,
      `${reviewCmd}:note:12:0`,
      `${reviewCmd}:take:0`,
      `${reviewCmd}:1:shows:bibleText@1:176`
    ];
    for (const id of longest) {
      expect(id.length).toBeLessThan(EVENT_FIELD_MAX_CHARS);
      expect(idAuthor(id)).toBe(ME);
    }
    expect(Math.max(...longest.map((id) => id.length))).toBeLessThan(180);
  });
});

describe('unboundId', () => {
  it('gives back what the author was put in front of', () => {
    expect(unboundId(newCommandId(ME, UNIQUE))).toBe(UNIQUE);
    expect(unboundId(newCommandId(OTHER, UNIQUE))).toBe(UNIQUE);
    expect(unboundId(UNIQUE)).toBe(UNIQUE);
    expect(unboundId('take:by:sam:x')).toBe('take:by:sam:x');
  });
});
