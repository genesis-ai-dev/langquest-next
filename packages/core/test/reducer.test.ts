import type { EventType } from '../src/events';
import { fold } from '../src/reducer';
import { emptyState } from '../src/state';
import { buildFixture, shuffle } from './fixtures';

const CATALOG: EventType[] = [
  'v1.ProjectCreated',
  'v1.ProjectConfigChanged',
  'v1.MemberAdded',
  'v1.MemberRoleChanged',
  'v1.MemberRemoved',
  'v1.LaneAdded',
  'v1.UnitAdded',
  'v1.ReferenceAttached',
  'v1.RecordingAdded',
  'v1.TakeComposed',
  'v1.TakeArchived',
  'v1.TakeSelected',
  'v1.TakeSubmitted',
  'v1.ReviewSubmitted',
  'v1.AssignmentMade',
  'v1.SourceImported'
];

describe('reducer invariants (PLAN.md section 4)', () => {
  const events = buildFixture();
  const canonical = fold(events, emptyState());

  it('fixture exercises every event type in the catalog', () => {
    const seen = new Set(events.map((e) => e.type));
    for (const type of CATALOG) expect(seen.has(type), type).toBe(true);
  });

  it('invariant 2: any permutation folds to the same state', () => {
    // Why: two devices offline for a month apply each other's events in
    // whatever order the sync delivers them. If order changed the answer,
    // teams would see different approval states on different phones.
    for (let seed = 1; seed <= 200; seed++) {
      const permuted = fold(shuffle(events, seed), emptyState());
      expect(permuted).toEqual(canonical);
    }
  });

  it('invariant 3: applying every event twice equals applying once', () => {
    // Why: the sync layer is at-least-once. Redelivery must be harmless.
    const doubled = fold([...events, ...shuffle(events, 7)], emptyState());
    expect(doubled).toEqual(canonical);
  });

  it('register semantics: later HLC wins for the same key', () => {
    expect(canonical.members['r3']?.role.value).toBe('coordinator');
    expect(canonical.members['gone']?.removed.value).toBe(true);
    expect(canonical.config?.value.workflow[0]?.rule).toBe('unanimous');
    expect(canonical.reviews['take2']?.['peer']?.['r2']?.value.decision).toBe('approve');
  });

  it('add-wins: an archive that arrives before its compose still sticks', () => {
    const archiveFirst = events.filter(
      (e) => e.type === 'v1.TakeArchived' || (e.type === 'v1.TakeComposed' && e.payload.takeId === 'take1')
    );
    const order = [...archiveFirst].sort((a) => (a.type === 'v1.TakeArchived' ? -1 : 1));
    const state = fold(order, emptyState());
    expect(state.takes['take1']?.archived).toBe(true);
    expect(state.takes['take1']?.cardHashes).toEqual(['c1', 'c2']);
  });

  it('unknown event types are ignored, not thrown', () => {
    // Why: an older app must keep folding when a newer app emits v2 events.
    const future = { ...events[0]!, id: 'zz', type: 'v9.Something' } as never;
    expect(() => fold([...events, future], emptyState())).not.toThrow();
  });
});
