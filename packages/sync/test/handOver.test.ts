import { HlcClock, type BlobRef } from '@langquest-next/core';
import { DurableOutbox } from '../src/durableOutbox';
import { afterAttempt, deliverHandOver, parseHandOvers, withHandOver, type HandOver, type HandOverAttempt, type HandOverDeps } from '../src/handOver';
import { MemoryStore } from '../src/memoryStore';
import { SyncClient } from '../src/syncClient';
import { FakeServer } from '../src/testing/fakeServer';

const ref = (hash: string): BlobRef => ({ hash, format: 'm4a', unitId: 'u1' });
const upload = (hash: string) => ({ orgId: 'org', languageId: 'luke', ref: ref(hash) });
const akol: HandOver = { actorId: 'akol', uploads: [upload('a'), upload('b')], savedAt: '2026-10-05T12:00:00Z' };
const attempt = (over: Partial<HandOverAttempt> = {}): HandOverAttempt => ({
  sessionGone: false, eventsLeft: 0, accountLeft: 0, finished: [], unregistered: false, ...over
});

describe('hand-over on a shared phone (decisions.md 60)', () => {
  it('ends only when every event, account change, recording and notification is dealt with', () => {
    expect(afterAttempt(akol, attempt({ finished: ['a', 'b'] }))).toEqual({ kind: 'done' });
    expect(afterAttempt(akol, attempt({ finished: ['a'] }))).toEqual({ kind: 'keep', handOver: { ...akol, uploads: [upload('b')] } });
    expect(afterAttempt(akol, attempt({ finished: ['a', 'b'], eventsLeft: 1 })).kind).toBe('keep');
    expect(afterAttempt(akol, attempt({ finished: ['a', 'b'], accountLeft: 1 })).kind).toBe('keep');
    const withPush = { ...akol, uploads: [], pushToken: 'tok' };
    expect(afterAttempt(withPush, attempt())).toEqual({ kind: 'keep', handOver: withPush });
    expect(afterAttempt(withPush, attempt({ unregistered: true }))).toEqual({ kind: 'done' });
  });

  it('a session the server will not renew is dropped; the work waits for their next sign-in', () => {
    expect(afterAttempt(akol, attempt({ sessionGone: true, eventsLeft: 3 }))).toEqual({ kind: 'drop' });
  });

  it('signing out twice before the phone is online keeps one record naming every recording', () => {
    const again: HandOver = { actorId: 'akol', uploads: [upload('b'), upload('c')], savedAt: '2026-10-06T08:00:00Z' };
    const list = withHandOver(withHandOver([], { ...akol, pushToken: 'tok' }), again);
    expect(list).toHaveLength(1);
    expect(list[0]!.uploads.map((u) => u.ref.hash)).toEqual(['b', 'c', 'a']);
    expect(list[0]!.pushToken).toBe('tok');
    expect(withHandOver(list, { ...akol, actorId: 'mary' }).map((h) => h.actorId)).toEqual(['akol', 'mary']);
  });

  it('a torn write reads as no hand-overs, never a crash on launch', () => {
    expect(parseHandOvers(null)).toEqual([]);
    expect(parseHandOvers('{not json')).toEqual([]);
    expect(parseHandOvers('[{"nope":1}]')).toEqual([]);
    expect(parseHandOvers(JSON.stringify([akol]))).toEqual([akol]);
  });
});


describe('deliverHandOver: one attempt to send what a person left, as them', () => {
  function setup() {
    const server = new FakeServer();
    const store = new MemoryStore();
    const wall = { t: 0 };
    const client = new SyncClient({
      orgId: 'org1', streamId: 'luke', actorId: 'akol', deviceId: 'shared', store, transport: server.transportFor(),
      clock: new HlcClock('shared', () => (wall.t += 1)), newId: () => `akol-${(wall.t += 1)}`
    });
    const saved = new Map<string, string>();
    const outbox = new DurableOutbox('akol', {
      getItem: async (k) => saved.get(k) ?? null,
      setItem: async (k, v) => { saved.set(k, v); }
    }, async () => {});
    const sent: string[] = [];
    const deps = (over: Partial<HandOverDeps> = {}): HandOverDeps => ({
      store, transport: server.transportFor(), deviceId: 'shared', outbox,
      unregisterPush: async () => true,
      hasFile: () => true,
      upload: async (u) => { sent.push(u.ref.hash); return 'sent'; },
      ...over
    });
    return { server, store, client, outbox, sent, deps };
  }

  it('sends events, account changes and recordings, and says all of it went', async () => {
    const { server, client, outbox, sent, deps } = setup();
    server.offline = true;
    await client.load();
    await client.append('v1.UnitAdded', { unitId: 'Luke', parentUnitId: null, kind: 'passage', label: 'Luke', order: 'a' });
    await outbox.enqueue({ id: 'p1', kind: 'profile', payload: {} });
    server.offline = false;
    const { attempt: a, offline } = await deliverHandOver({ ...akol, pushToken: 'tok' }, deps());
    expect(offline).toBe(false);
    expect(server.log.map((e) => e.actorId)).toEqual(['akol']);
    expect(sent).toEqual(['a', 'b']);
    expect(a).toEqual({ sessionGone: false, eventsLeft: 0, accountLeft: 0, finished: ['a', 'b'], unregistered: true });
    expect(afterAttempt(akol, a)).toEqual({ kind: 'done' });
  });

  it('offline: no recording is tried, and every part is kept for the next attempt', async () => {
    const { server, client, sent, deps } = setup();
    server.offline = true;
    await client.load();
    await client.append('v1.UnitAdded', { unitId: 'Luke', parentUnitId: null, kind: 'passage', label: 'Luke', order: 'a' });
    const notes: string[] = [];
    const { attempt: a, offline } = await deliverHandOver(akol, deps({ note: (where) => notes.push(where) }));
    expect(offline).toBe(true);
    expect(sent).toEqual([]);
    expect(a.eventsLeft).toBe(1);
    expect(notes).toEqual(['hand-over events']);
    expect(afterAttempt(akol, a).kind).toBe('keep');
  });

  it('a recording refused or gone from the phone is finished; one that fails to reach the server is not', async () => {
    const { deps } = setup();
    const three: HandOver = { ...akol, uploads: [upload('gone'), upload('refused'), upload('fails'), upload('after')] };
    const { attempt: a, offline } = await deliverHandOver(three, deps({
      hasFile: (r) => r.hash !== 'gone',
      upload: async (u) => {
        if (u.ref.hash === 'refused') return 'refused';
        if (u.ref.hash === 'fails') throw new Error('network');
        return 'sent';
      }
    }));
    expect(offline).toBe(true);
    expect(a.finished).toEqual(['gone', 'refused']);
  });

  it('notifications that could not be stopped keep the hand-over open', async () => {
    const { deps } = setup();
    const { attempt: a, offline } = await deliverHandOver({ ...akol, uploads: [], pushToken: 'tok' }, deps({ unregisterPush: async () => false }));
    expect(offline).toBe(true);
    expect(a.unregistered).toBe(false);
    expect(afterAttempt({ ...akol, uploads: [], pushToken: 'tok' }, a).kind).toBe('keep');
  });
});
