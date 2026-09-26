// Outcome oracles: pure judgements over evidence read from the device log,
// the device blob store and the server. The model that drove the UI has no
// say here; "done" from Jev is never a pass.

export type Verdict = 'passed' | 'product_failure' | 'inconclusive';

export interface DeviceRow {
  status: 'pending' | 'confirmed' | 'rejected';
  rejectReason: string | null;
  event: { id: string; type: string; actorId: string; payload: Record<string, unknown> };
}
export interface ServerRow { id: string; type: string; actor_id: string; payload: Record<string, unknown> }

export interface RecordingContract { actorId: string; unitIds: string[]; laneId: string }
export interface RecordingEvidence {
  /** Every event in the project partition on the device, after the journey. */
  device: DeviceRow[];
  /** Hashes with a trusted file in the device blob store, before and after the journey. */
  blobsBefore: string[];
  blobsAfter: string[];
  /** Server events for the project, read after sync had time to run. */
  server: ServerRow[];
}

export interface Check { name: string; ok: boolean; detail?: string }
export interface Outcome { verdict: Verdict; checks: Check[] }

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
    && r.event.payload['laneId'] === contract.laneId
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
        `pending in partition: ${evidence.device.filter((r) => r.status === 'pending').length}` },
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
    && contract.unitIds.includes(String(r.event.payload['unitId'])) && r.event.payload['laneId'] === contract.laneId
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
