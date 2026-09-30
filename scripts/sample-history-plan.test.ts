import { HISTORY_PROFILES, planHistory, silentWav, uploadedAt } from './sample-history-plan';

/**
 * The sample history must show each state the dashboard reads, relative to
 * whenever it is run: these check the plan says what the profile promises.
 */

const DAY = 86_400_000;
const NOW = Date.parse('2026-09-30T12:00:00Z');
const days = (at: number) => (NOW - at) / DAY;

describe('planHistory', () => {
  it('stays inside the work window, oldest first, and never reaches the future', () => {
    for (const [lane, p] of Object.entries(HISTORY_PROFILES)) {
      const plan = planHistory(p, 1000, NOW, lane);
      expect(plan.length).toBeGreaterThan(0);
      expect(plan.map((a) => a.at)).toEqual([...plan.map((a) => a.at)].sort((a, b) => a - b));
      for (const a of plan) expect(a.at).toBeLessThan(NOW);
      const records = plan.filter((a) => a.kind === 'record');
      expect(days(records[0]!.at)).toBeLessThanOrEqual(p.fromDaysAgo);
      expect(days(records.at(-1)!.at)).toBeGreaterThanOrEqual(p.toDaysAgo);
    }
  });

  it('records passages in order, once each, and reviews only what was recorded before', () => {
    const plan = planHistory(HISTORY_PROFILES['L-nus-sample']!, 1000, NOW, 'x');
    const recorded = plan.filter((a) => a.kind === 'record').map((a) => a.unitIndex);
    expect(recorded).toEqual(recorded.map((_, i) => i));
    const when = new Map(plan.filter((a) => a.kind === 'record').map((a) => [a.unitIndex, a.at]));
    for (const r of plan.filter((a) => a.kind === 'review')) expect(r.at).toBeGreaterThan(when.get(r.unitIndex)!);
  });

  it('a quiet language last recorded when its profile says', () => {
    const plan = planHistory(HISTORY_PROFILES['L-bfa-sample']!, 1000, NOW, 'b');
    const last = plan.filter((a) => a.kind === 'record').at(-1)!;
    expect(days(last.at)).toBeGreaterThanOrEqual(17);
    expect(days(last.at)).toBeLessThan(21);
  });

  it('only the stuck window stays off the server, and it is older than two weeks', () => {
    const p = HISTORY_PROFILES['L-bom-sample']!;
    const plan = planHistory(p, 1000, NOW, 'bom').filter((a) => a.kind === 'record');
    const stuck = plan.filter((a) => a.kind === 'record' && !a.uploaded);
    expect(stuck.length).toBeGreaterThan(0);
    for (const a of stuck) expect(days(a.at)).toBeGreaterThan(14);
    for (const a of plan.filter((a) => a.kind === 'record' && a.uploaded)) expect(days(a.at)).toBeGreaterThan(p.stuck![0]);
  });

  it('never plans more passages than the language has', () => {
    expect(planHistory(HISTORY_PROFILES['L-din-sample']!, 5, NOW, 'd').filter((a) => a.kind === 'record')).toHaveLength(5);
  });

  it('is the same plan for the same seed', () => {
    const p = HISTORY_PROFILES['L-kcg-sample']!;
    expect(planHistory(p, 1000, NOW, 's')).toEqual(planHistory(p, 1000, NOW, 's'));
  });

  it('uploads a card minutes after it was recorded', () => {
    expect(uploadedAt(NOW, 0) - NOW).toBe(12 * 60_000);
  });
});

describe('silentWav', () => {
  it('is a valid mono 16-bit WAV of the asked length, unique per id', () => {
    const a = silentWav('card-1');
    const b = silentWav('card-2');
    const v = new DataView(a.bytes.buffer);
    const text = (at: number) => String.fromCharCode(...a.bytes.slice(at, at + 4));
    expect([text(0), text(8), text(12)]).toEqual(['RIFF', 'WAVE', 'fmt ']);
    expect(v.getUint32(4, true)).toBe(a.bytes.byteLength - 8);
    expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([1, 8000, 16]);
    const data = a.bytes.findIndex((_, i) => text(i) === 'data');
    expect(v.getUint32(data + 4, true)).toBe(8000 * 1.5 * 2);
    expect(a.bytes.byteLength).toBe(data + 8 + 8000 * 1.5 * 2);
    expect(a.durationMs).toBe(1500);
    expect(a.hash).not.toBe(b.hash);
    expect(silentWav('card-1').hash).toBe(a.hash);
  });
});
