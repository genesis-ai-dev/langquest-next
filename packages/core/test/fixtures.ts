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
      streamId: 'L1',
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

  emit('dA', 'lead', 'v1.UnitAdded', { unitId: 'luke', parentUnitId: null, kind: 'book', label: 'Luke', order: 'a0' });
  emit('dA', 'lead', 'v1.UnitAdded', { unitId: 'luke1', parentUnitId: 'luke', kind: 'passage', label: 'Luke 1:1-4', order: 'a0' });
  // The Worker confirms c1 after it lands (server actor). An earlier
  // corrupt upload of c1 was invalidated by the reconciler; the later
  // confirmation wins.
  emit('storage', 'service', 'v1.BlobInvalidated', { hash: 'c1', reason: 'hash mismatch' });
  emit('storage', 'service', 'v1.BlobStored', { hash: 'c1', size: 12345 });

  // A mistaken recording, later redacted by the lead (append-only removal).
  const wrong = emit('dB', 't1', 'v1.RecordingAdded', {
    recordingId: 'recWrong', unitId: 'luke1', kind: 'target', cards: [{ hash: 'cWrong', durationMs: 500 }]
  });
  emit('dA', 'lead', 'v1.Redacted', { eventId: wrong.id, reason: 'wrong passage' });

  // Translator records offline on device B.
  emit('dB', 't1', 'v1.RecordingAdded', {
    recordingId: 'rec1', unitId: 'luke1', kind: 'target', cards: [{ hash: 'c1', durationMs: 1200 }, { hash: 'c2', durationMs: 900 }]
  });
  emit('dB', 't1', 'v1.TakeComposed', { takeId: 'take1', unitId: 'luke1', cardHashes: ['c1', 'c2'], parentTakeId: null });
  // Re-edit: new take reusing c1, new card c3.
  emit('dB', 't1', 'v1.TakeComposed', { takeId: 'take2', unitId: 'luke1', cardHashes: ['c1', 'c3'], parentTakeId: 'take1' });
  emit('dB', 't1', 'v1.TakeArchived', { takeId: 'take1' });
  emit('dB', 't1', 'v1.TakeSubmitted', { takeId: 'take2' });

  // Reviewers on devices C and D, offline, concurrently.
  emit('dC', 'r1', 'v1.ReviewRecorded', { reviewId: 'rvA', takeId: 'take2', kindId: 'peer', outcome: 'looks_good', via: 'app' });
  emit('dD', 'r2', 'v1.ReviewRecorded', { reviewId: 'rvB', takeId: 'take2', kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'card 2 unclear' });

  return events;
}

/**
 * Templates, flows, teams, the respond loop, materials and key terms on top
 * of the language fixture: the language uses the Quick Check flow, a step is
 * removed, a review team, a template version that hides a part, the
 * translator answers suggestions with a note.
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
    events.push({ id: `s${seq}`, type, orgId: 'org1', streamId: 'L1', actorId, deviceId: device, hlc: clock.next(), payload, serverSeq: seq } as AnyEvent);
  };
  emit('dA', 'lead', 'v1.FlowSelected', { flowId: 'quick_check', name: 'Quick Check' });
  emit('dA', 'lead', 'v1.FlowStepSet', { stepId: 'quick_check/s1', order: 's00', kindIds: ['peer'], checkpoint: false });
  emit('dA', 'lead', 'v1.FlowStepSet', { stepId: 'quick_check/s2', order: 's01', kindIds: ['final'], checkpoint: false });
  emit('dA', 'lead', 'v1.FlowStepSet', { stepId: 'quick_check/extra', order: 's02', kindIds: ['community'], checkpoint: false });
  emit('dA', 'lead', 'v1.FlowStepRemoved', { stepId: 'quick_check/extra' });
  emit('dA', 'lead', 'v1.ReviewTeamDefined', { teamId: 'team1', name: 'Community reviewers' });
  emit('dA', 'lead', 'v1.ReviewTeamMemberSet', { teamId: 'team1', profileId: 'r1', member: true });
  emit('dA', 'lead', 'v1.ReviewTeamMemberSet', { teamId: 'team1', profileId: 'r2', member: true });
  emit('dA', 'lead', 'v1.ReviewTeamMemberSet', { teamId: 'team1', profileId: 'r3', member: false });
  emit('dA', 'lead', 'v1.TemplateSelected', { itemId: 'langquest.fia-eng', docHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', unitPrefix: 'langquest.fia-eng', books: ['LUK'] });
  emit('dA', 'lead', 'v1.UnitHidden', { unitId: 'langquest.fia-eng/LUK.2.1-7', hidden: true });
  emit('dB', 't1', 'v1.ResponseRecorded', { takeId: 'take2', respondsToTakeId: 'take1', note: 'Re-recorded card 2; kept the rest.' });

  // Materials with per-field registers, a locked document, the community
  // question set for a kind, a translator-written set, and a living glossary
  // tied to take2.
  emit('dA', 'lead', 'v1.MaterialDefined', { materialId: 'tmf', kind: 'tmf', title: 'Translation Management Framework', scope: {} });
  emit('dA', 'lead', 'v1.MaterialFieldSet', { materialId: 'tmf', fieldId: 'body', text: 'Four checks before publication.' });
  emit('dA', 'lead', 'v1.MaterialLocked', { materialId: 'tmf', locked: true });
  emit('dA', 'lead', 'v1.MaterialDefined', { materialId: 'questions/community_check', kind: 'questions', title: 'Community Check Questions', scope: { stepId: 'community' }, templateRef: 'questions/community_check' });
  emit('dA', 'lead', 'v1.MaterialFieldSet', { materialId: 'questions/community_check', fieldId: 'meaning', text: 'Does the translation accurately convey the meaning of the source text?' });
  emit('dA', 'lead', 'v1.MaterialFieldSet', { materialId: 'questions/community_check', fieldId: 'natural', text: 'Is the translation natural and clear in the target language?' });
  emit('dB', 't1', 'v1.MaterialDefined', { materialId: 'q-luke1', kind: 'questions', title: 'Luke 1 questions', scope: { unitId: 'luke1' } });
  emit('dB', 't1', 'v1.MaterialFieldSet', { materialId: 'q-luke1', fieldId: 'q1', text: 'Does Theophilus sound like a name?' });
  emit('dB', 't1', 'v1.MaterialDefined', { materialId: 'tg', kind: 'tg', title: 'Translation Guidelines', scope: {} });
  emit('dB', 't1', 'v1.MaterialFieldSet', { materialId: 'tg', fieldId: 'luke1', text: 'Keep the dedication formal.' });
  emit('dC', 'r1', 'v1.MaterialFieldSet', { materialId: 'tg', fieldId: 'general', text: 'Use the eastern dialect for narration.' });
  emit('dA', 'lead', 'v1.KeyTermDefined', { termId: 'kt-logos', term: 'Word (Logos)', gloss: 'The eternal Word of God', unitScope: ['luke'] });
  emit('dA', 'lead', 'v1.KeyTermRenderingAdded', { termId: 'kt-logos', renderingId: 'r1', rendering: 'Wët Nhialic', context: "God's own Word" });
  emit('dB', 't1', 'v1.KeyTermAdjusted', { termId: 'kt-logos', adjustmentId: 'adj1', note: 'Standardized on Wët Nhialic.', duringTakeId: 'take2' });
  emit('dB', 't1', 'v1.KeyTermLinked', { takeId: 'take2', termId: 'kt-logos', note: 'Used the divine sense.', adjustmentId: 'adj1' });
  emit('dA', 'lead', 'v1.KeyTermDefined', { termId: 'kt-sarx', term: 'flesh (sarx)', gloss: 'Body, or sinful nature', unitScope: ['romans'] });

  return events;
}

/**
 * The passage record (record.ts) on top of the language fixture: the
 * Standard Bible Flow, a renamed kind, a peer step set aside and brought
 * back, requests (one withdrawn, one to a team), a back translation, logged
 * community feedback kept with a reason, notes, study marks, and reference
 * material. Two devices touch the same registers so the permutation test
 * has work to do.
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
    events.push({ id: `r${seq}`, type, orgId: 'org1', streamId: 'L1', actorId, deviceId: device, hlc: clock.next(), payload, serverSeq: seq } as AnyEvent);
  };
  emit('dA', 'lead', 'v1.ReviewKindDefined', { kindId: 'elder', name: 'Elder Review', description: 'Elders listen together.', usualReviewer: 'Village elders' });
  emit('dE', 'lead2', 'v1.ReviewKindDefined', { kindId: 'elder', name: 'Elders Review' });
  emit('dA', 'lead', 'v1.FlowSelected', { flowId: 'standard_bible', name: 'Standard Bible Flow' });
  emit('dA', 'lead', 'v1.FlowStepSet', { stepId: 'standard_bible/s1', order: 's00', kindIds: ['peer', 'bt'], checkpoint: false });
  emit('dA', 'lead', 'v1.FlowStepSet', { stepId: 'standard_bible/s2', order: 's01', kindIds: ['community'], checkpoint: false });
  emit('dA', 'lead', 'v1.FlowStepSet', { stepId: 'standard_bible/s3', order: 's02', kindIds: ['consultant'], checkpoint: true });
  emit('dA', 'lead', 'v1.FlowStepSet', { stepId: 'standard_bible/s4', order: 's03', kindIds: ['final'], checkpoint: false });
  emit('dE', 'lead2', 'v1.FlowStepSet', { stepId: 'standard_bible/s4', order: 's03', kindIds: ['final', 'elder'], checkpoint: false });
  emit('dB', 't1', 'v1.DepartureRecorded', { departureId: 'd1', unitId: 'luke1', type: 'skip', kindId: 'peer', reason: 'No peer to ask yet.' });
  emit('dB', 't1', 'v1.DepartureUndone', { departureId: 'd1' });
  emit('dA', 'lead', 'v1.RequestMade', { requestId: 'q1', unitId: 'luke1', what: 'review', kindId: 'community', profileId: 'r1', dueDate: '2026-10-01', note: 'Sunday service', questions: [{ id: 'x1', text: 'Did they follow it?', type: 'yesno', required: true }] });
  emit('dA', 'lead', 'v1.RequestMade', { requestId: 'q2', unitId: 'luke1', what: 'review', kindId: 'community', guest: { name: 'Pastor Garang', channel: 'whatsapp', contact: '+211 900 000' } });
  emit('dA', 'lead', 'v1.RequestWithdrawn', { requestId: 'q2' });
  // A request to a review team (ADR-029): team1 is defined in the step-11 fixture.
  // team1 usually does peer review; a second admin clears it to any kind, offline, earlier.
  emit('dE', 'lead2', 'v1.ReviewTeamKindSet', { teamId: 'team1', kindId: null });
  emit('dA', 'lead', 'v1.ReviewTeamKindSet', { teamId: 'team1', kindId: 'peer' });
  emit('dB', 't1', 'v1.RequestMade', { requestId: 'q3', unitId: 'luke1', what: 'review', kindId: 'peer', teamId: 'team1', dueDate: '2026-10-08', note: 'Either of you' });
  emit('dF', 'bt1', 'v1.ReviewRecorded', { reviewId: 'rv1', takeId: 'take2', kindId: 'bt', outcome: 'recorded', via: 'app', artifacts: [{ hash: 'b1', durationMs: 4000, format: 'wav' }], comment: 'Verse 3 was hard to say back.' });
  emit('dB', 't1', 'v1.ReviewRecorded', { reviewId: 'rv2', takeId: 'take2', kindId: 'community', outcome: 'needs_changes', via: 'logged', comment: 'They heard shepherd as a hired herder.', people: 11, place: "Women's fellowship", answers: { x1: 'No' } });
  emit('dB', 't1', 'v1.DepartureRecorded', { departureId: 'd2', unitId: 'luke1', type: 'keep', reviewId: 'rv2', reason: 'The cattle-camp word is used for the owner already.' });
  emit('dA', 'lead', 'v1.DepartureRecorded', { departureId: 'd3', unitId: 'luke1', type: 'override', stepId: 'standard_bible/s3', reason: 'Consultant visit moved to next year.' });
  emit('dB', 't1', 'v1.NoteAdded', { noteId: 'n1', unitId: 'luke1', anchor: { kind: 'verse', verse: '1:3', translation: 'BSB' }, text: 'Most excellent is a title here.', onTakeId: 'take2' });
  emit('dB', 't1', 'v1.NoteAdded', { noteId: 'n2', unitId: 'luke1', anchor: { kind: 'study', guideId: 'fia:luke1', stepId: 'hear', at: '1:02' }, blobHash: 'c9' });
  emit('dB', 't1', 'v1.StudyStepMarked', { unitId: 'luke1', guideId: 'fia:luke1', stepId: 'hear', done: true });
  emit('dG', 't2', 'v1.StudyStepMarked', { unitId: 'luke1', guideId: 'fia:luke1', stepId: 'hear', done: false });
  // The library (decision 36): the language moves to another template
  // version from two devices, hides a part the new version dropped (and
  // another device brings it back), and follows a library flow from one
  // device while another chooses the shipped one.
  emit('dE', 'lead2', 'v1.TemplateSelected', { itemId: 'langquest.fia-eng', docHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', unitPrefix: 'langquest.fia-eng', books: ['GEN', 'EXO'] });
  emit('dA', 'lead', 'v1.UnitAdded', { unitId: 'langquest.fia-eng/GEN', parentUnitId: null, kind: 'book', label: 'Genesis', order: 'b0000' });
  emit('dA', 'lead', 'v1.UnitAdded', { unitId: 'langquest.fia-eng/GEN.2.4-25', parentUnitId: 'langquest.fia-eng/GEN', kind: 'passage', label: 'Genesis 2:4–25', order: 'b0000p00001' });
  emit('dA', 'lead', 'v1.UnitHidden', { unitId: 'langquest.fia-eng/GEN.2.4-25', hidden: true });
  emit('dE', 'lead2', 'v1.UnitHidden', { unitId: 'langquest.fia-eng/GEN.2.4-25', hidden: false });

  // Reference material (references.ts): the language hides the
  // organization's recommendation offline while another admin recommends
  // it, an admin links a guide to a passage and later hides it, and a
  // version and a review record what was in front of the person.
  emit('dE', 'lead2', 'v1.ReferenceSet', { itemId: 'langquest.source.bsb', state: 'hidden' });
  emit('dA', 'lead', 'v1.ReferenceSet', { itemId: 'langquest.source.bsb', state: 'recommended' });
  emit('dA', 'lead', 'v1.ReferenceSet', { itemId: 'langquest.source.esv', state: 'inherit' });
  emit('dA', 'lead', 'v1.PassageReferenceLinked', { unitId: 'luke1', itemId: 'health-notes', linked: true });
  emit('dE', 'lead2', 'v1.PassageReferenceLinked', { unitId: 'luke1', itemId: 'health-notes', linked: false });
  emit('dB', 't1', 'v1.ReferencesUsed', { unitId: 'luke1', takeId: 'take2', items: [
    { itemId: 'langquest.source.bsb', name: 'Berean Standard Bible', kind: 'source', docHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', ref: 'LUK 1:1-4', opened: true, copyright: 'Public domain' },
    { itemId: 'langquest.fia.eng', name: 'FIA study guides (English)', kind: 'guide', ref: 'hear', opened: false }] });
  emit('dG', 't2', 'v1.ReferencesUsed', { unitId: 'luke1', takeId: 'take2', items: [
    { itemId: 'langquest.fia.eng', name: 'FIA study guides (English)', kind: 'guide', ref: 'hear', opened: true },
    { itemId: 'biblebrain.ENGESV', name: 'English Standard Version', kind: 'source', detail: 'ENGESVN1DA', opened: true }] });
  emit('dF', 'bt1', 'v1.ReferencesUsed', { unitId: 'luke1', reviewId: 'rv1', items: [{ itemId: 'guidelines', name: 'Translation Guidelines', kind: 'note', opened: false }] });

  // Ties the merge rules must settle without looking at arrival order
  // (event-sourced-sync, "Tests to write"): the same review id from two
  // devices, once at the same clock; two people undoing the same departure,
  // once at the same clock; an undo that arrives for a departure never seen;
  // a step removed while another device sets it.
  const raw = (id: string, actorId: string, deviceId: string, hlc: string, type: EventType, payload: unknown) => {
    seq += 1;
    events.push({ id, type, orgId: 'org1', streamId: 'L1', actorId, deviceId, hlc, payload, serverSeq: seq } as AnyEvent);
  };
  const tie = '001760000900000:000000:';
  raw('tie-a', 'r1', 'dC', `${tie}dC`, 'v1.ReviewRecorded', { reviewId: 'rvTie', takeId: 'take2', kindId: 'peer', outcome: 'looks_good', via: 'app' });
  raw('tie-b', 'r2', 'dC', `${tie}dC`, 'v1.ReviewRecorded', { reviewId: 'rvTie', takeId: 'take2', kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Same clock, other device state.' });
  raw('tie-c', 'r2', 'dD', '001760000950000:000000:dD', 'v1.ReviewRecorded', { reviewId: 'rvTie', takeId: 'take2', kindId: 'peer', outcome: 'needs_changes', via: 'app', comment: 'Later clock loses.' });
  raw('tie-d', 't1', 'dB', `${tie}dB`, 'v1.DepartureUndone', { departureId: 'd3' });
  raw('tie-e', 'lead', 'dB', `${tie}dB`, 'v1.DepartureUndone', { departureId: 'd3' });
  raw('tie-f', 'lead', 'dA', '001760000800000:000000:dA', 'v1.DepartureUndone', { departureId: 'never-recorded' });
  raw('tie-g', 'lead', 'dA', `${tie}dA`, 'v1.FlowSelected', { flowId: 'langquest.standard~aaaaaaaaaaaa', itemId: 'langquest.standard', docHash: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', name: 'Standard Bible Flow' });
  raw('tie-h', 'lead2', 'dE', `${tie}dE`, 'v1.FlowSelected', { flowId: 'standard_bible', name: 'Standard Bible Flow' });
  raw('tie-i', 'lead2', 'dE', '001760000700000:000000:dE', 'v1.FlowStepRemoved', { stepId: 'standard_bible/s9' });
  raw('tie-j', 'lead', 'dA', '001760000990000:000000:dA', 'v1.FlowStepSet', { stepId: 'standard_bible/s9', order: 's09', kindIds: ['local'], checkpoint: false });
  return events;
}

/**
 * One of each organization-stream event (org.ts). Separate from the
 * language fixtures; appended to them wherever a test must see every
 * catalog type.
 */
export function buildOrgFixture(): AnyEvent[] {
  const events: AnyEvent[] = [];
  let seq = 900;
  let wall = 1_800_000_000_000;
  const clock = new HlcClock('dA', () => wall);
  const emit = <T extends EventType>(type: T, payload: EventPayloads[T]) => {
    wall += 1000;
    seq += 1;
    events.push({ id: `o${seq}`, type, orgId: 'org1', streamId: '_org', actorId: 'lead', deviceId: 'dA', hlc: clock.next(), payload, serverSeq: seq } as AnyEvent);
  };
  emit('v1.OrgCreated', { name: 'Wycliffe Associates' });
  emit('v1.RoleDefined', { roleId: 'org_admin', name: 'Organization Admin', privileges: ['manage_roles', 'invite_members', 'manage_structure', 'assign_work', 'view_status'] });
  emit('v1.RoleDefined', { roleId: 'translator', name: 'Translator', privileges: ['translate', 'view_status'] });
  emit('v1.RoleRetired', { roleId: 'old_role' });
  emit('v1.MemberAdded', { profileId: 'lead', roleId: 'org_admin', scope: { level: 'org' } });
  emit('v1.MemberAdded', { profileId: 't1', roleId: 'translator', scope: { level: 'language', languageId: 'L1' } });
  emit('v1.MemberRemoved', { profileId: 'gone', scope: { level: 'language', languageId: 'L1' } });
  emit('v1.LanguageAdded', { languageId: 'L1', name: 'Dinka', code: 'din', sourceCode: 'eng' });
  emit('v1.InviteIssued', { inviteId: 'inv1', roleId: 'translator', scope: { level: 'language', languageId: 'L1' }, expiresAt: '2030-01-01T00:00:00Z' });
  emit('v1.InviteRedeemed', { inviteId: 'inv1', profileId: 't2' });
  emit('v1.JoinDecided', { requestId: 'jr1', profileId: 'someone', accepted: true });
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
    events.push({ id, type, orgId: 'org1', streamId: '_org', actorId: 'lead', deviceId, hlc, payload, serverSeq: seq } as AnyEvent);
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
  emit('v1.ReferenceRecommended', { itemId: 'langquest.source.bsb', recommended: true });
  raw('rec-a', 'dB', '001800000960500:000000:dB', 'v1.ReferenceRecommended', { itemId: 'langquest.source.esv', recommended: true });
  raw('rec-b', 'dC', '001800000960500:000000:dB', 'v1.ReferenceRecommended', { itemId: 'langquest.source.esv', recommended: false });
  // A language's identity: added twice offline (earliest wins), renamed from
  // two devices, its country and target set, and a rename that arrives for
  // a language never added.
  raw('lang-a', 'dB', '001800000961000:000000:dB', 'v1.LanguageAdded', { languageId: 'L1', name: 'Dinka (second)', code: 'dik', sourceCode: 'eng' });
  raw('lang-b', 'dB', '001800000962000:000000:dB', 'v1.LanguageRenamed', { languageId: 'L1', name: 'Thuɔŋjäŋ' });
  raw('lang-c', 'dC', '001800000962000:000000:dC', 'v1.LanguageRenamed', { languageId: 'L1', name: 'Dinka' });
  raw('lang-d', 'dB', '001800000963000:000000:dB', 'v1.LanguageCountrySet', { languageId: 'L1', country: 'SS' });
  raw('lang-e', 'dB', '001800000964000:000000:dB', 'v1.LanguageTargetSet', { languageId: 'L1', scope: 'nt', startDate: '2026-01-01', targetDate: '2027-07-01' });
  raw('lang-f', 'dB', '001800000965000:000000:dB', 'v1.LanguageRenamed', { languageId: 'L-never', name: 'Ghost' });
  // The license only opens (license.ts): a later, more closed choice from
  // an admin who was offline changes nothing, and two devices opening to the
  // same license at the same clock settle on the lower id.
  emit('v1.LicenseSet', { license: 'CC-BY-NC-ND-4.0' });
  raw('lic-a', 'dB', '001800000970000:000000:dB', 'v1.LicenseSet', { license: 'CC-BY-SA-4.0' });
  raw('lic-b', 'dC', '001800000970000:000000:dB', 'v1.LicenseSet', { license: 'CC-BY-SA-4.0' });
  raw('lic-c', 'dB', '001800000980000:000000:dB', 'v1.LicenseSet', { license: 'all-rights-reserved' });
  raw('red-a', 'dB', '001800000990000:000000:dB', 'v1.Redacted', { eventId: 'lang-f', reason: 'mistake' });

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
