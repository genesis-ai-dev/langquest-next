import { HlcClock } from '@langquest-next/core';
import { deliverQueued } from '../src/courier';
import { MemoryStore } from '../src/memoryStore';
import { SyncClient } from '../src/syncClient';
import { FakeServer } from './fakeServer';

/**
 * A shared phone after Akol handed it to Mary (decisions.md 60): his
 * queued events go to the server under his own session, while Mary's
 * stay hers, and nothing about the phone's own fold changes.
 */
function phone() {
  const server = new FakeServer();
  const store = new MemoryStore();
  const wall = { t: 0 };
  const client = (actorId: string, partitionId = 'p1') =>
    new SyncClient({
      orgId: 'org1', partitionId, actorId, deviceId: 'shared', store, transport: server.transportFor(),
      clock: new HlcClock('shared', () => (wall.t += 1)), newId: () => `${actorId}-${partitionId}-${(wall.t += 1)}`
    });
  return { server, store, client };
}

describe('deliverQueued (a shared phone handed on)', () => {
  it("sends every partition's queued events by one person, and only theirs", async () => {
    const { server, store, client } = phone();
    server.offline = true;
    const akol = client('akol');
    await akol.load();
    await akol.append('v1.PartitionCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
    const akolElsewhere = client('akol', 'p2');
    await akolElsewhere.load();
    await akolElsewhere.append('v1.PartitionCreated', { name: 'John', sourceLanguoidId: 'eng' });
    const mary = client('mary');
    await mary.load();
    await mary.append('v1.PartitionCreated', { name: 'Mark', sourceLanguoidId: 'eng' });
    expect(await store.pendingPartitionsBy('akol')).toEqual([{ orgId: 'org1', partitionId: 'p1' }, { orgId: 'org1', partitionId: 'p2' }]);

    server.offline = false;
    const sent = await deliverQueued({ store, transport: server.transportFor(), actorId: 'akol', deviceId: 'shared' });
    expect(sent).toEqual({ accepted: 2, rejected: 0, left: 0 });
    expect(server.log.map((e) => e.actorId)).toEqual(['akol', 'akol']);
    // Mary's work waits for Mary's session.
    expect(await store.pendingCountBy('org1', 'p1', 'mary')).toBe(1);
    expect(await store.pendingPartitionsBy('akol')).toEqual([]);
  });

  it('offline: nothing is lost, and it goes on the next try', async () => {
    const { server, store, client } = phone();
    server.offline = true;
    const akol = client('akol');
    await akol.load();
    await akol.append('v1.PartitionCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
    await expect(deliverQueued({ store, transport: server.transportFor(), actorId: 'akol', deviceId: 'shared' })).rejects.toThrow();
    expect(await store.pendingCountBy('org1', 'p1', 'akol')).toBe(1);
    server.offline = false;
    expect((await deliverQueued({ store, transport: server.transportFor(), actorId: 'akol', deviceId: 'shared' })).left).toBe(0);
  });

  it('a refused event is marked refused, without refolding; one refused for its clock stays queued for their own session', async () => {
    const { server, store, client } = phone();
    server.offline = true;
    const akol = client('akol');
    await akol.load();
    await akol.append('v1.PartitionCreated', { name: 'Refused', sourceLanguoidId: 'eng' });
    await akol.append('v1.PartitionCreated', { name: 'Too early', sourceLanguoidId: 'eng' });
    server.offline = false;
    server.authorize = (e) => {
      const name = (e.payload as { name?: string }).name;
      return name === 'Refused' ? 'not a member of this organization' : name === 'Too early' ? 'clock ahead: server time 5' : null;
    };
    const sent = await deliverQueued({ store, transport: server.transportFor(), actorId: 'akol', deviceId: 'shared' });
    expect(sent).toEqual({ accepted: 0, rejected: 1, left: 1 });
    expect((await store.rejected('org1', 'p1')).map((l) => l.rejectReason)).toEqual(['not a member of this organization']);
    // Not re-stamped: the queued event keeps its clock for Akol's own client to fix.
    const queued = await store.pending('org1', 'p1');
    expect(queued.map((l) => (l.event.payload as { name: string }).name)).toEqual(['Too early']);
  });
});
