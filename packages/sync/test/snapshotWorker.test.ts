import { HlcClock, ORG_STREAM, PERSON_ORG, type Snapshot } from '@langquest-next/core';
import { MemoryStore } from '../src/memoryStore';
import { runSnapshotWorker } from '../src/snapshotWorker';
import { SyncClient } from '../src/syncClient';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSupabase } from './fakeSupabase';

const unit = (i: number) => ({ unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${String(i).padStart(4, '0')}` });
const HOUR = 60 * 60 * 1000;

/** A stream with `n` units (numbered from `from`) written by a client and pushed to the server. */
async function language(server: FakeServer, streamId: string, n: number, orgId = 'org1', from = 0) {
  const wall = { t: from * 10 };
  let k = from;
  const client = new SyncClient({
    orgId, streamId, actorId: 'lead', deviceId: `d-${streamId}`, store: new MemoryStore(), transport: server.transportFor(),
    clock: new HlcClock(`d-${streamId}`, () => (wall.t += 1)), newId: () => `${streamId}-e${++k}`
  });
  await client.load();
  for (let i = from; i < from + n; i++) await client.append('v1.UnitAdded', unit(i));
  await client.sync();
  return client;
}

describe('runSnapshotWorker (the projection pass, against a fake service client)', () => {
  it('writes a first snapshot for each language, smallest first, and skips the organization and person streams', async () => {
    const server = new FakeServer();
    await language(server, 'big', 3);
    await language(server, 'small', 1);
    await language(server, ORG_STREAM, 1);
    await language(server, 'mine', 1, PERSON_ORG);
    const fake = fakeSupabase(server);
    const out = await runSnapshotWorker(fake.client);
    expect(out.map((r) => [r.streamId, r.serverSeq, r.updated, r.written])).toEqual([
      ['small', 1, true, true],
      ['big', 3, true, true]
    ]);
    expect(fake.puts().map((c) => [c.args['p_stream_id'], c.args['p_server_seq']])).toEqual([['small', 1], ['big', 3]]);
    expect(Object.keys(server.snapshots.get('org1/big')!.state.units)).toHaveLength(3);
    // Applied-id bookkeeping is not stored in a snapshot.
    expect(server.snapshots.get('org1/big')!.state.appliedEventIds).toEqual({});
  });

  it('a second pass over a stream that has not moved writes nothing, and still shows the Inbox the snapshot', async () => {
    const server = new FakeServer();
    await language(server, 'a', 2);
    const fake = fakeSupabase(server);
    await runSnapshotWorker(fake.client);
    const observed: Snapshot[] = [];
    const out = await runSnapshotWorker(fake.client, 1000, async (s) => { observed.push(s); });
    expect(out).toEqual([{ orgId: 'org1', streamId: 'a', serverSeq: 2, updated: false, written: false }]);
    expect(fake.puts()).toHaveLength(1);
    expect(observed.map((s) => s.serverSeq)).toEqual([2]);
  });

  it('pages the log by page size, including a stream that fills its last page exactly', async () => {
    const server = new FakeServer();
    await language(server, 'a', 5);
    for (const [pageSize, pulls] of [[2, 3], [5, 2], [100, 1]] as const) {
      const fake = fakeSupabase(server);
      server.snapshots.clear();
      const before = server.pullCalls;
      const [r] = await runSnapshotWorker(fake.client, pageSize);
      expect(r!.serverSeq).toBe(5);
      expect(server.pullCalls - before).toBe(pulls);
      expect(Object.keys(server.snapshots.get('org1/a')!.state.units)).toHaveLength(5);
    }
  });

  it('visit decides which languages are looked at; the others are not even read', async () => {
    const server = new FakeServer();
    await language(server, 'a', 1);
    await language(server, 'b', 1);
    const fake = fakeSupabase(server);
    const out = await runSnapshotWorker(fake.client, 1000, undefined, (_org, stream) => stream === 'b');
    expect(out.map((r) => r.streamId)).toEqual(['b']);
    expect(fake.calls.filter((c) => c.fn === 'get_snapshot_meta').map((c) => c.args['p_stream_id'])).toEqual(['b']);
  });

  describe('with a snapshot already stored (decisions.md 88)', () => {
    async function stored(created: string | null, snapshotsError?: string) {
      const server = new FakeServer();
      const client = await language(server, 'a', 3);
      server.makeSnapshot('org1', 'a');
      const fake = fakeSupabase(server, { snapshotCreatedAt: created, ...(snapshotsError ? { snapshotsError } : {}) });
      return { server, client, fake };
    }

    it('folds a short tail for the Inbox but waits to write while the snapshot is young', async () => {
      const { client, fake } = await stored(new Date().toISOString());
      await client.append('v1.UnitAdded', unit(3));
      await client.sync();
      const observed: Snapshot[] = [];
      const [r] = await runSnapshotWorker(fake.client, 1000, async (s) => { observed.push(s); });
      expect(r).toMatchObject({ serverSeq: 4, updated: true, written: false });
      expect(fake.puts()).toHaveLength(0);
      expect(Object.keys(observed[0]!.state.units)).toHaveLength(4);
    });

    it('writes once the snapshot is an hour old, or its age is unknown', async () => {
      for (const created of [new Date(Date.now() - 2 * HOUR).toISOString(), null]) {
        const { client, fake } = await stored(created);
        await client.append('v1.UnitAdded', unit(3));
        await client.sync();
        const [r] = await runSnapshotWorker(fake.client);
        expect(r).toMatchObject({ serverSeq: 4, written: true });
        expect(fake.puts()).toHaveLength(1);
      }
    });

    it('writes at 200 new events without asking how old the snapshot is', async () => {
      const { server, fake } = await stored('not read');
      await language(server, 'a', 200, 'org1', 3);
      const [r] = await runSnapshotWorker(fake.client);
      expect(r).toMatchObject({ serverSeq: 203, written: true });
    });

    it('a redaction of something inside the snapshot refolds the whole log and writes at once', async () => {
      const { client, fake } = await stored(new Date().toISOString());
      await client.append('v1.Redacted', { eventId: 'a-e1' });
      await client.sync();
      const observed: Snapshot[] = [];
      const [r] = await runSnapshotWorker(fake.client, 2, async (s) => { observed.push(s); });
      expect(r).toMatchObject({ serverSeq: 4, written: true });
      expect(observed[0]!.state.units['u0']).toBeUndefined();
      expect(observed[0]!.state.units['u1']).toBeDefined();
    });

    it('an error reading the snapshot age is raised, not guessed', async () => {
      const { client, fake } = await stored(null, 'boom');
      await client.append('v1.UnitAdded', unit(3));
      await client.sync();
      await expect(runSnapshotWorker(fake.client)).rejects.toThrow('snapshot age org1/a: boom');
    });
  });

  describe('failures', () => {
    it('without onError the first failing language stops the pass', async () => {
      const server = new FakeServer();
      await language(server, 'a', 1);
      await language(server, 'b', 1);
      const fake = fakeSupabase(server);
      fake.fail.set('put_snapshot:a', 'timeout');
      await expect(runSnapshotWorker(fake.client)).rejects.toThrow('put_snapshot org1/a: timeout');
    });

    it('with onError that language is reported and the pass goes on', async () => {
      const server = new FakeServer();
      await language(server, 'a', 1);
      await language(server, 'b', 1);
      const fake = fakeSupabase(server);
      fake.fail.set('put_snapshot:a', 'timeout');
      const errors: string[] = [];
      const out = await runSnapshotWorker(fake.client, 1000, undefined, undefined, (org, stream, e) => errors.push(`${org}/${stream}: ${(e as Error).message}`));
      expect(errors).toEqual(['org1/a: put_snapshot org1/a: timeout']);
      expect(out.map((r) => r.streamId)).toEqual(['b']);
    });
  });
});
