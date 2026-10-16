import { HlcClock, type LanguageState } from '@langquest-next/core';
import { MemoryStore } from '../src/memoryStore';
import { SyncClient } from '../src/syncClient';
import { FakeServer } from '../src/testing/fakeServer';
import type { Transport } from '../src/types';

/**
 * The numbers PLAN.md section 4 promises, held at the defaults a client gets
 * when nobody passes an option: invariant 12 (small requests) and invariant 10
 * (a local checkpoint every 2000 confirmed events).
 */
const unit = (i: number) => ({ unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${String(i).padStart(5, '0')}` });

function client(server: FakeServer, deviceId: string, over: { store?: MemoryStore; transport?: Transport; checkpointEvery?: number } = {}) {
  const wall = { t: 0 };
  let k = 0;
  const store = over.store ?? new MemoryStore();
  return {
    store,
    client: new SyncClient({
      orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId, store, transport: over.transport ?? server.transportFor(),
      clock: new HlcClock(deviceId, () => (wall.t += 1)), newId: () => `${deviceId}-${++k}`,
      ...(over.checkpointEvery ? { checkpointEvery: over.checkpointEvery } : {})
    })
  };
}

/** Fill the server with events from a writer that never checkpoints, so the reader under test is the only one. */
const loaded = new WeakSet<object>();
async function fill(_server: FakeServer, from: number, to: number, writer: ReturnType<typeof client>) {
  if (!loaded.has(writer)) {
    await writer.client.load();
    loaded.add(writer);
  }
  for (let i = from; i < to; i++) await writer.client.append('v1.UnitAdded', unit(i));
  while ((await writer.client.push()).more);
}

async function drain(c: Pick<SyncClient<LanguageState>, 'sync'>) {
  for (let i = 0; i < 50; i++) if (!(await c.sync()).more) return;
  throw new Error('sync never finished');
}

describe('request sizes at the defaults (invariant 12)', () => {
  it('pushes 450 events in pages of 200', async () => {
    const server = new FakeServer();
    server.maxBatch = 200;
    const sizes: number[] = [];
    const inner = server.transportFor();
    const transport: Transport = { ...inner, append: async (events) => { sizes.push(events.length); return inner.append(events); } };
    const { client: c } = client(server, 'dA', { transport });
    await c.load();
    for (let i = 0; i < 450; i++) await c.append('v1.UnitAdded', unit(i));
    expect((await c.push()).accepted).toBe(450);
    expect(sizes).toEqual([200, 200, 50]);
    expect(server.appendCalls).toBe(3);
  });

  it('pulls 1200 events in pages of 500', async () => {
    const server = new FakeServer();
    await fill(server, 0, 1200, client(server, 'writer'));
    // The writer's own pushes were never refused for size; pushing 1200 took 6 calls of at most 200.
    expect(server.appendCalls).toBe(6);
    const limits: number[] = [];
    const inner = server.transportFor();
    const transport: Transport = { ...inner, pull: async (o, s, after, limit) => { limits.push(limit); return inner.pull(o, s, after, limit); } };
    const { client: reader } = client(server, 'reader', { transport });
    await reader.load();
    await drain(reader);
    expect(Object.keys(reader.getState().units)).toHaveLength(1200);
    expect(Math.max(...limits)).toBe(500);
    expect(limits.slice(0, 3)).toEqual([500, 500, 500]);
  });
});

describe('local checkpoint at the defaults (invariant 10)', () => {
  it('is taken at 2000 confirmed events, never before, and prunes what it covers', async () => {
    const server = new FakeServer();
    const writer = client(server, 'writer');
    await fill(server, 0, 1999, writer);

    const reader = client(server, 'reader');
    await reader.client.load();
    await drain(reader.client);
    // One short of the cadence: no checkpoint, every event still in the log.
    expect((await reader.client.inspect()).checkpointSeq).toBeNull();
    expect((await reader.store.all('org1', 'p1')).length).toBe(1999);

    await fill(server, 1999, 2000, writer);
    await drain(reader.client);
    expect((await reader.client.inspect()).checkpointSeq).toBe(2000);
    // Everything the checkpoint covers is pruned from the log; the state is not lost.
    expect((await reader.store.all('org1', 'p1')).length).toBe(0);
    expect(Object.keys(reader.client.getState().units)).toHaveLength(2000);

    // A relaunch reads the checkpoint and resumes from its seq.
    const relaunched = client(server, 'reader', { store: reader.store });
    await relaunched.client.load();
    expect(Object.keys(relaunched.client.getState().units)).toHaveLength(2000);

    // Newer events stay in the log until 2000 more have been confirmed after the checkpoint.
    await fill(server, 2000, 2010, writer);
    await drain(relaunched.client);
    expect((await relaunched.client.inspect()).checkpointSeq).toBe(2000);
    expect((await relaunched.store.all('org1', 'p1')).length).toBe(10);
    expect(Object.keys(relaunched.client.getState().units)).toHaveLength(2010);
  });
});
