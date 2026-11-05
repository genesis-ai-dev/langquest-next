import { describe, expect, it } from 'vitest';
import { lengthClock } from '../src/audio/clipTime';

describe('a player\'s whole length (audio/clipTime.ts)', () => {
  it('is the clips\' lengths together once each is known', () => {
    expect(lengthClock([3, 62])).toBe('1:05');
  });

  it('is not known while a clip has no length yet, never 0:00', () => {
    // Why: Ruth's feedback, a voice note with no length on the record, read "0:00" until it played (the Answer feedback video, 2026-11-02).
    expect(lengthClock([0])).toBeNull();
    expect(lengthClock([12, 0])).toBeNull();
    expect(lengthClock([])).toBeNull();
  });
});
