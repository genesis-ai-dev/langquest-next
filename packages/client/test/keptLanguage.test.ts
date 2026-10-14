import { HlcClock, type LanguageState } from '@langquest-next/core';
import { MemoryStore } from '../src/memoryStore';
import { SyncClient } from '../src/syncClient';
import { LanguageFiles } from '../src/languageFiles';
import { FakeServer } from '../src/testing/fakeServer';

/**
 * A big language keeps its recordings and file verdicts on the phone, not
 * in memory, and holds in memory only the passages a screen has open
 * (decisions.md 104). Why these tests: memory must shrink without the
 * phone's language ever differing from what folding everything in memory
 * gives, whatever order things arrive in, and without losing anything to a
 * dropped link, an old checkpoint or a redaction.
 */
type Lang = LanguageState;
let ids = 0;

function phone(server: FakeServer, deviceId: string, actorId: string, opts: { keepOnDisk?: boolean; checkpointEvery?: number; store?: MemoryStore } = {}) {
  const store = opts.store ?? new MemoryStore();
  const client = new SyncClient({
    orgId: 'org1', streamId: 'p1', actorId, deviceId, store, transport: server.transportFor(),
    clock: new HlcClock(deviceId, () => ++ids), newId: () => `${deviceId}-${++ids}`,
    ...(opts.keepOnDisk ? { keepOnDisk: true } : {}),
    ...(opts.checkpointEvery ? { checkpointEvery: opts.checkpointEvery } : {})
  });
  return { client, store };
}

/** The language as a phone that keeps records on disk has it: memory plus what is kept. */
async function whole(c: SyncClient, store: MemoryStore): Promise<Lang> {
  const s = structuredClone(c.getState()) as Lang;
  for (const row of await store.keptByUnit('org1', 'p1', 'recording', Object.keys(s.units).concat(['u-other']))) {
    s.recordings[row.id] ??= JSON.parse(row.json);
  }
  const files = await store.keptById('org1', 'p1', 'file', [...hashesIn(s)]);
  for (const row of files) s.blobs[row.id] ??= JSON.parse(row.json);
  return s;
}
const hashesIn = (s: Lang) => new Set(Object.values(s.recordings).flatMap((r) => r.cards.map((c) => c.hash)));
const comparable = (s: Lang) => ({ ...s, appliedEventIds: {} });

/** A language with `n` passages, each with a recording whose file the server stored. */
async function language(server: FakeServer, n: number) {
  const lead = phone(server, 'dA', 'lead');
  await lead.client.load();
  for (let i = 0; i < n; i++) {
    await lead.client.append('v1.UnitAdded', { unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${String(i).padStart(3, '0')}` });
    await lead.client.append('v1.RecordingAdded', { recordingId: `r${i}`, unitId: `u${i}`, kind: 'target', cards: [{ hash: `h${i}`, durationMs: 1000 + i }] });
  }
  await lead.client.sync();
  for (let i = 0; i < n; i++) server.storeBlob('org1', 'p1', `h${i}`, 100 + i);
  return lead;
}

describe('a language that keeps its recordings on disk', () => {
  it('opens from a server snapshot holding no recordings in memory until a passage opens', async () => {
    const server = new FakeServer();
    await language(server, 40);
    server.makeSnapshot('org1', 'p1');
    server.chunkChars = 500;
    const { client, store } = phone(server, 'dB', 'r1', { keepOnDisk: true });
    await client.load();
    await client.pull();
    const s = client.getState();
    expect(Object.keys(s.units)).toHaveLength(40);
    expect(Object.keys(s.recordings)).toHaveLength(0);
    expect(Object.keys(s.blobs)).toHaveLength(0);
    expect(await store.keptCount('org1', 'p1', 'recording')).toBe(40);
    expect(await store.keptCount('org1', 'p1', 'file')).toBe(40);

    await client.loadUnits(['u3', 'u4']);
    expect(Object.keys(client.getState().recordings).sort()).toEqual(['r3', 'r4']);
    expect(Object.keys(client.getState().blobs).sort()).toEqual(['h3', 'h4']);
    expect(client.getState().blobs['h3']).toMatchObject({ stored: true, size: 103 });
  });

  it('agrees with a phone that keeps everything in memory, through checkpoints, in any order', async () => {
    const server = new FakeServer();
    await language(server, 30);
    const onDisk = phone(server, 'dB', 'r1', { keepOnDisk: true, checkpointEvery: 7 });
    const inMemory = phone(server, 'dC', 'r2', { checkpointEvery: 7 });
    await onDisk.client.load();
    await inMemory.client.load();
    await onDisk.client.loadUnits(['u1']);
    for (let round = 0; round < 3; round++) {
      // Work arrives from someone else, and from this phone, between checkpoints.
      const other = phone(server, `dX${round}`, `t${round}`);
      await other.client.load();
      await other.client.sync();
      for (let i = 0; i < 5; i++) {
        await other.client.append('v1.RecordingAdded', { recordingId: `x${round}-${i}`, unitId: `u${(round * 7 + i) % 30}`, kind: 'target', cards: [{ hash: `x${round}-${i}`, durationMs: 5 }] });
      }
      await other.client.sync();
      server.storeBlob('org1', 'p1', `x${round}-0`, 7);
      await onDisk.client.append('v1.RecordingAdded', { recordingId: `mine${round}`, unitId: 'u1', kind: 'target', cards: [{ hash: `m${round}`, durationMs: 9 }] });
      for (let k = 0; k < 3; k++) { await onDisk.client.sync(); await inMemory.client.sync(); }
    }
    expect(comparable(await whole(onDisk.client, onDisk.store))).toEqual(comparable(inMemory.client.getState()));
    // Memory holds the open passage's recordings, not the language's.
    const inMemoryNow = Object.values(onDisk.client.getState().recordings);
    expect(inMemoryNow.length).toBeLessThan(10);
    expect(inMemoryNow.every((r) => r.unitId === 'u1')).toBe(true);
  });

  it('a dropped link resumes from the pieces already here, and nothing half-read is kept', async () => {
    const server = new FakeServer();
    await language(server, 40);
    server.makeSnapshot('org1', 'p1');
    server.chunkChars = 400;
    server.failChunkAfter = 5;
    const { client, store } = phone(server, 'dB', 'r1', { keepOnDisk: true });
    await client.load();
    expect((await client.sync()).offline).toBe(true);
    expect(await store.keptCount('org1', 'p1', 'recording')).toBe(0);
    const before = server.chunkCalls;
    server.failChunkAfter = Infinity;
    await client.pull();
    const total = Math.ceil(JSON.stringify(server.snapshots.get('org1/p1')!.state).length / 400);
    expect(server.chunkCalls - before).toBe(total - 5);
    expect(await store.keptCount('org1', 'p1', 'recording')).toBe(40);
    expect(Object.keys(client.getState().units)).toHaveLength(40);
  });

  it('moves a checkpoint from before onto disk the first time it opens', async () => {
    const server = new FakeServer();
    await language(server, 20);
    const store = new MemoryStore();
    const old = phone(server, 'dB', 'r1', { store, checkpointEvery: 5 });
    await old.client.load();
    await old.client.pull();
    const full = comparable(old.client.getState());
    expect(Object.keys(full.recordings)).toHaveLength(20);
    const updated = phone(server, 'dB', 'r1', { store, keepOnDisk: true });
    await updated.client.load();
    expect(Object.keys(updated.client.getState().recordings)).toHaveLength(0);
    expect(await store.keptCount('org1', 'p1', 'recording')).toBe(20);
    expect(comparable(await whole(updated.client, store))).toEqual(full);
  });

  it('a recording redacted after it went to disk disappears once the new snapshot arrives', async () => {
    const server = new FakeServer();
    const lead = await language(server, 10);
    server.makeSnapshot('org1', 'p1');
    const { client, store } = phone(server, 'dB', 'r1', { keepOnDisk: true });
    await client.load();
    await client.pull();
    expect((await store.keptById('org1', 'p1', 'recording', ['r2']))).toHaveLength(1);
    const target = server.log.find((e) => e.type === 'v1.RecordingAdded' && e.payload.recordingId === 'r2')!;
    await lead.client.append('v1.Redacted', { eventId: target.id });
    await lead.client.sync();
    server.makeSnapshot('org1', 'p1');
    await client.pull();
    await client.pull();
    expect(await store.keptById('org1', 'p1', 'recording', ['r2'])).toHaveLength(0);
    expect(await store.keptCount('org1', 'p1', 'recording')).toBe(9);
    await client.loadUnits(['u2']);
    expect(client.getState().recordings['r2']).toBeUndefined();
  });
});

describe('file planning for a language kept on disk', () => {
  it('still sends a recording made here whose file never went up, after the recording went to disk', async () => {
    // Why: the recording's event can reach the server before its audio does.
    // If the checkpoint then moves the recording to disk, a planner that
    // looked only in memory would never send the file: lost audio.
    const server = new FakeServer();
    await language(server, 12);
    const { client, store } = phone(server, 'dB', 't1', { keepOnDisk: true, checkpointEvery: 3 });
    await client.load();
    await client.sync();
    await client.append('v1.RecordingAdded', { recordingId: 'mine', unitId: 'u7', kind: 'target', cards: [{ hash: 'unsent', durationMs: 3 }] });
    await client.sync();
    // More work arrives, a checkpoint takes the recording to disk, and memory lets it go.
    const other = phone(server, 'dX', 't2');
    await other.client.load();
    for (let i = 0; i < 6; i++) await other.client.append('v1.UnitAdded', { unitId: `n${i}`, parentUnitId: null, kind: 'passage', label: `N${i}`, order: `z${i}` });
    await other.client.sync();
    await client.sync();
    expect(client.getState().recordings['mine']).toBeUndefined();
    expect(await store.keptById('org1', 'p1', 'recording', ['mine'])).toHaveLength(1);

    const files = new LanguageFiles(client, store, 'org1', 'p1');
    const present = new Set(['unsent', 'h2']);
    expect((await files.upload(present)).map((r) => r.hash)).toEqual(['unsent']);
    expect(await files.hasRecording('mine')).toBe(true);
    // The passage this person recorded in is theirs to keep offline.
    expect([...(await files.scope('t1'))]).toContain('u7');
    // Kept offline: the stored files of u2 and u7 come down, with the server's size; the unsent one cannot.
    const down = await files.download(new Set(), new Set(['u2', 'u7']));
    expect(down.map((r) => r.hash)).toEqual(['h2', 'h7']);
    expect(files.sizeOf('h2')).toBe(102);
    // Room: h2 may go once u2 is not kept; the unsent file never may.
    expect((await files.evictable(present, new Set(['u7']))).map((r) => r.hash)).toEqual(['h2']);
    expect(await files.evictable(present, new Set(['u2', 'u7']))).toEqual([]);
    const counts = await files.byUnit(['u2', 'u7'], present, 't1', new Set());
    expect(counts.get('u2')).toMatchObject({ audio: 1, here: 1 });
    expect(counts.get('u7')).toMatchObject({ audio: 2, here: 1, toFetch: 1, reason: 'worked' });
    expect(await files.lost(['unsent'])).toMatchObject({ unsent: 1, unitIds: ['u7'] });
  });
});
