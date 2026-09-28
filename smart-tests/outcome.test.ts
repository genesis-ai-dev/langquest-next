import {
  accountForDriver, judgeBackTranslation, judgeNewProject, judgeCheck, judgeFlow, judgeLoggedCheck, judgeStudyNote, judgeKept, judgeMapSearch, judgeOfflineRecording, judgeRecording, judgeRequest, judgeReview, judgeSavedVersion, judgeSetAside,
  type DeviceRow, type LogEvidence, type RecordingEvidence, type ServerRow
} from './outcome';

// The oracle is what makes a Jev journey mean anything. These cases pin the
// false passes and false alarms that would make the suite untrustworthy.
const contract = { actorId: 'translator', unitIds: ['luke-0'], laneId: 'L1' };
const recording = (over: Partial<DeviceRow> = {}, payload: Record<string, unknown> = {}): DeviceRow => ({
  status: 'confirmed', rejectReason: null,
  event: { id: 'r1', type: 'v1.RecordingAdded', actorId: 'translator',
    payload: { recordingId: 'rec1', unitId: 'luke-0', laneId: 'L1', kind: 'target', cards: [{ hash: 'h1' }], ...payload } },
  ...over
});
const serverHas = (...rows: Partial<ServerRow>[]): ServerRow[] =>
  rows.map((r) => ({ id: 'x', type: 'v1.Other', actor_id: 'translator', payload: {}, ...r }));
const good = (): RecordingEvidence => ({
  device: [recording()], blobsBefore: [], blobsAfter: ['h1'],
  server: serverHas({ id: 'r1', type: 'v1.RecordingAdded' }, { type: 'v1.BlobStored', payload: { hash: 'h1' } })
});

describe('recording journey oracle', () => {
  it('passes only when the take is in the log, on disk and on the server', () => {
    expect(judgeRecording(contract, good()).verdict).toBe('passed');
  });

  it('is inconclusive, not failed, when the driver never recorded anything', () => {
    const outcome = judgeRecording(contract, { device: [], blobsBefore: [], blobsAfter: [], server: [] });
    expect(outcome.verdict).toBe('inconclusive');
  });

  it('fails when audio was captured but no recording event exists (a lost take)', () => {
    const outcome = judgeRecording(contract, { device: [], blobsBefore: [], blobsAfter: ['h9'], server: [] });
    expect(outcome.verdict).toBe('product_failure');
  });

  it('fails when the server rejected anything the device wrote, even if the take is fine', () => {
    const evidence = good();
    evidence.device.push({ status: 'rejected', rejectReason: 'not a member',
      event: { id: 'e2', type: 'v1.TakeComposed', actorId: 'translator', payload: {} } });
    const outcome = judgeRecording(contract, evidence);
    expect(outcome.verdict).toBe('product_failure');
    expect(outcome.checks.find((c) => c.name === 'no-rejected-events')?.detail).toContain('not a member');
  });

  it('fails when the take never reached the server (offline-first must still sync)', () => {
    const evidence = { ...good(), server: [] };
    expect(judgeRecording(contract, evidence).verdict).toBe('product_failure');
  });

  it('fails when the event names audio the device does not have', () => {
    const evidence = { ...good(), blobsAfter: [] };
    expect(judgeRecording(contract, evidence).verdict).toBe('product_failure');
  });

  it('does not count a recording on the wrong passage, lane or by someone else', () => {
    for (const device of [[recording({}, { unitId: 'luke-1' })], [recording({}, { laneId: 'L2' })],
      [recording({ event: { ...recording().event, actorId: 'owner' } })], [recording({}, { kind: 'source' })]]) {
      const outcome = judgeRecording(contract, { ...good(), device });
      expect(outcome.verdict).not.toBe('passed');
    }
  });
});

describe('offline recording journey oracle', () => {
  const offline = (): RecordingEvidence => ({ device: [recording({ status: 'pending' })], blobsBefore: [], blobsAfter: ['h1'],
    server: serverHas({ type: 'v1.ProjectCreated' }) });
  const all = () => ({ offline: offline(), afterRestart: offline(), online: good() });

  it('passes when the take waits offline, survives a restart, then syncs', () => {
    expect(judgeOfflineRecording(contract, all()).verdict).toBe('passed');
  });

  it('fails when a restart while offline loses the pending take', () => {
    const evidence = { ...all(), afterRestart: { ...offline(), device: [] } };
    expect(judgeOfflineRecording(contract, evidence).verdict).toBe('product_failure');
  });

  it('fails when a restart while offline loses the audio but keeps the event', () => {
    const evidence = { ...all(), afterRestart: { ...offline(), blobsAfter: [] } };
    expect(judgeOfflineRecording(contract, evidence).verdict).toBe('product_failure');
  });

  it('fails when the take never syncs after reconnecting', () => {
    const evidence = { ...all(), online: { ...good(), server: [] } };
    expect(judgeOfflineRecording(contract, evidence).verdict).toBe('product_failure');
  });

  it('refuses to pass a journey that was never really offline', () => {
    const evidence = { ...all(), offline: { ...offline(), server: serverHas({ id: 'r1', type: 'v1.RecordingAdded' }) } };
    const outcome = judgeOfflineRecording(contract, evidence);
    expect(outcome.verdict).not.toBe('passed');
    expect(outcome.checks.find((c) => c.name === 'server-unreachable-while-offline')?.ok).toBe(false);
  });

  it('is inconclusive when nothing was recorded offline', () => {
    const empty = { device: [], blobsBefore: [], blobsAfter: [], server: [] };
    expect(judgeOfflineRecording(contract, { offline: empty, afterRestart: empty, online: empty }).verdict).toBe('inconclusive');
  });
});

describe('driver that did not finish', () => {
  it('turns a failure it caused (upload held while the mic is still open) into inconclusive', () => {
    const outcome = judgeRecording(contract, { ...good(), server: serverHas({ id: 'r1', type: 'v1.RecordingAdded' }) });
    expect(outcome.verdict).toBe('product_failure');
    expect(accountForDriver(outcome, 'driver_error').verdict).toBe('inconclusive');
    expect(accountForDriver(outcome, 'done').verdict).toBe('product_failure');
  });

  it('still fails on a server rejection, whatever state the user was left in', () => {
    const evidence = good();
    evidence.device.push({ status: 'rejected', rejectReason: 'not a member',
      event: { id: 'e2', type: 'v1.TakeComposed', actorId: 'translator', payload: {} } });
    expect(accountForDriver(judgeRecording(contract, evidence), 'timed_out').verdict).toBe('product_failure');
  });
});

describe('driver status never hides a broken product', () => {
  it('keeps a failure when Jev was blocked, since blocked usually means the app broke', () => {
    const outcome = judgeRecording(contract, { ...good(), server: [] });
    expect(accountForDriver(outcome, 'blocked').verdict).toBe('product_failure');
  });

  it('keeps a failure when a take in the log has no audio, even if the harness crashed', () => {
    // The live mutation that motivated this: adopt() "saved" a take without writing it.
    const outcome = judgeRecording(contract, { ...good(), blobsAfter: [] });
    expect(accountForDriver(outcome, 'driver_error').verdict).toBe('product_failure');
  });
});

// ---- Phase 1 journeys ------------------------------------------------------

const row = (id: string, type: string, actorId: string, payload: Record<string, unknown>, over: Partial<DeviceRow> = {}): DeviceRow =>
  ({ status: 'confirmed', rejectReason: null, event: { id, type, actorId, payload }, ...over });
/** The server holds every device event (confirmed means the server has it). */
const onServer = (device: DeviceRow[]): ServerRow[] => [
  { id: 'seed', type: 'v1.ProjectCreated', actor_id: 'owner', payload: {} },
  ...device.map((r) => ({ id: r.event.id, type: r.event.type, actor_id: r.event.actorId, payload: r.event.payload }))
];
const log = (device: DeviceRow[], blobsAfter: string[] = []): LogEvidence => ({ device, server: onServer(device), blobsAfter });

describe('save a version oracle', () => {
  const contract = { actorId: 'translator', unitId: 'luke-0', laneId: 'L1', priorTakeIds: [] as string[] };
  const composed = (takeId = 't2', over: Partial<DeviceRow> = {}, payload: Record<string, unknown> = {}) =>
    row(`c-${takeId}`, 'v1.TakeComposed', 'translator', { takeId, unitId: 'luke-0', laneId: 'L1', cardHashes: ['h2'], parentTakeId: null, ...payload }, over);
  const submitted = (takeId = 't2', over: Partial<DeviceRow> = {}) => row(`s-${takeId}`, 'v1.TakeSubmitted', 'translator', { takeId, questionSetIds: [] }, over);
  const response = (respondsToTakeId = 't1', note = 'Slowed down') =>
    row('r', 'v1.ResponseRecorded', 'translator', { takeId: 't2', respondsToTakeId, note });

  it('passes when a new take of the passage is composed, submitted and confirmed', () => {
    expect(judgeSavedVersion(contract, log([composed(), submitted()], ['h2'])).verdict).toBe('passed');
  });

  it('does not count a take that was only kept (recorded, never saved as a version)', () => {
    // Why: "Save Version N" is the explicit hand-off; a kept draft is not a version.
    expect(judgeSavedVersion(contract, log([composed()], ['h2'])).verdict).toBe('product_failure');
  });

  it('is inconclusive when the translator never recorded anything', () => {
    expect(judgeSavedVersion(contract, log([])).verdict).toBe('inconclusive');
  });

  it('does not count a submission that is still pending or never reached the server', () => {
    const pending = log([composed(), submitted('t2', { status: 'pending' })], ['h2']);
    expect(judgeSavedVersion(contract, pending).verdict).toBe('product_failure');
    const lost = { ...log([composed(), submitted()], ['h2']), server: onServer([composed()]) };
    expect(judgeSavedVersion(contract, lost).verdict).toBe('product_failure');
  });

  it('fails when the new version names audio the device does not have', () => {
    expect(judgeSavedVersion(contract, log([composed(), submitted()], [])).verdict).toBe('product_failure');
  });

  it('fails on any rejected event, even when the version synced', () => {
    const device = [composed(), submitted(), row('x', 'v1.TakeSelected', 'translator', {}, { status: 'rejected', rejectReason: 'not a member' })];
    expect(judgeSavedVersion(contract, log(device, ['h2'])).verdict).toBe('product_failure');
  });

  it('does not count the seeded Version 1, another passage, lane or author', () => {
    for (const device of [[composed('t1'), submitted('t1')], [composed('t2', {}, { unitId: 'luke-1' }), submitted()],
      [composed('t2', {}, { laneId: 'L2' }), submitted()],
      [row('c', 'v1.TakeComposed', 'owner', composed().event.payload), row('s', 'v1.TakeSubmitted', 'owner', { takeId: 't2' })]]) {
      expect(judgeSavedVersion({ ...contract, priorTakeIds: ['t1'] }, log(device, ['h2'])).verdict).not.toBe('passed');
    }
  });

  describe('answering feedback', () => {
    const answering = { ...contract, priorTakeIds: ['t1'], priorHashes: ['h1'], respondsToTakeId: 't1' };
    // Version 2 reuses Version 1's part (h1, not on this device) and adds h2.
    const v2 = () => composed('t2', {}, { cardHashes: ['h1', 'h2'], parentTakeId: 't1' });

    it('passes when Version 2 is submitted with a note that names the reviewed take', () => {
      expect(judgeSavedVersion(answering, log([v2(), response(), submitted()], ['h2'])).verdict).toBe('passed');
    });

    it('fails when Version 2 was saved without a response (the reviewer never hears what changed)', () => {
      expect(judgeSavedVersion(answering, log([v2(), submitted()], ['h2'])).verdict).toBe('product_failure');
    });

    it('fails when the response names another take or says nothing', () => {
      expect(judgeSavedVersion(answering, log([v2(), response('t0'), submitted()], ['h2'])).verdict).toBe('product_failure');
      expect(judgeSavedVersion(answering, log([v2(), response('t1', '  '), submitted()], ['h2'])).verdict).toBe('product_failure');
    });

    it('fails when the response stayed on the device', () => {
      const evidence = { ...log([v2(), response(), submitted()], ['h2']) };
      evidence.server = onServer([v2(), submitted()]);
      expect(judgeSavedVersion(answering, evidence).verdict).toBe('product_failure');
    });

    it('needs new audio: a "fix" made only of Version 1\'s parts is not a new recording', () => {
      const same = composed('t2', {}, { cardHashes: ['h1'], parentTakeId: 't1' });
      expect(judgeSavedVersion(answering, log([same, response(), submitted()], [])).verdict).toBe('product_failure');
    });
  });
});

describe('review oracle', () => {
  const contract = { reviewerId: 'reviewer', takeId: 't1', stepId: 'community', decision: 'suggest_changes' as const, requiredQuestionIds: ['q#meaning'] };
  const review = (payload: Record<string, unknown> = {}, over: Partial<DeviceRow> = {}, actorId = 'reviewer') =>
    row('rv', 'v1.ReviewSubmitted', actorId, { takeId: 't1', stepId: 'community', decision: 'suggest_changes',
      comment: 'Say Theophilus more slowly', answers: { 'q#meaning': '1' }, ...payload }, over);

  it('passes on a confirmed "needs changes" with feedback and the required answers', () => {
    expect(judgeReview(contract, log([review()])).verdict).toBe('passed');
  });

  it('accepts a required question left unanswered with a reason', () => {
    expect(judgeReview(contract, log([review({ answers: { 'q#meaning#skipped': 'I did not hear it' } })])).verdict).toBe('passed');
  });

  it('fails when "needs changes" carries no feedback or skips a required question silently', () => {
    // Why: the translator must be told what to change (J-REV-2), and required means required.
    expect(judgeReview(contract, log([review({ comment: undefined })])).verdict).toBe('product_failure');
    expect(judgeReview(contract, log([review({ answers: {} })])).verdict).toBe('product_failure');
  });

  it('never passes an approval as "needs changes", and does not blame the product for it', () => {
    const outcome = judgeReview(contract, log([review({ decision: 'approve' })]));
    expect(outcome.verdict).toBe('inconclusive');
  });

  it('does not count a review of another take or step, or by someone else', () => {
    for (const r of [review({ takeId: 't0' }), review({ stepId: 'consultant' }), review({}, {}, 'owner')]) {
      expect(judgeReview(contract, log([r])).verdict).not.toBe('passed');
    }
  });

  it('fails when the review is pending, missing on the server, or anything was rejected', () => {
    expect(judgeReview(contract, log([review({}, { status: 'pending' })])).verdict).toBe('product_failure');
    expect(judgeReview(contract, { ...log([review()]), server: onServer([]) }).verdict).toBe('product_failure');
    const rejected = row('x', 'v1.ReviewCommentRecorded', 'reviewer', {}, { status: 'rejected', rejectReason: 'no' });
    expect(judgeReview(contract, log([review(), rejected])).verdict).toBe('product_failure');
  });
});

describe('ask someone oracle (RequestMade)', () => {
  const contract = { askerId: 'coordinator', unitId: 'luke-2', laneId: 'L1', assigneeId: 'translator', what: 'record' as const };
  const ask = (payload: Record<string, unknown> = {}, over: Partial<DeviceRow> = {}, actorId = 'coordinator') =>
    row(`a-${actorId}`, 'v1.RequestMade', actorId, { requestId: 'rq1', unitId: 'luke-2', laneId: 'L1', what: 'record', assigneeId: 'translator', dueDate: '2026-10-02', ...payload }, over);

  it('passes on a confirmed request with an ISO due date', () => {
    expect(judgeRequest(contract, log([ask()])).verdict).toBe('passed');
  });

  it('does not count the seed\'s assignment by the owner, and fails when the product sends the legacy fact', () => {
    const seed = row('seed', 'v1.AssignmentMade', 'owner', { unitId: 'luke-2', laneId: 'L1', profileId: 'translator', role: 'translator' });
    expect(judgeRequest(contract, log([seed])).verdict).toBe('inconclusive');
    const legacy = row('a1', 'v1.AssignmentMade', 'coordinator', { unitId: 'luke-2', laneId: 'L1', profileId: 'translator', role: 'translator', dueDate: '2026-10-02' });
    expect(judgeRequest(contract, log([legacy])).verdict).toBe('product_failure');
  });

  it('fails when the date chosen did not make it into the ask, or is not an ISO date', () => {
    expect(judgeRequest(contract, log([ask({ dueDate: undefined })])).verdict).toBe('product_failure');
    expect(judgeRequest(contract, log([ask({ dueDate: 'next week' })])).verdict).toBe('product_failure');
    expect(judgeRequest(contract, log([ask({ dueDate: '2026-10-02T00:00' })])).verdict).toBe('product_failure');
  });

  it('fails when the ask names another person, passage, what or kind', () => {
    for (const payload of [{ assigneeId: 'reviewer' }, { unitId: 'luke-0' }, { what: 'check' }]) {
      expect(judgeRequest(contract, log([ask(payload)])).verdict).toBe('product_failure');
    }
    const check = { ...contract, what: 'check' as const, kindId: 'kind@1/peer' };
    expect(judgeRequest(check, log([ask({ what: 'check', kindId: 'kind@1/community' })])).verdict).toBe('product_failure');
    expect(judgeRequest(check, log([ask({ what: 'check' })])).verdict).toBe('product_failure');
    expect(judgeRequest(check, log([ask({ what: 'check', kindId: 'kind@1/peer' })])).verdict).toBe('passed');
  });

  it('fails when the ask was withdrawn afterwards (toast Undo), or never synced', () => {
    // Why: an undone ask is not an ask; passing it would hide an Undo that fires by itself.
    expect(judgeRequest(contract, log([ask(), row('w', 'v1.RequestWithdrawn', 'coordinator', { requestId: 'rq1' })])).verdict).toBe('product_failure');
    expect(judgeRequest(contract, log([ask({}, { status: 'pending' })])).verdict).toBe('product_failure');
    expect(judgeRequest(contract, { ...log([ask()]), server: onServer([]) }).verdict).toBe('product_failure');
  });
});

describe('set aside with a reason oracle', () => {
  const contract = { actorId: 'translator', unitId: 'luke-0', laneId: 'L1', stepId: 'one_check@1/s1', kindId: 'kind@1/peer' };
  const aside = (payload: Record<string, unknown> = {}, over: Partial<DeviceRow> = {}, actorId = 'translator') =>
    row('sa', 'v1.StepSetAside', actorId, { departureId: 'd1', unitId: 'luke-0', laneId: 'L1', stepId: 'one_check@1/s1', kindId: 'kind@1/peer',
      reason: 'Not needed for this passage', ...payload }, over);

  it('passes on a confirmed set-aside of the step that says why, in words or voice', () => {
    expect(judgeSetAside(contract, log([aside()])).verdict).toBe('passed');
    expect(judgeSetAside(contract, log([aside({ reason: undefined, reasonBlobHash: 'h' })])).verdict).toBe('passed');
    expect(judgeSetAside(contract, log([aside({ kindId: undefined })])).verdict).toBe('passed');
  });

  it('fails when the reason is blank, or it was brought back afterwards', () => {
    expect(judgeSetAside(contract, log([aside({ reason: ' ' })])).verdict).toBe('product_failure');
    const undo = row('u', 'v1.DepartureUndone', 'translator', { undoId: 'u1', departureId: 'd1', departureKind: 'set_aside' });
    expect(judgeSetAside(contract, log([aside(), undo])).verdict).toBe('product_failure');
  });

  it('does not count another step, kind, passage or person', () => {
    for (const r of [aside({ stepId: 'x' }), aside({ kindId: 'kind@1/community' }), aside({ unitId: 'luke-1' })]) {
      expect(judgeSetAside(contract, log([r])).verdict).toBe('product_failure');
    }
    expect(judgeSetAside(contract, log([aside({}, {}, 'owner')])).verdict).toBe('inconclusive');
  });

  it('fails when it never synced or anything was rejected', () => {
    expect(judgeSetAside(contract, log([aside({}, { status: 'pending' })])).verdict).toBe('product_failure');
    expect(judgeSetAside(contract, { ...log([aside()]), server: onServer([]) }).verdict).toBe('product_failure');
    expect(judgeSetAside(contract, log([aside(), row('x', 'v1.DepartureUndone', 'translator', {}, { status: 'rejected', rejectReason: 'no' })])).verdict).toBe('product_failure');
  });
});

describe('keep it, say why oracle', () => {
  const contract = { authorId: 'translator', target: { takeId: 't1', stepId: 'community', reviewerId: 'reviewer' } };
  const kept = (payload: Record<string, unknown> = {}, over: Partial<DeviceRow> = {}, actorId = 'translator') =>
    row('k', 'v1.FeedbackKept', actorId, { keptId: 'k1', legacyTarget: { takeId: 't1', stepId: 'community', reviewerId: 'reviewer' },
      reason: 'Listeners preferred the current wording', ...payload }, over);

  it('passes on a confirmed kept answer naming the feedback, with a reason', () => {
    expect(judgeKept(contract, log([kept()])).verdict).toBe('passed');
    expect(judgeKept({ authorId: 'translator', target: { checkId: 'c1' } }, log([kept({ legacyTarget: undefined, checkId: 'c1' })])).verdict).toBe('passed');
  });

  it('fails when it names other feedback, says nothing, or a new version was saved instead', () => {
    expect(judgeKept(contract, log([kept({ legacyTarget: { takeId: 't1', stepId: 'community', reviewerId: 'other' } })])).verdict).toBe('product_failure');
    expect(judgeKept(contract, log([kept({ reason: '' })])).verdict).toBe('product_failure');
    const submitted = row('s', 'v1.TakeSubmitted', 'translator', { takeId: 't2' });
    expect(judgeKept(contract, log([kept(), submitted])).verdict).toBe('product_failure');
  });

  it('is inconclusive when nothing was kept, and does not count someone else', () => {
    expect(judgeKept(contract, log([])).verdict).toBe('inconclusive');
    expect(judgeKept(contract, log([kept({}, {}, 'owner')])).verdict).toBe('inconclusive');
  });

  it('fails when it never synced', () => {
    expect(judgeKept(contract, log([kept({}, { status: 'pending' })])).verdict).toBe('product_failure');
    expect(judgeKept(contract, { ...log([kept()]), server: onServer([]) }).verdict).toBe('product_failure');
  });
});

describe('map search oracle', () => {
  const contract = { query: 'luk 1', laneId: 'L1', matchingUnitIds: ['luke-0', 'luke-1'] };
  const opened = (unitId = 'luke-0', laneId = 'L1') => [{ unitId, laneId }];

  it('passes when the typed query opened a passage it means', () => {
    expect(judgeMapSearch(contract, { typed: ['luk 1'], recentBefore: [], recentAfter: opened() }).verdict).toBe('passed');
  });

  it('is inconclusive when the passage was reached without searching (My Work, browsing the book)', () => {
    expect(judgeMapSearch(contract, { typed: [], recentBefore: [], recentAfter: opened() }).verdict).toBe('inconclusive');
    expect(judgeMapSearch(contract, { typed: ['luke'], recentBefore: [], recentAfter: opened() }).verdict).toBe('inconclusive');
  });

  it('does not accept a Recent entry that was already there before the journey', () => {
    expect(judgeMapSearch(contract, { typed: ['luk 1'], recentBefore: opened(), recentAfter: opened() }).verdict).not.toBe('passed');
  });

  it('fails when search opened a passage the query does not mean', () => {
    // Luke 2:1-7 is in the seeded project; "luk 1" must not lead there.
    expect(judgeMapSearch(contract, { typed: ['luk 1'], recentBefore: [], recentAfter: opened('luke-2') }).verdict).toBe('product_failure');
    expect(judgeMapSearch(contract, { typed: ['luk 1'], recentBefore: [], recentAfter: opened('luke-0', 'L2') }).verdict).toBe('product_failure');
  });

  it('is inconclusive when the query was typed but nothing was opened', () => {
    expect(judgeMapSearch(contract, { typed: ['luk 1'], recentBefore: [], recentAfter: [] }).verdict).toBe('inconclusive');
  });
});

describe('flow with kinds together and a checkpoint oracle', () => {
  const contract = { adminId: 'owner', laneId: 'L1' };
  const step = (id: string, payload: Record<string, unknown>, over: Partial<DeviceRow> = {}, actorId = 'owner') =>
    row(id, 'v2.WorkflowStepSet', actorId, { stepId: payload['stepId'] ?? id, laneId: 'L1', order: 's00', kindIds: ['kind@1/peer'], checkpoint: false, ...payload }, over);
  const good = () => [step('a', { kindIds: ['kind@1/peer', 'kind@1/back_translation'] }), step('b', { order: 's01', kindIds: ['kind@1/consultant'], checkpoint: true })];

  it('passes on confirmed steps with two kinds together and a checkpoint', () => {
    expect(judgeFlow(contract, log(good())).verdict).toBe('passed');
  });

  it('fails when the kinds were put in separate steps, or no step is a checkpoint', () => {
    // Why (J-CFG-3): "Together" is the point; two single-kind steps is a different flow.
    expect(judgeFlow(contract, log([step('a', {}), step('c', { stepId: 'c', kindIds: ['kind@1/back_translation'] }), good()[1]!])).verdict).toBe('product_failure');
    expect(judgeFlow(contract, log([good()[0]!])).verdict).toBe('product_failure');
  });

  it('does not count a step later removed, a later edit that splits the kinds, another lane, or someone else', () => {
    const removed = row('rm', 'v1.WorkflowStepRemoved', 'owner', { stepId: 'a' });
    expect(judgeFlow(contract, log([...good(), removed])).verdict).toBe('product_failure');
    expect(judgeFlow(contract, log([...good(), step('a2', { stepId: 'a', kindIds: ['kind@1/peer'] })])).verdict).toBe('product_failure');
    expect(judgeFlow(contract, log(good().map((r) => ({ ...r, event: { ...r.event, payload: { ...r.event.payload, laneId: 'L2' } } })))).verdict).toBe('inconclusive');
    expect(judgeFlow(contract, log([step('a', { kindIds: ['kind@1/peer', 'x'] }, {}, 'other'), step('b', { checkpoint: true }, {}, 'other')])).verdict).toBe('inconclusive');
  });

  it('fails when a step is pending, missing on the server, or anything was rejected', () => {
    expect(judgeFlow(contract, log([good()[0]!, { ...good()[1]!, status: 'pending' }])).verdict).toBe('product_failure');
    expect(judgeFlow(contract, { ...log(good()), server: onServer([]) }).verdict).toBe('product_failure');
    expect(judgeFlow(contract, log([...good(), row('x', 'v1.ReviewKindDefined', 'owner', {}, { status: 'rejected', rejectReason: 'no' })])).verdict).toBe('product_failure');
  });

  it('is inconclusive when nobody touched the flow', () => {
    expect(judgeFlow(contract, log([])).verdict).toBe('inconclusive');
  });
});

describe('check of a kind oracle', () => {
  const contract = { reviewerId: 'reviewer', takeId: 't1', kindId: 'kind@1/peer', outcome: 'looks_good' as const, requiredQuestionIds: ['q#meaning'] };
  const check = (payload: Record<string, unknown> = {}, over: Partial<DeviceRow> = {}, actorId = 'reviewer') =>
    row('ck', 'v1.CheckRecorded', actorId, { checkId: 'c1', unitId: 'luke-0', laneId: 'L1', takeId: 't1', kindId: 'kind@1/peer',
      outcome: 'looks_good', answers: { 'q#meaning': '5' }, ...payload }, over);

  it('passes on a confirmed check of the kind with the required answers', () => {
    expect(judgeCheck(contract, log([check()])).verdict).toBe('passed');
    expect(judgeCheck(contract, log([check({ answers: {}, skippedQuestions: [{ questionId: 'q#meaning', reason: 'Not asked here' }] })])).verdict).toBe('passed');
  });

  it('fails when a v2 step got a legacy ReviewSubmitted instead of a check', () => {
    // Why: old and new clients read reviews differently; a v2 kind needs CheckRecorded or the record never clears it.
    const legacy = row('rv', 'v1.ReviewSubmitted', 'reviewer', { takeId: 't1', stepId: 'one_check@1/s1', decision: 'approve' });
    expect(judgeCheck(contract, log([legacy])).verdict).toBe('product_failure');
  });

  it('fails on a skipped required question with no reason, or needs changes that says nothing', () => {
    expect(judgeCheck(contract, log([check({ answers: {} })])).verdict).toBe('product_failure');
    expect(judgeCheck(contract, log([check({ answers: {}, skippedQuestions: [{ questionId: 'q#meaning', reason: ' ' }] })])).verdict).toBe('product_failure');
    const needs = { ...contract, outcome: 'needs_changes' as const };
    expect(judgeCheck(needs, log([check({ outcome: 'needs_changes' })])).verdict).toBe('product_failure');
    expect(judgeCheck(needs, log([check({ outcome: 'needs_changes', commentBlobHash: 'h' })])).verdict).toBe('passed');
  });

  it('does not count another take, kind or reviewer, and never passes the other outcome', () => {
    for (const c of [check({ takeId: 't0' }), check({ kindId: 'kind@1/community' }), check({}, {}, 'owner')]) {
      expect(judgeCheck(contract, log([c])).verdict).not.toBe('passed');
    }
    expect(judgeCheck(contract, log([check({ outcome: 'needs_changes', comment: 'x' })])).verdict).toBe('inconclusive');
  });

  it('fails when the check is pending, missing on the server, or anything was rejected', () => {
    expect(judgeCheck(contract, log([check({}, { status: 'pending' })])).verdict).toBe('product_failure');
    expect(judgeCheck(contract, { ...log([check()]), server: onServer([]) }).verdict).toBe('product_failure');
    expect(judgeCheck(contract, log([check(), row('x', 'v1.ReviewCommentRecorded', 'reviewer', {}, { status: 'rejected', rejectReason: 'no' })])).verdict).toBe('product_failure');
  });
});

describe('logged check oracle (J-REC-11)', () => {
  const contract = { loggerId: 'translator', kindId: 'kind@1/community', outcome: 'looks_good' as const, takeIds: ['t1', 't2'] };
  const logged = (id: string, takeId: string, payload: Record<string, unknown> = {}, over: Partial<DeviceRow> = {}, actorId = 'translator') =>
    row(id, 'v1.CheckLogged', actorId, { checkId: `c-${id}`, unitId: 'u', laneId: 'L1', takeId, kindId: 'kind@1/community',
      outcome: 'looks_good', people: 12, place: 'Bor church', ...payload }, over);

  it('passes on one confirmed, credited check per passage, each with its own id', () => {
    expect(judgeLoggedCheck(contract, log([logged('a', 't1'), logged('b', 't2', { people: undefined, givenBy: 'Elder Deng' })])).verdict).toBe('passed');
  });

  it('fails when only one of the two passages got the check', () => {
    // Why: "also covered in this session" is the point; the second passage's record would stay open.
    expect(judgeLoggedCheck(contract, log([logged('a', 't1')])).verdict).toBe('product_failure');
  });

  it('fails when both passages share one check id, or nobody is credited', () => {
    expect(judgeLoggedCheck(contract, log([logged('a', 't1', { checkId: 'same' }), logged('b', 't2', { checkId: 'same' })])).verdict).toBe('product_failure');
    expect(judgeLoggedCheck(contract, log([logged('a', 't1', { people: undefined }), logged('b', 't2', { people: undefined })])).verdict).toBe('product_failure');
  });

  it('fails when the logger wrote an in-app review instead: that credits the typist', () => {
    const inApp = row('r', 'v1.CheckRecorded', 'translator', { checkId: 'x', takeId: 't1', kindId: 'kind@1/community', outcome: 'looks_good' });
    expect(judgeLoggedCheck(contract, log([logged('a', 't1'), logged('b', 't2'), inApp])).verdict).toBe('product_failure');
    expect(judgeLoggedCheck(contract, log([inApp])).verdict).toBe('product_failure');
  });

  it('does not count another kind, outcome or logger; nothing written is inconclusive', () => {
    expect(judgeLoggedCheck(contract, log([logged('a', 't1', { kindId: 'kind@1/peer' }), logged('b', 't2', { kindId: 'kind@1/peer' })])).verdict).not.toBe('passed');
    expect(judgeLoggedCheck(contract, log([logged('a', 't1', { outcome: 'needs_changes', comment: 'x' }), logged('b', 't2', { outcome: 'needs_changes', comment: 'x' })])).verdict).not.toBe('passed');
    expect(judgeLoggedCheck(contract, log([logged('a', 't1', {}, {}, 'owner'), logged('b', 't2', {}, {}, 'owner')])).verdict).toBe('inconclusive');
  });

  it('fails when a check is pending or missing on the server', () => {
    expect(judgeLoggedCheck(contract, log([logged('a', 't1'), logged('b', 't2', {}, { status: 'pending' })])).verdict).toBe('product_failure');
    expect(judgeLoggedCheck(contract, { ...log([logged('a', 't1'), logged('b', 't2')]), server: onServer([logged('a', 't1')]) }).verdict).toBe('product_failure');
  });
});

describe('back translation oracle (J-BT-1)', () => {
  const contract = { makerId: 'reviewer', unitId: 'luke-0', laneId: 'L1', fromTakeId: 'v1', kindId: 'kind@1/back_translation' };
  const produced = (payload: Record<string, unknown> = {}, over: Partial<DeviceRow> = {}) =>
    row('p', 'v1.ContentProduced', 'reviewer', { contentId: 'b1', unitId: 'luke-0', laneId: 'L1', fromTakeId: 'v1',
      kindId: 'kind@1/back_translation', language: 'eng', cards: [{ hash: 'bt', durationMs: 1000 }], ...payload }, over);

  it('passes on confirmed content from the version with its audio on the device', () => {
    expect(judgeBackTranslation(contract, log([produced()], ['bt'])).verdict).toBe('passed');
  });

  it('fails when the back translation was also composed as a take in the source lane', () => {
    // Why (analysis row 21): an old client would show that take as the translator's newest version.
    const take = row('t', 'v1.TakeComposed', 'reviewer', { takeId: 'x', unitId: 'luke-0', laneId: 'L1', cardHashes: ['bt'], parentTakeId: null });
    expect(judgeBackTranslation(contract, log([produced(), take], ['bt'])).verdict).toBe('product_failure');
    expect(judgeBackTranslation(contract, log([take], ['bt'])).verdict).toBe('product_failure');
  });

  it('fails without its audio on the device, or when made from another version or kind', () => {
    expect(judgeBackTranslation(contract, log([produced()], [])).verdict).toBe('product_failure');
    expect(judgeBackTranslation(contract, log([produced({ fromTakeId: 'v0' })], ['bt'])).verdict).toBe('product_failure');
    expect(judgeBackTranslation(contract, log([produced({ kindId: 'kind@1/peer' })], ['bt'])).verdict).toBe('product_failure');
  });

  it('fails when pending or rejected; nothing written is inconclusive', () => {
    expect(judgeBackTranslation(contract, log([produced({}, { status: 'pending' })], ['bt'])).verdict).toBe('product_failure');
    expect(judgeBackTranslation(contract, log([produced({}, { status: 'rejected', rejectReason: 'privilege' })], ['bt'])).verdict).toBe('product_failure');
    expect(judgeBackTranslation(contract, log([], ['bt'])).verdict).toBe('inconclusive');
  });
});

describe('study note at a moment oracle (J-STUDY-2)', () => {
  const contract = { authorId: 'translator', unitId: 'luke-0', laneId: 'L1', materialId: 'fia', stepId: 'stage', text: 'Ask who the crowd is' };
  const note = (anchor: Record<string, unknown> = {}, payload: Record<string, unknown> = {}, over: Partial<DeviceRow> = {}) =>
    row('n', 'v1.ContextItemAdded', 'translator', { itemId: 'n1', kind: 'note', home: { level: 'unit', laneId: 'L1', unitId: 'luke-0' },
      anchors: [{ type: 'study', materialId: 'fia', stepId: 'stage', atMs: 1800, ...anchor }], text: 'Ask who the crowd is', ...payload }, over);

  it('passes on a confirmed note at a whole-ms moment on the step', () => {
    expect(judgeStudyNote(contract, log([note()])).verdict).toBe('passed');
  });

  it('fails when the moment is missing, zero, or text like "0:01"', () => {
    // Why: integer ms is what sorts the notes and seeks the audio back to the moment.
    for (const atMs of [undefined, 0, '0:01', 1.5]) expect(judgeStudyNote(contract, log([note({ atMs })])).verdict).toBe('product_failure');
  });

  it('fails when the note lands on another step, passage, or says something else', () => {
    expect(judgeStudyNote(contract, log([note({ stepId: 'hear' })])).verdict).toBe('product_failure');
    expect(judgeStudyNote(contract, log([note({}, { home: { level: 'unit', unitId: 'luke-1' } })])).verdict).toBe('product_failure');
    expect(judgeStudyNote(contract, log([note({}, { text: 'something else' })])).verdict).toBe('product_failure');
  });

  it('fails when the old one-note guideline field was written instead', () => {
    const old = row('m', 'v1.MaterialFieldSet', 'translator', { materialId: 'tg:L1', fieldId: 'luke-0', text: 'Ask who the crowd is' });
    expect(judgeStudyNote(contract, log([old])).verdict).toBe('product_failure');
  });

  it('fails when pending; nothing written is inconclusive', () => {
    expect(judgeStudyNote(contract, log([note({}, {}, { status: 'pending' })])).verdict).toBe('product_failure');
    expect(judgeStudyNote(contract, log([])).verdict).toBe('inconclusive');
  });
});

describe('new project is one language oracle', () => {
  const contract = { adminId: 'owner', name: 'Mark in Dinka', languoidId: 'din' };
  const org = (over: Partial<DeviceRow> = {}) => [row('reg', 'v1.ProjectRegistered', 'owner', { projectId: 'p9', name: 'Mark in Dinka' }, over)];
  const project = (lanes: [string, string][] = [['L-din', 'din']]) => [
    row('pc', 'v1.ProjectCreated', 'owner', { name: 'Mark in Dinka', sourceLanguoidId: 'eng' }),
    ...lanes.map(([laneId, languoidId], i) => row(`lane${i}`, 'v1.LaneAdded', 'owner', { laneId, languoidId }))
  ];
  const evidence = (device: DeviceRow[], orgRows = org()) => ({ org: orgRows, device, server: onServer([...orgRows, ...device]) });

  it('passes on a registered project born with its one language, synced', () => {
    expect(judgeNewProject(contract, evidence(project())).verdict).toBe('passed');
  });
  it('fails a project with no language or two languages', () => {
    // Why: the project is the sync and permission bucket (decision 28).
    expect(judgeNewProject(contract, evidence(project([]))).verdict).toBe('product_failure');
    expect(judgeNewProject(contract, evidence(project([['L-din', 'din'], ['L-nus', 'nus']]))).verdict).toBe('product_failure');
  });
  it('fails the wrong language, a rejected event, or events that never reached the server', () => {
    expect(judgeNewProject(contract, evidence(project([['L-nus', 'nus']]))).verdict).toBe('product_failure');
    const rejected = project(); rejected[1] = { ...rejected[1]!, status: 'rejected', rejectReason: 'a project has one language' };
    expect(judgeNewProject(contract, evidence(rejected)).verdict).toBe('product_failure');
    expect(judgeNewProject(contract, { org: org(), device: project(), server: onServer(org()) }).verdict).toBe('product_failure');
  });
  it('is inconclusive when no project was registered under that name', () => {
    expect(judgeNewProject(contract, evidence([], [])).verdict).toBe('inconclusive');
    expect(judgeNewProject(contract, evidence(project(), org({ event: { id: 'reg', type: 'v1.ProjectRegistered', actorId: 'owner', payload: { projectId: 'p9', name: 'Something else' } } }))).verdict).toBe('inconclusive');
  });
});
