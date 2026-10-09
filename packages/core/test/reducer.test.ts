import type { AnyEvent, EventType } from '../src/events';
import { foldLanguage } from '../src/reducer';
import { referencedBlobs } from '../src/blobs';
import { EVENT_PRIVILEGE, foldOrg, emptyOrgState, ORG_EVENT_TYPES } from '../src/org';
import { derivePassage, languageProgress } from '../src/passage';
import { emptyLanguageState } from '../src/state';
import { buildFixture, buildOrgFixture, buildRecordFixture, buildStep11Fixture, shuffle } from './fixtures';

/** Every event type in the catalog: `EVENT_PRIVILEGE` must name each one, so this list cannot drift. */
const CATALOG = Object.keys(EVENT_PRIVILEGE) as EventType[];
const ORG_TYPES = new Set<EventType>(ORG_EVENT_TYPES);

describe('reducer invariants (PLAN.md section 4)', () => {
  const language = [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture()];
  const org = buildOrgFixture();
  const canonical = foldLanguage(language, emptyLanguageState());
  const canonicalOrg = foldOrg(org, emptyOrgState());

  it('fixtures exercise every event type in the catalog, each in its own stream', () => {
    const seen = new Set([...language, ...org].map((e) => e.type));
    for (const type of CATALOG) expect(seen.has(type), type).toBe(true);
    for (const e of language) expect(ORG_TYPES.has(e.type as never) && e.type !== 'v1.Redacted', e.type).toBe(false);
    for (const e of org) expect(ORG_TYPES.has(e.type as never) || e.type === 'v1.Redacted', e.type).toBe(true);
  });

  it('invariant 2: any permutation folds to the same state', () => {
    // Why: two devices offline for a month apply each other's events in
    // whatever order the sync delivers them. If order changed the answer,
    // teams would see different approval states on different phones.
    for (let seed = 1; seed <= 200; seed++) {
      expect(foldLanguage(shuffle(language, seed), emptyLanguageState())).toEqual(canonical);
      expect(foldOrg(shuffle(org, seed), emptyOrgState())).toEqual(canonicalOrg);
    }
  });

  it('invariant 3: applying every event twice equals applying once', () => {
    // Why: the sync layer is at-least-once. Redelivery must be harmless.
    expect(foldLanguage([...language, ...shuffle(language, 7)], emptyLanguageState())).toEqual(canonical);
    expect(foldOrg([...org, ...shuffle(org, 7)], emptyOrgState())).toEqual(canonicalOrg);
  });

  it('register semantics: later HLC wins for the same key, earliest for grow-only', () => {
    expect(canonical.reviewKinds['elder']?.value.name).toBe('Elders Review');
    expect(canonical.flowSteps['standard_bible/s4']?.value.kindIds).toEqual(['final', 'elder']);
    expect(canonical.hiddenUnits['langquest.fia-eng/GEN.2.4-25']?.value).toBe(false);
    expect(canonical.studyMarks['luke1:fia:luke1:hear']?.value.done).toBe(false);
    expect(canonicalOrg.languages['L1']?.added?.name).toBe('Dinka');
    expect(canonicalOrg.languages['L1']?.renamed?.value).toBe('Dinka');
  });

  it('create-once ids used twice: the earliest stands, and a tie is settled by author and content', () => {
    // Why: `??=` kept whichever arrived first, so two phones could disagree
    // on a unit's label or a key term's gloss for good.
    expect(canonical.units['luke']?.label).toBe('Luke');
    expect(canonical.units['luke-intro']?.label).toBe('Intro');
    expect(canonical.keyTerms['kt-logos']?.gloss).toBe('The eternal Word of God');
    expect(canonical.keyTerms['kt-pneuma']?.gloss).toBe('Breath, wind');
    expect(canonical.keyTermLinks['take2']?.['kt-logos']?.note).toBe('Used the divine sense.');
    expect(canonical.keyTermLinks['take2']?.['kt-sarx']?.note).toBe('Body sense.');
  });

  it('same-clock ties in submissions, materials, invites and join decisions are settled by author and content', () => {
    // Why: these compared clocks only, so at an equal clock whichever
    // arrived first stayed, and two phones could keep different answers.
    expect(canonical.submissions['take1']?.questionSetIds).toEqual(['q-luke1']);
    expect(canonical.materials['notes-luke']).toMatchObject({ title: 'Notes on Luke', createdBy: 'lead' });
    expect(canonicalOrg.invites['inv2']?.roleId).toBe('reviewer');
    expect(canonicalOrg.joinDecisions['jr2']?.accepted).toBe(false);
  });

  it('a redaction of a redaction is ignored, in any order', () => {
    // Why: redactions fold first, in arrival order; if one could cancel
    // another, which one stood would depend on that order.
    const redactions = language.filter((e): e is Extract<AnyEvent, { type: 'v1.Redacted' }> => e.type === 'v1.Redacted');
    const others = language.filter((e) => e.type !== 'v1.Redacted');
    expect(redactions.some((r) => redactions.some((t) => t.id === r.payload.eventId))).toBe(true);
    for (const order of [redactions, [...redactions].reverse()]) {
      expect(foldLanguage([...order, ...others], emptyLanguageState()).recordings['recWrong']).toBeUndefined();
    }
  });

  it('a removed step stays removed, whatever clock sets it later (add-wins)', () => {
    expect(canonical.removedSteps['standard_bible/s9']).toBe(true);
    expect(canonical.removedSteps['quick_check/extra']).toBe(true);
  });

  it('add-wins: an archive that arrives before its compose still sticks', () => {
    const archiveFirst = language.filter(
      (e) => e.type === 'v1.TakeArchived' || (e.type === 'v1.TakeComposed' && e.payload.takeId === 'take1')
    );
    const order = [...archiveFirst].sort((a) => (a.type === 'v1.TakeArchived' ? -1 : 1));
    const state = foldLanguage(order, emptyLanguageState());
    expect(state.takes['take1']?.archived).toBe(true);
    expect(state.takes['take1']?.cardHashes).toEqual(['c1', 'c2']);
  });

  it('unknown event types are ignored, not thrown', () => {
    // Why: an older app must keep folding when a newer app emits v2 events.
    const future = { ...language[0]!, id: 'zz', type: 'v9.Something' } as never;
    expect(() => foldLanguage([...language, future], emptyLanguageState())).not.toThrow();
    expect(() => foldOrg([...org, future], emptyOrgState())).not.toThrow();
  });
});

describe('reducer tie-breaking', () => {
  it('two events with an identical clock fold the same in either order', () => {
    // Why: node ids are supposed to make clocks unique, but a bug that
    // gives every device the same id must not make state order-dependent.
    const base = buildFixture()[0]!;
    const hlc = '000000000002000:000000:same';
    const x = { ...base, id: 'x', hlc, type: 'v1.FlowSelected', payload: { flowId: 'quick_check' } } as AnyEvent;
    const y = { ...base, id: 'y', hlc, type: 'v1.FlowSelected', payload: { flowId: 'standard_bible' } } as AnyEvent;
    expect(foldLanguage([x, y], emptyLanguageState()).flow).toEqual(foldLanguage([y, x], emptyLanguageState()).flow);
  });
});

describe('reducer survives bad input (invariant: one bad event never bricks a language)', () => {
  it('skips a malformed event, counts it, and derived views still work', () => {
    const events = buildFixture();
    const rec = events.find((e) => e.type === 'v1.RecordingAdded')!;
    const bad = { ...rec, id: 'bad1', payload: { recordingId: 'recX', unitId: 'luke1', kind: 'target' } } as never;
    const state = foldLanguage([...events, bad], emptyLanguageState());
    expect(state.invalidEvents['bad1']).toMatch(/cards/);
    expect(state.recordings['recX']).toBeUndefined();
    expect(() => referencedBlobs(state)).not.toThrow();
    expect(() => derivePassage(state, 'luke1')).not.toThrow();
    expect(() => languageProgress(state)).not.toThrow();
  });

  it('a redaction removes the target whether it arrives before or after it', () => {
    // Why: wrong recordings, sensitive content, data requests. The log is
    // append-only, so removal is itself an event, and it must commute.
    const events = buildFixture();
    const rec = events.find((e) => e.type === 'v1.RecordingAdded')!;
    const redact = { ...rec, id: 'rd1', type: 'v1.Redacted', payload: { eventId: rec.id, reason: 'wrong passage' } } as never;
    const others = events.filter((e) => e.id !== rec.id && e.type !== 'v1.Redacted');
    const after = foldLanguage([...others, rec, redact], emptyLanguageState());
    const before = foldLanguage([...others, redact, rec], emptyLanguageState());
    expect(after.recordings[(rec.payload as { recordingId: string }).recordingId]).toBeUndefined();
    expect(before.recordings[(rec.payload as { recordingId: string }).recordingId]).toBeUndefined();
    expect(before.redactions[rec.id]).toBe(true);
    expect(stripApplied(after)).toEqual(stripApplied(before));
  });
});

function stripApplied(state: ReturnType<typeof emptyLanguageState>) {
  const { appliedEventIds: _ignored, ...rest } = state;
  return rest;
}
