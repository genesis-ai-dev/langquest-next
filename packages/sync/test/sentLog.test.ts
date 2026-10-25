import { describe, expect, it } from 'vitest';
import { noteSent, readSentLog, SENT_JOIN_MS, SENT_KEEP, sameUploads, uploadsByPassage, type SentEntry } from '../src/sentLog';

const MIN = 60_000;

describe('the log of what this device sent', () => {
  it('joins what goes up for a passage within a sitting, and starts a new line after', () => {
    let log: SentEntry[] = [];
    log = noteSent(log, { at: 0, unitId: 'u1', files: 1 });
    log = noteSent(log, { at: 2 * MIN, unitId: 'u1', files: 1 });
    log = noteSent(log, { at: 3 * MIN, unitId: 'u1', changes: 4 });
    expect(log).toEqual([{ at: 3 * MIN, unitId: 'u1', files: 2, changes: 4 }]);
    log = noteSent(log, { at: 3 * MIN + SENT_JOIN_MS + 1, unitId: 'u1', files: 1 });
    expect(log.map((e) => e.files)).toEqual([1, 2]);
  });

  it('keeps passages apart, newest first, and changes about no passage on their own line', () => {
    let log: SentEntry[] = [];
    log = noteSent(log, { at: 0, unitId: 'u1', files: 1 });
    log = noteSent(log, { at: MIN, unitId: 'u2', files: 1 });
    log = noteSent(log, { at: 2 * MIN, unitId: null, changes: 1 });
    log = noteSent(log, { at: 3 * MIN, unitId: 'u1', files: 1 });
    expect(log.map((e) => [e.unitId, e.files, e.changes])).toEqual([['u1', 2, 0], [null, 0, 1], ['u2', 1, 0]]);
  });

  it('notes nothing for nothing, and keeps at most SENT_KEEP lines', () => {
    expect(noteSent([], { at: 0, unitId: 'u1' })).toEqual([]);
    let log: SentEntry[] = [];
    for (let i = 0; i < SENT_KEEP + 5; i++) log = noteSent(log, { at: i * SENT_JOIN_MS * 2, unitId: 'u1', files: 1 });
    expect(log).toHaveLength(SENT_KEEP);
    expect(log[0]!.at).toBe((SENT_KEEP + 4) * SENT_JOIN_MS * 2);
  });

  it('reads back what it wrote, and anything else as nothing', () => {
    const log = noteSent([], { at: 5, unitId: 'u1', files: 2 });
    expect(readSentLog(JSON.stringify(log))).toEqual(log);
    expect(readSentLog(null)).toEqual([]);
    expect(readSentLog('not json')).toEqual([]);
    expect(readSentLog(JSON.stringify([{ at: 'x' }, { at: 1, unitId: null, files: 0, changes: 1 }]))).toEqual([{ at: 1, unitId: null, files: 0, changes: 1 }]);
  });
});

describe('recordings waiting by passage', () => {
  const list = [{ hash: 'a', unitId: 'u1' }, { hash: 'b', unitId: 'u1' }, { hash: 'c', unitId: 'u2' }];

  it('counts what is still to go, less what went up, against the most there were', () => {
    const peaks = new Map([['u1', 9]]);
    const now = uploadsByPassage(list, new Set(['b']), peaks);
    expect(Object.fromEntries(now)).toEqual({ u1: { waiting: 1, of: 9 }, u2: { waiting: 1, of: 1 } });
    // Everything for u2 went up: it is no longer listed.
    expect(uploadsByPassage(list, new Set(['c']), new Map()).has('u2')).toBe(false);
  });

  it('says when two counts are the same', () => {
    const a = uploadsByPassage(list, new Set(), new Map());
    expect(sameUploads(a, uploadsByPassage(list, new Set(), new Map()))).toBe(true);
    expect(sameUploads(a, uploadsByPassage(list, new Set(['a']), new Map()))).toBe(false);
  });
});
