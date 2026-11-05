import { describe, expect, it } from 'vitest';
import { INSPECT_EVERY_MS, keepIfSame } from '../src/account/syncInspectionModel';

describe('the sync screen\'s polling (syncInspectionModel.ts)', () => {
  it('keeps the value it had when a poll finds the same, so nothing redraws', () => {
    const was = { pending: [], rejected: [{ id: 'a', reason: 'x' }], total: 4, cursor: 9, checkpointSeq: null };
    expect(keepIfSame(was, structuredClone(was))).toBe(was);
    expect(keepIfSame(null, null)).toBe(null);
  });
  it('takes the new value when anything differs', () => {
    const was = { total: 4, cursor: 9 };
    const next = { total: 5, cursor: 9 };
    expect(keepIfSame(was, next)).toBe(next);
    expect(keepIfSame(null as typeof was | null, was)).toBe(was);
  });
  it('polls every three seconds', () => { expect(INSPECT_EVERY_MS).toBe(3000); });
});
