import { HlcClock } from '@langquest-next/core';
import { MemoryStore, SyncClient, type SupabaseTransport, type Transport } from '@langquest-next/sync';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeServer } from '../../../packages/sync/src/testing/fakeServer';
import { LANGUAGE_MATERIALIZER } from '../../../packages/sync/src/syncClient';
import { gated, setBelowMinimum } from '../src/appVersion/syncGate';

/**
 * Below the minimum version the phone sends its waiting work first, then
 * stops downloading (syncGate.ts, decisions.md 150), and a send that fails
 * leaves the work waiting on the phone.
 */

const unit = (i: number) => ({ unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${i}` });

function device(transport: Transport, deviceId: string, wall: { t: number }) {
  const store = new MemoryStore();
  let n = 0;
  const client = new SyncClient({
    orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId, store, transport,
    materializer: LANGUAGE_MATERIALIZER,
    clock: new HlcClock(deviceId, () => (wall.t += 1)),
    newId: () => `${deviceId}-${++n}`
  });
  return { client, store };
}

afterEach(() => setBelowMinimum(false));

describe('below the minimum version', () => {
  it('sends the waiting work, then stops downloading other people\'s changes', async () => {
    const server = new FakeServer();
    const wall = { t: 0 };
    const other = device(server.transportFor(), 'dB', wall);
    await other.client.load();
    await other.client.append('v1.UnitAdded', unit(2));
    await other.client.sync();

    const old = device(gated(server.transportFor() as unknown as SupabaseTransport), 'dA', wall);
    await old.client.load();
    await old.client.append('v1.UnitAdded', unit(1));
    setBelowMinimum(true);
    const result = await old.client.sync();

    expect(result.tooOld).toBe(true);
    expect(await old.client.pendingCount()).toBe(0);
    await other.client.sync();
    expect(other.client.getState().units['u1']?.label).toBe('P1');
    expect(old.client.getState().units['u2']).toBeUndefined();
  });

  it('keeps the work waiting on the phone when the send fails because a server call is gone', async () => {
    const server = new FakeServer();
    const real = server.transportFor();
    const gone: Transport = { ...real, append: () => Promise.reject(new Error('Could not find the function public.append_events in the schema cache')) };
    const wall = { t: 0 };
    const old = device(gated(gone as unknown as SupabaseTransport), 'dA', wall);
    await old.client.load();
    await old.client.append('v1.UnitAdded', unit(1));
    setBelowMinimum(true);
    await old.client.sync().catch(() => undefined);

    expect(await old.client.pendingCount()).toBe(1);
    expect(await old.client.refusedCount()).toBe(0);
  });
});
