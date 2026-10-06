import { HlcClock, decodeHlc } from '@langquest-next/core';
import { MemoryStore } from '../src/memoryStore';
import { ensureDeviceId } from '../src/device';
import { SyncClient } from '../src/syncClient';

describe('device identity and clock survive restarts', () => {
  it('ensureDeviceId creates one id per store and returns it every time', async () => {
    let n = 0;
    const gen = () => `dev-${++n}`;
    const a = new MemoryStore();
    const b = new MemoryStore();
    expect(await ensureDeviceId(a, gen)).toBe('dev-1');
    expect(await ensureDeviceId(a, gen)).toBe('dev-1');
    expect(await ensureDeviceId(b, gen)).toBe('dev-2');
  });

  it('a relaunched client keeps counting from its persisted clock', async () => {
    // Why: HlcClock in memory forgets everything on restart. If the phone's
    // clock was corrected backwards meanwhile, the next event would sort
    // before the previous one and lose every register conflict.
    const store = new MemoryStore();
    const mk = (now: number) =>
      new SyncClient({ orgId: 'o', partitionId: 'p', actorId: 'a', deviceId: 'dA', store, transport: fakeTransport(), now: () => now });
    const first = mk(2_000_000);
    await first.load();
    const e1 = await first.append('v1.LaneAdded', { laneId: 'L1', languoidId: 'x' });

    const second = mk(500);
    await second.load();
    const e2 = await second.append('v1.LaneAdded', { laneId: 'L2', languoidId: 'x' });
    expect(e2.hlc > e1.hlc).toBe(true);
    expect(decodeHlc(e2.hlc).nodeId).toBe('dA');
  });

  it('a received remote clock is persisted too', async () => {
    const store = new MemoryStore();
    const remote = new HlcClock('dB', () => 9_000_000).next();
    const transport = fakeTransport([
      { id: 'r1', type: 'v1.LaneAdded', orgId: 'o', partitionId: 'p', actorId: 'b', deviceId: 'dB', hlc: remote, payload: { laneId: 'L9', languoidId: 'x' }, serverSeq: 1 }
    ]);
    const c1 = new SyncClient({ orgId: 'o', partitionId: 'p', actorId: 'a', deviceId: 'dA', store, transport, now: () => 100 });
    await c1.load();
    await c1.pull();
    const c2 = new SyncClient({ orgId: 'o', partitionId: 'p', actorId: 'a', deviceId: 'dA', store, transport, now: () => 100 });
    await c2.load();
    const e = await c2.append('v1.LaneAdded', { laneId: 'L1', languoidId: 'x' });
    expect(e.hlc > remote).toBe(true);
  });
});

function fakeTransport(log: import('@langquest-next/core').AnyEvent[] = []) {
  return {
    append: async (events: import('@langquest-next/core').AnyEvent[]) =>
      events.map((e, i) => ({ id: e.id, accepted: true, serverSeq: i + 1, reason: null })),
    pull: async (_o: string, _p: string, after: number) => log.filter((e) => (e.serverSeq ?? 0) > after),
    snapshotMeta: async () => null,
    snapshotChunk: async () => null
  };
}
