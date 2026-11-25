import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The phone's question to the Worker about when its carried file was built
 * (src/nearby/carriedApkBuilt.ts). Why: Download the install file, Sync and Share nearby all show the
 * file, and each would ask on opening; one answer stands for ten minutes, and a failed question, as
 * offline, is asked again by the next screen rather than kept.
 */

const asked = vi.fn<(name: string) => Promise<number | null>>();
vi.mock('../src/server/carriedApk', () => ({ carriedApkBuiltMs: (name: string) => asked(name) }));

const NAME = 'r21-l1-p1-34f7634a.apk';

describe('asking the Worker when its file was built', () => {
  beforeEach(() => {
    vi.resetModules();
    asked.mockReset();
  });

  it('asks once for screens that open together, and again once the answer is ten minutes old', async () => {
    const { builtOnServer, ASK_AGAIN_MS } = await import('../src/nearby/carriedApkBuilt');
    let now = 1_000;
    asked.mockResolvedValue(1795600000000);
    const both = await Promise.all([builtOnServer(NAME, () => now), builtOnServer(NAME, () => now)]);
    expect(both).toEqual([1795600000000, 1795600000000]);
    expect(await builtOnServer(NAME, () => now)).toBe(1795600000000);
    expect(asked).toHaveBeenCalledTimes(1);
    now += ASK_AGAIN_MS;
    asked.mockResolvedValue(1795700000000);
    expect(await builtOnServer(NAME, () => now)).toBe(1795700000000);
    expect(asked).toHaveBeenCalledTimes(2);
  });

  it('keeps a Worker that does not say as an answer, but not a question that failed', async () => {
    const { builtOnServer } = await import('../src/nearby/carriedApkBuilt');
    asked.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(builtOnServer(NAME)).rejects.toThrow('Network request failed');
    asked.mockResolvedValueOnce(null);
    expect(await builtOnServer(NAME)).toBeNull();
    expect(await builtOnServer(NAME)).toBeNull();
    expect(asked).toHaveBeenCalledTimes(2);
  });
});
