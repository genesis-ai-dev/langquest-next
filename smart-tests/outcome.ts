// Outcome oracles: pure judgements over evidence read from the device log,
// the device blob store and the server. The model that drove the UI has no
// say here; "done" from Jev is never a pass.

type Verdict = 'passed' | 'product_failure' | 'inconclusive';

export interface DeviceRow {
  status: 'pending' | 'confirmed' | 'rejected';
  rejectReason: string | null;
  event: { id: string; type: string; actorId: string; payload: Record<string, unknown> };
}
export interface ServerRow { id: string; type: string; actor_id: string; payload: Record<string, unknown> }

interface RecordingContract { actorId: string; unitIds: string[] }
export interface RecordingEvidence {
  /** Every event in the language's stream on the device, after the journey. */
  device: DeviceRow[];
  /** Hashes with a trusted file in the device blob store, before and after the journey. */
  blobsBefore: string[];
  blobsAfter: string[];
  /** Server events for the language's stream, read after sync had time to run. */
  server: ServerRow[];
}

interface Check { name: string; ok: boolean; detail?: string }
interface Outcome { verdict: Verdict; checks: Check[] }

/**
 * A translator recorded an assigned passage: the take is an event in the
 * device log (the source of truth), its audio is on the device, nothing the
 * device wrote was rejected, and both the event and the audio reached the
 * server.
 */
export function judgeRecording(contract: RecordingContract, evidence: RecordingEvidence): Outcome {
  const recordings = evidence.device.filter((r) => r.event.type === 'v1.RecordingAdded'
    && r.event.actorId === contract.actorId
    && contract.unitIds.includes(String(r.event.payload['unitId']))
    && r.event.payload['kind'] === 'target');
  const hashes = recordings.flatMap((r) => (r.event.payload['cards'] as { hash: string }[] | undefined ?? []).map((c) => c.hash));
  const newBlobs = evidence.blobsAfter.filter((h) => !evidence.blobsBefore.includes(h));
  const rejected = evidence.device.filter((r) => r.status === 'rejected');
  const serverIds = new Set(evidence.server.map((e) => e.id));
  const stored = new Set(evidence.server.filter((e) => e.type === 'v1.BlobStored').map((e) => String(e.payload['hash'])));
  const orphans = newBlobs.filter((h) => !hashes.includes(h));

  const checks: Check[] = [
    { name: 'recording-in-device-log', ok: recordings.length > 0, detail: `${recordings.length} RecordingAdded` },
    { name: 'recording-has-audio', ok: hashes.length > 0 && hashes.every((h) => evidence.blobsAfter.includes(h)),
      detail: `${hashes.length} card(s)` },
    { name: 'no-rejected-events', ok: rejected.length === 0,
      detail: rejected.map((r) => `${r.event.type}: ${r.rejectReason}`).join('; ') || undefined },
    { name: 'no-orphaned-audio', ok: orphans.length === 0,
      detail: orphans.length ? `${orphans.length} stored take(s) with no RecordingAdded` : undefined },
    { name: 'recording-reached-server', ok: recordings.length > 0 && recordings.every((r) => serverIds.has(r.event.id)),
      detail: `device status: ${recordings.map((r) => r.status).join(', ') || 'none'}; ` +
        `pending in the language: ${evidence.device.filter((r) => r.status === 'pending').length}` },
    { name: 'audio-reached-server', ok: hashes.length > 0 && hashes.every((h) => stored.has(h)) }
  ];
  if (checks.every((c) => c.ok)) return { verdict: 'passed', checks };
  // Audio captured (a new blob) or any event written means the product was exercised.
  const exercised = newBlobs.length > 0 || recordings.length > 0 || rejected.length > 0;
  return { verdict: exercised ? 'product_failure' : 'inconclusive', checks };
}

/** The contract's takes in one reading of the device log. */
function takesIn(contract: RecordingContract, device: DeviceRow[]) {
  return device.filter((r) => r.event.type === 'v1.RecordingAdded' && r.event.actorId === contract.actorId
    && contract.unitIds.includes(String(r.event.payload['unitId']))
    && r.event.payload['kind'] === 'target');
}

/**
 * Extended offline use: a take recorded with the server unreachable is a
 * pending event with its audio on the device, survives an app restart while
 * still offline, and syncs completely once the server is back.
 */
export function judgeOfflineRecording(contract: RecordingContract, evidence: {
  offline: RecordingEvidence; afterRestart: RecordingEvidence; online: RecordingEvidence;
}): Outcome {
  const offlineTakes = takesIn(contract, evidence.offline.device);
  const ids = offlineTakes.map((r) => r.event.id);
  const hashes = offlineTakes.flatMap((r) => (r.event.payload['cards'] as { hash: string }[] | undefined ?? []).map((c) => c.hash));
  const serverIds = new Set(evidence.offline.server.map((e) => e.id));
  const restarted = new Map(takesIn(contract, evidence.afterRestart.device).map((r) => [r.event.id, r]));
  const online = judgeRecording(contract, evidence.online);

  const checks: Check[] = [
    { name: 'recorded-while-offline', ok: offlineTakes.length > 0 && offlineTakes.every((r) => r.status === 'pending'),
      detail: `${offlineTakes.length} take(s): ${offlineTakes.map((r) => r.status).join(', ') || 'none'}` },
    { name: 'audio-kept-offline', ok: hashes.length > 0 && hashes.every((h) => evidence.offline.blobsAfter.includes(h)) },
    { name: 'server-unreachable-while-offline', ok: ids.every((id) => !serverIds.has(id)),
      detail: 'a take on the server here means the journey was never offline' },
    { name: 'take-survives-offline-restart', ok: ids.length > 0 && ids.every((id) => restarted.get(id)?.status === 'pending'),
      detail: `${ids.filter((id) => restarted.has(id)).length}/${ids.length} after restart` },
    { name: 'audio-survives-offline-restart', ok: hashes.length > 0 && hashes.every((h) => evidence.afterRestart.blobsAfter.includes(h)) },
    ...online.checks.map((c) => ({ ...c, name: `after-reconnect: ${c.name}` }))
  ];
  if (checks.every((c) => c.ok)) return { verdict: 'passed', checks };
  const exercised = offlineTakes.length > 0
    || evidence.offline.blobsAfter.some((h) => !evidence.offline.blobsBefore.includes(h));
  return { verdict: exercised ? 'product_failure' : 'inconclusive', checks };
}

/** Driver endings that mean the harness, not the user, stopped. `blocked` is Jev's judgement and never softens a verdict. */
const HARNESS_STOPS = new Set(['driver_error', 'timed_out', 'budget_exhausted', 'incomplete']);
/**
 * Wrong whatever state the user was left in: a refused write, or a take in
 * the log whose audio is not on the device (ingest writes audio before the
 * event, so an unfinished user can never cause it).
 */
const ALWAYS_WRONG = /(^|: )(no-rejected-events|recording-has-audio|audio-kept-offline|audio-survives-offline-restart|take-survives-offline-restart)$/;

/**
 * A harness that stopped early (bridge or model error, timeout, budget) may
 * leave the user mid-task, e.g. with the microphone open, where uploads
 * correctly wait. Only there, and only for failures such a state can
 * explain, is a product failure softened to inconclusive.
 */
export function accountForDriver(outcome: Outcome, driverStatus: string): Outcome {
  if (!HARNESS_STOPS.has(driverStatus) || outcome.verdict !== 'product_failure') return outcome;
  const hard = outcome.checks.some((c) => !c.ok && ALWAYS_WRONG.test(c.name));
  return hard ? outcome : { ...outcome, verdict: 'inconclusive' };
}

// ---- Phase 1 journeys: versions, reviews, asks, map search -----------------

const cardsOf = (r: DeviceRow) => (r.event.payload['cardHashes'] as string[] | undefined) ?? [];
const rejectedCheck = (device: DeviceRow[]): Check => {
  const rejected = device.filter((r) => r.status === 'rejected');
  return { name: 'no-rejected-events', ok: rejected.length === 0,
    detail: rejected.map((r) => `${r.event.type}: ${r.rejectReason}`).join('; ') || undefined };
};
/** On the server by id and confirmed on the device: synced, not just written. */
const synced = (rows: DeviceRow[], server: ServerRow[]) => {
  const ids = new Set(server.map((e) => e.id));
  return rows.length > 0 && rows.every((r) => r.status === 'confirmed' && ids.has(r.event.id));
};

interface VersionContract {
  actorId: string; unitId: string;
  /** Takes that existed before the journey; a version made from them is not new. */
  priorTakeIds: string[];
  /** When the version answers feedback: the reviewed take it must name. */
  respondsToTakeId?: string;
  /** Audio of earlier versions a new version may reuse; it need not be on this device. */
  priorHashes?: string[];
}
export interface LogEvidence { device: DeviceRow[]; server: ServerRow[]; blobsAfter: string[] }

/**
 * "Save Version N": a new take of this passage by this translator is
 * composed (with audio on the device) and submitted, both events are
 * confirmed on the server, and nothing was rejected. When it answers
 * feedback, a ResponseRecorded with a note names the reviewed take.
 */
export function judgeSavedVersion(contract: VersionContract, evidence: LogEvidence): Outcome {
  const mine = (r: DeviceRow) => r.event.actorId === contract.actorId;
  const composed = evidence.device.filter((r) => mine(r) && r.event.type === 'v1.TakeComposed'
    && r.event.payload['unitId'] === contract.unitId
    && !contract.priorTakeIds.includes(String(r.event.payload['takeId'])));
  const submitted = evidence.device.filter((r) => mine(r) && r.event.type === 'v1.TakeSubmitted'
    && composed.some((c) => c.event.payload['takeId'] === r.event.payload['takeId']));
  const takeIds = submitted.map((r) => String(r.event.payload['takeId']));
  const composedSubmitted = composed.filter((c) => takeIds.includes(String(c.event.payload['takeId'])));
  const hashes = composedSubmitted.flatMap(cardsOf).filter((h) => !(contract.priorHashes ?? []).includes(h));
  const responses = evidence.device.filter((r) => mine(r) && r.event.type === 'v1.ResponseRecorded'
    && takeIds.includes(String(r.event.payload['takeId'])));

  const checks: Check[] = [
    { name: 'version-submitted', ok: submitted.length > 0,
      detail: `${composed.length} new TakeComposed, ${submitted.length} submitted` },
    { name: 'version-has-new-audio', ok: hashes.length > 0 && hashes.every((h) => evidence.blobsAfter.includes(h)),
      detail: `${hashes.length} new card(s)` },
    rejectedCheck(evidence.device),
    { name: 'version-reached-server', ok: synced([...composedSubmitted, ...submitted], evidence.server),
      detail: `device status: ${[...composedSubmitted, ...submitted].map((r) => `${r.event.type}=${r.status}`).join(', ') || 'none'}` }
  ];
  if (contract.respondsToTakeId !== undefined) {
    const answering = responses.filter((r) => r.event.payload['respondsToTakeId'] === contract.respondsToTakeId
      && String(r.event.payload['note'] ?? '').trim() !== '');
    checks.push(
      { name: 'response-names-reviewed-take', ok: answering.length > 0,
        detail: responses.map((r) => `responds to ${String(r.event.payload['respondsToTakeId'])}`).join('; ') || 'no ResponseRecorded' },
      { name: 'response-reached-server', ok: synced(answering, evidence.server) });
  }
  if (checks.every((c) => c.ok)) return { verdict: 'passed', checks };
  const exercised = composed.length > 0 || evidence.device.some((r) => r.status === 'rejected');
  return { verdict: exercised ? 'product_failure' : 'inconclusive', checks };
}

interface ReviewContract {
  reviewerId: string; takeId: string; stepId: string;
  decision: 'approve' | 'suggest_changes';
  /** Each needs an answer or a `${id}#skipped` reason. */
  requiredQuestionIds: string[];
}

/**
 * A reviewer's decision on one version: a ReviewSubmitted by them for that
 * take and step, with the decision asked for, typed feedback when asking
 * for changes, every required question handled, confirmed on the server.
 */
export function judgeReview(contract: ReviewContract, evidence: LogEvidence): Outcome {
  const reviews = evidence.device.filter((r) => r.event.type === 'v1.ReviewSubmitted' && r.event.actorId === contract.reviewerId
    && r.event.payload['takeId'] === contract.takeId && r.event.payload['stepId'] === contract.stepId);
  const decided = reviews.filter((r) => r.event.payload['decision'] === contract.decision);
  const complete = decided.filter((r) => {
    const answers = (r.event.payload['answers'] as Record<string, string> | undefined) ?? {};
    const comment = String(r.event.payload['comment'] ?? '').trim();
    return (contract.decision === 'approve' || comment !== '')
      && contract.requiredQuestionIds.every((id) => (answers[id] ?? answers[`${id}#skipped`] ?? '') !== '');
  });
  const checks: Check[] = [
    { name: 'review-in-device-log', ok: decided.length > 0,
      detail: `${reviews.length} review(s): ${reviews.map((r) => String(r.event.payload['decision'])).join(', ') || 'none'}` },
    { name: 'review-says-what-and-answers', ok: complete.length > 0,
      detail: decided.map((r) => `comment=${JSON.stringify(r.event.payload['comment'] ?? null)} answers=${JSON.stringify(r.event.payload['answers'] ?? {})}`).join('; ') || undefined },
    rejectedCheck(evidence.device),
    { name: 'review-reached-server', ok: synced(complete, evidence.server),
      detail: `device status: ${decided.map((r) => r.status).join(', ') || 'none'}` }
  ];
  if (checks.every((c) => c.ok)) return { verdict: 'passed', checks };
  // Only the other decision: the driver chose differently; nothing about this decision was shown.
  const exercised = decided.length > 0 || evidence.device.some((r) => r.status === 'rejected');
  return { verdict: exercised ? 'product_failure' : 'inconclusive', checks };
}

interface RequestContract {
  askerId: string; unitId: string; assigneeId: string;
  what: 'record' | 'check';
  /** A check request must be fixed to this kind (ADR-020). */
  kindId?: string;
}

/**
 * An ask with a due date (J-REC-10): a RequestMade by the asker for this
 * passage, naming the person, what is asked (and for a check, the kind),
 * with an ISO due date (YYYY-MM-DD), confirmed on the server and not
 * withdrawn afterwards. A legacy AssignmentMade is not a request: it has no
 * id, so the ask could not be withdrawn or answered precisely.
 */
export function judgeRequest(contract: RequestContract, evidence: LogEvidence): Outcome {
  const asks = evidence.device.filter((r) => r.event.type === 'v1.RequestMade' && r.event.actorId === contract.askerId);
  const withdrawn = new Set(evidence.device.filter((r) => r.event.type === 'v1.RequestWithdrawn').map((r) => String(r.event.payload['requestId'])));
  const right = asks.filter((r) => r.event.payload['unitId'] === contract.unitId
    && r.event.payload['assigneeId'] === contract.assigneeId && r.event.payload['what'] === contract.what
    && (contract.kindId === undefined || r.event.payload['kindId'] === contract.kindId));
  const dated = right.filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r.event.payload['dueDate'] ?? '')));
  const standing = dated.filter((r) => !withdrawn.has(String(r.event.payload['requestId'])));
  const legacy = evidence.device.filter((r) => r.event.type === 'v1.AssignmentMade' && r.event.actorId === contract.askerId
    && r.event.payload['unitId'] === contract.unitId);
  const checks: Check[] = [
    { name: 'request-in-device-log', ok: right.length > 0,
      detail: asks.map((r) => `${String(r.event.payload['unitId'])} → ${String(r.event.payload['assigneeId'])}: ${String(r.event.payload['what'])} ${String(r.event.payload['kindId'] ?? '')}`).join('; ')
        + (legacy.length ? `; ${legacy.length} legacy AssignmentMade` : '') || 'none' },
    { name: 'request-has-iso-due-date', ok: dated.length > 0, detail: right.map((r) => String(r.event.payload['dueDate'] ?? 'no date')).join(', ') || undefined },
    { name: 'request-not-withdrawn', ok: standing.length > 0 },
    rejectedCheck(evidence.device),
    { name: 'request-reached-server', ok: synced(standing, evidence.server), detail: `device status: ${right.map((r) => r.status).join(', ') || 'none'}` }
  ];
  if (checks.every((c) => c.ok)) return { verdict: 'passed', checks };
  // An AssignmentMade instead of a request is the product emitting the old fact.
  const exercised = asks.length > 0 || legacy.length > 0 || evidence.device.some((r) => r.status === 'rejected');
  return { verdict: exercised ? 'product_failure' : 'inconclusive', checks };
}

// ---- Phase 2b journeys: departures and kept feedback -----------------------

interface SetAsideContract { actorId: string; unitId: string; stepId: string; kindId?: string }

/**
 * A step (or its kind) was set aside with a reason (J-REC-5): a
 * StepSetAside by the actor for this passage and step, with a non-blank
 * reason or a voice reason, confirmed on the server, and not brought back
 * afterwards by an undo of its kind.
 */
export function judgeSetAside(contract: SetAsideContract, evidence: LogEvidence): Outcome {
  const mine = evidence.device.filter((r) => r.event.type === 'v1.StepSetAside' && r.event.actorId === contract.actorId);
  const undone = new Set(evidence.device.filter((r) => r.event.type === 'v1.DepartureUndone' && r.event.payload['departureKind'] === 'set_aside')
    .map((r) => String(r.event.payload['departureId'])));
  const right = mine.filter((r) => r.event.payload['unitId'] === contract.unitId
    && r.event.payload['stepId'] === contract.stepId
    && (contract.kindId === undefined || r.event.payload['kindId'] === undefined || r.event.payload['kindId'] === contract.kindId));
  const why = right.filter((r) => String(r.event.payload['reason'] ?? '').trim() !== '' || String(r.event.payload['reasonBlobHash'] ?? '') !== '');
  const standing = why.filter((r) => !undone.has(String(r.event.payload['departureId'])));
  const checks: Check[] = [
    { name: 'set-aside-in-device-log', ok: right.length > 0,
      detail: mine.map((r) => `${String(r.event.payload['stepId'])}/${String(r.event.payload['kindId'] ?? '-')}`).join('; ') || 'none' },
    { name: 'set-aside-says-why', ok: why.length > 0, detail: right.map((r) => JSON.stringify(r.event.payload['reason'] ?? null)).join(', ') || undefined },
    { name: 'set-aside-not-undone', ok: standing.length > 0 },
    rejectedCheck(evidence.device),
    { name: 'set-aside-reached-server', ok: synced(standing, evidence.server), detail: `device status: ${right.map((r) => r.status).join(', ') || 'none'}` }
  ];
  if (checks.every((c) => c.ok)) return { verdict: 'passed', checks };
  const exercised = mine.length > 0 || evidence.device.some((r) => r.status === 'rejected');
  return { verdict: exercised ? 'product_failure' : 'inconclusive', checks };
}

interface KeptContract {
  authorId: string;
  /** The feedback kept: a legacy review by (take, step, reviewer), or a check by id. */
  target: { takeId: string; stepId: string; reviewerId: string } | { checkId: string };
}

/**
 * The author kept the version and said why (J-REC-4): a FeedbackKept by the
 * author naming exactly this feedback, with a non-blank reason or a voice
 * reason, confirmed on the server. No new version may have been saved for
 * it: keeping is the point.
 */
export function judgeKept(contract: KeptContract, evidence: LogEvidence): Outcome {
  const mine = evidence.device.filter((r) => r.event.type === 'v1.FeedbackKept' && r.event.actorId === contract.authorId);
  const names = (r: DeviceRow) => {
    const t = contract.target;
    if ('checkId' in t) return r.event.payload['checkId'] === t.checkId;
    const lt = r.event.payload['legacyTarget'] as Record<string, unknown> | undefined;
    return !!lt && lt['takeId'] === t.takeId && lt['stepId'] === t.stepId && lt['reviewerId'] === t.reviewerId;
  };
  const right = mine.filter(names);
  const why = right.filter((r) => String(r.event.payload['reason'] ?? '').trim() !== '' || String(r.event.payload['reasonBlobHash'] ?? '') !== '');
  const revised = evidence.device.filter((r) => r.event.type === 'v1.TakeSubmitted' && r.event.actorId === contract.authorId);
  const checks: Check[] = [
    { name: 'kept-in-device-log', ok: right.length > 0, detail: `${mine.length} FeedbackKept, ${right.length} naming the feedback` },
    { name: 'kept-says-why', ok: why.length > 0, detail: right.map((r) => JSON.stringify(r.event.payload['reason'] ?? null)).join(', ') || undefined },
    { name: 'no-new-version', ok: revised.length === 0, detail: revised.length ? `${revised.length} TakeSubmitted` : undefined },
    rejectedCheck(evidence.device),
    { name: 'kept-reached-server', ok: synced(why, evidence.server), detail: `device status: ${right.map((r) => r.status).join(', ') || 'none'}` }
  ];
  if (checks.every((c) => c.ok)) return { verdict: 'passed', checks };
  // Answering with a new version is a different journey; nothing was kept.
  const exercised = mine.length > 0 || evidence.device.some((r) => r.status === 'rejected');
  return { verdict: exercised ? 'product_failure' : 'inconclusive', checks };
}

// ---- Phase 2a journeys: flows of kinds, checks of a kind ------------------

interface FlowContract { adminId: string }

/**
 * An admin built a flow with two kinds together in one step and a
 * checkpoint: after the journey, the language's steps as the admin last set
 * them include one with at least two kinds and one marked as a checkpoint,
 * every such event is confirmed on the server, and nothing was rejected.
 * Later edits of a step win (register per step), and removed steps do not count.
 */
export function judgeFlow(contract: FlowContract, evidence: LogEvidence): Outcome {
  const sets = evidence.device.filter((r) => r.event.type === 'v1.FlowStepSet' && r.event.actorId === contract.adminId);
  const removed = new Set(evidence.device.filter((r) => r.event.type === 'v1.FlowStepRemoved')
    .map((r) => String(r.event.payload['stepId'])));
  const last = new Map<string, DeviceRow>();
  for (const r of sets) last.set(String(r.event.payload['stepId']), r); // device log order is append order
  const live = [...last.values()].filter((r) => !removed.has(String(r.event.payload['stepId'])));
  const kindsOf = (r: DeviceRow) => (r.event.payload['kindIds'] as unknown[] | undefined) ?? [];
  const together = live.filter((r) => new Set(kindsOf(r)).size >= 2);
  const checkpoint = live.filter((r) => r.event.payload['checkpoint'] === true);
  const checks: Check[] = [
    { name: 'flow-steps-in-device-log', ok: live.length > 0, detail: `${sets.length} step event(s), ${live.length} live step(s)` },
    { name: 'flow-has-kinds-together', ok: together.length > 0,
      detail: live.map((r) => `${String(r.event.payload['stepId'])}: ${kindsOf(r).join(' + ')}`).join('; ') || undefined },
    { name: 'flow-has-checkpoint', ok: checkpoint.length > 0 },
    rejectedCheck(evidence.device),
    { name: 'flow-reached-server', ok: synced([...together, ...checkpoint], evidence.server),
      detail: `device status: ${live.map((r) => r.status).join(', ') || 'none'}` }
  ];
  if (checks.every((c) => c.ok)) return { verdict: 'passed', checks };
  const exercised = sets.length > 0 || evidence.device.some((r) => r.status === 'rejected');
  return { verdict: exercised ? 'product_failure' : 'inconclusive', checks };
}

interface CheckContract {
  reviewerId: string; takeId: string; kindId: string;
  outcome: 'looks_good' | 'needs_changes';
  /** Each needs an answer or a skipped-question reason. */
  requiredQuestionIds: string[];
}

/**
 * A reviewer checked one kind on a v2 flow: a CheckRecorded by them for that
 * take and kind with the outcome asked for (needs changes says what), every
 * required question answered or skipped with a reason, confirmed on the
 * server. A legacy ReviewSubmitted is not a check of a kind.
 */
export function judgeCheck(contract: CheckContract, evidence: LogEvidence): Outcome {
  const mine = evidence.device.filter((r) => r.event.type === 'v1.CheckRecorded' && r.event.actorId === contract.reviewerId
    && r.event.payload['takeId'] === contract.takeId && r.event.payload['kindId'] === contract.kindId);
  const decided = mine.filter((r) => r.event.payload['outcome'] === contract.outcome);
  const complete = decided.filter((r) => {
    const answers = (r.event.payload['answers'] as Record<string, string> | undefined) ?? {};
    const skipped = ((r.event.payload['skippedQuestions'] as { questionId: string; reason: string }[] | undefined) ?? [])
      .filter((q) => String(q.reason ?? '').trim() !== '').map((q) => q.questionId);
    const saysWhat = String(r.event.payload['comment'] ?? '').trim() !== '' || String(r.event.payload['commentBlobHash'] ?? '') !== '';
    return (contract.outcome === 'looks_good' || saysWhat)
      && contract.requiredQuestionIds.every((id) => (answers[id] ?? '') !== '' || skipped.includes(id));
  });
  const legacy = evidence.device.filter((r) => r.event.type === 'v1.ReviewSubmitted' && r.event.actorId === contract.reviewerId
    && r.event.payload['takeId'] === contract.takeId);
  const checks: Check[] = [
    { name: 'check-in-device-log', ok: decided.length > 0,
      detail: `${mine.length} check(s): ${mine.map((r) => String(r.event.payload['outcome'])).join(', ') || 'none'}${legacy.length ? `; ${legacy.length} legacy ReviewSubmitted` : ''}` },
    { name: 'check-answers-required-questions', ok: complete.length > 0,
      detail: decided.map((r) => `answers=${JSON.stringify(r.event.payload['answers'] ?? {})} skipped=${JSON.stringify(r.event.payload['skippedQuestions'] ?? [])}`).join('; ') || undefined },
    rejectedCheck(evidence.device),
    { name: 'check-reached-server', ok: synced(complete, evidence.server), detail: `device status: ${decided.map((r) => r.status).join(', ') || 'none'}` }
  ];
  if (checks.every((c) => c.ok)) return { verdict: 'passed', checks };
  // A legacy review on a v2 step is the product emitting the wrong fact.
  const exercised = decided.length > 0 || legacy.length > 0 || evidence.device.some((r) => r.status === 'rejected');
  return { verdict: exercised ? 'product_failure' : 'inconclusive', checks };
}

// ---- Phase 2b slice C: logged checks, produced content, anchored notes -----

interface LoggedCheckContract {
  loggerId: string; kindId: string; outcome: 'looks_good' | 'needs_changes';
  /** Each passage covered, by the version that was played: one CheckLogged per take. */
  takeIds: string[];
}

/**
 * A check that happened outside the app was logged (J-REC-11): one
 * CheckLogged by the logger per covered version, of the kind and outcome
 * asked for, each with its own checkId, credited to someone (a head count
 * or a named giver), all confirmed on the server. An in-app CheckRecorded
 * or a legacy ReviewSubmitted by the logger is the wrong fact: it would
 * credit the typist as the reviewer.
 */
export function judgeLoggedCheck(contract: LoggedCheckContract, evidence: LogEvidence): Outcome {
  const mine = evidence.device.filter((r) => r.event.type === 'v1.CheckLogged' && r.event.actorId === contract.loggerId);
  const right = mine.filter((r) => r.event.payload['kindId'] === contract.kindId && r.event.payload['outcome'] === contract.outcome);
  const perTake = contract.takeIds.map((t) => right.filter((r) => r.event.payload['takeId'] === t));
  const credited = right.filter((r) => (typeof r.event.payload['people'] === 'number' && (r.event.payload['people'] as number) >= 1)
    || String(r.event.payload['givenBy'] ?? '').trim() !== '');
  const ids = right.map((r) => String(r.event.payload['checkId']));
  const wrong = evidence.device.filter((r) => (r.event.type === 'v1.CheckRecorded' || r.event.type === 'v1.ReviewSubmitted')
    && r.event.actorId === contract.loggerId);
  const chosen = perTake.map((rows) => rows.find((r) => credited.includes(r))).filter((r): r is DeviceRow => r !== undefined);
  const checks: Check[] = [
    { name: 'logged-check-per-passage', ok: perTake.every((rows) => rows.length > 0),
      detail: `${mine.length} CheckLogged: ${mine.map((r) => `${String(r.event.payload['takeId'])} ${String(r.event.payload['kindId'])} ${String(r.event.payload['outcome'])}`).join('; ') || 'none'}` },
    { name: 'logged-checks-have-own-ids', ok: new Set(ids).size === ids.length },
    { name: 'logged-check-credits-someone', ok: chosen.length === contract.takeIds.length,
      detail: right.map((r) => `people=${String(r.event.payload['people'] ?? '-')} givenBy=${String(r.event.payload['givenBy'] ?? '-')}`).join('; ') || undefined },
    { name: 'not-an-in-app-review', ok: wrong.length === 0, detail: wrong.map((r) => r.event.type).join(', ') || undefined },
    rejectedCheck(evidence.device),
    { name: 'logged-checks-reached-server', ok: chosen.length === contract.takeIds.length && synced(chosen, evidence.server),
      detail: `device status: ${right.map((r) => r.status).join(', ') || 'none'}` }
  ];
  if (checks.every((c) => c.ok)) return { verdict: 'passed', checks };
  const exercised = mine.length > 0 || wrong.length > 0 || evidence.device.some((r) => r.status === 'rejected');
  return { verdict: exercised ? 'product_failure' : 'inconclusive', checks };
}

interface ProducedContract { makerId: string; unitId: string; fromTakeId: string; kindId: string }

/**
 * A back translation (J-BT-1/2): a ContentProduced
 * by the maker from the version, of the producing kind, with at least one
 * card whose audio is on the device, confirmed on the server. The maker must not have composed or recorded anything for
 * that passage: an old client would show that take as the
 * translator's newest version.
 */
export function judgeBackTranslation(contract: ProducedContract, evidence: LogEvidence): Outcome {
  const mine = evidence.device.filter((r) => r.event.type === 'v1.ContentProduced' && r.event.actorId === contract.makerId);
  const right = mine.filter((r) => r.event.payload['unitId'] === contract.unitId
    && r.event.payload['fromTakeId'] === contract.fromTakeId && r.event.payload['kindId'] === contract.kindId);
  const hashesOf = (r: DeviceRow) => ((r.event.payload['cards'] as { hash?: string }[] | undefined) ?? []).map((c) => String(c.hash ?? ''));
  const withAudio = right.filter((r) => hashesOf(r).length > 0 && hashesOf(r).every((h) => evidence.blobsAfter.includes(h)));
  const asVersion = evidence.device.filter((r) => (r.event.type === 'v1.TakeComposed' || r.event.type === 'v1.RecordingAdded' || r.event.type === 'v1.TakeSubmitted')
    && r.event.actorId === contract.makerId
    && (r.event.type === 'v1.TakeSubmitted' || (r.event.payload['unitId'] === contract.unitId)));
  const checks: Check[] = [
    { name: 'content-in-device-log', ok: right.length > 0,
      detail: mine.map((r) => `${String(r.event.payload['kindId'])} from ${String(r.event.payload['fromTakeId'])}, ${hashesOf(r).length} card(s)`).join('; ') || 'none' },
    { name: 'content-audio-on-device', ok: withAudio.length > 0 },
    { name: 'no-take-of-the-passage', ok: asVersion.length === 0, detail: asVersion.map((r) => r.event.type).join(', ') || undefined },
    rejectedCheck(evidence.device),
    { name: 'content-reached-server', ok: synced(withAudio, evidence.server), detail: `device status: ${right.map((r) => r.status).join(', ') || 'none'}` }
  ];
  if (checks.every((c) => c.ok)) return { verdict: 'passed', checks };
  const exercised = mine.length > 0 || asVersion.length > 0 || evidence.device.some((r) => r.status === 'rejected');
  return { verdict: exercised ? 'product_failure' : 'inconclusive', checks };
}

interface StudyNoteContract { authorId: string; unitId: string; materialId: string; stepId: string; text: string }

/**
 * A note at a moment in the study audio (J-STUDY-2): a ContextItemAdded by
 * the author homed on the passage, with a study anchor on that material
 * and step whose atMs is a whole number of ms above 0 (never "3:12"), the
 * text asked for, confirmed on the server. A note overwriting the language's
 * guideline field (MaterialFieldSet) is the old one-note path.
 */
export function judgeStudyNote(contract: StudyNoteContract, evidence: LogEvidence): Outcome {
  const mine = evidence.device.filter((r) => r.event.type === 'v1.ContextItemAdded' && r.event.actorId === contract.authorId);
  const anchorOf = (r: DeviceRow) => ((r.event.payload['anchors'] as Record<string, unknown>[] | undefined) ?? [])
    .find((a) => a['type'] === 'study' && a['materialId'] === contract.materialId && a['stepId'] === contract.stepId);
  const home = (r: DeviceRow) => r.event.payload['home'] as Record<string, unknown> | undefined;
  const placed = mine.filter((r) => anchorOf(r) !== undefined && home(r)?.['unitId'] === contract.unitId);
  const timed = placed.filter((r) => { const at = anchorOf(r)!['atMs']; return typeof at === 'number' && Number.isInteger(at) && at > 0; });
  const said = timed.filter((r) => String(r.event.payload['text'] ?? '').trim().toLowerCase() === contract.text.trim().toLowerCase());
  const old = evidence.device.filter((r) => r.event.type === 'v1.MaterialFieldSet' && r.event.actorId === contract.authorId
    && String(r.event.payload['materialId'] ?? '').startsWith('tg:'));
  const checks: Check[] = [
    { name: 'note-in-device-log', ok: placed.length > 0,
      detail: mine.map((r) => JSON.stringify(r.event.payload['anchors'])).join('; ') || (old.length ? `${old.length} guideline field write(s)` : 'none') },
    { name: 'note-at-a-moment', ok: timed.length > 0, detail: placed.map((r) => String(anchorOf(r)!['atMs'] ?? 'no moment')).join(', ') || undefined },
    { name: 'note-says-it', ok: said.length > 0, detail: timed.map((r) => JSON.stringify(r.event.payload['text'] ?? null)).join(', ') || undefined },
    rejectedCheck(evidence.device),
    { name: 'note-reached-server', ok: synced(said, evidence.server), detail: `device status: ${placed.map((r) => r.status).join(', ') || 'none'}` }
  ];
  if (checks.every((c) => c.ok)) return { verdict: 'passed', checks };
  const exercised = mine.length > 0 || old.length > 0 || evidence.device.some((r) => r.status === 'rejected');
  return { verdict: exercised ? 'product_failure' : 'inconclusive', checks };
}

interface SearchContract {
  /** Exactly what the user types, e.g. "luk 1". */
  query: string;
  languageId: string;
  /** Passages the query means; opening any other one is not this journey. */
  matchingUnitIds: string[];
}
interface SearchEvidence {
  /** Text the user typed, in order (the driver's own keystrokes, not its claims). */
  typed: string[];
  /** The device-local Recent list (RecentPassage[]) before and after the journey. */
  recentBefore: { unitId: string; languageId: string }[];
  recentAfter: { unitId: string; languageId: string }[];
}

/**
 * Map search opened a passage. The product persists every opened passage to
 * the device's Recent list (App.tsx, rememberRecent); that write, for a
 * passage the query means, after the query was typed, is the outcome.
 */
export function judgeMapSearch(contract: SearchContract, evidence: SearchEvidence): Outcome {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  const searched = evidence.typed.some((t) => norm(t) === norm(contract.query));
  const opened = evidence.recentAfter[0];
  const fresh = !!opened && !evidence.recentBefore.some((r) => r.unitId === opened.unitId && r.languageId === opened.languageId);
  const matches = !!opened && opened.languageId === contract.languageId && contract.matchingUnitIds.includes(opened.unitId);
  const checks: Check[] = [
    { name: 'query-typed', ok: searched, detail: `typed: ${JSON.stringify(evidence.typed)}` },
    { name: 'passage-opened', ok: fresh, detail: `recent before ${evidence.recentBefore.length}, after ${evidence.recentAfter.length}` },
    { name: 'opened-passage-matches-query', ok: matches, detail: opened ? `${opened.unitId} in ${opened.languageId}` : 'none' }
  ];
  if (checks.every((c) => c.ok)) return { verdict: 'passed', checks };
  // Without the typed query there is nothing to judge about search.
  return { verdict: searched && fresh ? 'product_failure' : 'inconclusive', checks };
}

// ---- New Language: a language and its own stream (decision 63) ------------

interface NewLanguageContract { adminId: string; name: string; code: string }
interface NewLanguageEvidence {
  /** The organization's stream on the device, where the language is added. */
  org: DeviceRow[];
  /** The new language's own stream on the device, empty if none was added. */
  device: DeviceRow[];
  server: ServerRow[];
}

/** The language this admin added under this name, if any (device log order is append order). */
export function addedLanguageId(contract: NewLanguageContract, org: DeviceRow[]): string | null {
  const mine = org.filter((r) => r.event.type === 'v1.LanguageAdded' && r.event.actorId === contract.adminId
    && String(r.event.payload['name'] ?? '').trim() === contract.name);
  return mine.length ? String(mine[mine.length - 1]!.event.payload['languageId']) : null;
}

/**
 * An admin added a language: the organization's stream adds it with the
 * name and code asked for, and its own stream starts with a template and a
 * flow, all confirmed on the server with nothing rejected. Why: a language
 * without a flow has no steps, and one without a template has no passages,
 * so nobody downstream could work in it.
 */
export function judgeNewLanguage(contract: NewLanguageContract, evidence: NewLanguageEvidence): Outcome {
  const languageId = addedLanguageId(contract, evidence.org);
  const added = evidence.org.filter((r) => r.event.type === 'v1.LanguageAdded' && r.event.payload['languageId'] === languageId);
  const codes = added.map((r) => String(r.event.payload['code']));
  const template = evidence.device.filter((r) => r.event.type === 'v1.TemplateSelected');
  const flow = evidence.device.filter((r) => r.event.type === 'v1.FlowSelected');
  const checks: Check[] = [
    { name: 'language-added-in-org', ok: languageId !== null },
    { name: 'language-is-the-one-asked-for', ok: codes.length > 0 && codes.every((c) => c === contract.code), detail: codes.join(', ') || 'none' },
    { name: 'language-has-template', ok: template.length > 0 },
    { name: 'language-has-flow', ok: flow.length > 0 },
    rejectedCheck([...evidence.org, ...evidence.device]),
    { name: 'language-reached-server', ok: synced([...template, ...flow], evidence.server),
      detail: `device status: ${[...added, ...template, ...flow].map((r) => r.status).join(', ') || 'none'}` }
  ];
  if (checks.every((c) => c.ok)) return { verdict: 'passed', checks };
  return { verdict: languageId !== null ? 'product_failure' : 'inconclusive', checks };
}
