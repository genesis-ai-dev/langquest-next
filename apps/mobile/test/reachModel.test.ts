import { CHECK_AFTER_MS, NOTHING_HEARD, checked, heard, isQuiet, nextCheckAt, onlineNow } from '../src/sync/reachModel';

describe('whether the server answers (decisions.md 166)', () => {
  it('says offline when a check goes unanswered, though the phone says it is connected', () => {
    // Why: behind a VPN with no internet, the operating system says
    // "connected" and the last sync said online; only the server's silence
    // tells the truth.
    const r = checked(heard(NOTHING_HEARD, 1_000), 21_000, 29_000, false);
    expect(isQuiet(r)).toBe(true);
    expect(onlineNow({ osOffline: false, quiet: isQuiet(r), synced: true })).toBe(false);
  });

  it('an answer that came while a check was waiting wins over the check', () => {
    // The heartbeat got through at 25 s while a check asked at 21 s timed out at 29 s.
    const r = checked(heard(NOTHING_HEARD, 25_000), 21_000, 29_000, false);
    expect(isQuiet(r)).toBe(false);
  });

  it('is online again as soon as anything answers after the missed check', () => {
    const quiet = checked(NOTHING_HEARD, 21_000, 29_000, false);
    expect(isQuiet(heard(quiet, 20_000))).toBe(true);
    expect(isQuiet(heard(quiet, 30_000))).toBe(false);
    expect(isQuiet(checked(quiet, 49_000, 49_300, true))).toBe(false);
  });

  it('asks only when nothing has answered for a while, and again after each check', () => {
    expect(nextCheckAt(NOTHING_HEARD)).toBe(0);
    const r = heard(NOTHING_HEARD, 5_000);
    expect(nextCheckAt(r)).toBe(5_000 + CHECK_AFTER_MS);
    expect(nextCheckAt(heard(r, 15_000))).toBe(15_000 + CHECK_AFTER_MS);
    expect(nextCheckAt(checked(r, 25_000, 33_000, false))).toBe(33_000 + CHECK_AFTER_MS);
  });

  it('an older answer changes nothing', () => {
    const r = heard(NOTHING_HEARD, 10_000);
    expect(heard(r, 9_000)).toBe(r);
  });

  it('the operating system saying offline is offline, whatever the server last said', () => {
    expect(onlineNow({ osOffline: true, quiet: false, synced: true })).toBe(false);
    expect(onlineNow({ osOffline: false, quiet: false, synced: true })).toBe(true);
    expect(onlineNow({ osOffline: false, quiet: false, synced: null })).toBeNull();
    expect(onlineNow({ osOffline: false, quiet: false, synced: false })).toBe(false);
  });
});
