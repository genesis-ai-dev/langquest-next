import { SNAPSHOT_SCHEDULE, shouldWriteSnapshot } from '../src/snapshotWorker';

describe('when the projection pass writes a new snapshot (decisions.md 88)', () => {
  const HOUR = 60 * 60 * 1000;
  const base = { existing: true, newEvents: 10, redaction: false, ageMs: 5 * 60 * 1000 };

  it('waits for 200 new events or an hour, so a download in progress is not overtaken every five minutes', () => {
    // Why: rewriting it after every event made slow phones' downloads go
    // stale and start over from the log (performance-audit.md item 5).
    expect(SNAPSHOT_SCHEDULE).toEqual({ minNewEvents: 200, maxAgeMs: HOUR });
    expect(shouldWriteSnapshot(base)).toBe(false);
    expect(shouldWriteSnapshot({ ...base, newEvents: 200 })).toBe(true);
    expect(shouldWriteSnapshot({ ...base, ageMs: HOUR })).toBe(true);
  });

  it('writes at once when there is none, or when the new events hold a redaction', () => {
    // Why: phones whose own checkpoint holds the redacted content wait for
    // a server snapshot past it, whether or not the server's held it; waiting
    // up to an hour sent them back to the whole log after 30 minutes.
    expect(shouldWriteSnapshot({ ...base, existing: false })).toBe(true);
    expect(shouldWriteSnapshot({ ...base, redaction: true })).toBe(true);
  });

  it('never writes for a stream that has not moved, and writes when the age is unknown', () => {
    expect(shouldWriteSnapshot({ ...base, newEvents: 0, ageMs: 2 * HOUR })).toBe(false);
    expect(shouldWriteSnapshot({ ...base, ageMs: null })).toBe(true);
  });
});
