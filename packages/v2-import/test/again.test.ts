import { describe, expect, it } from 'vitest';
import { again } from '../src/pass';

describe('again: a file step after a passing failure', () => {
  const waits: number[] = [];
  const wait = async (ms: number) => { waits.push(ms); };

  it('tries again after a hiccup and returns what the step gave', async () => {
    waits.length = 0;
    let calls = 0;
    const out = await again(async () => { calls += 1; if (calls < 3) throw new Error('upload (502)'); return 'stored'; }, wait);
    expect(out).toBe('stored');
    expect(calls).toBe(3);
    expect(waits).toEqual([1000, 2000]);
  });

  it('gives up after five tries with the last failure', async () => {
    waits.length = 0;
    let calls = 0;
    await expect(again(async () => { calls += 1; throw new Error(`down ${calls}`); }, wait)).rejects.toThrow('down 5');
    expect(waits).toEqual([1000, 2000, 4000, 8000]);
  });
});
