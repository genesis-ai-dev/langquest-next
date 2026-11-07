import { HlcClock, idAuthor, isBoundToAuthor, newCommandId, type AnyEvent } from '@langquest-next/core';
import { LanguageFiles } from '../src/languageFiles';
import { MemoryStore } from '../src/memoryStore';
import { SyncClient } from '../src/syncClient';
import { FakeServer } from '../src/testing/fakeServer';

/**
 * Bound ids (docs/nearby-sync-plan.md 5.4), on the sync side. Why: an event with
 * no id of its own gets one here, so this default has to bind or sharing quietly loses
 * those events; and a recording id is bound when its event is written, for whoever
 * is signed in then, so the journal's question "is this one here" has to look past the name.
 */
let ticks = 0;
function phone(server: FakeServer, actorId: string, deviceId = `d-${actorId}`, o: { keepOnDisk?: boolean; checkpointEvery?: number; store?: MemoryStore } = {}) {
  const store = o.store ?? new MemoryStore();
  let n = 0;
  const client = new SyncClient({
    orgId: 'org1', streamId: 'p1', actorId, deviceId, store, transport: server.transportFor(),
    clock: new HlcClock(deviceId, () => ++ticks), newId: () => `n${++n}`,
    ...(o.keepOnDisk ? { keepOnDisk: true } : {}),
    ...(o.checkpointEvery ? { checkpointEvery: o.checkpointEvery } : {})
  });
  return { client, store };
}
const recording = (recordingId: string, unitId = 'u0') => ({ recordingId, unitId, kind: 'target' as const, cards: [{ hash: `h-${recordingId}`, durationMs: 5 }] });
const unit = (i: number) => ({ unitId: `u${i}`, parentUnitId: null, kind: 'passage', label: `P${i}`, order: `a${i}` });

describe('an event with no id of its own', () => {
  it('names its author, from append and from appendMany', async () => {
    const { client } = phone(new FakeServer(), 'sam');
    await client.load();
    const one = await client.append('v1.UnitAdded', unit(0));
    const [many] = await client.appendMany([{ type: 'v1.UnitAdded', payload: unit(1) }]);
    expect(idAuthor(one.id)).toBe('sam');
    expect(isBoundToAuthor(one)).toBe(true);
    expect(isBoundToAuthor(many!)).toBe(true);
  });

  it('a spec keeps the id it came with, old or new', async () => {
    const { client } = phone(new FakeServer(), 'sam');
    await client.load();
    const [old, bound] = await client.appendMany([
      { id: 'old-id:0', type: 'v1.UnitAdded', payload: unit(0) },
      { id: newCommandId('sam', 'x:0'), type: 'v1.UnitAdded', payload: unit(1) }
    ]);
    expect(old!.id).toBe('old-id:0');
    expect(bound!.id).toBe('by:sam:x:0');
  });

  it('the server takes old and new forms alike, and a phone folds both', async () => {
    const server = new FakeServer();
    const { client } = phone(server, 'sam');
    await client.load();
    await client.appendMany([{ id: 'old-id:0', type: 'v1.UnitAdded', payload: unit(0) }, { type: 'v1.UnitAdded', payload: unit(1) }]);
    await client.sync();
    const other = phone(server, 'carla');
    await other.client.load();
    await other.client.pull();
    expect(Object.keys(other.client.getState().units).sort()).toEqual(['u0', 'u1']);
    expect(server.stream('org1', 'p1').map((e: AnyEvent) => idAuthor(e.id))).toEqual(expect.arrayContaining([null, 'sam']));
  });
});

describe('is this recording here, whoever wrote it', () => {
  async function kept(actor: string, recordingId: string) {
    // The recording is on the server; a language kept on disk has it only as a row, once others' work has moved memory on.
    const server = new FakeServer();
    const lead = phone(server, 'lead');
    await lead.client.load();
    for (let i = 0; i < 6; i++) await lead.client.append('v1.UnitAdded', unit(i));
    await lead.client.sync();
    const writer = phone(server, actor);
    await writer.client.load();
    await writer.client.append('v1.RecordingAdded', recording(recordingId));
    await writer.client.sync();
    const here = phone(server, 'carla', 'd-carla', { keepOnDisk: true, checkpointEvery: 2 });
    await here.client.load();
    await here.client.pull();
    expect(here.client.getState().recordings[recordingId]).toBeUndefined();
    expect(await here.store.keptById('org1', 'p1', 'recording', [recordingId])).toHaveLength(1);
    return new LanguageFiles(here.client, here.store, 'org1', 'p1');
  }

  it('finds a copy another person wrote, on disk', async () => {
    const files = await kept('sam', 'by:sam:journal-1');
    expect(await files.hasRecording('journal-1', 'u0')).toBe(true);
    expect(await files.hasRecording('journal-2', 'u0')).toBe(false);
  });

  it('finds a copy from before ids were bound, on disk', async () => {
    const files = await kept('sam', 'journal-1');
    expect(await files.hasRecording('journal-1', 'u0')).toBe(true);
  });

  it('finds a copy another person wrote, in memory, as a language held whole', async () => {
    const server = new FakeServer();
    const { client, store } = phone(server, 'carla');
    await client.load();
    await client.append('v1.RecordingAdded', recording('by:sam:journal-1'));
    const files = new LanguageFiles(client, store, 'org1', 'p1');
    expect(await files.hasRecording('journal-1', 'u0')).toBe(true);
    expect(await files.hasRecording('by:carla:journal-1', 'u0')).toBe(true);
    expect(await files.hasRecording('journal-2', 'u0')).toBe(false);
  });
});
