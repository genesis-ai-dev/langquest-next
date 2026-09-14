import { HlcClock, deriveTakeStatus } from '@langquest-next/core';
import { MemoryStore } from '../src/memoryStore';
import { SyncClient } from '../src/syncClient';
import { FakeServer } from './fakeServer';

function device(server: FakeServer, deviceId: string, actorId: string, wall: { t: number }) {
  const store = new MemoryStore();
  let n = 0;
  const client = new SyncClient({
    orgId: 'org1',
    projectId: 'p1',
    actorId,
    deviceId,
    store,
    transport: server.transportFor(),
    clock: new HlcClock(deviceId, () => (wall.t += 1)),
    newId: () => `${deviceId}-${++n}`
  });
  return { client, store };
}

describe('SyncClient', () => {
  it('own appends are visible before any sync (PLAN.md section 3)', async () => {
    const server = new FakeServer();
    const { client } = device(server, 'dA', 'lead', { t: 0 });
    await client.load();
    await client.append('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
    expect(client.getState().project?.value.name).toBe('Luke');
    expect(await client.pendingCount()).toBe(1);
  });

  it('two devices offline for a while converge after sync, in either order', async () => {
    // Why: this is the month-in-the-village case. Both record, both review,
    // nobody merges anything by hand.
    const server = new FakeServer();
    const wall = { t: 0 };
    const a = device(server, 'dA', 'lead', wall);
    const b = device(server, 'dB', 't1', wall);
    await a.client.load();
    await b.client.load();

    await a.client.append('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
    await a.client.append('v1.MemberAdded', { profileId: 'lead', role: 'owner' });
    await a.client.append('v1.MemberAdded', { profileId: 't1', role: 'translator' });
    await a.client.append('v1.LaneAdded', { laneId: 'L1', languoidId: 'xyz' });
    await a.client.sync();
    await b.client.sync();

    server.offline = true;
    await b.client.append('v1.TakeComposed', {
      takeId: 'tB',
      unitId: 'u1',
      laneId: 'L1',
      cardHashes: ['c1'],
      parentTakeId: null
    });
    await a.client.append('v1.TakeComposed', {
      takeId: 'tA',
      unitId: 'u1',
      laneId: 'L1',
      cardHashes: ['c2'],
      parentTakeId: null
    });
    expect((await b.client.sync()).pushed).toBe(0); // still queued
    expect(await b.client.pendingCount()).toBe(1);

    server.offline = false;
    await b.client.sync();
    await a.client.sync();
    await b.client.sync(); // b pulls a's take

    const sa = a.client.getState();
    const sb = b.client.getState();
    expect(Object.keys(sa.takes).sort()).toEqual(['tA', 'tB']);
    expect({ ...sa, appliedEventIds: {} }).toEqual({ ...sb, appliedEventIds: {} });
    expect(await a.client.pendingCount()).toBe(0);
    expect(await b.client.pendingCount()).toBe(0);
  });

  it('a rejected event stays in the log, marked, and leaves the fold (invariant 1)', async () => {
    const server = new FakeServer();
    server.authorize = (e) => (e.type === 'v1.ProjectConfigChanged' ? 'role translator may not emit' : null);
    const { client, store } = device(server, 'dB', 't1', { t: 0 });
    await client.load();
    await client.append('v1.ProjectCreated', { name: 'x', sourceLanguoidId: 'eng' });
    const bad = await client.append('v1.ProjectConfigChanged', {
      config: { unitKinds: [], workflow: [] }
    });
    expect(client.getState().config).not.toBeNull();

    const { rejected } = await client.sync();
    expect(rejected).toBe(1);
    expect(client.getState().config).toBeNull();
    const kept = store.rejected();
    expect(kept.map((k) => k.event.id)).toEqual([bad.id]);
    expect(kept[0]!.rejectReason).toMatch(/may not emit/);
    expect(await client.pendingCount()).toBe(0);
  });

  it('re-pushing after a lost ack is harmless (idempotent server, invariant 3)', async () => {
    const server = new FakeServer();
    const { client, store } = device(server, 'dA', 'lead', { t: 0 });
    await client.load();
    const e = await client.append('v1.ProjectCreated', { name: 'x', sourceLanguoidId: 'eng' });
    await client.push();
    // Simulate the ack never reaching the device.
    await store.put({ event: e, status: 'pending' });
    const r = await client.push();
    expect(r.accepted).toBe(1);
    expect(server.log.length).toBe(1);
    expect((await store.get(e.id))?.event.serverSeq).toBe(1);
  });

  it('pull pages through the tail and advances the cursor', async () => {
    const server = new FakeServer();
    const wall = { t: 0 };
    const a = device(server, 'dA', 'lead', wall);
    await a.client.load();
    for (let i = 0; i < 7; i++) {
      await a.client.append('v1.UnitAdded', {
        unitId: `u${i}`,
        parentUnitId: null,
        kind: 'passage',
        label: `P${i}`,
        order: `a${i}`
      });
    }
    await a.client.push();

    const store = new MemoryStore();
    const b = new SyncClient({
      orgId: 'org1',
      projectId: 'p1',
      actorId: 'r1',
      deviceId: 'dB',
      store,
      transport: server.transportFor(),
      pullPageSize: 3
    });
    await b.load();
    expect(await b.pull()).toBe(7);
    expect(await store.cursor('org1', 'p1')).toBe(7);
    expect(Object.keys(b.getState().units).length).toBe(7);
    expect(await b.pull()).toBe(0);
  });

  it('derived status agrees across devices once synced', async () => {
    const server = new FakeServer();
    const wall = { t: 0 };
    const a = device(server, 'dA', 'lead', wall);
    const r = device(server, 'dR', 'r1', wall);
    await a.client.load();
    await r.client.load();
    await a.client.append('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
    await a.client.append('v1.MemberAdded', { profileId: 'lead', role: 'owner' });
    await a.client.append('v1.MemberAdded', { profileId: 'r1', role: 'reviewer' });
    await a.client.append('v1.TakeComposed', {
      takeId: 't1',
      unitId: 'u1',
      laneId: 'L1',
      cardHashes: ['c1'],
      parentTakeId: null
    });
    await a.client.append('v1.TakeSubmitted', { takeId: 't1' });
    await a.client.sync();
    await r.client.sync();
    await r.client.append('v1.ReviewSubmitted', { takeId: 't1', stepId: 'community', decision: 'approve' });
    await r.client.sync();
    await a.client.sync();
    expect(deriveTakeStatus(a.client.getState(), 't1').outcome).toBe('approved');
    expect(deriveTakeStatus(r.client.getState(), 't1').outcome).toBe('approved');
  });

  it("does not push another user's queued events from a shared device", async () => {
    // Why: dev persona switching and real shared phones. Events queued by A
    // must wait for A's session, not be pushed (and rejected) under B.
    const server = new FakeServer();
    const store = new MemoryStore();
    const wall = { t: 0 };
    const mk = (actorId: string) =>
      new SyncClient({
        orgId: 'org1',
        projectId: 'p1',
        actorId,
        deviceId: 'shared',
        store,
        transport: server.transportFor(),
        clock: new HlcClock('shared', () => (wall.t += 1)),
        newId: () => `${actorId}-${wall.t}`
      });
    const a = mk('a');
    await a.load();
    await a.append('v1.ProjectCreated', { name: 'x', sourceLanguoidId: 'eng' });
    const b = mk('b');
    await b.load();
    expect((await b.push()).accepted).toBe(0);
    expect(server.log.length).toBe(0);
    expect((await a.push()).accepted).toBe(1);
  });
});
