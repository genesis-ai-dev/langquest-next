import fc from 'fast-check';
import type { AnyEvent, EventType } from '../src/events';
import { markChanged, publishedCopy } from '../src/changes';
import { dropEntry, PASSAGE_PART, putEntry } from '../src/passageParts';
import { buildIndexes, indexesOf } from '../src/indexes';
import { EVENT_PRIVILEGE, ORG_EVENT_TYPES } from '../src/org';
import { derivePassage, updatesFor } from '../src/passage';
import { highlightsFor, languageProgress, unitsAskedOf, upNext, waitingOn } from '../src/passageLines';
import { applyLanguageEvent, foldLanguage } from '../src/reducer';
import { instantiateFlow } from '../src/record';
import { emptyLanguageState, type LanguageState } from '../src/state';
import { buildFixture, buildRecordFixture, buildStep11Fixture } from './fixtures';

/**
 * The views a published copy gets from the copy before it, redoing only the
 * passages the events since touched (performance-audit-app.md C1), must be
 * exactly what a full rebuild gives.
 */

const hlc = (n: number, device: string) => `${String(1_765_000_000_000 + n * 1000).padStart(15, '0')}:000000:${device}`;

/**
 * Several passages with the cases a per-passage patch could get wrong: a
 * draft whose parent is in another passage, records that arrive before the
 * take or departure they name, create-once ids used twice, a team request
 * whose team changes, change notes, equal clocks, an invalid event and a
 * redaction.
 */
function crossPassageEvents(): AnyEvent[] {
  const events: AnyEvent[] = [];
  let n = 0;
  const e = (actorId: string, type: EventType, payload: unknown, at?: number, device = actorId) => {
    n += 1;
    events.push({ id: `xp${String(n).padStart(3, '0')}`, type, orgId: 'org1', streamId: 'L1', actorId, deviceId: device, hlc: hlc(at ?? n, device), payload, serverSeq: 2000 + n } as AnyEvent);
    return events.at(-1)!;
  };
  for (const u of ['u1', 'u2', 'u3']) e('lead', 'v1.UnitAdded', { unitId: u, parentUnitId: null, kind: 'passage', label: u.toUpperCase(), order: `z${u}` });
  e('t1', 'v1.TakeComposed', { takeId: 'tA1', unitId: 'u1', cardHashes: ['h1'], parentTakeId: null });
  e('t1', 'v1.TakeComposed', { takeId: 'tA2', unitId: 'u1', cardHashes: ['h1', 'h2'], parentTakeId: 'tA1' });
  e('t2', 'v1.TakeComposed', { takeId: 'tB1', unitId: 'u2', cardHashes: ['h3'], parentTakeId: 'tA1' });
  e('t2', 'v1.TakeComposed', { takeId: 'tB2', unitId: 'u2', cardHashes: [], parentTakeId: 'tB1' });
  e('t1', 'v1.TakeComposed', { takeId: 'tC1', unitId: 'u3', cardHashes: ['h4'], parentTakeId: 'tX' });
  // The same take id composed again for another passage, later: it loses.
  e('t2', 'v1.TakeComposed', { takeId: 'tA1', unitId: 'u2', cardHashes: ['h9'], parentTakeId: null });
  e('t1', 'v1.TakeSubmitted', { takeId: 'tA1' });
  e('t2', 'v1.TakeSubmitted', { takeId: 'tB1' });
  e('t1', 'v1.TakeSubmitted', { takeId: 'tA2' });
  e('t1', 'v1.TakeSubmitted', { takeId: 'tC1' });
  e('t2', 'v1.TakeSubmitted', { takeId: 'tC1' }, 1);
  e('t1', 'v1.TakeSubmitted', { takeId: 'tX' });
  e('t1', 'v1.TakeArchived', { takeId: 'tA2' });
  e('t1', 'v1.TakeArchived', { takeId: 'tZ' });
  e('t1', 'v1.TakeComposed', { takeId: 'tZ', unitId: 'u3', cardHashes: ['h5'], parentTakeId: null });
  e('t1', 'v1.ResponseRecorded', { takeId: 'tA2', respondsToTakeId: 'tA1', note: 'Fixed verse 2.' });
  e('r1', 'v1.ReviewRecorded', { reviewId: 'rx1', takeId: 'tA1', kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Verse 2' });
  e('r2', 'v1.ReviewRecorded', { reviewId: 'rx2', takeId: 'tB1', kindId: 'peer', outcome: 'looks_good', via: 'app' });
  e('r2', 'v1.ReviewRecorded', { reviewId: 'rx2', takeId: 'tA1', kindId: 'final', outcome: 'looks_good', via: 'app' }, 2);
  e('r1', 'v1.ReviewRecorded', { reviewId: 'rx3', takeId: 'tQ', kindId: 'community', outcome: 'needs_changes', via: 'logged' });
  e('t2', 'v1.TakeComposed', { takeId: 'tQ', unitId: 'u3', cardHashes: ['h6'], parentTakeId: 'tC1' });
  e('t2', 'v1.TakeSubmitted', { takeId: 'tQ' });
  e('t1', 'v1.DepartureRecorded', { departureId: 'dx1', unitId: 'u1', type: 'keep', reviewId: 'rx1', reason: 'It is right.' });
  e('t2', 'v1.DepartureRecorded', { departureId: 'dx2', unitId: 'u2', type: 'skip', kindId: 'peer', reason: 'Nobody to ask.' });
  e('t2', 'v1.DepartureUndone', { departureId: 'dx2' });
  e('t2', 'v1.DepartureUndone', { departureId: 'dx3' });
  e('lead', 'v1.DepartureRecorded', { departureId: 'dx3', unitId: 'u3', type: 'skip', kindId: 'peer', reason: 'Later.' });
  e('lead', 'v1.DepartureRecorded', { departureId: 'dx1', unitId: 'u2', type: 'skip', kindId: 'final', reason: 'Same id, earlier.' }, 3);
  e('lead', 'v1.ReviewTeamDefined', { teamId: 'teamX', name: 'Readers' });
  e('lead', 'v1.ReviewTeamMemberSet', { teamId: 'teamX', profileId: 'r1', member: true });
  e('lead', 'v1.RequestMade', { requestId: 'qx1', unitId: 'u1', what: 'review', kindId: 'peer', profileId: 'r1' });
  e('lead', 'v1.RequestMade', { requestId: 'qx2', unitId: 'u2', what: 'record', teamId: 'teamX' });
  e('lead', 'v1.ReviewTeamMemberSet', { teamId: 'teamX', profileId: 'r2', member: true });
  e('lead', 'v1.RequestWithdrawn', { requestId: 'qx1' });
  e('t1', 'v1.RequestWithdrawn', { requestId: 'qx3' });
  e('t1', 'v1.RequestMade', { requestId: 'qx3', unitId: 'u3', what: 'review', kindId: 'peer', profileId: 't2', dueDate: '2026-12-01' });
  e('r2', 'v1.RequestMade', { requestId: 'qx4', unitId: 'u1', what: 'record', profileId: 't1' });
  e('r2', 'v1.RequestMade', { requestId: 'qx4', unitId: 'u3', what: 'review', kindId: 'final', profileId: 't2' }, 4);
  e('t1', 'v1.NoteAdded', { noteId: 'nx1', unitId: 'u1', anchor: { kind: 'passage' }, text: 'Check the name.' });
  e('t1', 'v1.NoteAdded', { noteId: 'nx2', unitId: 'u1', anchor: { kind: 'version', takeId: 'tA2', role: 'change' }, text: 'Re-recorded.' });
  e('t2', 'v1.NoteAdded', { noteId: 'nx3', unitId: 'u1', anchor: { kind: 'version', takeId: 'tA2', role: 'change' }, text: 'Earlier change note.' }, 5);
  e('t2', 'v1.NoteAdded', { noteId: 'nx4', unitId: 'u2', anchor: { kind: 'version', takeId: 'tR', role: 'change' }, text: 'Before its take.' });
  e('t2', 'v1.NoteAdded', { noteId: 'nx1', unitId: 'u2', anchor: { kind: 'passage' }, text: 'Same id, earlier.' }, 6);
  e('t2', 'v1.TakeComposed', { takeId: 'tR', unitId: 'u2', cardHashes: ['h7'], parentTakeId: 'tB1' });
  e('t2', 'v1.TakeSubmitted', { takeId: 'tR' });
  // Two drafts in two passages at one clock: the order of My Work rests on ids, not on how the indexes were built.
  e('t1', 'v1.TakeComposed', { takeId: 'tS1', unitId: 'u1', cardHashes: ['h8'], parentTakeId: 'tA2' }, 900, 'dS');
  e('t1', 'v1.TakeComposed', { takeId: 'tS2', unitId: 'u2', cardHashes: ['h8'], parentTakeId: null }, 900, 'dS');
  e('t1', 'v1.RecordingAdded', { recordingId: 'rcx1', unitId: 'u1', kind: 'target', cards: [{ hash: 'h1', durationMs: 900 }] });
  e('service', 'v1.BlobStored', { hash: 'h1', size: 100 });
  e('t1', 'v1.TakeComposed', { takeId: 'tBad', cardHashes: ['h1'], parentTakeId: null });
  const target = e('t2', 'v1.NoteAdded', { noteId: 'nx5', unitId: 'u2', anchor: { kind: 'passage' }, text: 'Redacted later.' });
  e('lead', 'v1.Redacted', { eventId: target.id, reason: 'mistake' });
  return events;
}

const POOL: AnyEvent[] = [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture(), ...crossPassageEvents()];
const ACTORS = ['lead', 'lead2', 't1', 't2', 'r1', 'r2', 'r3', 'bt1'];
const ORG_TYPES = new Set<string>(ORG_EVENT_TYPES);

/** Every view that reads the record indexes, as one comparable value. `units` limits the passages asked for. */
function views(state: LanguageState, units: readonly string[], idx = indexesOf(state)) {
  return {
    indexes: idx,
    passages: units.map((u) => derivePassage(state, u, idx)),
    progress: languageProgress(state, idx),
    people: ACTORS.map((a) => ({
      highlights: highlightsFor(state, a, { canRecord: true, canReview: true }, idx),
      updates: updatesFor(state, a, idx),
      asked: [...unitsAskedOf(state, a, idx)],
      waiting: waitingOn(state, a, idx),
      upNext: upNext(state, { canRecord: a.startsWith('t'), canReview: !a.startsWith('t') }, idx)
    }))
  };
}

/** The same views from nothing: a plain copy no cache has seen. */
function rebuilt(reference: LanguageState, units: readonly string[]) {
  const fresh = { ...reference };
  return views(fresh, units, buildIndexes(fresh));
}

const unitsOf = (s: LanguageState) => [...new Set([...Object.keys(s.units), ...Object.values(s.takes).map((t) => t.unitId), 'ghost'])].sort();

type Step = 'skip' | 'publish' | 'partial' | 'live' | 'unviewed' | 'stale';

describe('passage views carried from one published copy to the next', () => {
  it('the pool has every language event type in the catalog', () => {
    const seen = new Set(POOL.map((e) => e.type));
    for (const type of Object.keys(EVENT_PRIVILEGE)) if (!ORG_TYPES.has(type) || type === 'v1.Redacted') expect(seen.has(type as EventType), type).toBe(true);
  });

  it('the cross-passage events are valid, but the one meant not to be', () => {
    const state = foldLanguage(crossPassageEvents(), emptyLanguageState());
    expect(Object.keys(state.invalidEvents)).toHaveLength(1);
  });

  it('equal a full rebuild after every event, in any order, with repeats, however often the app publishes', () => {
    // Why: the app renders every change from a copy whose views were patched
    // from the copy before. A patch that misses a passage shows a stale
    // state (a version not there, a review not counted) until the next
    // refold, and nothing else would notice.
    const steps = fc.constantFrom<Step>('skip', 'publish', 'publish', 'partial', 'live', 'unviewed', 'stale');
    // Every event once, in a random order, plus random repeats; a step after each.
    const order = fc
      .tuple(fc.shuffledSubarray(POOL.map((_, i) => i), { minLength: POOL.length, maxLength: POOL.length }), fc.array(fc.nat(POOL.length - 1), { maxLength: POOL.length }))
      .chain(([all, extra]) => fc.shuffledSubarray([...all, ...extra], { minLength: all.length + extra.length, maxLength: all.length + extra.length }));
    fc.assert(
      fc.property(
        order.chain((o) => fc.tuple(fc.array(steps, { minLength: o.length, maxLength: o.length }), fc.array(fc.nat(), { minLength: o.length, maxLength: o.length })).map(([s, seeds]) => o.map((i, k) => [i, s[k]!, seeds[k]!] as const))),
        (plan) => {
          const live = emptyLanguageState();
          const reference = emptyLanguageState();
          let previous: LanguageState | null = null;
          for (const [i, step, seed] of plan) {
            applyLanguageEvent(live, POOL[i]!);
            applyLanguageEvent(reference, POOL[i]!);
            const units = unitsOf(reference);
            if (step === 'skip') continue;
            if (step === 'unviewed') {
              // Published, but no screen draws it before the next change.
              previous = publishedCopy(live);
              continue;
            }
            if (step === 'stale') {
              // A screen still showing the last copy reads it after the fold moved on (not compared: it is behind).
              if (previous) views(previous, units);
              continue;
            }
            const state = step === 'live' ? live : publishedCopy(live);
            const asked = step === 'partial' ? units.filter((_, k) => (seed >> (k % 30)) & 1) : units;
            expect(views(state, asked)).toEqual(rebuilt(reference, asked));
            if (step !== 'live') previous = state;
          }
          const last = publishedCopy(live);
          const units = unitsOf(reference);
          expect(views(last, units)).toEqual(rebuilt(reference, units));
        }
      ),
      { numRuns: 25 }
    );
  });
});

/** A language of `passages` passages, each recorded twice and reviewed (like `npm run bench:core`). */
function bigLanguage(passages: number): AnyEvent[] {
  const events: AnyEvent[] = [];
  let n = 0;
  const push = (type: EventType, payload: unknown, actorId = 't1', device = 'dA') => {
    n += 1;
    events.push({ id: `big${n}`, type, orgId: 'o', streamId: 'L1', actorId, deviceId: device, hlc: hlc(n, device), payload, serverSeq: n } as AnyEvent);
  };
  push('v1.FlowSelected', { flowId: 'standard_bible', name: 'Standard Bible Flow' }, 'lead');
  for (const s of instantiateFlow('standard_bible')) push('v1.FlowStepSet', s, 'lead');
  for (let p = 0; p < passages; p++) {
    const unitId = `p${p}`;
    push('v1.UnitAdded', { unitId, parentUnitId: null, kind: 'passage', label: `P ${p}`, order: `p${String(p).padStart(5, '0')}` }, 'lead');
    for (let t = 0; t < 2; t++) {
      push('v1.TakeComposed', { takeId: `k${p}-${t}`, unitId, cardHashes: [`c${p}-${t}`], parentTakeId: t ? `k${p}-0` : null });
      push('v1.TakeSubmitted', { takeId: `k${p}-${t}` });
      push('v1.ReviewRecorded', { reviewId: `rv${p}-${t}`, takeId: `k${p}-${t}`, kindId: 'peer', outcome: t ? 'looks_good' : 'needs_changes', via: 'app' }, 'r1', 'dR');
    }
  }
  return events;
}

const event = (id: string, type: EventType, payload: unknown, at: number, actorId = 't1'): AnyEvent =>
  ({ id, type, orgId: 'o', streamId: 'L1', actorId, deviceId: 'dZ', hlc: hlc(at, 'dZ'), payload, serverSeq: 0 }) as AnyEvent;

describe('one change re-derives only what it touched', () => {
  const PASSAGES = 1500;
  const live = foldLanguage(bigLanguage(PASSAGES), emptyLanguageState());
  const units = Object.keys(live.units);
  let at = 100_000;

  /** Publish a copy and read the language's progress on it, as the Map does. */
  const publish = () => {
    const copy = publishedCopy(live);
    languageProgress(copy, indexesOf(copy));
    return copy;
  };
  /** The passages whose view object is not the one the copy before had. */
  const recomputed = (before: LanguageState, after: LanguageState) =>
    units.filter((u) => derivePassage(after, u, indexesOf(after)) !== derivePassage(before, u, indexesOf(before)));

  it('a new take re-derives its passage and no other, and still equals a full rebuild', () => {
    const before = publish();
    applyLanguageEvent(live, event('one-take', 'v1.TakeComposed', { takeId: 'new-take', unitId: 'p700', cardHashes: ['cx'], parentTakeId: 'k700-1' }, at++));
    const after = publish();
    expect(recomputed(before, after)).toEqual(['p700']);
    expect(indexesOf(after)).toBe(indexesOf(before));
    expect(derivePassage(after, 'p700').drafting).toBe(true);
    expect(languageProgress(after)).toEqual(languageProgress({ ...live }, buildIndexes(live)));
  });

  it('a review re-derives the passage of the version it heard', () => {
    const before = publish();
    applyLanguageEvent(live, event('one-review', 'v1.ReviewRecorded', { reviewId: 'rv-new', takeId: 'k42-1', kindId: 'community', outcome: 'looks_good', via: 'app' }, at++, 'r2'));
    const after = publish();
    expect(recomputed(before, after)).toEqual(['p42']);
    expect(derivePassage(after, 'p42')).toEqual(derivePassage({ ...live }, 'p42', buildIndexes(live)));
  });

  it('audio landing re-derives nothing', () => {
    const before = publish();
    applyLanguageEvent(live, event('one-blob', 'v1.BlobStored', { hash: 'c1-1', size: 10 }, at++, 'service'));
    applyLanguageEvent(live, event('one-recording', 'v1.RecordingAdded', { recordingId: 'rc-new', unitId: 'p3', kind: 'target', cards: [{ hash: 'cy', durationMs: 900 }] }, at++));
    const after = publish();
    expect(recomputed(before, after)).toEqual([]);
  });

  it('a new unit rebuilds the indexes and every passage', () => {
    const before = publish();
    applyLanguageEvent(live, event('one-unit', 'v1.UnitAdded', { unitId: 'p-new', parentUnitId: null, kind: 'passage', label: 'New', order: 'q' }, at++, 'lead'));
    const after = publish();
    expect(indexesOf(after)).not.toBe(indexesOf(before));
    expect(recomputed(before, after)).toHaveLength(units.length);
    expect(indexesOf(after)).toEqual(buildIndexes(live));
  });

  it('records a phone lets go of, or brings back from disk, rebuild every passage, and equal a full rebuild', () => {
    // Why: a language kept on disk (decisions.md 143) takes passages' records out of the live state at a
    // checkpoint and puts them back when a screen opens the passage, with no event. A view carried from the
    // copy before would still show them, or still miss them: `markChanged` must count as an `all` touch.
    const [takeId, take] = Object.entries(live.takes).find(([, t]) => t.unitId === 'p800')!;
    const sub = live.submissions[takeId];
    const before = publish();
    expect(derivePassage(before, 'p800').versions.some((v) => v.takeId === takeId) || !sub).toBe(true);
    dropEntry(live, PASSAGE_PART.takes, takeId);
    if (sub) dropEntry(live, PASSAGE_PART.submissions, takeId);
    markChanged(live);
    const shed = publish();
    expect(recomputed(before, shed)).toHaveLength(units.length);
    expect(derivePassage(shed, 'p800')).toEqual(derivePassage({ ...live }, 'p800', buildIndexes(live)));
    expect(languageProgress(shed)).toEqual(languageProgress({ ...live }, buildIndexes(live)));

    putEntry(live, PASSAGE_PART.takes, takeId, take);
    if (sub) putEntry(live, PASSAGE_PART.submissions, takeId, sub);
    markChanged(live);
    const back = publish();
    expect(derivePassage(back, 'p800')).toEqual(derivePassage(before, 'p800'));
    expect(derivePassage(back, 'p800')).toEqual(derivePassage({ ...live }, 'p800', buildIndexes(live)));
  });

  it('a long catch-up between two copies rebuilds, and equals a full rebuild', () => {
    publish();
    for (let i = 0; i < 1200; i++) {
      applyLanguageEvent(live, event(`catch-up-${i}`, 'v1.TakeComposed', { takeId: `cu-${i}`, unitId: `p${i}`, cardHashes: ['cz'], parentTakeId: null }, at++));
    }
    const after = publish();
    expect(languageProgress(after)).toEqual(languageProgress({ ...live }, buildIndexes(live)));
    expect(derivePassage(after, 'p5')).toEqual(derivePassage({ ...live }, 'p5', buildIndexes(live)));
  });
});
