import { HlcClock, type BlobRef } from '@langquest-next/core';
import { Diagnostics, MemoryDiagStore } from '../src/diagnostics';
import { LanguageSession, type LocalFiles } from '../src/languageSession';
import { MemoryStore } from '../src/memoryStore';
import { NO_ANSWER_IN_TIME, withRequestLimit } from '../src/requestLimit';
import { FakeServer } from '../src/testing/fakeServer';
import { OfflineError, type Transport } from '../src/types';

function memoryFiles(): LocalFiles & { put(hash: string, size: number): void } {
  const sizes = new Map<string, number>();
  const listeners = new Set<() => void>();
  return {
    put(hash, size) { sizes.set(hash, size); for (const l of listeners) l(); },
    snapshot: () => new Set(sizes.keys()),
    sizes: () => sizes,
    sizeOf: (hash) => sizes.get(hash),
    formatOf: (hash) => (sizes.has(hash) ? 'm4a' : undefined),
    reclaim: () => {},
    onChange: (l) => { listeners.add(l); return () => { listeners.delete(l); }; }
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(ok: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error('timed out');
    await wait(5);
  }
}

describe('a call to the server that never answers (requestLimit.ts)', () => {
  it('fails as offline once it has waited the limit, and says which call it was', async () => {
    const late: string[] = [];
    const base = new FakeServer().transportFor();
    const silent: Transport = { ...base, pull: () => new Promise<never>(() => {}) };
    const t = withRequestLimit(silent, 30, (call) => late.push(call));
    const outcome = await t.pull('org1', 'luke', 0, 500).then(() => 'answered', (e: unknown) => e);
    expect(outcome).toBeInstanceOf(OfflineError);
    expect((outcome as Error).message).toBe(NO_ANSWER_IN_TIME);
    expect(late).toEqual(['pull']);
  });

  it('a call that answers in time is passed on as it is, and so is one that answers at once', async () => {
    const late: string[] = [];
    const server = new FakeServer();
    const base = server.transportFor();
    const t = withRequestLimit(base, 1000, (call) => late.push(call));
    expect(await t.pull('org1', 'luke', 0, 500)).toEqual([]);
    const stop = t.watch?.('org1', 'luke', { onPoke: () => {}, onStatus: () => {} });
    expect(typeof stop === 'function' || stop === undefined).toBe(true);
    stop?.();
    expect(late).toEqual([]);
    // A call the transport does not have stays absent, so a client still sees what it can ask.
    const { relay: _relay, ...noRelay } = base as Transport;
    expect(withRequestLimit(noRelay as Transport, 1000, () => {}).relay).toBeUndefined();
  });

  it('replays LAN-339: a pull with no answer no longer stops the language until the app restarts', async () => {
    // Why: on 2026-11-25 the network dropped while a phone's pull was out. The
    // pull never answered nor failed, the language's sync held its turn, and a
    // part recorded later waited 90 minutes to upload, while leaving the
    // language and opening it again would have hung. Now the wait ends at the
    // limit as offline, the sync runs again and the part goes up.
    const server = new FakeServer();
    const store = new MemoryStore();
    const files = memoryFiles();
    const records = new MemoryDiagStore();
    let n = 0;
    const diag = new Diagnostics({ store: records, newId: () => `d${++n}`, maxRecords: Infinity });
    const uploaded: string[] = [];
    const base = server.transportFor();
    let hang = false;
    let pulls = 0;
    let hung = 0;
    const transport: Transport = {
      ...base,
      pull: (...a) => {
        pulls += 1;
        if (!hang) return base.pull(...a);
        hung += 1;
        return new Promise<never>(() => {});
      }
    };
    const wall = { t: 0 };
    const open = () => LanguageSession.open({
      orgId: 'org1', languageId: 'luke', actorId: 'akol', deviceId: 'phone', store, transport, files,
      upload: async (ref: BlobRef) => { uploaded.push(ref.hash); server.storeBlob('org1', 'luke', ref.hash, 10); },
      download: async () => {},
      limits: { minFreeBytes: 0, maxTotalBytes: Number.MAX_SAFE_INTEGER },
      client: { clock: new HlcClock('phone', () => (wall.t += 1)), newId: () => `e${(wall.t += 1)}`, diag, requestLimitMs: 200 }
    });
    const session = await open();
    session.start();
    await until(() => session.status.online === true);

    // The network drops while a pull is out: it never answers.
    hang = true;
    session.wake();
    await until(() => hung > 0);
    const pullsAtDrop = pulls;

    // The network comes back. The person records a part, and the app wakes sync.
    hang = false;
    files.put('h1', 10);
    await session.append('v1.RecordingAdded', { recordingId: 'r1', unitId: 'Luke 1', kind: 'target', cards: [{ hash: 'h1', durationMs: 1000, format: 'm4a' }] });
    session.wake();
    session.triggerUpload();

    await until(() => uploaded.includes('h1') && session.status.pending === 0);
    expect(pulls).toBeGreaterThan(pullsAtDrop);

    // Leaving the language and opening it again does not wait on the old pull.
    session.close();
    const again = await Promise.race([open().then((s) => s), wait(2000).then(() => null)]);
    expect(again).not.toBeNull();
    again?.close();

    diag.closeTallies();
    await diag.settle();
    expect(records.records).toContainEqual(expect.objectContaining({ kind: 'expected', t: { where: 'sync request', name: 'pull', code: 'no_answer' } }));
  }, 15_000);
});
