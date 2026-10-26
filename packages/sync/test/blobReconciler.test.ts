import { HlcClock, isStored } from '@langquest-next/core';
import { reconcileBlobs, runBlobReconciler, type BlobObject, type ReconcilerDeps } from '../src/blobReconciler';
import type { BlobFiles } from '../src/workerBlobs';
import { fakeSupabase } from './fakeSupabase';
import { MemoryStore } from '../src/memoryStore';
import { SyncClient } from '../src/syncClient';
import { FakeServer } from '../src/testing/fakeServer';

/**
 * The reconciler is the server's own check on the bucket, independent of the
 * Worker's confirmation: every object gets one even if it was never
 * recorded, and bytes that do not match their name are invalidated.
 */
async function language(server: FakeServer) {
  const wall = { t: 0 };
  const client = new SyncClient({
    orgId: 'org1', streamId: 'p1', actorId: 'lead', deviceId: 'dA', store: new MemoryStore(),
    transport: server.transportFor(), clock: new HlcClock('dA', () => (wall.t += 1))
  });
  await client.load();
  await client.append('v1.RecordingAdded', {
    recordingId: 'r1', unitId: 'u1', kind: 'target',
    cards: [{ hash: sha('good'), durationMs: 1 }, { hash: sha('other'), durationMs: 1 }]
  });
  await client.sync();
  return client;
}

// Test digest: deterministic stand-in for SHA-256 over the bytes' text.
function sha(text: string): string {
  return `h_${text}`;
}
const digest = async (bytes: Uint8Array) => sha(new TextDecoder().decode(bytes));

function deps(server: FakeServer, objects: BlobObject[], removed: string[] = []): ReconcilerDeps {
  const verdicts: string[] = [];
  return {
    streams: async () => [{ orgId: 'org1', streamId: 'p1' }],
    transport: server.transportFor(),
    listObjects: async () => objects,
    download: async (o) => new TextEncoder().encode(o.hash === sha('good') ? 'good' : 'garbage'),
    remove: async (o) => { removed.push(o.hash); },
    recordBlob: async (_o, _p, hash, size) => {
      verdicts.push(`stored:${hash}:${size}`);
      server.serviceEvent('v1.BlobStored', { hash, size });
    },
    invalidateBlob: async (_o, _p, hash, reason) => {
      verdicts.push(`invalid:${hash}:${reason}`);
      server.serviceEvent('v1.BlobInvalidated', { hash, reason });
    },
    digest,
    verdicts
  } as ReconcilerDeps & { verdicts: string[] };
}

describe('blob reconciler', () => {
  it('confirms objects in the bucket that have no confirmation in the log', async () => {
    const server = new FakeServer();
    await language(server);
    const d = deps(server, [{ orgId: 'org1', streamId: 'p1', hash: sha('good'), format: 'wav', size: 4 }]);
    const report = await reconcileBlobs(d, { verify: false });
    expect(report.confirmed).toBe(1);
    expect((d as unknown as { verdicts: string[] }).verdicts).toEqual([`stored:${sha('good')}:4`]);
    // Second pass: nothing to do.
    expect((await reconcileBlobs(d, { verify: false })).confirmed).toBe(0);
  });

  it('with verify on, bytes that do not hash to their name are removed and invalidated', async () => {
    const server = new FakeServer();
    const client = await language(server);
    server.serviceEvent('v1.BlobStored', { hash: sha('other'), size: 7 }); // trigger already confirmed it
    const removed: string[] = [];
    const d = deps(server, [
      { orgId: 'org1', streamId: 'p1', hash: sha('good'), format: 'wav', size: 4 },
      { orgId: 'org1', streamId: 'p1', hash: sha('other'), format: 'wav', size: 7 }
    ], removed);
    const report = await reconcileBlobs(d, { verify: true });
    expect(report.invalidated).toBe(1);
    expect(removed).toEqual([sha('other')]);
    await client.sync();
    expect(isStored(client.getState(), sha('good'))).toBe(true);
    expect(isStored(client.getState(), sha('other'))).toBe(false);
  });
});

describe('blob reconciler caution', () => {
  it('an object it cannot download is reported, not invalidated', async () => {
    // Why: a transient storage error must never make the server disown
    // good audio. Only bytes that were read and hash wrong are invalidated.
    const server = new FakeServer();
    await language(server);
    const removed: string[] = [];
    const d = deps(server, [{ orgId: 'org1', streamId: 'p1', hash: sha('good'), format: 'wav', size: 4 }], removed);
    d.download = async () => { throw new Error('Internal Server Error'); };
    const report = await reconcileBlobs(d, { verify: true });
    expect(report.invalidated).toBe(0);
    expect(removed).toEqual([]);
    expect(report.unreadable).toHaveLength(1);
  });

  it('a confirmation with a different size than the object is recorded again; one that matches is left alone', async () => {
    const server = new FakeServer();
    await language(server);
    server.serviceEvent('v1.BlobStored', { hash: sha('good'), size: 4 });
    server.serviceEvent('v1.BlobStored', { hash: sha('other'), size: 7 });
    const d = deps(server, [
      { orgId: 'org1', streamId: 'p1', hash: sha('good'), format: 'wav', size: 4 },
      { orgId: 'org1', streamId: 'p1', hash: sha('other'), format: 'wav', size: 9 }
    ]);
    const report = await reconcileBlobs(d, { verify: false });
    expect(report.confirmed).toBe(1);
    expect((d as unknown as { verdicts: string[] }).verdicts).toEqual([`stored:${sha('other')}:9`]);
  });

  it('without verify nothing is downloaded, hashed or removed', async () => {
    const server = new FakeServer();
    await language(server);
    const removed: string[] = [];
    const d = deps(server, [{ orgId: 'org1', streamId: 'p1', hash: sha('other'), format: 'wav', size: 7 }], removed);
    d.download = async () => { throw new Error('must not download'); };
    const report = await reconcileBlobs(d, { verify: false });
    expect(report).toMatchObject({ streams: 1, objects: 1, verified: 0, invalidated: 0, unreadable: [] });
    expect(removed).toEqual([]);
  });

  it('an invalidated object is not also confirmed, and a stream with no objects is just counted', async () => {
    const server = new FakeServer();
    await language(server);
    const d = deps(server, [{ orgId: 'org1', streamId: 'p1', hash: sha('good'), format: 'wav', size: 4 }]);
    d.download = async () => new TextEncoder().encode('garbage');
    const report = await reconcileBlobs(d, { verify: true });
    expect(report).toMatchObject({ verified: 1, invalidated: 1, confirmed: 0 });
    expect((d as unknown as { verdicts: string[] }).verdicts[0]).toBe(`invalid:${sha('good')}:hash mismatch: bytes hash to ${sha('garbage')}`);
    expect(await reconcileBlobs(deps(server, []), { verify: true })).toMatchObject({ streams: 1, objects: 0 });
  });

  it('reads the stream through its snapshot and the pages after it', async () => {
    const server = new FakeServer();
    await language(server);
    server.serviceEvent('v1.BlobStored', { hash: sha('good'), size: 4 });
    server.makeSnapshot('org1', 'p1');
    server.serviceEvent('v1.BlobStored', { hash: sha('other'), size: 7 });
    const d = deps(server, [
      { orgId: 'org1', streamId: 'p1', hash: sha('good'), format: 'wav', size: 4 },
      { orgId: 'org1', streamId: 'p1', hash: sha('other'), format: 'wav', size: 7 }
    ]);
    expect((await reconcileBlobs(d, { verify: false, pageSize: 1 })).confirmed).toBe(0);
  });
});

describe('blob reconciler work saved', () => {
  it('folds no stream that has no files, and none whose log holds no BlobStored', async () => {
    // Why: performance-audit-2026-10-26.md C5. Every stream, organization and person streams too, was folded each pass.
    const server = new FakeServer();
    await language(server);
    let folded = 0;
    const d = deps(server, []);
    const pull = d.transport.pull.bind(d.transport);
    d.transport = { ...d.transport, pull: async (...a: Parameters<typeof pull>) => { folded += 1; return pull(...a); } } as typeof d.transport;
    expect(await reconcileBlobs(d, { verify: false })).toMatchObject({ streams: 1, objects: 0, confirmed: 0 });
    expect(folded).toBe(0);

    // With files but no BlobStored in the log: confirmed without reading the stream.
    const objects = [{ orgId: 'org1', streamId: 'p1', hash: sha('good'), format: 'wav', size: 4 }];
    const none = deps(server, objects);
    none.hasStoredBlobs = async () => false;
    none.transport = d.transport;
    expect((await reconcileBlobs(none, { verify: false })).confirmed).toBe(1);
    expect(folded).toBe(0);
  });

  it('confirms the unconfirmed objects a few at a time, and a refusal stops the stream', async () => {
    const server = new FakeServer();
    await language(server);
    const objects = Array.from({ length: 10 }, (_, i) => ({ orgId: 'org1', streamId: 'p1', hash: sha(`f${i}`), format: 'wav', size: 1 }));
    const d = deps(server, objects);
    let inFlight = 0;
    let most = 0;
    const record = d.recordBlob;
    d.recordBlob = async (...a) => { inFlight += 1; most = Math.max(most, inFlight); await new Promise((r) => setTimeout(r, 1)); await record(...a); inFlight -= 1; };
    expect((await reconcileBlobs(d, { verify: false })).confirmed).toBe(10);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(4);

    const fresh = new FakeServer();
    await language(fresh);
    const refusing = deps(fresh, objects);
    refusing.recordBlob = async () => { throw new Error('nope'); };
    await expect(reconcileBlobs(refusing, { verify: false })).rejects.toThrow('nope');
  });
});

describe('runBlobReconciler (wired to a service client and the file store)', () => {
  function files(objects: Record<string, string>): BlobFiles & { removed: string[] } {
    const removed: string[] = [];
    return {
      removed,
      list: async (prefix) => Object.entries(objects).filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.length })),
      get: async (key) => new TextEncoder().encode(objects[key]),
      put: async () => {},
      remove: async (key) => { removed.push(key); }
    };
  }
  const sha256 = async (text: string) =>
    Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))).map((b) => b.toString(16).padStart(2, '0')).join('');

  it('confirms a good file through record_blob, and removes and invalidates one that hashes wrong', async () => {
    const server = new FakeServer();
    await language(server);
    const good = await sha256('good bytes');
    const bad = await sha256('what it should have been');
    const f = files({ [`org1/p1/${good}.wav`]: 'good bytes', [`org1/p1/${bad}.m4a`]: 'garbage', 'org1/p1/stray': 'ignored' });
    const fake = fakeSupabase(server);
    const report = await runBlobReconciler(fake.client, f, { verify: true });
    expect(report).toMatchObject({ streams: 1, objects: 2, verified: 2, confirmed: 1, invalidated: 1 });
    expect(f.removed).toEqual([`org1/p1/${bad}.m4a`]);
    expect(fake.calls.map((c) => c.fn).filter((fn) => fn.endsWith('_blob')).sort()).toEqual(['invalidate_blob', 'record_blob']);
    expect(fake.calls.find((c) => c.fn === 'record_blob')!.args).toEqual({ p_org: 'org1', p_stream: 'p1', p_hash: good, p_size: 10 });
  });

  it('a refused record_blob or invalidate_blob stops the pass with the RPC named', async () => {
    const server = new FakeServer();
    await language(server);
    const good = await sha256('good bytes');
    const fake = fakeSupabase(server);
    fake.fail.set('record_blob', 'nope');
    await expect(runBlobReconciler(fake.client, files({ [`org1/p1/${good}.wav`]: 'good bytes' }), { verify: false })).rejects.toThrow('record_blob: nope');
    const bad = fakeSupabase(server);
    bad.fail.set('invalidate_blob', 'nope');
    await expect(runBlobReconciler(bad.client, files({ [`org1/p1/${good}.wav`]: 'tampered' }), { verify: true })).rejects.toThrow('invalidate_blob: nope');
  });
});
