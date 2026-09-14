import { fold } from '../src/reducer';
import { resume, takeSnapshot } from '../src/snapshot';
import { emptyState } from '../src/state';
import { buildFixture, shuffle } from './fixtures';

describe('snapshot + tail equals full fold (PLAN.md invariant 10)', () => {
  const events = buildFixture();
  const full = fold(events, emptyState());

  it('resuming from a mid-history snapshot reproduces the full state', () => {
    // Why: a new phone must not replay a year of events. Snapshot at N plus
    // events after N has to be indistinguishable from folding everything.
    const cut = Math.floor(events.length / 2);
    const snapshot = takeSnapshot('org1', 'p1', events.slice(0, cut));
    const resumed = resume(snapshot, shuffle(events, 3));
    expect(stripIds(resumed)).toEqual(stripIds(full));
  });

  it('pending events (no serverSeq) are always applied on resume', () => {
    const snapshot = takeSnapshot('org1', 'p1', events);
    const { serverSeq: _seq, ...last } = events[events.length - 1]!;
    const pending = { ...last, id: 'local1' } as (typeof events)[number];
    const resumed = resume(snapshot, [pending]);
    expect(resumed.appliedEventIds['local1']).toBe(true);
  });

  it('refuses a snapshot from a different reducer version', () => {
    const snapshot = { ...takeSnapshot('org1', 'p1', events), reducerVersion: 0 };
    expect(() => resume(snapshot, [])).toThrow(/reducer version/);
  });
});

function stripIds(state: ReturnType<typeof emptyState>) {
  const { appliedEventIds: _ignored, ...rest } = state;
  return rest;
}
