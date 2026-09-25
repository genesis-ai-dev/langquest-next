import { judgeRecording, type DeviceRow, type RecordingEvidence, type ServerRow } from './outcome';

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
