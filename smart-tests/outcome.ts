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
