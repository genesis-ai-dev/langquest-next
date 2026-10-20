import fc from 'fast-check';
import type { AnyEvent } from '../src/events';
import * as core from '../src/index';
import {
  eventPassage, hangsOn, partEntries, passageInMemory, PASSAGE_PARTS, putEntry, READS_EVERY_PASSAGE, rowId, studyMarkUnit, withOwnParts, withoutParts
} from '../src/passageParts';
import { foldLanguage } from '../src/reducer';
import { emptyLanguageState, type LanguageState } from '../src/state';
import { buildFixture, buildRecordFixture, buildStep11Fixture } from './fixtures';

/**
 * Why: a phone that keeps a big language on disk (decisions.md 143) holds a
 * passage's part in memory only while a screen needs it. Events for a
 * passage that is not in memory are folded on their own and combined with
 * the stored copy later. If the combination differed from folding every
 * event together, a phone's record would drift from the server's.
 */
const language = [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture()];
// A redaction refolds from the log (SyncClient); it is never combined.
const redacted = new Set(language.flatMap((e) => (e.type === 'v1.Redacted' ? [e.id, e.payload.eventId] : [])));
const events = language.filter((e) => !redacted.has(e.id));
const fold = (es: AnyEvent[]) => foldLanguage(es, emptyLanguageState());
const whole = fold(events);

/** What two states hold of the maps cut by passage, combined entry by entry. */
function combined(a: LanguageState, b: LanguageState): LanguageState {
  const out = withOwnParts(a);
  for (const e of partEntries(b)) putEntry(out, e.part, rowId(e), e.value);
  return out;
}

const parts = (s: LanguageState) => Object.fromEntries(PASSAGE_PARTS.map((p) => [p.map, s[p.map] ?? {}]));

describe('a language cut by passage', () => {
  it('names every map of the state as cut by passage or shared by the whole language', () => {
    // A new map must say which it is: one that grows with a passage's work
    // and stays in memory whole defeats keeping a big language on disk.
    const shared = new Set([
      'units', 'blobs', 'audioFormats', 'appliedEventIds', 'invalidEvents', 'redactions', 'template', 'templateHistory',
      'hiddenUnits', 'bookNames', 'flow', 'teams', 'checkHelps', 'stepLinks', 'externalValues', 'materials', 'keyTerms',
      'reviewKinds', 'flowSteps', 'removedSteps', 'languageReferences', 'referenceLanguage'
    ]);
    const cut = new Set(PASSAGE_PARTS.map((p) => p.map as string));
    for (const key of Object.keys({ ...emptyLanguageState(), templateHistory: {}, bookNames: {}, checkHelps: {}, referenceLanguage: null })) {
      expect(shared.has(key) || cut.has(key), key).toBe(true);
      expect(shared.has(key) && cut.has(key), key).toBe(false);
    }
  });

  it('combines two halves of the events into what folding them all gives, however they are split', () => {
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: events.length, maxLength: events.length }), (side) => {
        const a = fold(events.filter((_, i) => side[i]));
        const b = fold(events.filter((_, i) => !side[i]));
        expect(parts(combined(a, b))).toEqual(parts(whole));
        expect(parts(combined(b, a))).toEqual(parts(whole));
      }),
      { numRuns: 200 }
    );
  });

  it('combines copies of one entry made by different events at the same and different clocks', () => {
    // The fixtures reuse a few ids; here every kind of entry collides.
    const ev = (id: string, type: string, payload: unknown, hlc: string, actorId = 't1') =>
      ({ id, type, orgId: 'o', streamId: 'L', actorId, deviceId: 'd', hlc, payload }) as AnyEvent;
    const colliding: AnyEvent[] = [
      ev('a1', 'v1.TakeComposed', { takeId: 'T', unitId: 'u1', cardHashes: ['h1'], parentTakeId: null }, '0002'),
      ev('a2', 'v1.TakeComposed', { takeId: 'T', unitId: 'u1', cardHashes: ['h2'], parentTakeId: null }, '0002', 't0'),
      ev('a3', 'v1.TakeArchived', { takeId: 'T' }, '0001'),
      ev('b1', 'v1.TakeSubmitted', { takeId: 'T', questionSetIds: ['q'] }, '0003'),
      ev('b2', 'v1.TakeSubmitted', { takeId: 'T' }, '0003', 't0'),
      ev('c1', 'v1.ResponseRecorded', { takeId: 'T', respondsToTakeId: 'S', note: 'x' }, '0004'),
      ev('c2', 'v1.ResponseRecorded', { takeId: 'T', respondsToTakeId: 'S', note: 'y' }, '0004'),
      ev('d1', 'v1.ReviewRecorded', { reviewId: 'R', takeId: 'T', kindId: 'peer', outcome: 'looks_good', via: 'app' }, '0005'),
      ev('d2', 'v1.ReviewRecorded', { reviewId: 'R', takeId: 'T', kindId: 'peer', outcome: 'needs_changes', via: 'app' }, '0005'),
      ev('e1', 'v1.DepartureRecorded', { departureId: 'D', unitId: 'u1', type: 'skip', kindId: 'peer', reason: 'a' }, '0006'),
      ev('e2', 'v1.DepartureUndone', { departureId: 'D' }, '0007', 't2'),
      ev('e3', 'v1.DepartureUndone', { departureId: 'D' }, '0007', 't1'),
      ev('f1', 'v1.RequestMade', { requestId: 'Q', unitId: 'u1', what: 'record', profileId: 'p' }, '0008'),
      ev('f2', 'v1.RequestWithdrawn', { requestId: 'Q' }, '0010'),
      ev('f3', 'v1.RequestWithdrawn', { requestId: 'Q' }, '0009'),
      ev('g1', 'v1.NoteAdded', { noteId: 'N', unitId: 'u1', anchor: { kind: 'passage' }, text: 'a' }, '0011'),
      ev('g2', 'v1.NoteAdded', { noteId: 'N', unitId: 'u1', anchor: { kind: 'passage' }, text: 'b' }, '0011'),
      ev('h1', 'v1.StudyStepMarked', { unitId: 'u1', guideId: 'fia:luke1', stepId: 's', done: true }, '0012'),
      ev('h2', 'v1.StudyStepMarked', { unitId: 'u1', guideId: 'fia:luke1', stepId: 's', done: false }, '0013'),
      ev('i1', 'v1.CardVerseSet', { unitId: 'u1', hash: 'h1', mark: 'next' }, '0014'),
      ev('i2', 'v1.CardVerseSet', { unitId: 'u1', hash: 'h1', mark: 'join' }, '0015'),
      ev('i3', 'v1.CardVerseSet', { unitId: 'u1', hash: 'h2', mark: 'join' }, '0015'),
      ev('j1', 'v1.PassageReferenceLinked', { unitId: 'u1', itemId: 'i', linked: true }, '0016'),
      ev('j2', 'v1.PassageReferenceLinked', { unitId: 'u1', itemId: 'i', linked: false }, '0016'),
      ev('k1', 'v1.ReferencesUsed', { unitId: 'u1', takeId: 'T', items: [{ itemId: 'i', name: 'a', kind: 'source', opened: false }] }, '0017'),
      ev('k2', 'v1.ReferencesUsed', { unitId: 'u1', takeId: 'T', items: [{ itemId: 'i', name: 'b', kind: 'source', opened: true }] }, '0018'),
      ev('l1', 'v1.KeyTermLinked', { takeId: 'T', termId: 'k', note: 'a' }, '0019'),
      ev('l2', 'v1.KeyTermLinked', { takeId: 'T', termId: 'k', note: 'b' }, '0019', 't0'),
      ev('m1', 'v1.VersionReleased', { takeId: 'T', channel: 'web', live: true }, '0020'),
      ev('m2', 'v1.VersionReleased', { takeId: 'T', channel: 'web', live: false }, '0021'),
      ev('n1', 'v1.RecordingAdded', { recordingId: 'r', unitId: 'u1', kind: 'target', cards: [{ hash: 'h1', durationMs: 1 }] }, '0022'),
      ev('n2', 'v1.RecordingAdded', { recordingId: 'r', unitId: 'u1', kind: 'target', cards: [{ hash: 'h2', durationMs: 1 }] }, '0021')
    ];
    const all = fold(colliding);
    fc.assert(
      fc.property(fc.array(fc.boolean(), { minLength: colliding.length, maxLength: colliding.length }), (side) => {
        const a = fold(colliding.filter((_, i) => side[i]));
        const b = fold(colliding.filter((_, i) => !side[i]));
        expect(parts(combined(a, b))).toEqual(parts(all));
      }),
      { numRuns: 300 }
    );
  });

  it('finds the passage of every entry, and of every event, from what the language holds', () => {
    for (const e of partEntries(whole)) {
      const of = e.part.passage(e.key, e.value as never, e.inner);
      const on = hangsOn(of);
      // What an entry hangs on may never have arrived (an undo of a departure
      // nobody recorded, a take archived before anyone composed it): it waits.
      const kinds: Record<string, keyof LanguageState> = { take: 'takes', review: 'kindReviews', departure: 'departures', request: 'requests', note: 'notes' };
      const target = on ? (whole[kinds[on.kind]!] as Record<string, { unitId?: string }>)[on.id] : undefined;
      if (on && (!target || target.unitId === '')) continue;
      expect(passageInMemory(whole, of), `${e.part.map} ${e.key}`).toBeTruthy();
    }
    for (const e of events) {
      const of = eventPassage(e);
      if (of === null || of === 'settings') continue;
      if ('unitId' in of) expect(of.unitId).toBeTruthy();
    }
  });

  it('reads a study mark\'s passage even when its guide id holds a colon', () => {
    const units = { 'a:b': {}, a: {} } as unknown as LanguageState['units'];
    expect(studyMarkUnit(units, 'a:b:fia:luke1:s1')).toBe('a:b');
    expect(studyMarkUnit(units, 'a:fia:luke1:s1')).toBe('a');
    expect(studyMarkUnit(units, 'z:fia:s1')).toBeNull();
  });

  it('a state without its parts keeps the rest of the language', () => {
    const rest = withoutParts(whole);
    for (const p of PASSAGE_PARTS) expect(rest[p.map]).toEqual({});
    expect(rest.units).toBe(whole.units);
  });
});

describe('what reads every passage', () => {
  // The app's guard (apps/mobile/test/wholeLanguage.test.ts) looks for these names: a rename must carry the list with it.
  it('names functions core exports', () => {
    for (const name of READS_EVERY_PASSAGE) expect(typeof (core as Record<string, unknown>)[name], name).toBe('function');
  });
});
