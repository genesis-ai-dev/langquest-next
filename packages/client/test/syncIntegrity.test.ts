import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { AnyEvent } from '@langquest-next/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MemoryStore } from '../src/memoryStore';
import { SqliteStore, type SqlDriver } from '../src/sqliteStore';
import { SyncClient, type Materializer } from '../src/syncClient';
import { SupabaseTransport } from '../src/supabaseTransport';
import type { EventStore, WriteBatch } from '../src/types';
import { FakeServer } from './fakeServer';

function sqlite() {
  const db = new DatabaseSync(':memory:');
  const driver: SqlDriver = {
    async run(sql, args = []) { db.prepare(sql).run(...args as never[]); },
    async all<T>(sql: string, args: unknown[] = []) {
      return db.prepare(sql).all(...args as never[]) as T[];
    },
    async transaction(fn) {
      db.exec('begin');
      try { await fn(driver); db.exec('commit'); }
      catch (error) { db.exec('rollback'); throw error; }
    }
  };
  return SqliteStore.open(driver);
}
const stores: [string, () => Promise<EventStore>][] = [
  ['memory', async () => new MemoryStore()], ['SQLite', sqlite]
];
const unknown = {
  id: 'future', type: 'v99.FutureFact', orgId: 'o', projectId: 'p',
  actorId: 'a', deviceId: 'new', hlc: '000000000000001:000000:new',
  parentEventId: 'parent', payload: { nested: { items: [null, 'λ', 7] } }
} as unknown as AnyEvent;
function reader(version: number, understands: boolean): Materializer<Record<string, unknown>> {
  const apply = (state: Record<string, unknown>, event: AnyEvent) => {
    if (understands || event.type === 'v1.ProjectCreated') state[event.id] = event.payload;
    return state;
  };
  return { version, empty: () => ({}), apply, compact: () => {},
    fold: (events, state) => { for (const event of events) apply(state, event); return state; } };
}
function client(store: EventStore, server: FakeServer, version = 1, understands = false) {
  return new SyncClient({ orgId: 'o', projectId: 'p', actorId: 'a', deviceId: 'old',
    store, transport: server.transportFor(), materializer: reader(version, understands),
    checkpointEvery: 1, pullPageSize: 1, now: () => 100 });
}

describe.each(stores)('%s cross-version history', (_name, make) => {
  it('retains unfamiliar envelopes through checkpoints, restart and offline upgrade', async () => {
    const store = await make(), server = new FakeServer();
    await server.transportFor().append([unknown]);
    const old = client(store, server);
    await old.load();
    expect((await old.sync()).tooOld).toBe(false);
    expect(old.getState()).toEqual({});
    expect(await store.cursor('o', 'p')).toBe(1);
    expect((await store.get('future'))!.event).toEqual({ ...unknown, serverSeq: 1 });
    expect(await store.meta('snapshot:o/p')).toBeTruthy();
    await store.commit({ prune: { orgId: 'o', projectId: 'p', uptoSeq: 99 } });
    await store.prune('o', 'p', 99);
    server.offline = true;
    const restarted = client(store, server);
    await restarted.load();
    expect(restarted.getState()).toEqual({});
    const upgraded = client(store, server, 2, true);
    await upgraded.load();
    expect(upgraded.getState()).toEqual({ future: unknown.payload });
    expect((await upgraded.sync()).offline).toBe(true);
    expect((await store.get('future'))!.event).toEqual({ ...unknown, serverSeq: 1 });
  });

  it('backfills a legacy pruned checkpoint after upgrade without losing pending work', async () => {
    const store = await make(), server = new FakeServer();
    await server.transportFor().append([unknown]);
    await store.setMeta('snapshot:o/p', JSON.stringify({ orgId: 'o', projectId: 'p',
      reducerVersion: 1, serverSeq: 1, state: {} }));
    await store.setCursor('o', 'p', 1);
    const pending = { ...unknown, id: 'pending', type: 'v1.ProjectCreated',
      payload: { name: 'Offline work', sourceLanguoidId: 'eng' } } as AnyEvent;
    await store.put({ event: pending, status: 'pending' });
    server.offline = true;
    const next = client(store, server, 2, true);
    await next.load();
    expect(await store.cursor('o', 'p')).toBe(0);
    expect(await next.pendingCount()).toBe(1);
    expect(next.getState().pending).toEqual(pending.payload);
    expect((await next.sync()).offline).toBe(true);
    server.offline = false;
    await next.sync();
    expect(await next.pendingCount()).toBe(0);
    expect(next.getState().future).toEqual(unknown.payload);
    expect(next.getState().pending).toEqual(pending.payload);
    expect(await store.cursor('o', 'p')).toBe(2);
  });

  it('a failed page commit cannot advance the durable cursor or lose a future fact', async () => {
    const store = await make(), server = new FakeServer();
    await server.transportFor().append([unknown]);
    const old = client(store, server);
    await old.load();
    const commit = store.commit.bind(store);
    store.commit = async (batch: WriteBatch) => {
      if (batch.events?.length) throw new Error('simulated disk failure');
      await commit(batch);
    };
    await expect(old.pull()).rejects.toThrow('disk failure');
    expect(await store.cursor('o', 'p')).toBe(0);
    expect(await store.get('future')).toBeUndefined();
    store.commit = commit;
    const restarted = client(store, server, 2, true);
    await restarted.load(); await restarted.pull();
    expect(restarted.getState().future).toEqual(unknown.payload);
    expect(await store.cursor('o', 'p')).toBe(1);
  });
});

it('the HTTP transport preserves an unfamiliar payload and envelope', async () => {
  const row = { id: unknown.id, type: unknown.type, org_id: 'o', project_id: 'p',
    actor_id: 'a', device_id: 'new', hlc: unknown.hlc, parent_event_id: 'parent',
    server_seq: 7, payload: unknown.payload };
  const transport = new SupabaseTransport({ rpc: async () => ({ data: [row], error: null }) } as unknown as SupabaseClient);
  expect(await transport.pull('o', 'p', 0, 10)).toEqual([{ ...unknown, serverSeq: 7 }]);
});
