import type { AnyEvent, EventEnvelope, EventPayloads, EventType } from '../src/events';
import { HlcClock } from '../src/hlc';

/**
 * Builds a realistic event history from several devices. Every event type in
 * the catalog appears at least once so the permutation tests cover all of
 * them. Adding a new event type: add it here and the tests pick it up.
 */
export function buildFixture(): AnyEvent[] {
  const events: AnyEvent[] = [];
  let seq = 0;
  let wall = 1_700_000_000_000;
  const clocks = new Map<string, HlcClock>();

  function emit<T extends EventType>(
    device: string,
    actorId: string,
    type: T,
    payload: EventPayloads[T],
    parentEventId?: string
  ): EventEnvelope<T> {
    const clock = clocks.get(device) ?? new HlcClock(device, () => wall);
    clocks.set(device, clock);
    wall += 1000;
    seq += 1;
    const e: EventEnvelope<T> = {
      id: `e${String(seq).padStart(4, '0')}`,
      type,
      orgId: 'org1',
      projectId: 'p1',
      actorId,
      deviceId: device,
      hlc: clock.next(),
      payload,
      serverSeq: seq,
      ...(parentEventId ? { parentEventId } : {})
    };
    events.push(e as AnyEvent);
    return e;
  }

  emit('dA', 'lead', 'v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
  const cfg = emit('dA', 'lead', 'v1.ProjectConfigChanged', {
    config: {
      unitKinds: [
        { id: 'book', label: 'Book', childKinds: ['passage'] },
        { id: 'passage', label: 'Passage', childKinds: [] }
      ],
      workflow: [
        { id: 'peer', role: 'reviewer', required: true, rule: 'majority' },
        { id: 'consultant', role: 'coordinator', required: false, rule: 'any' }
      ]
    }
  });
  emit('dA', 'lead', 'v1.MemberAdded', { profileId: 'lead', role: 'owner' });
  emit('dA', 'lead', 'v1.MemberAdded', { profileId: 't1', role: 'translator' });
  emit('dA', 'lead', 'v1.MemberAdded', { profileId: 'r1', role: 'reviewer' });
  emit('dA', 'lead', 'v1.MemberAdded', { profileId: 'r2', role: 'reviewer' });
  emit('dA', 'lead', 'v1.MemberAdded', { profileId: 'r3', role: 'reviewer' });
  emit('dA', 'lead', 'v1.MemberRoleChanged', { profileId: 'r3', role: 'coordinator' });
  emit('dA', 'lead', 'v1.MemberAdded', { profileId: 'gone', role: 'reviewer' });
  emit('dA', 'lead', 'v1.MemberRemoved', { profileId: 'gone' });
  emit('dA', 'lead', 'v1.LaneAdded', { laneId: 'L1', languoidId: 'xyz' });
  emit('dA', 'lead', 'v1.UnitAdded', {
    unitId: 'luke',
    parentUnitId: null,
    kind: 'book',
    label: 'Luke',
    order: 'a0'
  });
  emit('dA', 'lead', 'v1.UnitAdded', {
    unitId: 'luke1',
    parentUnitId: 'luke',
    kind: 'passage',
    label: 'Luke 1:1-4',
    order: 'a0'
  });
  emit('dA', 'lead', 'v1.ReferenceAttached', {
    unitId: 'luke1',
    refId: 'ref1',
    kind: 'overview_audio',
    blobHash: 'sha256:ov1'
  });
  emit('dA', 'lead', 'v1.AssignmentMade', {
    unitId: 'luke1',
    laneId: 'L1',
    profileId: 'r1',
    role: 'reviewer'
  });
  emit('dA', 'lead', 'v1.AssignmentMade', {
    unitId: 'luke1',
    laneId: 'L1',
    profileId: 'r2',
    role: 'reviewer'
  });
  emit('dA', 'lead', 'v1.SourceImported', { sourceProjectId: 'src', sourceSeq: 42, unitIds: ['luke1'] });
  // The storage trigger confirms c1 after it lands (server actor).
  emit('storage', 'service', 'v1.BlobStored', { hash: 'c1', size: 12345 });

  // Translator records offline on device B.
  emit('dB', 't1', 'v1.RecordingAdded', {
    recordingId: 'rec1',
    unitId: 'luke1',
    laneId: 'L1',
    kind: 'target',
    cards: [
      { hash: 'c1', durationMs: 1200 },
      { hash: 'c2', durationMs: 900 }
    ]
  });
  emit('dB', 't1', 'v1.TakeComposed', {
    takeId: 'take1',
    unitId: 'luke1',
    laneId: 'L1',
    cardHashes: ['c1', 'c2'],
    parentTakeId: null
  });
  // Re-edit: new take reusing c1, new card c3.
  emit('dB', 't1', 'v1.TakeComposed', {
    takeId: 'take2',
    unitId: 'luke1',
    laneId: 'L1',
    cardHashes: ['c1', 'c3'],
    parentTakeId: 'take1'
  });
  emit('dB', 't1', 'v1.TakeArchived', { takeId: 'take1' });
  emit('dB', 't1', 'v1.TakeSubmitted', { takeId: 'take2' });

  // Reviewers on devices C and D, offline, concurrently.
  emit('dC', 'r1', 'v1.ReviewSubmitted', { takeId: 'take2', stepId: 'peer', decision: 'approve' });
  emit('dD', 'r2', 'v1.ReviewSubmitted', {
    takeId: 'take2',
    stepId: 'peer',
    decision: 'suggest_changes',
    comment: 'card 2 unclear'
  });
  // r2 changes mind later.
  emit('dD', 'r2', 'v1.ReviewSubmitted', { takeId: 'take2', stepId: 'peer', decision: 'approve' });
  emit('dC', 'r1', 'v1.TakeSelected', { unitId: 'luke1', laneId: 'L1', takeId: 'take2' });

  // Lead edits config again from device A (register with parent).
  emit(
    'dA',
    'lead',
    'v1.ProjectConfigChanged',
    {
      config: {
        unitKinds: [
          { id: 'book', label: 'Book', childKinds: ['passage'] },
          { id: 'passage', label: 'Passage', childKinds: [] }
        ],
        workflow: [{ id: 'peer', role: 'reviewer', required: true, rule: 'unanimous' }]
      }
    },
    cfg.id
  );

  return events;
}

export function shuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let s = seed;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) % 4294967296;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
