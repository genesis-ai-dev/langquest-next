import { describe, expect, it, vi } from 'vitest';
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

// A browser's cut (wavCut.web.ts): the session's parts are cut one after another when the session is left.
describe('cutting parts from a chunk in a browser (LAN-156)', () => {
  const chunkOf = (seconds: number) => {
    const data = new Uint8Array(seconds * MONO.rate * 2);
    // Each sample holds its own number, so a part's bytes say where they came from.
    new Int16Array(data.buffer).forEach((_, i, all) => { all[i] = i % 30000; });
    return { data, uri: URL.createObjectURL(new Blob([wavHeader(data.length, MONO) as Uint8Array<ArrayBuffer>, data], { type: 'audio/wav' })) };
  };
  const read = async (uri: string) => new Uint8Array(await (await fetch(uri)).arrayBuffer());

  it('reads the chunk once for all the parts cut from it, and each part holds its own stretch', async () => {
    const { cutWav, deleteRecorderFile } = await import('../src/audio/wavCut.web');
    const { data, uri } = chunkOf(3);
    const asked = vi.spyOn(globalThis, 'fetch');
    try {
      const parts = [await cutWav(uri, 0, 1000), await cutWav(uri, 1000, 2500), await cutWav(uri, 2900, 3000)];
      expect(asked.mock.calls.filter(([url]) => url === uri)).toHaveLength(1);
      // The chunk goes once its parts are cut: the parts are still whole.
      deleteRecorderFile(uri);
      const at = (ms: number) => Math.round(ms * MONO.rate / 1000) * 2;
      for (const [i, [from, to]] of ([[0, 1000], [1000, 2500], [2900, 3000]] as const).entries()) {
        const part = await read(parts[i]!);
        expect(readWavHeader(part.subarray(0, 44))).toEqual(MONO);
        expect(part.subarray(44)).toEqual(data.subarray(at(from), at(to)));
        deleteRecorderFile(parts[i]!);
      }
      // A chunk deleted is asked for again, not remembered.
      const again = chunkOf(1);
      await cutWav(again.uri, 0, 500);
      deleteRecorderFile(again.uri);
      await expect(cutWav(again.uri, 0, 500)).rejects.toThrow();
    } finally { asked.mockRestore(); }
  });

  it('refuses what is not a recorder WAV', async () => {
    const { cutWav } = await import('../src/audio/wavCut.web');
    const uri = URL.createObjectURL(new Blob([new Uint8Array(100)]));
    await expect(cutWav(uri, 0, 1000)).rejects.toThrow('not a recorder WAV');
  });
});
