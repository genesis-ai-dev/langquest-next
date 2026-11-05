import { encodeHlc } from '@langquest-next/core';
import { DEVICE as V2_IMPORT_DEVICE } from '../../../packages/v2-import/src/reconcile';
import { SERVER_DEVICES, arrivalStats, percentile, type ArrivalRow } from '../../../server/arrivals';

const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const row = (delayMs: number, device = 'd1'): ArrivalRow => ({
  hlc: encodeHlc(NOW - delayMs, 0, device), received_at: new Date(NOW).toISOString(), device_id: device
});

describe('arrivalStats (upload delay and clock skew, ops dashboard plan 5.4)', () => {
  it('takes the percentiles of how long work took to arrive, and the longest', () => {
    const rows = Array.from({ length: 100 }, (_, i) => row((i + 1) * 1000));
    expect(arrivalStats(rows, 5000)).toEqual({
      arrivalsSampled: 100, newEvents: 5000,
      maxUploadDelayP50Ms: 50_000, maxUploadDelayP95Ms: 95_000, maxUploadDelayMs: 100_000,
      futureStamped: 0, futureStampedInstalls: 0
    });
  });

  it('floors a stamp ahead of the server at no delay, and counts only stamps over five minutes ahead, by distinct device', () => {
    const stats = arrivalStats([row(-60_000), row(-6 * 60_000, 'a'), row(-9 * 60_000, 'a'), row(-10 * 60_000, 'b'), row(2000)], 5);
    expect(stats).toMatchObject({ arrivalsSampled: 5, futureStamped: 3, futureStampedInstalls: 2, maxUploadDelayMs: 2000, maxUploadDelayP50Ms: 0 });
  });

  it('skips rows it cannot read, and answers zeros for none', () => {
    expect(arrivalStats([{ hlc: 'nonsense', received_at: new Date(NOW).toISOString(), device_id: 'x' }, { ...row(1000), received_at: 'never' }], 2))
      .toEqual({ arrivalsSampled: 0, newEvents: 2, maxUploadDelayP50Ms: 0, maxUploadDelayP95Ms: 0, maxUploadDelayMs: 0, futureStamped: 0, futureStampedInstalls: 0 });
    expect(percentile([], 50)).toBe(0);
    expect(percentile([7], 95)).toBe(7);
  });

  it('leaves the v2 import out of the delays: it stamps work with when the v2 record changed', () => {
    // October 2026: v2 import events sampled at a day and a half late made every phone look offline that long.
    expect(SERVER_DEVICES.has(V2_IMPORT_DEVICE)).toBe(true);
    const stats = arrivalStats([row(2000), row(30 * 3_600_000, V2_IMPORT_DEVICE), row(31 * 3_600_000, V2_IMPORT_DEVICE)], 3);
    expect(stats).toMatchObject({ arrivalsSampled: 1, newEvents: 3, maxUploadDelayMs: 2000 });
  });
});
