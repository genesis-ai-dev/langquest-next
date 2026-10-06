import { HlcClock, isStored } from '@langquest-next/core';
import { reconcileBlobs, type BlobObject, type ReconcilerDeps } from '../src/blobReconciler';
import { MemoryStore } from '../src/memoryStore';
import { SyncClient } from '../src/syncClient';
import { FakeServer } from './fakeServer';

/**
 * The reconciler is the server's own check on the bucket, independent of the
 * storage trigger: every object gets a confirmation even if the trigger
 * never fired, and bytes that do not match their name are invalidated.
 */
async function partition(server: FakeServer) {
  const wall = { t: 0 };
  const client = new SyncClient({
    orgId: 'org1', partitionId: 'p1', actorId: 'lead', deviceId: 'dA', store: new MemoryStore(),
    transport: server.transportFor(), clock: new HlcClock('dA', () => (wall.t += 1))
  });
  await client.load();
  await client.append('v1.PartitionCreated', { name: 'x', sourceLanguoidId: 'eng' });
  await client.append('v1.MemberAdded', { profileId: 'lead', role: 'owner' });
  await client.append('v1.RecordingAdded', {
    recordingId: 'r1', unitId: 'u1', laneId: 'L1', kind: 'target',
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
    partitions: async () => [{ orgId: 'org1', partitionId: 'p1' }],
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
    await partition(server);
    const d = deps(server, [{ orgId: 'org1', partitionId: 'p1', hash: sha('good'), format: 'wav', size: 4 }]);
    const report = await reconcileBlobs(d, { verify: false });
    expect(report.confirmed).toBe(1);
    expect((d as unknown as { verdicts: string[] }).verdicts).toEqual([`stored:${sha('good')}:4`]);
    // Second pass: nothing to do.
    expect((await reconcileBlobs(d, { verify: false })).confirmed).toBe(0);
  });

  it('with verify on, bytes that do not hash to their name are removed and invalidated', async () => {
    const server = new FakeServer();
    const client = await partition(server);
    server.serviceEvent('v1.BlobStored', { hash: sha('other'), size: 7 }); // trigger already confirmed it
    const removed: string[] = [];
    const d = deps(server, [
      { orgId: 'org1', partitionId: 'p1', hash: sha('good'), format: 'wav', size: 4 },
      { orgId: 'org1', partitionId: 'p1', hash: sha('other'), format: 'wav', size: 7 }
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
    await partition(server);
    const removed: string[] = [];
    const d = deps(server, [{ orgId: 'org1', partitionId: 'p1', hash: sha('good'), format: 'wav', size: 4 }], removed);
    d.download = async () => { throw new Error('Internal Server Error'); };
    const report = await reconcileBlobs(d, { verify: true });
    expect(report.invalidated).toBe(0);
    expect(removed).toEqual([]);
    expect(report.unreadable).toHaveLength(1);
  });
});
