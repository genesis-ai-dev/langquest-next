import type { EventType } from '../src/events';
import { fold } from '../src/reducer';
import { referencedBlobs } from '../src/blobs';
import { derivePieces } from '../src/status';
import { emptyState } from '../src/state';
import { buildFixture, buildOrgFixture, buildRecordFixture, buildStep11Fixture, shuffle } from './fixtures';

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
  'v1.SourceImported',
  'v1.BlobStored',
  'v1.Redacted',
  'v1.BlobInvalidated',
  'v1.OrgCreated',
  'v1.RoleDefined',
  'v1.RoleRetired',
  'v1.OrgMemberAdded',
  'v1.OrgMemberRemoved',
  'v1.CatalogItemToggled',
  'v1.ProjectRegistered',
  'v1.LaneTemplateSelected',
  'v1.LaneFlowSelected',
  'v1.WorkflowStepSet',
  'v1.WorkflowStepRemoved',
  'v1.ReviewTeamDefined',
  'v1.ReviewTeamMemberSet',
  'v1.ResponseRecorded',
  'v1.ReviewCommentRecorded',
  'v1.MaterialDefined',
  'v1.MaterialFieldSet',
  'v1.MaterialLocked',
  'v1.StepQuestionSetLinked',
  'v1.KeyTermDefined',
  'v1.KeyTermRenderingAdded',
  'v1.KeyTermAdjusted',
  'v1.KeyTermLinked',
  'v1.ReviewKindDefined',
  'v2.WorkflowStepSet',
  'v1.ReviewRecorded',
  'v1.DepartureRecorded',
  'v1.DepartureUndone',
  'v1.RequestMade',
  'v1.RequestWithdrawn',
  'v1.NoteAdded',
  'v1.StudyStepMarked',
  'v1.LaneNamed',
  'v1.LibraryItemDefined',
  'v1.LibraryVersionPublished',
  'v1.LibrarySharingSet',
  'v1.LibraryItemArchived',
  'v1.LibrarySubscribed',
  'v1.LibraryPinned',
  'v2.LaneTemplateSelected',
  'v1.LaneUnitHidden',
  'v2.LaneFlowSelected'
];

describe('reducer invariants (PLAN.md section 4)', () => {
  const events = [...buildFixture(), ...buildStep11Fixture(), ...buildRecordFixture(), ...buildOrgFixture()];
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

describe('reducer tie-breaking', () => {
  it('two events with an identical clock fold the same in either order', () => {
    // Why: node ids are supposed to make clocks unique, but a bug that
    // gives every device the same id must not make state order-dependent.
    const base = buildFixture().filter((e) => e.type === 'v1.MemberAdded');
    const hlc = '000000000002000:000000:same';
    const x = { ...base[0]!, id: 'x', hlc, payload: { profileId: 'p', role: 'translator' as const } };
    const y = { ...base[0]!, id: 'y', hlc, payload: { profileId: 'p', role: 'reviewer' as const } };
    const xy = fold([x, y], emptyState());
    const yx = fold([y, x], emptyState());
    expect(xy.members['p']?.role.value).toBe(yx.members['p']?.role.value);
    expect(xy.selectedTakes).toEqual(yx.selectedTakes);
  });
});

describe('reducer survives bad input (invariant: one bad event never bricks a project)', () => {
  it('skips a malformed event, counts it, and derived views still work', () => {
    const events = buildFixture();
    const rec = events.find((e) => e.type === 'v1.RecordingAdded')!;
    const bad = { ...rec, id: 'bad1', payload: { recordingId: 'recX', unitId: 'luke1', laneId: 'L1', kind: 'target' } } as never;
    const state = fold([...events, bad], emptyState());
    expect(state.invalidEvents['bad1']).toMatch(/cards/);
    expect(state.recordings['recX']).toBeUndefined();
    expect(() => referencedBlobs(state)).not.toThrow();
    expect(() => derivePieces(state, 'L1')).not.toThrow();
  });

  it('a redaction removes the target whether it arrives before or after it', () => {
    // Why: wrong recordings, sensitive content, data requests. The log is
    // append-only, so removal is itself an event, and it must commute.
    const events = buildFixture();
    const rec = events.find((e) => e.type === 'v1.RecordingAdded')!;
    const redact = {
      ...rec,
      id: 'rd1',
      type: 'v1.Redacted',
      payload: { eventId: rec.id, reason: 'wrong passage' }
    } as never;
    const others = events.filter((e) => e.id !== rec.id && e.type !== 'v1.Redacted');
    const after = fold([...others, rec, redact], emptyState());
    const before = fold([...others, redact, rec], emptyState());
    expect(after.recordings[(rec.payload as { recordingId: string }).recordingId]).toBeUndefined();
    expect(before.recordings[(rec.payload as { recordingId: string }).recordingId]).toBeUndefined();
    expect(before.redactions[rec.id]).toBe(true);
    expect(stripApplied(after)).toEqual(stripApplied(before));
  });
});

function stripApplied(state: ReturnType<typeof emptyState>) {
  const { appliedEventIds: _ignored, ...rest } = state;
  return rest;
}
