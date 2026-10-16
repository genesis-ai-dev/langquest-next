import { describe, expect, it } from 'vitest';
import { restartIndex } from '../src/audio/clipPosition';

describe('where Play starts', () => {
  it('starts at the first clip when nothing is loaded', () => {
    expect(restartIndex(null, 3)).toBe(0);
  });
  it('starts the whole recording again at the end of its last clip (A11Y-015)', () => {
    expect(restartIndex({ index: 2, atEnd: true }, 3)).toBe(0);
    expect(restartIndex({ index: 0, atEnd: true }, 1)).toBe(0);
  });
  it('plays the loaded clip again when it is not the last, or not at its end', () => {
    expect(restartIndex({ index: 1, atEnd: true }, 3)).toBe(1);
    expect(restartIndex({ index: 2, atEnd: false }, 3)).toBe(2);
  });
});
