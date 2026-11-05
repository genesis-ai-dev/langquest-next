import type { AnyEvent, EventPayloads, EventType } from '../src/events';
import { encodeHlc } from '../src/hlc';
import { approvedVersion, derivePassage, releasesOf, stepAllowsLinks } from '../src/passage';
import { foldLanguage } from '../src/reducer';
import { validateEvent } from '../src/validate';

/**
 * What leaves the team (decisions.md 72). A listening app plays, and a
 * partner releases, only a version someone actually approved; a review
 * through a shared link (recorded by whoever shared it) never clears a
 * checkpoint; and a release is a fact per version and channel.
 */

type Extra = [EventType, unknown, number?];

/** One passage, version t1, in a flow of a peer step then a consultant checkpoint. */
function fold(...extra: Extra[]) {
  let n = 0;
  const ev = (type: EventType, payload: unknown, at?: number): AnyEvent => {
    n += 1;
    return { id: `e${n}`, type, orgId: 'o', streamId: 'L', actorId: 'p', deviceId: 'd', hlc: encodeHlc(at ?? 1_700_000_000_000 + n * 1000, 0, 'd'), payload } as AnyEvent;
  };
  const state = foldLanguage([
    ev('v1.FlowSelected', { flowId: 'f', name: 'F' }),
    ev('v1.FlowStepSet', { stepId: 'f/s1', order: 's00', kindIds: ['peer'], checkpoint: false }),
    ev('v1.FlowStepSet', { stepId: 'f/s2', order: 's01', kindIds: ['consultant'], checkpoint: true }),
    ev('v1.UnitAdded', { unitId: 'u', parentUnitId: null, kind: 'passage', label: 'U', order: 'a' }),
    ev('v1.TakeComposed', { takeId: 't1', unitId: 'u', cardHashes: ['a'.repeat(64)], parentTakeId: null }),
    ev('v1.TakeSubmitted', { takeId: 't1' }),
    ...extra.map(([type, payload, at]) => ev(type, payload, at))
  ]);
  return { state, s: derivePassage(state, 'u') };
}

const review = (reviewId: string, takeId: string, kindId: string, outcome: 'looks_good' | 'needs_changes', via: 'app' | 'link' | 'logged' = 'app'): Extra =>
  ['v1.ReviewRecorded', { reviewId, takeId, kindId, outcome, via }];
const v2: Extra[] = [
  ['v1.TakeComposed', { takeId: 't2', unitId: 'u', cardHashes: ['b'.repeat(64)], parentTakeId: 't1' }],
  ['v1.TakeSubmitted', { takeId: 't2' }]
];
const approvedT1 = [review('r1', 't1', 'peer', 'looks_good'), review('r2', 't1', 'consultant', 'looks_good')];

describe('approvedVersion', () => {
  it('is the version reviews approved, not newer audio nobody has heard', () => {
    const { s } = fold(...approvedT1, ...v2);
    // The team view still calls the passage done: each kind's latest review approves.
    expect(s.done).toBe(true);
    expect(approvedVersion(s)?.takeId).toBe('t1');
  });

  it('does not count a revision that answered feedback as approved', () => {
    const { s } = fold(review('r1', 't1', 'peer', 'needs_changes'), review('r2', 't1', 'consultant', 'looks_good'), ...v2);
    expect(approvedVersion(s)).toBeNull();
  });

  it('is gone when a reviewer withdraws approval of that version', () => {
    expect(approvedVersion(fold(...approvedT1, review('r3', 't1', 'peer', 'needs_changes')).s)).toBeNull();
  });
});

describe('a review through a shared link', () => {
  it('completes an ordinary step but never a checkpoint, whoever recorded it', () => {
    const { s } = fold(review('r1', 't1', 'peer', 'looks_good', 'link'), review('r2', 't1', 'consultant', 'looks_good', 'link'));
    expect(s.steps.map((st) => st.complete)).toEqual([true, false]);
    expect(s.done).toBe(false);
    expect(approvedVersion(s)).toBeNull();
  });

  it('may be shared for any step but a checkpoint, unless the language says otherwise', () => {
    const { state, s } = fold();
    expect(s.flow.steps.map((st) => stepAllowsLinks(state, st))).toEqual([true, false]);
    const changed = fold(['v1.FlowStepLinksSet', { stepId: 'f/s1', allowed: false }], ['v1.FlowStepLinksSet', { stepId: 'f/s2', allowed: true }]);
    expect(changed.s.flow.steps.map((st) => stepAllowsLinks(changed.state, st))).toEqual([false, true]);
  });
});

describe('releasesOf', () => {
  it('names the newest version live on each channel, whatever order the reports arrive in', () => {
    const late = 1_800_000_000_000;
    const { state, s } = fold(...approvedT1, ...v2,
      ['v1.VersionReleased', { takeId: 't2', channel: 'EL app', live: true }],
      ['v1.VersionReleased', { takeId: 't1', channel: 'EL app', live: true, url: 'https://el.example/1' }],
      // Taken down later on the website, live on the website before that.
      ['v1.VersionReleased', { takeId: 't1', channel: 'website', live: false }, late],
      ['v1.VersionReleased', { takeId: 't1', channel: 'website', live: true }, late - 1]);
    expect(releasesOf(state, s).map((r) => [r.channel, r.versionN])).toEqual([['EL app', 2]]);
  });

  it('takes a review voice clip pinned to a moment, as a whole number of ms', () => {
    const base = { id: 'x', orgId: 'o', streamId: 'L', actorId: 'p', deviceId: 'd', hlc: encodeHlc(1, 0, 'd') };
    const check = (atMs: unknown) => validateEvent({ ...base, type: 'v1.ReviewRecorded', payload: {
      reviewId: 'r', takeId: 't1', kindId: 'listener', outcome: 'needs_changes', via: 'link', artifacts: [{ hash: 'h', durationMs: 900, format: 'm4a', atMs }]
    } } as AnyEvent);
    expect(check(undefined)).toBeNull();
    expect(check(41_500)).toBeNull();
    for (const bad of [-1, 1.5, '3', null]) expect(check(bad)).not.toBeNull();
  });

  it('refuses a release without a channel or a yes or no', () => {
    const base = { id: 'x', orgId: 'o', streamId: 'L', actorId: 'p', deviceId: 'd', hlc: encodeHlc(1, 0, 'd') };
    const check = (payload: Partial<EventPayloads['v1.VersionReleased']>) => validateEvent({ ...base, type: 'v1.VersionReleased', payload } as AnyEvent);
    expect(check({ takeId: 't1', channel: 'EL app', live: true })).toBeNull();
    expect(check({ takeId: 't1', live: true })).not.toBeNull();
    expect(check({ takeId: 't1', channel: 'EL app' })).not.toBeNull();
  });
});
