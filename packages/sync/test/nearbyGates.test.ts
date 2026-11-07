import { DatabaseSync } from 'node:sqlite';
import { HlcClock, type AnyEvent, type LanguageState, type NearbyVia } from '@langquest-next/core';
import { Diagnostics, MemoryDiagStore } from '../src/diagnostics';
import { MemoryStore } from '../src/memoryStore';
import { SqliteStore, type SqlDriver } from '../src/sqliteStore';
import { SyncClient } from '../src/syncClient';
import { FakeServer } from '../src/testing/fakeServer';
import { NOT_LISTED_TEXT, type EventStore, type LocalEvent } from '../src/types';

/**
 * A nearby row is a teammate's event the server has not confirmed. It is folded for the
 * screen, and must never reach a confirmed checkpoint or the outbox
 * (docs/nearby-sync-plan.md 5.2, 5.4). These rows are written straight through the store,
 * because `receiveNearby` comes later: nothing may depend on it to keep them out.
 */
function sqlite(): EventStore {
  const db = new DatabaseSync(':memory:');
  const driver: SqlDriver = {
    run: async (sql, params = []) => { db.prepare(sql).run(...(params as never[])); },
    all: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as T[],
    transaction: async (fn) => { db.exec('begin'); try { await fn(driver); db.exec('commit'); } catch (e) { db.exec('rollback'); throw e; } }
  };
  let opened: Promise<SqliteStore> | null = null;
  const store = () => (opened ??= SqliteStore.open(driver));
  return new Proxy({} as EventStore, { get: (_t, k) => async (...a: unknown[]) => ((await store()) as unknown as Record<string, (...x: unknown[]) => unknown>)[k as string]!(...a) });
}

const via: NearbyVia = { batch: 1, key: 'K' };
let ticks = 0;
let eventIds = 0;

function phone(server: FakeServer, store: EventStore, actorId: string, deviceId: string, o: { keepOnDisk?: boolean; checkpointEvery?: number } = {}) {
  const records = new MemoryDiagStore();
  let n = 0;
  const diag = new Diagnostics({ store: records, newId: () => `d${++n}`, now: () => ++ticks, maxRecords: Infinity });
  const client = new SyncClient({
    orgId: 'org1', streamId: 'p1', actorId, deviceId, store, transport: server.transportFor(), diag,
    clock: new HlcClock(deviceId, () => ++ticks), newId: () => `${deviceId}-${++eventIds}`,
    ...(o.keepOnDisk ? { keepOnDisk: true } : {}),
    ...(o.checkpointEvery ? { checkpointEvery: o.checkpointEvery } : {})
  });
  const checkpoints = async () => {
    await diag.settle();
    return records.records.filter((r) => r.kind === 'checkpoint');
  };
  return { client, store, checkpoints };
}

/** An event as a teammate's phone made it: this phone did not write it and the server has not seen it. */
function recording(id: string, recordingId: string, unitId: string, actorId = 'teammate'): AnyEvent {
  return {
    id, type: 'v1.RecordingAdded', orgId: 'org1', streamId: 'p1', actorId, deviceId: 'dT', hlc: `${String(++ticks).padStart(15, '0')}:000000:dT`,
    payload: { recordingId, unitId, kind: 'target', cards: [{ hash: `hash-${recordingId}`, durationMs: 5 }] }
  } as AnyEvent;
}
const near = (e: AnyEvent): LocalEvent => ({ event: e, status: 'nearby', via });

/** A language with `n` passages on the server, each with a recording. */
async function language(server: FakeServer, n: number) {
  const lead = phone(server, new MemoryStore(), 'lead', 'dA');
  await lead.client.load();
  for (let i = 0; i < n; i++) {
    await lead.client.append('v1.UnitAdded', { unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${String(i).padStart(3, '0')}` });
    await lead.client.append('v1.RecordingAdded', { recordingId: `r${i}`, unitId: `u${i}`, kind: 'target', cards: [{ hash: `h${i}`, durationMs: 1000 + i }] });
  }
  await lead.client.sync();
  return lead;
}

async function moreWork(lead: Awaited<ReturnType<typeof language>>, tag: string, n: number) {
  for (let i = 0; i < n; i++) {
    await lead.client.append('v1.RecordingAdded', { recordingId: `${tag}${i}`, unitId: `u${i}`, kind: 'target', cards: [{ hash: `${tag}h${i}`, durationMs: 5 }] });
  }
  await lead.client.sync();
}

const checkpointOf = async (store: EventStore) => {
  const raw = await store.meta('snapshot:org1/p1');
  return raw ? JSON.parse(raw) as { serverSeq: number; state: LanguageState } : null;
};
const statusOf = async (store: EventStore, id: string) => (await store.getMany([id]))[0]?.status;

describe.each([['memory', () => new MemoryStore() as EventStore], ['SQLite', sqlite]] as const)('on the %s store', (_name, make) => {
  describe.each([['whole in memory', false], ['kept on disk', true]] as const)('a language %s', (_how, keepOnDisk) => {
    it('a checkpoint with a nearby row takes the slow path and leaves the row out', async () => {
      // Why: the fast path saves the live state as the confirmed fold. A nearby event in it would be saved as
      // confirmed and never go away, and a refusal the server gives it later could not take it back.
      const server = new FakeServer();
      const lead = await language(server, 6);
      const { client, store, checkpoints } = phone(server, make(), 'r1', 'dB', { keepOnDisk, checkpointEvery: 3 });
      await client.load();
      await client.pull();
      await store.commit({ receive: [near(recording('near-1', 'near', 'u1'))] });
      await client.load();
      expect(client.getState().recordings['near']).toBeDefined();

      await moreWork(lead, 'o', 4);
      const before = (await checkpoints()).length;
      await client.pull();

      const taken = (await checkpoints()).slice(before);
      expect(taken.map((r) => r.t.path)).toEqual(['slow']);
      const checkpoint = (await checkpointOf(store))!;
      expect(checkpoint.serverSeq).toBe(server.head('org1', 'p1'));
      expect(checkpoint.state.recordings['near']).toBeUndefined();
      expect(checkpoint.state.appliedEventIds['near-1']).toBeUndefined();
      expect(await store.keptById('org1', 'p1', 'recording', ['near'])).toHaveLength(0);
      // Still held and still folded, for the screen and for the next phone.
      expect(await statusOf(store, 'near-1')).toBe('nearby');
      expect(client.getState().recordings['near']).toBeDefined();
      const again = phone(server, store, 'r1', 'dB', { keepOnDisk });
      await again.client.load();
      expect(again.client.getState().recordings['near']).toBeDefined();
    });

    it('once the nearby row is gone, the fast path comes back', async () => {
      const server = new FakeServer();
      const lead = await language(server, 6);
      const { client, store, checkpoints } = phone(server, make(), 'r1', 'dB', { keepOnDisk, checkpointEvery: 3 });
      await client.load();
      await client.pull();
      await store.commit({ receive: [near(recording('near-1', 'near', 'u1'))] });
      await client.load();
      await store.commit({ dropNearby: { orgId: 'org1', streamId: 'p1', ids: ['near-1'] } });
      await client.load();

      await moreWork(lead, 'o', 4);
      const before = (await checkpoints()).length;
      await client.pull();
      expect((await checkpoints()).slice(before).map((r) => r.t.path)).toEqual(['fast']);
    });
  });

  describe('reading passage after passage on a language kept on disk', () => {
    it('with a nearby row, takes no checkpoint at all, and memory waits', async () => {
      // Why: `loadUnits` asks for a checkpoint only to shed, and only the fast path sheds. A slow one sheds nothing,
      // so memory stays too full and every later passage opened would run another whole fold of the tail.
      const server = new FakeServer();
      await language(server, 80);
      server.makeSnapshot('org1', 'p1');
      const { client, store, checkpoints } = phone(server, make(), 'r1', 'dB', { keepOnDisk: true });
      await client.load();
      await client.pull();
      await store.commit({ receive: [near(recording('near-1', 'near', 'u1'))] });
      await client.load();
      const before = (await checkpoints()).length;
      const saved = await store.meta('snapshot:org1/p1');
      for (let i = 0; i < 70; i++) await client.loadUnits([`u${i}`]);
      expect((await checkpoints()).length - before).toBe(0);
      expect(await store.meta('snapshot:org1/p1')).toBe(saved);
      expect(await statusOf(store, 'near-1')).toBe('nearby');
      expect(Object.keys(client.getState().recordings).length).toBeGreaterThan(12 * 4 + 1);
    });

    it('sheds again as soon as the nearby rows are settled', async () => {
      const server = new FakeServer();
      await language(server, 80);
      server.makeSnapshot('org1', 'p1');
      const { client, store, checkpoints } = phone(server, make(), 'r1', 'dB', { keepOnDisk: true });
      await client.load();
      await client.pull();
      await store.commit({ receive: [near(recording('near-1', 'near', 'u1'))] });
      await client.load();
      for (let i = 0; i < 70; i++) await client.loadUnits([`u${i}`]);
      await store.commit({ dropNearby: { orgId: 'org1', streamId: 'p1', ids: ['near-1'] } });
      await client.load();
      const before = (await checkpoints()).length;
      await client.loadUnits(['u71']);
      expect((await checkpoints()).slice(before).map((r) => r.t.path)).toEqual(['fast']);
      expect(Object.keys(client.getState().recordings).length).toBeLessThanOrEqual(12 * 4 + 1);
    });
  });

  describe('retrying refused work', () => {
    const rejected = (e: AnyEvent, rejectReason: string): LocalEvent => ({ event: e, status: 'rejected', rejectReason, via });

    it('never puts a refused nearby row back in the outbox, even one naming this person', async () => {
      // Why: its reason reads as retryable, so pressing retry would make a forged event pending, and push would send it as them.
      const server = new FakeServer();
      await language(server, 2);
      const { client, store } = phone(server, make(), 'r1', 'dB');
      await client.load();
      await client.pull();
      await store.commit({
        events: [
          { event: recording('mine', 'mine', 'u0', 'r1'), status: 'rejected', rejectReason: 'not a member' },
          rejected(recording('forged-member', 'fm', 'u0', 'r1'), 'not a member'),
          rejected(recording('forged-role', 'fr', 'u0', 'r1'), 'may not emit v1.RecordingAdded'),
          rejected(recording('forged-other', 'fo', 'u0', 'r1'), 'something new')
        ]
      });
      expect(await client.retryRejected()).toBe(1);
      expect(await statusOf(store, 'mine')).toBe('pending');
      for (const id of ['forged-member', 'forged-role', 'forged-other']) expect(await statusOf(store, id), id).toBe('rejected');
      expect(await client.retryRejected(['NOT_MEMBER', 'NOT_ALLOWED'], 'membership')).toBe(0);
      await client.sync();
      const sent = server.stream('org1', 'p1').map((e) => e.id);
      expect(sent).toContain('mine');
      for (const id of ['forged-member', 'forged-role', 'forged-other']) expect(sent, id).not.toContain(id);
    });

    it('the not-listed retry on every push leaves them too', async () => {
      // Why: push asks the store by this reason's text, a different read from the one above.
      const server = new FakeServer();
      await language(server, 2);
      const { client, store } = phone(server, make(), 'r1', 'dB');
      await client.load();
      await client.pull();
      await store.commit({
        events: [
          { event: recording('mine', 'mine', 'u0', 'r1'), status: 'rejected', rejectReason: NOT_LISTED_TEXT },
          rejected(recording('forged', 'f', 'u0', 'r1'), NOT_LISTED_TEXT)
        ]
      });
      await client.sync();
      expect(await statusOf(store, 'forged')).toBe('rejected');
      const sent = server.stream('org1', 'p1').map((e) => e.id);
      expect(sent).toContain('mine');
      expect(sent).not.toContain('forged');
    });
  });

  it('a nearby row naming this person is not their unsent work: the sign-out check and push ignore it', async () => {
    // Why: the sign-out check and a shared phone's hand-over read these counts. A teammate's copy must not hold
    // this session on the phone or go out as them. Files are the other half, and wait for the file marks of phase 3.
    const server = new FakeServer();
    await language(server, 2);
    const { client, store } = phone(server, make(), 'r1', 'dB');
    await client.load();
    await client.pull();
    await store.commit({ receive: [near(recording('near-1', 'near', 'u0', 'r1'))] });
    await client.load();
    expect(await client.pendingCount()).toBe(0);
    expect(await store.pendingStreamsBy('r1')).toEqual([]);
    await client.sync();
    expect(server.stream('org1', 'p1').map((e) => e.id)).not.toContain('near-1');
    expect(await statusOf(store, 'near-1')).toBe('nearby');
  });
});
