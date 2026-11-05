import { describe, expect, it } from 'vitest';
import { readWavHeader, wavHeader, wavRange } from '../src/audio/wavModel';

// Cutting a part from its session chunk (LAN-82): the chunk's header, and
// which bytes of its data a part's box covers.
const MONO = { rate: 44100, channels: 1, bits: 16 };

describe('cutting a WAV by milliseconds (wavModel.ts)', () => {
  it('reads back the header it writes, and refuses anything else', () => {
    const h = wavHeader(88200, MONO);
    expect(h).toHaveLength(44);
    expect(readWavHeader(h)).toEqual(MONO);
    expect(readWavHeader(new Uint8Array(44))).toBeNull();
    expect(readWavHeader(wavHeader(10, { ...MONO, bits: 8 }))).toBeNull();
  });

  it('cuts on whole samples, within what the file holds', () => {
    expect(wavRange(MONO, 441000, 1000, 2000)).toEqual({ start: 88200, length: 88200 });
    // A chunk cut short by a crash holds less than its box says: the box stops at what is there.
    expect(wavRange(MONO, 44100, 0, 2000)).toEqual({ start: 0, length: 44100 });
    expect(wavRange(MONO, 441000, -50, 0.01)).toEqual({ start: 0, length: 0 });
    const { start, length } = wavRange(MONO, 441000, 12.34, 56.78);
    expect(start % 2).toBe(0);
    expect(length % 2).toBe(0);
  });
});
