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
  // The storage trigger confirms c1 after it lands (server actor). An earlier
  // corrupt upload of c1 was invalidated by the reconciler; the later
  // confirmation wins.
  emit('storage', 'service', 'v1.BlobInvalidated', { hash: 'c1', reason: 'hash mismatch' });
  emit('storage', 'service', 'v1.BlobStored', { hash: 'c1', size: 12345 });

  // A mistaken recording, later redacted by the lead (append-only removal).
  const wrong = emit('dB', 't1', 'v1.RecordingAdded', {
    recordingId: 'recWrong',
    unitId: 'luke1',
    laneId: 'L1',
    kind: 'target',
    cards: [{ hash: 'cWrong', durationMs: 500 }]
  });
  emit('dA', 'lead', 'v1.Redacted', { eventId: wrong.id, reason: 'wrong passage' });

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

/**
 * Step 11 events on top of the project fixture: lane L1 picks the Quick
 * Check flow, its peer step is owned by a review team, a removed step, lane
 * L2 picks a content template, the translator answers suggestions with a
 * note, and a reviewer leaves a spoken comment. Kept apart from
 * `buildFixture` so the workflow tests' config-toggling expectations hold.
 */
export function buildStep11Fixture(): AnyEvent[] {
  const events: AnyEvent[] = [];
  let seq = 500;
  let wall = 1_750_000_000_000;
  const clocks = new Map<string, HlcClock>();
  const emit = <T extends EventType>(device: string, actorId: string, type: T, payload: EventPayloads[T]) => {
    const clock = clocks.get(device) ?? new HlcClock(device, () => wall);
    clocks.set(device, clock);
    wall += 1000;
    seq += 1;
    events.push({ id: `s${seq}`, type, orgId: 'org1', projectId: 'p1', actorId, deviceId: device, hlc: clock.next(), payload, serverSeq: seq } as AnyEvent);
  };
  emit('dA', 'lead', 'v1.LaneFlowSelected', { laneId: 'L1', flowId: 'quick_check', catalogVersion: 1 });
  emit('dA', 'lead', 'v1.WorkflowStepSet', { stepId: 'peer', laneId: 'L1', order: 's00', label: 'Peer', role: 'reviewer', teamId: 'team1', required: true, rule: 'unanimous' });
  emit('dA', 'lead', 'v1.WorkflowStepSet', { stepId: 'consultant', laneId: 'L1', order: 's01', role: 'coordinator', required: false, rule: 'any' });
  emit('dA', 'lead', 'v1.WorkflowStepSet', { stepId: 'extra', laneId: 'L1', order: 's02', role: 'reviewer', required: false, rule: 'any' });
  emit('dA', 'lead', 'v1.WorkflowStepRemoved', { stepId: 'extra' });
  emit('dA', 'lead', 'v1.ReviewTeamDefined', { teamId: 'team1', laneId: 'L1', name: 'Community reviewers' });
  emit('dA', 'lead', 'v1.ReviewTeamMemberSet', { teamId: 'team1', profileId: 'r1', member: true });
  emit('dA', 'lead', 'v1.ReviewTeamMemberSet', { teamId: 'team1', profileId: 'r2', member: true });
  emit('dA', 'lead', 'v1.ReviewTeamMemberSet', { teamId: 'team1', profileId: 'r3', member: false });
  emit('dA', 'lead', 'v1.LaneTemplateSelected', { laneId: 'L2', templateId: 'book', catalogVersion: 1 });
  emit('dB', 't1', 'v1.ResponseRecorded', { takeId: 'take2', respondsToTakeId: 'take1', note: 'Re-recorded card 2; kept the rest.' });
  emit('dD', 'r2', 'v1.ReviewCommentRecorded', { takeId: 'take2', stepId: 'peer', blobHash: 'c1' });

  // Step 12: materials with per-field registers, a locked org document, the
  // community question set from the catalog linked to the peer step, a
  // translator-written set, and a living glossary tied to take2.
  emit('dA', 'lead', 'v1.MaterialDefined', { materialId: 'tmf', kind: 'tmf', title: 'Translation Management Framework', scope: {} });
  emit('dA', 'lead', 'v1.MaterialFieldSet', { materialId: 'tmf', fieldId: 'body', text: 'Four checks before publication.' });
  emit('dA', 'lead', 'v1.MaterialLocked', { materialId: 'tmf', locked: true });
  emit('dA', 'lead', 'v1.MaterialDefined', { materialId: 'questions@1/community_check', kind: 'questions', title: 'Community Check Questions', scope: {}, templateRef: 'questions/community_check' });
  emit('dA', 'lead', 'v1.MaterialFieldSet', { materialId: 'questions@1/community_check', fieldId: 'meaning', text: 'Does the translation accurately convey the meaning of the source text?' });
  emit('dA', 'lead', 'v1.MaterialFieldSet', { materialId: 'questions@1/community_check', fieldId: 'natural', text: 'Is the translation natural and clear in the target language?' });
  emit('dA', 'lead', 'v1.StepQuestionSetLinked', { stepId: 'peer', materialId: 'questions@1/community_check' });
  emit('dB', 't1', 'v1.MaterialDefined', { materialId: 'q-luke1', kind: 'questions', title: 'Luke 1 questions', scope: { laneId: 'L1', unitId: 'luke1' } });
  emit('dB', 't1', 'v1.MaterialFieldSet', { materialId: 'q-luke1', fieldId: 'q1', text: 'Does Theophilus sound like a name?' });
  emit('dB', 't1', 'v1.MaterialDefined', { materialId: 'tg:L1', kind: 'tg', title: 'Translation Guidelines', scope: { laneId: 'L1' } });
  emit('dB', 't1', 'v1.MaterialFieldSet', { materialId: 'tg:L1', fieldId: 'luke1', text: 'Keep the dedication formal.' });
  emit('dC', 'r1', 'v1.MaterialFieldSet', { materialId: 'tg:L1', fieldId: 'general', text: 'Use the eastern dialect for narration.' });
  emit('dA', 'lead', 'v1.KeyTermDefined', { termId: 'kt-logos', laneId: 'L1', term: 'Word (Logos)', gloss: 'The eternal Word of God', unitScope: ['luke'] });
  emit('dA', 'lead', 'v1.KeyTermRenderingAdded', { termId: 'kt-logos', renderingId: 'r1', rendering: 'Wët Nhialic', context: "God's own Word" });
  emit('dB', 't1', 'v1.KeyTermAdjusted', { termId: 'kt-logos', adjustmentId: 'adj1', note: 'Standardized on Wët Nhialic.', duringTakeId: 'take2' });
  emit('dB', 't1', 'v1.KeyTermLinked', { takeId: 'take2', termId: 'kt-logos', note: 'Used the divine sense.', adjustmentId: 'adj1' });
  emit('dA', 'lead', 'v1.KeyTermDefined', { termId: 'kt-sarx', laneId: 'L1', term: 'flesh (sarx)', gloss: 'Body, or sinful nature', unitScope: ['romans'] });

  return events;
}

/**
 * The passage record (record.ts) on top of the project fixture: lane L1
 * uses the Standard Bible Flow as v2 steps, a renamed kind, a peer step set
 * aside and brought back, requests (one withdrawn), a back translation,
 * logged community feedback kept with a reason, notes, study marks. Two
 * devices touch the same registers so the permutation test has work to do.
 */
export function buildRecordFixture(): AnyEvent[] {
  const events: AnyEvent[] = [];
  let seq = 700;
  let wall = 1_760_000_000_000;
  const clocks = new Map<string, HlcClock>();
  const emit = <T extends EventType>(device: string, actorId: string, type: T, payload: EventPayloads[T]) => {
    const clock = clocks.get(device) ?? new HlcClock(device, () => wall);
    clocks.set(device, clock);
    wall += 1000;
    seq += 1;
    events.push({ id: `r${seq}`, type, orgId: 'org1', projectId: 'p1', actorId, deviceId: device, hlc: clock.next(), payload, serverSeq: seq } as AnyEvent);
  };
  emit('dA', 'lead', 'v1.ReviewKindDefined', { kindId: 'elder', name: 'Elder Review', description: 'Elders listen together.', usualReviewer: 'Village elders' });
  emit('dE', 'lead2', 'v1.ReviewKindDefined', { kindId: 'elder', name: 'Elders Review' });
  emit('dA', 'lead', 'v1.LaneFlowSelected', { laneId: 'L1', flowId: 'standard_bible', catalogVersion: 2 });
  emit('dA', 'lead', 'v2.WorkflowStepSet', { stepId: 'L1/standard_bible@2/s1', laneId: 'L1', order: 's00', kindIds: ['peer', 'bt'], checkpoint: false });
  emit('dA', 'lead', 'v2.WorkflowStepSet', { stepId: 'L1/standard_bible@2/s2', laneId: 'L1', order: 's01', kindIds: ['community'], checkpoint: false });
  emit('dA', 'lead', 'v2.WorkflowStepSet', { stepId: 'L1/standard_bible@2/s3', laneId: 'L1', order: 's02', kindIds: ['consultant'], checkpoint: true });
  emit('dA', 'lead', 'v2.WorkflowStepSet', { stepId: 'L1/standard_bible@2/s4', laneId: 'L1', order: 's03', kindIds: ['final'], checkpoint: false });
  emit('dE', 'lead2', 'v2.WorkflowStepSet', { stepId: 'L1/standard_bible@2/s4', laneId: 'L1', order: 's03', kindIds: ['final', 'elder'], checkpoint: false });
  emit('dB', 't1', 'v1.DepartureRecorded', { departureId: 'd1', unitId: 'luke1', laneId: 'L1', type: 'skip', kindId: 'peer', reason: 'No peer to ask yet.' });
  emit('dB', 't1', 'v1.DepartureUndone', { departureId: 'd1' });
  emit('dA', 'lead', 'v1.RequestMade', { requestId: 'q1', unitId: 'luke1', laneId: 'L1', what: 'review', kindId: 'community', profileId: 'r1', dueDate: '2026-10-01', note: 'Sunday service', questions: [{ id: 'x1', text: 'Did they follow it?', type: 'yesno', required: true }] });
  emit('dA', 'lead', 'v1.RequestMade', { requestId: 'q2', unitId: 'luke1', laneId: 'L1', what: 'review', kindId: 'community', guest: { name: 'Pastor Garang', channel: 'whatsapp', contact: '+211 900 000' } });
  emit('dA', 'lead', 'v1.RequestWithdrawn', { requestId: 'q2' });
  emit('dF', 'bt1', 'v1.ReviewRecorded', { reviewId: 'rv1', takeId: 'take2', kindId: 'bt', outcome: 'recorded', via: 'app', artifacts: [{ hash: 'b1', durationMs: 4000, format: 'wav' }], comment: 'Verse 3 was hard to say back.' });
  emit('dB', 't1', 'v1.ReviewRecorded', { reviewId: 'rv2', takeId: 'take2', kindId: 'community', outcome: 'needs_changes', via: 'logged', comment: 'They heard shepherd as a hired herder.', people: 11, place: "Women's fellowship", answers: { x1: 'No' } });
  emit('dB', 't1', 'v1.DepartureRecorded', { departureId: 'd2', unitId: 'luke1', laneId: 'L1', type: 'keep', reviewId: 'rv2', reason: 'The cattle-camp word is used for the owner already.' });
  emit('dA', 'lead', 'v1.DepartureRecorded', { departureId: 'd3', unitId: 'luke1', laneId: 'L1', type: 'override', stepId: 'L1/standard_bible@2/s3', reason: 'Consultant visit moved to next year.' });
  emit('dB', 't1', 'v1.NoteAdded', { noteId: 'n1', unitId: 'luke1', laneId: 'L1', anchor: { kind: 'verse', verse: '1:3', translation: 'BSB' }, text: 'Most excellent is a title here.', onTakeId: 'take2' });
  emit('dB', 't1', 'v1.NoteAdded', { noteId: 'n2', unitId: 'luke1', laneId: 'L1', anchor: { kind: 'study', guideId: 'fia:luke1', stepId: 'hear', at: '1:02' }, blobHash: 'c9' });
  emit('dB', 't1', 'v1.StudyStepMarked', { unitId: 'luke1', laneId: 'L1', guideId: 'fia:luke1', stepId: 'hear', done: true });
  emit('dG', 't2', 'v1.StudyStepMarked', { unitId: 'luke1', laneId: 'L1', guideId: 'fia:luke1', stepId: 'hear', done: false });
  emit('dA', 'lead', 'v1.LaneNamed', { laneId: 'L1', name: 'Dinka' });
  emit('dE', 'lead2', 'v1.LaneNamed', { laneId: 'L1', name: 'Thuɔŋjäŋ' });
  // The library (decision 36): a language moves from a catalog template to a
  // library one, hides a part the new version dropped (and another device
  // brings it back), and follows a library flow.
  emit('dA', 'lead', 'v1.LaneTemplateSelected', { laneId: 'L2', templateId: 'fia', catalogVersion: 1 });
  emit('dE', 'lead2', 'v2.LaneTemplateSelected', { laneId: 'L2', itemId: 'langquest.fia-eng', docHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', unitPrefix: 'langquest.fia-eng', books: ['GEN', 'EXO'] });
  emit('dA', 'lead', 'v1.UnitAdded', { unitId: 'langquest.fia-eng/GEN', parentUnitId: null, kind: 'book', label: 'Genesis', order: 'b0000' });
  emit('dA', 'lead', 'v1.UnitAdded', { unitId: 'langquest.fia-eng/GEN.2.4-25', parentUnitId: 'langquest.fia-eng/GEN', kind: 'passage', label: 'Genesis 2:4–25', order: 'b0000p00001' });
  emit('dA', 'lead', 'v1.LaneUnitHidden', { laneId: 'L2', unitId: 'langquest.fia-eng/GEN.2.4-25', hidden: true });
  emit('dE', 'lead2', 'v1.LaneUnitHidden', { laneId: 'L2', unitId: 'langquest.fia-eng/GEN.2.4-25', hidden: false });
  emit('dA', 'lead', 'v2.LaneFlowSelected', { laneId: 'L2', flowId: 'langquest.standard~aaaaaaaaaaaa', catalogVersion: 2, itemId: 'langquest.standard', docHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'Standard Bible Flow' });
  emit('dE', 'lead2', 'v1.LaneFlowSelected', { laneId: 'L2', flowId: 'quick_check', catalogVersion: 2 });
  emit('dA', 'lead', 'v1.LaneCountrySet', { laneId: 'L1', country: 'SS' });
  emit('dE', 'lead2', 'v1.LaneCountrySet', { laneId: 'L1', country: 'SD' });
  emit('dA', 'lead', 'v1.LaneTargetSet', { laneId: 'L1', scope: 'nt', startDate: '2026-01-01', targetDate: '2027-07-01' });
  emit('dE', 'lead2', 'v1.LaneTargetSet', { laneId: 'L1', scope: 'gospels', startDate: '2026-01-01', targetDate: '2026-12-31' });

  // Ties the merge rules must settle without looking at arrival order
  // (event-sourced-sync, "Tests to write"): the same review id from two
  // devices, once at the same clock; two people undoing the same departure,
  // once at the same clock; an undo that arrives for a departure never seen.
  const raw = (id: string, actorId: string, deviceId: string, hlc: string, type: EventType, payload: unknown) => {
    seq += 1;
    events.push({ id, type, orgId: 'org1', projectId: 'p1', actorId, deviceId, hlc, payload, serverSeq: seq } as AnyEvent);
  };
  const tie = '001760000900000:000000:';
  raw('tie-a', 'r1', 'dC', `${tie}dC`, 'v1.ReviewRecorded', { reviewId: 'rvTie', takeId: 'take2', kindId: 'peer', outcome: 'looks_good', via: 'app' });
  raw('tie-b', 'r2', 'dC', `${tie}dC`, 'v1.ReviewRecorded', { reviewId: 'rvTie', takeId: 'take2', kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Same clock, other device state.' });
  raw('tie-c', 'r2', 'dD', '001760000950000:000000:dD', 'v1.ReviewRecorded', { reviewId: 'rvTie', takeId: 'take2', kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Later clock loses.' });
  raw('tie-d', 't1', 'dB', `${tie}dB`, 'v1.DepartureUndone', { departureId: 'd3' });
  raw('tie-e', 'lead', 'dB', `${tie}dB`, 'v1.DepartureUndone', { departureId: 'd3' });
  raw('tie-f', 'lead', 'dA', '001760000800000:000000:dA', 'v1.DepartureUndone', { departureId: 'never-recorded' });
  return events;
}

/**
 * One of each org partition event (org.ts). Separate from the project
 * fixture so snapshot tests keep their cut, and appended to it wherever a
 * test must see every catalog type.
 */
export function buildOrgFixture(): AnyEvent[] {
  const events: AnyEvent[] = [];
  let seq = 900;
  let wall = 1_800_000_000_000;
  const clock = new HlcClock('dA', () => wall);
  const emit = <T extends EventType>(type: T, payload: EventPayloads[T]) => {
    wall += 1000;
    seq += 1;
    events.push({ id: `o${seq}`, type, orgId: 'org1', projectId: '_org', actorId: 'lead', deviceId: 'dA', hlc: clock.next(), payload, serverSeq: seq } as AnyEvent);
  };
  emit('v1.OrgCreated', { name: 'Wycliffe Associates' });
  emit('v1.RoleDefined', { roleId: 'org_admin', name: 'Organization Admin', privileges: ['manage_roles', 'invite_members', 'manage_structure', 'assign_work', 'view_status'] });
  emit('v1.RoleDefined', { roleId: 'translator', name: 'Translator', privileges: ['translate', 'view_status'] });
  emit('v1.RoleRetired', { roleId: 'old_role' });
  emit('v1.OrgMemberAdded', { profileId: 'lead', roleId: 'org_admin', scope: { level: 'org' }, displayName: 'Lead' });
  emit('v1.OrgMemberAdded', { profileId: 't1', roleId: 'translator', scope: { level: 'lane', projectId: 'p1', laneId: 'L1' } });
  emit('v1.OrgMemberRemoved', { profileId: 'gone', scope: { level: 'project', projectId: 'p1' } });
  emit('v1.CatalogItemToggled', { kind: 'flow', itemId: 'quick_check', level: 'org', enabled: false });
  emit('v1.ProjectRegistered', { projectId: 'p1', name: 'Luke' });
  // One of each library event (library.ts), with the ties the merge rules settle.
  emit('v1.LibraryItemDefined', { itemId: 'health', kind: 'template', name: 'Health lessons', description: 'Community health notices.' });
  emit('v1.LibraryVersionPublished', { itemId: 'health', kind: 'template', docHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  emit('v1.LibraryVersionPublished', { itemId: 'health', kind: 'template', docHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', note: 'Added HIV awareness.' });
  emit('v1.LibrarySharingSet', { itemId: 'health', kind: 'template', shared: true, subscribable: true });
  emit('v1.LibraryItemArchived', { itemId: 'health', kind: 'template', archived: false });
  emit('v1.LibraryItemDefined', { itemId: 'fia-copy', kind: 'material', name: 'FIA (our copy)', description: '', copiedFrom: { orgId: 'langquest', orgName: 'LangQuest', itemId: 'langquest.fia-eng-study', docHash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' } });
  emit('v1.LibraryVersionPublished', { itemId: 'fia-copy', kind: 'material', docHash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' });
  emit('v1.LibrarySubscribed', { itemId: 'sub.langquest.langquest.standard', kind: 'flow', sourceOrgId: 'langquest', sourceOrgName: 'LangQuest', sourceItemId: 'langquest.standard', name: 'Standard Bible Flow', autoUpdate: true, active: true });
  emit('v1.LibraryPinned', { itemId: 'sub.langquest.langquest.standard', kind: 'flow', docHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  const raw = (id: string, deviceId: string, hlc: string, type: EventType, payload: unknown) => {
    seq += 1;
    events.push({ id, type, orgId: 'org1', projectId: '_org', actorId: 'lead', deviceId, hlc, payload, serverSeq: seq } as AnyEvent);
  };
  const tie = '001800000900000:000000:';
  // The same version published from two devices at the same clock: one version, the lower id.
  raw('lib-a', 'dB', `${tie}dB`, 'v1.LibraryVersionPublished', { itemId: 'health', kind: 'template', docHash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', note: 'from dB' });
  raw('lib-b', 'dC', `${tie}dB`, 'v1.LibraryVersionPublished', { itemId: 'health', kind: 'template', docHash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', note: 'from dC' });
  // The server's automatic pin and a person's manual pin at the same clock.
  raw('lib-c', 'server', `${tie}dB`, 'v1.LibraryPinned', { itemId: 'sub.langquest.langquest.standard', kind: 'flow', docHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
  raw('lib-d', 'dB', `${tie}dB`, 'v1.LibraryPinned', { itemId: 'sub.langquest.langquest.standard', kind: 'flow', docHash: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' });
  // Sharing turned off, and a pin for an item never defined here.
  raw('lib-e', 'dB', '001800000950000:000000:dB', 'v1.LibrarySharingSet', { itemId: 'health', kind: 'template', shared: false, subscribable: true });
  raw('lib-f', 'dB', '001800000960000:000000:dB', 'v1.LibraryPinned', { itemId: 'orphan', kind: 'material', docHash: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' });
  // The license only opens (license.ts): a later, more closed choice from
  // an admin who was offline changes nothing, and two devices opening to the
  // same license at the same clock settle on the lower id.
  emit('v1.OrgLicenseSet', { license: 'CC-BY-NC-ND-4.0' });
  raw('lic-a', 'dB', '001800000970000:000000:dB', 'v1.OrgLicenseSet', { license: 'CC-BY-SA-4.0' });
  raw('lic-b', 'dC', '001800000970000:000000:dB', 'v1.OrgLicenseSet', { license: 'CC-BY-SA-4.0' });
  raw('lic-c', 'dB', '001800000980000:000000:dB', 'v1.OrgLicenseSet', { license: 'all-rights-reserved' });

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
