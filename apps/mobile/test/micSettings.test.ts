import { beforeEach, describe, expect, it, vi } from 'vitest';

// The microphone settings kept on the device (simple/micSettings.ts): a save
// the device refuses must not leave every recorder using settings the person
// was told were not saved (REC-047).
const store = new Map<string, string>();
let refuse = false;
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => store.get(k) ?? null,
    setItem: async (k: string, v: string) => { if (refuse) throw new Error('QuotaExceededError'); store.set(k, v); }
  }
}));
vi.mock('../src/report', () => ({ noteExpected: () => undefined }));

describe('microphone settings on the device', () => {
  beforeEach(() => { store.clear(); refuse = false; vi.resetModules(); });

  it('keeps what was saved and tells the recorders', async () => {
    const m = await import('../src/simple/micSettings');
    const heard: unknown[] = [];
    m.onMicSettings((s) => heard.push(s));
    await m.saveMicSettings({ threshold: 0.2, pauseMs: 2000 });
    expect(m.cachedMicSettings()).toEqual({ threshold: 0.2, pauseMs: 2000 });
    expect(heard).toEqual([{ threshold: 0.2, pauseMs: 2000 }]);
    expect(JSON.parse(store.get('mic-setup:v1')!)).toEqual({ threshold: 0.2, pauseMs: 2000 });
  });

  it('a save the device refuses throws and changes nothing in use', async () => {
    const m = await import('../src/simple/micSettings');
    await m.saveMicSettings({ threshold: 0.1, pauseMs: 1000 });
    const heard: unknown[] = [];
    m.onMicSettings((s) => heard.push(s));
    refuse = true;
    await expect(m.saveMicSettings({ threshold: 0.3, pauseMs: 2000 })).rejects.toThrow();
    expect(m.cachedMicSettings()).toEqual({ threshold: 0.1, pauseMs: 1000 });
    expect(heard).toEqual([]);
  });
});
