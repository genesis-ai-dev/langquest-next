import { describe, expect, it } from 'vitest';
import { afterWait, FIRST_LAUNCH_WAIT_MS, waitsForUpdate } from '../src/shell/firstLaunchModel';

// The first launch after install waits a few seconds for the latest OTA
// update, and no other launch waits (firstLaunchModel.ts, decisions.md 150).

const first = { web: false, dev: false, updatesEnabled: true, embedded: true, looked: false };

describe('the first launch after install', () => {
  it('waits on a phone running the code built into the app, once', () => {
    expect(waitsForUpdate(first)).toBe(true);
    expect(waitsForUpdate({ ...first, looked: true })).toBe(false);
  });

  it('never waits in a browser, in development, without OTA updates, or once an update runs', () => {
    expect(waitsForUpdate({ ...first, web: true })).toBe(false);
    expect(waitsForUpdate({ ...first, dev: true })).toBe(false);
    expect(waitsForUpdate({ ...first, updatesEnabled: false })).toBe(false);
    expect(waitsForUpdate({ ...first, embedded: false })).toBe(false);
  });

  it('waits a few seconds at most', () => {
    expect(FIRST_LAUNCH_WAIT_MS).toBeLessThanOrEqual(5000);
  });

  it('restarts only into an update that arrived, and otherwise opens the app as it is', () => {
    expect(afterWait('fetched')).toBe('restart');
    for (const r of ['none', 'failed', 'timeout'] as const) expect(afterWait(r), r).toBe('open');
  });
});
