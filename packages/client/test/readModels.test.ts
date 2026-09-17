import { HlcClock, buildIndexes, passageKeys, passageRow, passageRowKey, type PassageRow, type ProjectState } from '@langquest-next/core';
import { MemoryStore } from '../src/memoryStore';
import { SyncClient } from '../src/syncClient';
import { FakeServer } from './fakeServer';

/**
 * Why: stage 2 lets screens read persisted rows instead of the fold. That
 * is only safe if the rows the client keeps, through local appends, pulls,
 * rejections, and restarts, always equal what a rebuild from the fold gives.
 * These tests hold the client to that on every path that writes.
 */
function device(server: FakeServer, deviceId: string, actorId: string, wall: { t: number }) {
  const store = new MemoryStore();
  let n = 0;
  const client = new SyncClient({
    orgId: 'org1', projectId: 'p1', actorId, deviceId, store,
    transport: server.transportFor(),
    clock: new HlcClock(deviceId, () => (wall.t += 1)),
    newId: () => `${deviceId}-${++n}`
  });
  return { client, store };
}

function rebuilt(state: ProjectState): Map<string, PassageRow> {
  const idx = buildIndexes(state);
  return new Map(passageKeys(state, idx).map((k) => [passageRowKey(k), passageRow(state, k.unitId, k.laneId, idx)]));
}

async function persisted(store: MemoryStore): Promise<Map<string, PassageRow>> {
  const rows = await store.passages('org1', 'p1', { limit: 10_000 });
  return new Map(rows.map((r) => [passageRowKey(r), r]));
}

async function expectRowsCurrent(c: { client: SyncClient; store: MemoryStore }) {
  expect(await persisted(c.store)).toEqual(rebuilt(c.client.getState()));
}

async function seed(a: { client: SyncClient }) {
  await a.client.append('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
  await a.client.append('v1.MemberAdded', { profileId: 'lead', role: 'owner' });
  await a.client.append('v1.MemberAdded', { profileId: 't1', role: 'translator' });
  await a.client.append('v1.MemberAdded', { profileId: 'r1', role: 'reviewer' });
  await a.client.append('v1.LaneAdded', { laneId: 'L1', languoidId: 'xyz' });
  await a.client.append('v1.UnitAdded', { unitId: 'luke', parentUnitId: null, kind: 'book', label: 'Luke', order: 'a' });
  for (let i = 1; i <= 5; i++) {
    await a.client.append('v1.UnitAdded', { unitId: `luke${i}`, parentUnitId: 'luke', kind: 'passage', label: `Luke ${i}`, order: `a${i}` });
  }
}

describe('read models on the client', () => {
  it('rows follow local appends: one passage per take, every passage per member change', async () => {
    const server = new FakeServer();
    const a = device(server, 'dA', 'lead', { t: 0 });
    await a.client.load();
    await seed(a);
    await expectRowsCurrent(a);
    expect((await a.store.passages('org1', 'p1', { limit: 100 })).map((r) => r.unitId)).toEqual(['luke1', 'luke2', 'luke3', 'luke4', 'luke5']);

    await a.client.appendMany([
      { type: 'v1.TakeComposed', payload: { takeId: 'take1', unitId: 'luke2', laneId: 'L1', cardHashes: ['c1'], parentTakeId: null } },
      { type: 'v1.TakeSelected', payload: { takeId: 'take1', unitId: 'luke2', laneId: 'L1' } }
    ]);
    await expectRowsCurrent(a);
    expect((await a.client.queries().getPassageView('luke2', 'L1'))?.outcome).toBe('draft');
    await a.client.append('v1.TakeSubmitted', { takeId: 'take1' });
    await expectRowsCurrent(a);
    expect((await a.client.queries().getPassageView('luke2', 'L1'))?.steps.map((s) => s.eligible)).toEqual([['r1']]);
  });

  it('rows follow pulls, survive a restart, and are rebuilt after a rejection refold', async () => {
    const server = new FakeServer();
    server.authorize = (e) => (e.type === 'v1.MemberAdded' && e.actorId !== 'lead' ? 'actor may not emit MemberAdded' : null);
    const wall = { t: 0 };
    const a = device(server, 'dA', 'lead', wall);
    const b = device(server, 'dB', 'r1', wall);
    await a.client.load();
    await b.client.load();
    await seed(a);
    await a.client.appendMany([
      { type: 'v1.TakeComposed', payload: { takeId: 'take1', unitId: 'luke3', laneId: 'L1', cardHashes: ['c1'], parentTakeId: null } },
      { type: 'v1.TakeSubmitted', payload: { takeId: 'take1' } }
    ]);
    await a.client.sync();
    await b.client.sync();
    await expectRowsCurrent(b);
    expect(await b.client.queries().getTask('review:luke3:L1:community', 'r1')).toMatchObject({ type: 'review', status: 'todo' });

    // A fresh client on the same store rebuilds rows from its fold on load.
    const again = new SyncClient({ orgId: 'org1', projectId: 'p1', actorId: 'r1', deviceId: 'dB', store: b.store, transport: server.transportFor() });
    await again.load();
    expect(await persisted(b.store)).toEqual(rebuilt(again.getState()));

    // r1 is a reviewer: a member event is refused by the server; the refold
    // that follows must leave the rows current too.
    await b.client.append('v1.MemberAdded', { profileId: 'intruder', role: 'owner' });
    await expectRowsCurrent(b);
    const r = await b.client.sync();
    expect(r.rejected).toBe(1);
    expect(b.client.getState().members['intruder']).toBeUndefined();
    await expectRowsCurrent(b);
  });

  it('task pages read rows, not the fold, and page with a cursor', async () => {
    const server = new FakeServer();
    const a = device(server, 'dA', 'lead', { t: 0 });
    await a.client.load();
    await seed(a);
    await a.client.append('v1.TakeComposed', { takeId: 'take1', unitId: 'luke1', laneId: 'L1', cardHashes: ['c1'], parentTakeId: null });
    const q = a.client.queries();
    const p1 = await q.listTasks('t1', {}, null, 2);
    expect(p1.tasks.map((t) => [t.unitId, t.status])).toEqual([['luke1', 'doing'], ['luke2', 'todo']]);
    expect(p1.cursor).not.toBeNull();
    const p2 = await q.listTasks('t1', {}, p1.cursor, 10);
    expect(p2.tasks.map((t) => t.unitId)).toEqual(['luke3', 'luke4', 'luke5']);
    expect(p2.cursor).toBeNull();
    expect((await q.listTasks('t1', { status: ['doing'] }, null, 10)).tasks.map((t) => t.unitId)).toEqual(['luke1']);
    expect((await q.listTasks('stranger', {}, null, 10)).tasks).toEqual([]);
    expect(await q.getLaneProgress('L1')).toEqual({ translatedPct: 0, approvedPct: 0, passages: 5 });
    expect(await q.getTask('respond:luke1:L1', 't1')).toMatchObject({ type: 'translate' });
  });

  it('publishes a revision before the disk write and reports saving until the commit lands', async () => {
    // Why: the screen must move on the tap (next frame) and must be able to
    // say "saved locally" only when that is true.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const store = new MemoryStore();
    const slow = Object.assign(store, { commit: async (b: Parameters<MemoryStore['commit']>[0]) => { await gate; await MemoryStore.prototype.commit.call(store, b); } });
    const client = new SyncClient({ orgId: 'org1', projectId: 'p1', actorId: 'lead', deviceId: 'dA', store: slow, transport: new FakeServer().transportFor() });
    const seen: { revision: number; saving: number; name: string | undefined }[] = [];
    client.subscribe((s) => seen.push({ revision: s.revision, saving: s.saving, name: s.state.project?.value.name }));
    const loadDone = client.load();
    release();
    await loadDone;
    seen.length = 0;
    const written = client.append('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
    expect(client.getState().project?.value.name).toBe('Luke');
    expect(client.saving).toBe(1);
    expect(seen[0]).toMatchObject({ name: 'Luke', saving: 1 });
    await written;
    expect(client.saving).toBe(0);
    expect(seen.at(-1)).toMatchObject({ name: 'Luke', saving: 0 });
    expect((await store.pending('org1', 'p1')).length).toBe(1);
  });

  it('local writes are serialized: two overlapping appends commit in order', async () => {
    const order: string[] = [];
    const store = new MemoryStore();
    const base = MemoryStore.prototype.commit;
    store.commit = async (b) => {
      order.push(`start:${b.events?.[0]?.event.id ?? 'meta'}`);
      await new Promise((r) => setTimeout(r, b.events?.[0]?.event.id === 'dA-1' ? 5 : 0));
      await base.call(store, b);
      order.push(`end:${b.events?.[0]?.event.id ?? 'meta'}`);
    };
    let n = 0;
    const client = new SyncClient({ orgId: 'org1', projectId: 'p1', actorId: 'lead', deviceId: 'dA', store, transport: new FakeServer().transportFor(), newId: () => `dA-${++n}` });
    await client.load();
    order.length = 0;
    await Promise.all([
      client.append('v1.ProjectCreated', { name: 'A', sourceLanguoidId: 'eng' }),
      client.append('v1.LaneAdded', { laneId: 'L1', languoidId: 'x' })
    ]);
    expect(order).toEqual(['start:dA-1', 'end:dA-1', 'start:dA-2', 'end:dA-2']);
  });
});
