import { MemoryStore } from '@langquest-next/sync';
import { FakeServer } from '../../../packages/sync/src/testing/fakeServer';
import { openLanguage, type LanguagePlatform, type OpenLanguageInput } from '../src/sync/openLanguage';
import { RateMeter } from '../src/sync/rate';

function fakeFiles() {
  const sizes = new Map<string, number>();
  const urlListeners = new Set<() => void>();
  return {
    sizes: () => sizes, snapshot: () => new Set(sizes.keys()), sizeOf: (h: string) => sizes.get(h), formatOf: () => undefined,
    reclaim: () => {}, onChange: () => () => {},
    onUrlReady: (l: () => void) => { urlListeners.add(l); return () => { urlListeners.delete(l); }; },
    urlListeners
  };
}

function setup() {
  const server = new FakeServer();
  const files = fakeFiles();
  const probes = new Set<string>();
  let ids = 0;
  const platform = {
    store: new MemoryStore(), files, transport: server.transportFor(), budget: undefined,
    limits: { minFreeBytes: 0, maxTotalBytes: Number.MAX_SAFE_INTEGER }, isDeferred: undefined,
    client: { newId: () => `e${(ids += 1)}` }, aroundSync: undefined, build: 'test',
    newId: () => 'device-1',
    send: async () => {}, fetch: async () => {},
    timedTransfer: async (_dir: 'up' | 'down', _where: unknown, run: (t: never) => Promise<number>) => run({} as never),
    registerProbe: (name: string) => { probes.add(name); return () => { probes.delete(name); }; },
    settled: () => {}
  } as unknown as LanguagePlatform;
  const seen = { changes: 0, files: 0 };
  const input: OpenLanguageInput = {
    orgId: 'org1', languageId: 'luke', actorId: 'akol', upMeter: new RateMeter(), downMeter: new RateMeter(),
    onAnswered: () => {}, onFiles: () => { seen.files += 1; }, onChange: () => { seen.changes += 1; }, onUrlReady: () => {}
  };
  return { platform, input, probes, seen, files };
}

describe('openLanguage: the language session wired without React', () => {
  it('opens, hands over the files, publishes once started and registers its probe', async () => {
    const { platform, input, probes, seen } = setup();
    const opened = await openLanguage(input, platform);
    expect(opened).not.toBeNull();
    expect(seen).toEqual({ changes: expect.any(Number), files: 1 });
    expect(seen.changes).toBeGreaterThan(0);
    expect([...probes]).toEqual(['language:org1/luke']);
    opened?.close();
    expect(probes.size).toBe(0);
  });

  it('close stops the url subscription too', async () => {
    const { platform, input, files } = setup();
    const opened = await openLanguage(input, platform);
    expect(files.urlListeners.size).toBe(1);
    opened?.close();
    expect(files.urlListeners.size).toBe(0);
  });

  it('a cancelled open leaves nothing running', async () => {
    const { platform, input, probes, seen } = setup();
    expect(await openLanguage(input, platform, () => true)).toBeNull();
    expect(probes.size).toBe(0);
    expect(seen).toEqual({ changes: 0, files: 0 });
  });
});
