import { DatabaseSync } from 'node:sqlite';
import { HlcClock } from '@langquest-next/core';
import {
  classifyTransferFailure,
  Diagnostics,
  MemoryDiagStore,
  sanitizeContext,
  sanitizeDiag,
  stackFrames,
  type DiagRecord,
  type DiagStore
} from '../src/diagnostics';
import { MemoryStore } from '../src/memoryStore';
import { SqliteDiagStore } from '../src/sqliteDiagStore';
import type { SqlDriver } from '../src/sqliteStore';
import { SyncClient } from '../src/syncClient';
import { FakeServer } from './fakeServer';

function nodeDriver(): SqlDriver {
  const db = new DatabaseSync(':memory:');
  return {
    run: async (sql, params = []) => { db.prepare(sql).run(...(params as never[])); },
    all: async <T,>(sql: string, params: unknown[] = []) => db.prepare(sql).all(...(params as never[])) as T[]
  };
}

function rec(id: string, at: number, kind: DiagRecord['kind'] = 'sync'): DiagRecord {
  return { id, kind, at, n: {}, t: {} };
}

describe('sanitizeDiag: the allowlist is the only way in', () => {
  it('keeps known fields and drops everything else', () => {
    const r = sanitizeDiag({
      id: 'r1', kind: 'sync', at: 5, orgId: 'org1', projectId: 'p1',
      n: { ms: 12.4, pulled: 3, secret: 9 },
      t: { outcome: 'ok', note: 'Maria said hello' },
      payload: { text: 'In the beginning' }
    });
    expect(r).toEqual({ id: 'r1', kind: 'sync', at: 5, orgId: 'org1', projectId: 'p1', n: { ms: 12, pulled: 3 }, t: { outcome: 'ok' } });
  });

  it('refuses tag values outside their set, and tokens that look like prose or an address', () => {
    expect(sanitizeDiag({ id: 'r', kind: 'sync', at: 1, t: { outcome: 'fine' } })?.t).toEqual({});
    expect(sanitizeDiag({ id: 'r', kind: 'error', at: 1, t: { name: 'TypeError', where: 'maria@example.org' } })?.t).toEqual({ name: 'TypeError' });
    expect(sanitizeDiag({ id: 'r', kind: 'error', at: 1, t: { where: 'He said, "no"' } })?.t).toEqual({});
  });

  it('refuses unknown kinds and malformed records', () => {
    expect(sanitizeDiag({ id: 'r', kind: 'transcript', at: 1 })).toBeNull();
    expect(sanitizeDiag({ id: 'r', kind: 'sync', at: 'now' })).toBeNull();
    expect(sanitizeDiag(null)).toBeNull();
  });

  it('keeps a stack only on errors, without its message line or paths', () => {
    const stack = 'Error: could not save "Jesus wept"\n    at save (/Users/someone/app/src/recording.ts:10:5)\n    at run (index.android.bundle:1:2345)';
    expect(stackFrames(stack)).toBe('at save (recording.ts:10:5)\nat run (index.android.bundle:1:2345)');
    expect(sanitizeDiag({ id: 'r', kind: 'sync', at: 1, stack })?.stack).toBeUndefined();
    expect(sanitizeDiag({ id: 'r', kind: 'error', at: 1, stack: 'only a message' })?.stack).toBeUndefined();
  });

  it('drops a partition id without its org, and context keys it does not know', () => {
    expect(sanitizeDiag({ id: 'r', kind: 'load', at: 1, projectId: 'p1' })?.projectId).toBeUndefined();
    expect(sanitizeContext({ os: 'android', model: 'SM-A105F', ...({ email: 'a@b.c' } as object) })).toEqual({ os: 'android', model: 'SM-A105F' });
  });
});

describe('classifyTransferFailure', () => {
  it('reads our own error texts', () => {
    expect(classifyTransferFailure(new Error('Network request failed'))).toBe('offline');
    expect(classifyTransferFailure(new Error('hash mismatch for abc: got def'))).toBe('hash');
    expect(classifyTransferFailure(new Error('Upload failed (503): gateway'))).toBe('http5xx');
    expect(classifyTransferFailure(new Error('Upload failed (403): denied'))).toBe('http4xx');
    expect(classifyTransferFailure('x')).toBe('other');
  });
});

for (const [name, make] of [
  ['memory', async () => new MemoryDiagStore()],
  ['sqlite', async () => SqliteDiagStore.open(nodeDriver())]
] as [string, () => Promise<DiagStore>][]) {
  describe(`DiagStore contract (${name})`, () => {
    it('is bounded, drops the oldest first, and keeps errors longest', async () => {
      // Why: weeks offline must not fill the phone, and a crash is the one record we cannot do without.
      const store = await make();
      await store.addDiag(rec('e', 1, 'error'), 3);
      for (let i = 2; i <= 6; i++) await store.addDiag(rec(`s${i}`, i), 3);
      expect((await store.diagBatch(10)).map((r) => r.id)).toEqual(['e', 's5', 's6']);
      expect(await store.diagCount()).toBe(3);
    });

    it('never deletes when under the cap, and ignores a repeated id', async () => {
      const store = await make();
      await store.addDiag(rec('a', 1), 10);
      await store.addDiag(rec('a', 1), 10);
      await store.addDiag(rec('b', 2), 10);
      expect(await store.diagCount()).toBe(2);
      await store.removeDiag(['a']);
      expect((await store.diagBatch(10)).map((r) => r.id)).toEqual(['b']);
    });
  });
}

describe('Diagnostics', () => {
  function make(now = { t: 1000 }) {
    const store = new MemoryDiagStore();
    let n = 0;
    const diag = new Diagnostics({ store, newId: () => `d${++n}`, now: () => now.t, tallyMaxCount: 3 });
    return { store, diag, now };
  }

  it('removes a batch only after it was delivered', async () => {
    const { store, diag } = make();
    diag.record('load', { n: { ms: 5 } });
    await expect(diag.flush(async () => { throw new Error('offline'); })).rejects.toThrow();
    expect(store.records).toHaveLength(1);
    const got: DiagRecord[] = [];
    expect(await diag.flush(async (b) => { got.push(...b); })).toBe(1);
    expect(got[0]?.n).toEqual({ ms: 5 });
    expect(store.records).toHaveLength(0);
  });

  it('tallies transfers into one record per window, separating failures from bytes', async () => {
    const { store, diag } = make();
    const base = { orgId: 'o', projectId: 'p' };
    diag.transfer('down', { ...base, bytes: 1000, ms: 100, fetchMs: 60, verifyMs: 40 });
    diag.transfer('down', { ...base, bytes: 500, ms: 900, failure: 'offline' });
    expect(store.records).toHaveLength(0);
    diag.transfer('down', { ...base, bytes: 2000, ms: 300, fetchMs: 100, verifyMs: 200 });
    await diag.settle();
    expect(store.records).toHaveLength(1);
    expect(store.records[0]).toMatchObject({
      kind: 'transfer', orgId: 'o', projectId: 'p', t: { dir: 'down' },
      n: { count: 3, bytes: 3000, ms: 1300, maxMs: 900, fetchMs: 160, verifyMs: 240, failOffline: 1 }
    });
  });

  it('records nothing when switched off', async () => {
    const { store, diag } = make();
    diag.setEnabled(false);
    diag.record('load', { n: { ms: 1 } });
    diag.transfer('up', { orgId: 'o', projectId: 'p', bytes: 1, ms: 1 });
    diag.closeTallies();
    await diag.settle();
    expect(store.records).toHaveLength(0);
  });

  it('survives a store that fails', async () => {
    class FullDisk extends MemoryDiagStore {
      override async addDiag(): Promise<void> { throw new Error('disk full'); }
    }
    const diag = new Diagnostics({ store: new FullDisk(), newId: () => 'x' });
    expect(() => diag.record('load', {})).not.toThrow();
    await diag.settle();
  });
});

describe('SyncClient diagnostics', () => {
  function device(server: FakeServer, wall: { t: number }) {
    const store = new MemoryDiagStore();
    let n = 0;
    const diag = new Diagnostics({ store, newId: () => `d${++n}`, now: () => wall.t });
    let e = 0;
    const client = new SyncClient({
      orgId: 'org1', projectId: 'p1', actorId: 'lead', deviceId: 'dA',
      store: new MemoryStore(), transport: server.transportFor(),
      clock: new HlcClock('dA', () => (wall.t += 1)), now: () => wall.t,
      newId: () => `e${++e}`, diag
    });
    return { client, store, diag };
  }

  it('records load, a sync that moved events, and not a quiet one', async () => {
    const server = new FakeServer();
    const wall = { t: 0 };
    const { client, store, diag } = device(server, wall);
    await client.load();
    await client.append('v1.ProjectCreated', { name: 'Luke', sourceLanguoidId: 'eng' });
    await client.append('v1.MemberAdded', { profileId: 'lead', role: 'owner' });
    await client.sync();
    await client.sync();
    await diag.settle();
    const syncs = store.records.filter((r) => r.kind === 'sync');
    expect(store.records.some((r) => r.kind === 'load' && r.orgId === 'org1' && r.projectId === 'p1')).toBe(true);
    expect(syncs).toHaveLength(1);
    expect(syncs[0]).toMatchObject({ t: { outcome: 'ok' }, n: { pushed: 2, pending: 0 } });
    expect(syncs[0]!.n.pages).toBeGreaterThan(0);
  });

  it('records a spell offline once an hour, and how long it lasted when it ends', async () => {
    // Why: a phone polling a dead radio for a month must not fill its buffer with identical records.
    const server = new FakeServer();
    const wall = { t: 0 };
    const { client, store, diag } = device(server, wall);
    await client.load();
    server.offline = true;
    for (let i = 0; i < 10; i++) { wall.t += 5 * 60_000; await client.sync(); }
    await diag.settle();
    expect(store.records.filter((r) => r.t.outcome === 'offline')).toHaveLength(1);
    wall.t += 60 * 60_000;
    await client.sync();
    server.offline = false;
    wall.t += 60_000;
    await client.sync();
    await diag.settle();
    const syncs = store.records.filter((r) => r.kind === 'sync');
    expect(syncs.map((r) => r.t.outcome)).toEqual(['offline', 'offline', 'ok']);
    expect(syncs[2]!.n.offlineMs).toBeGreaterThan(60 * 60_000);
  });
});
