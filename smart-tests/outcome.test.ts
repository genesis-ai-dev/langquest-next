import {
  accountForDriver, judgeAsk, judgeCheck, judgeFlow, judgeMapSearch, judgeOfflineRecording, judgeRecording, judgeReview, judgeSavedVersion,
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

describe('ask someone oracle', () => {
  const contract = { askerId: 'coordinator', unitId: 'luke-2', laneId: 'L1', profileId: 'translator', role: 'translator' };
  const ask = (payload: Record<string, unknown> = {}, over: Partial<DeviceRow> = {}, actorId = 'coordinator') =>
    row(`a-${actorId}`, 'v1.AssignmentMade', actorId, { unitId: 'luke-2', laneId: 'L1', profileId: 'translator', role: 'translator', dueDate: '2026-10-02', ...payload }, over);

  it('passes on a confirmed ask with an ISO due date', () => {
    expect(judgeAsk(contract, log([ask()])).verdict).toBe('passed');
  });

  it('does not count the seed\'s assignment by the owner (same passage and person, no date)', () => {
    expect(judgeAsk(contract, log([ask({ dueDate: undefined }, {}, 'owner')])).verdict).toBe('inconclusive');
  });

  it('fails when the date chosen did not make it into the ask', () => {
    expect(judgeAsk(contract, log([ask({ dueDate: undefined })])).verdict).toBe('product_failure');
    expect(judgeAsk(contract, log([ask({ dueDate: 'next week' })])).verdict).toBe('product_failure');
  });

  it('fails when the ask names another person, passage or role', () => {
    for (const payload of [{ profileId: 'reviewer' }, { unitId: 'luke-0' }, { role: 'reviewer' }]) {
      expect(judgeAsk(contract, log([ask(payload)])).verdict).toBe('product_failure');
    }
  });

  it('fails when the ask never synced', () => {
    expect(judgeAsk(contract, log([ask({}, { status: 'pending' })])).verdict).toBe('product_failure');
    expect(judgeAsk(contract, { ...log([ask()]), server: onServer([]) }).verdict).toBe('product_failure');
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
