import { emptyLanguageState, foldLanguage, newCommandId, type AnyEvent } from '@langquest-next/core';
import { Diagnostics, MemoryDiagStore } from '../src/diagnostics';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSha256 } from '../src/testing/memoryNearbyLink';
import type { AppendResult, EventStore, RelayAnswer, Transport } from '../src/types';
import {
  LANG, NOW, ORG, STORES, eventBy, intakeFor, pageOf, phone, rowOf, statusOf, teammate, unitBy, type PhoneOptions, type Teammate
} from './nearbyFixtures';

/**
 * Delivery through a teammate (docs/nearby-sync-plan.md section 6). Why: any phone that reaches
 * the server must be able to hand in the team's work, so a lost phone's work survives; but a
 * verdict must say which refusals are final, or a lost phone's work is dropped for a passing
 * reason, and a copy confirmed under another clock leaves the fold wrong.
 */
const certified = { sha256: fakeSha256, holdsCertificate: () => true };

describe.each(STORES)('delivery on the %s store', (_name, make) => {
  let sam: Teammate;
  let bob: Teammate;
  let mine: Teammate;
  let store: EventStore;
  let server: FakeServer;

  beforeEach(async () => {
    sam = await teammate('sam');
    bob = await teammate('bob');
    mine = await teammate('me');
    store = make();
    server = new FakeServer();
    server.relaying = true;
    server.now = () => NOW;
  });

  async function carrier(o: PhoneOptions = {}) {
    const client = phone(server, store, mine, { nearby: certified, ...o });
    await client.load();
    return client;
  }
  const take = async (client: Awaited<ReturnType<typeof carrier>>, who: Teammate, n: number, events: AnyEvent[]) => {
    const receipt = await client.receiveNearby(await pageOf(who, n, events), intakeFor());
    expect(receipt.kept).toBe(events.length);
  };

  it('sends a lost author\'s work between push and pull, as its author, and the rows end the server\'s', async () => {
    const calls: string[] = [];
    const t = server.transportFor();
    for (const name of ['append', 'relay', 'pull'] as const) {
      const inner = t[name]! as (...a: unknown[]) => Promise<unknown>;
      (t as unknown as Record<string, unknown>)[name] = async (...a: unknown[]) => { calls.push(name); return inner(...a); };
    }
    const client = await carrier({ transport: t });
    const u = unitBy(sam, 'u1');
    const note = eventBy(sam, 'v1.NoteAdded', { noteId: newCommandId('sam', 'n1'), unitId: 'u1', anchor: { kind: 'passage' }, text: 'hello' });
    await take(client, sam, 1, [u, note]);
    await client.append('v1.UnitAdded', { unitId: 'u9', parentUnitId: null, kind: 'passage', label: 'u9', order: 'u9' });

    const r = await client.sync();
    expect(r.offline).toBe(false);
    expect(calls.slice(0, 3)).toEqual(['append', 'relay', 'pull']);
    expect(server.stream(ORG, LANG).filter((e) => e.actorId === 'sam').map((e) => e.id)).toEqual([u.id, note.id]);
    expect(await statusOf(store, note.id)).toBe('confirmed');
    expect((await client.inspect()).nearby).toBe(0);
    expect(client.getState()).toEqual(foldLanguage([...server.stream(ORG, LANG)], emptyLanguageState()));
  });

  it('keeps each verdict as the plan\'s table says: confirmed, left for pull or a later try, or refused keeping its via', async () => {
    const events = [0, 1, 2, 3, 4, 5, 6].map((i) => unitBy(sam, `u${i}`));
    const reasons: (AppendResult | null)[] = [
      { id: events[0]!.id, accepted: true, serverSeq: 7, reason: null },
      { id: events[1]!.id, accepted: true, serverSeq: 3, reason: 'duplicate' },
      { id: events[2]!.id, accepted: false, serverSeq: null, reason: 'clock ahead: server time 1' },
      { id: events[3]!.id, accepted: false, serverSeq: null, reason: 'language not listed yet' },
      { id: events[4]!.id, accepted: false, serverSeq: null, reason: 'may not emit v1.UnitAdded: this revoked key has reached its limit' },
      { id: events[5]!.id, accepted: false, serverSeq: null, reason: 'stamped too far ahead: 2035-01-01' },
      { id: events[6]!.id, accepted: false, serverSeq: null, reason: 'invalid payload: a redaction is not relayed' }
    ];
    const t = server.transportFor();
    t.relay = async (_o, _s, batches): Promise<RelayAnswer[]> => [{ key: sam.key, n: 1, verdicts: reasons.filter((v): v is AppendResult => v !== null && batches[0]!.events.some((e) => e.id === v.id)) }];
    t.pull = async () => [];
    const client = await carrier({ transport: t });
    await take(client, sam, 1, events);
    await client.sync();
    const rows = await Promise.all(events.map((e) => rowOf(store, e.id)));
    expect(rows.map((r) => r?.status)).toEqual(['confirmed', 'nearby', 'nearby', 'nearby', 'rejected', 'rejected', 'rejected']);
    expect(rows[0]!.event.serverSeq).toBe(7);
    expect(rows[0]!.via).toBeUndefined();
    // A cap can be raised, so Try again may bring it back; the other two are the server's word for good.
    expect(rows[4]!.rejectReason).toBe('may not emit v1.UnitAdded: this revoked key has reached its limit');
    expect(rows[5]!.rejectReason).toBe('the server says: stamped too far ahead: 2035-01-01');
    expect(rows[6]!.rejectReason).toBe('the server says: invalid payload: a redaction is not relayed');
    for (const r of rows.slice(4)) expect(r!.via).toEqual({ batch: 1, key: sam.key });
    expect(client.getState().units['u4']).toBeUndefined();
    expect(client.getState().units['u1']).toBeDefined();
  });

  it('per author oldest clock first, one batch at a time, each batch\'s verdicts kept before the next goes', async () => {
    const sent: string[] = [];
    const t = server.transportFor();
    const relay = t.relay!;
    t.relay = async (o, s, batches) => {
      for (const b of batches) sent.push(`${b.events[0]!.actorId}:${JSON.parse(b.manifest).n}:${b.events.length}`);
      expect(batches).toHaveLength(1);
      // The batch before was written already.
      if (sent.length === 2) expect(await statusOf(store, 'by:sam:early')).toBe('confirmed');
      return relay(o, s, batches);
    };
    const client = await carrier({ transport: t });
    await take(client, sam, 2, [unitBy(sam, 'late', { at: NOW + 50, id: 'by:sam:late' })]);
    await take(client, sam, 1, [unitBy(sam, 'early', { at: NOW + 10, id: 'by:sam:early' })]);
    await take(client, bob, 1, [unitBy(bob, 'bob', { at: NOW + 20, id: 'by:bob:b' })]);
    await client.sync();
    expect(sent).toEqual(['sam:1:1', 'sam:2:1', 'bob:1:1']);
  });

  it('a carrier behind the server skips batches the server answered duplicate, so the batch past the first 25 goes at the next sync', async () => {
    const units = Array.from({ length: 27 }, (_, i) => unitBy(sam, `d${i}`, { at: NOW + i }));
    // Sam pushed the first 26 himself; the last is on the carrier alone, a lost phone's work.
    await server.transportFor().append(units.slice(0, 26));
    const sent: number[] = [];
    const t = server.transportFor();
    const relay = t.relay!;
    t.relay = async (o, s, batches) => {
      for (const b of batches) sent.push(JSON.parse(b.manifest).n as number);
      return relay(o, s, batches);
    };
    // Its pull never reaches the server's head in these syncs, so neither pull nor sweep settles the duplicates.
    t.pull = async () => [];
    const client = await carrier({ transport: t });
    for (const [i, u] of units.entries()) await take(client, sam, i + 1, [u]);
    await client.sync();
    expect(sent).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    sent.length = 0;
    await client.sync();
    expect(sent).toEqual([26, 27]);
    expect(server.stream(ORG, LANG).map((e) => e.id)).toContain(units[26]!.id);
    expect(await statusOf(store, units[26]!.id)).toBe('confirmed');
    // Each answered duplicate once, and nothing is sent again.
    sent.length = 0;
    await client.sync();
    expect(sent).toEqual([]);
    expect(await statusOf(store, units[0]!.id)).toBe('nearby');
    // Once the pull reaches the server's head the duplicates settle, and what delivery kept of them goes with the batch.
    const kept = `nearbyDuplicate:${ORG}/${LANG}:1 ${sam.key}`;
    expect(await store.meta(kept)).toBe(JSON.stringify([units[0]!.id]));
    t.pull = server.transportFor().pull;
    await client.sync();
    expect((await client.inspect()).nearby).toBe(0);
    expect(await store.meta(kept)).toBeUndefined();
  });

  it('leaves every row nearby when the relay says not yet, refuses a batch whole, or the server is too old for this build', async () => {
    const u = unitBy(sam, 'u1');
    const client = await carrier();
    await take(client, sam, 1, [u]);
    server.relayBehind = true;
    await client.sync();
    expect(await statusOf(store, u.id)).toBe('nearby');
    server.relayBehind = false;
    server.relayCheck = async () => 'chain: unknown certificate key';
    await client.sync();
    expect(await statusOf(store, u.id)).toBe('nearby');
    server.relayCheck = null;
    server.minClientVersion = 1_000_000;
    expect((await client.sync()).tooOld).toBe(true);
    expect(await statusOf(store, u.id)).toBe('nearby');
    server.minClientVersion = 0;
    await client.sync();
    expect(await statusOf(store, u.id)).toBe('confirmed');
  });

  it('a revoked key\'s earlier work goes up and its later work is refused for good, one by one (Carl\'s answer 4)', async () => {
    const before = unitBy(sam, 'before', { at: NOW - 10_000 });
    const after = unitBy(sam, 'after', { at: NOW + 10_000 });
    const client = await carrier();
    await take(client, sam, 1, [before, after]);
    server.revokedKeys.set(`${sam.key} sam`, NOW);
    await client.sync();
    expect(await statusOf(store, before.id)).toBe('confirmed');
    expect(await rowOf(store, after.id)).toMatchObject({ status: 'rejected', rejectReason: expect.stringMatching(/^the server says: key revoked: dated after /) });
  });

  it('a stamp refused as far ahead goes back to nearby once its date comes, and the server takes it then', async () => {
    const wall = { now: NOW };
    const ahead = unitBy(sam, 'ahead', { at: NOW + 3 * 86_400_000 });
    const client = await carrier({ now: () => wall.now });
    await take(client, sam, 1, [ahead]);
    await client.sync();
    expect(await rowOf(store, ahead.id)).toMatchObject({ status: 'rejected', rejectReason: expect.stringMatching(/stamped too far ahead/) });
    expect((await client.inspect()).nearby).toBe(0);
    wall.now = NOW + 2.5 * 86_400_000;
    server.now = () => wall.now + 86_400_000;
    await client.sync();
    expect(await statusOf(store, ahead.id)).toBe('confirmed');
  });

  it('push holds back an undo of a teammate\'s unsent set-aside, delivers the set-aside, then pushes the undo in the same sync', async () => {
    const order: string[] = [];
    // The server's restated may_emit: an undo of a departure it does not have is refused for good to someone without Override checkpoints.
    server.authorize = (e) => {
      order.push(e.type);
      if (e.type !== 'v1.DepartureUndone') return null;
      const id = (e.payload as { departureId: string }).departureId;
      return server.log.some((x) => x.type === 'v1.DepartureRecorded' && (x.payload as { departureId: string }).departureId === id) ? null : 'may not emit v1.DepartureUndone';
    };
    const client = await carrier();
    const u = unitBy(sam, 'u1');
    const departureId = newCommandId('sam', 'dep');
    await take(client, sam, 1, [u, eventBy(sam, 'v1.DepartureRecorded', { departureId, unitId: 'u1', type: 'skip', kindId: 'peer', reason: 'paper' })]);
    const undo = await client.append('v1.DepartureUndone', { departureId });
    const r = await client.sync();
    expect(r.rejected).toBe(0);
    expect(order).toEqual(['v1.UnitAdded', 'v1.DepartureRecorded', 'v1.DepartureUndone']);
    expect(await statusOf(store, undo.id)).toBe('confirmed');
    expect(client.getState().undoneDepartures[departureId]).toBeDefined();
  });

  it('an undo refused because its departure was not on the server yet goes again once the departure is delivered, in the same sync', async () => {
    server.authorize = (e) => {
      if (e.type !== 'v1.DepartureUndone') return null;
      const id = (e.payload as { departureId: string }).departureId;
      return server.log.some((x) => x.type === 'v1.DepartureRecorded' && (x.payload as { departureId: string }).departureId === id) ? null : 'departure not here yet';
    };
    const client = await carrier();
    const departureId = newCommandId('bob', 'dep');
    // Sam's batch starts earlier, so it goes first, and his undo reaches the server before Bob's set-aside.
    await take(client, sam, 1, [unitBy(sam, 'u1', { at: NOW + 1 }), eventBy(sam, 'v1.DepartureUndone', { departureId }, { at: NOW + 30 })]);
    await take(client, bob, 1, [eventBy(bob, 'v1.DepartureRecorded', { departureId, unitId: 'u1', type: 'skip', kindId: 'peer', reason: 'paper' }, { at: NOW + 20 })]);
    await client.sync();
    expect(server.stream(ORG, LANG).map((e) => e.type)).toEqual(['v1.UnitAdded', 'v1.DepartureRecorded', 'v1.DepartureUndone']);
    expect((await client.inspect()).nearby).toBe(0);
    expect((await client.inspect()).rejected).toEqual([]);
  });

  it('a phone with nothing held for teammates asks nothing, and a transport without relay delivers nothing', async () => {
    const client = await carrier();
    await client.append('v1.UnitAdded', { unitId: 'u1', parentUnitId: null, kind: 'passage', label: 'u1', order: 'u1' });
    await client.sync();
    expect(server.relayCalls).toBe(0);
    const t: Transport = server.transportFor();
    delete t.relay;
    const other = phone(server, make(), sam, { nearby: certified, transport: t });
    await other.load();
    await other.receiveNearby(await pageOf(bob, 1, [unitBy(bob, 'b1')]), intakeFor());
    await other.sync();
    expect(server.relayCalls).toBe(0);
  });

  it('records what it delivered as counts and codes, naming no author, key or event', async () => {
    const diagStore = new MemoryDiagStore();
    let n = 0;
    const diag = new Diagnostics({ store: diagStore, newId: () => `d${++n}`, now: () => 0 });
    const client = await carrier({ diag });
    await take(client, sam, 1, [unitBy(sam, 'u1'), unitBy(sam, 'u2', { at: NOW + 3 * 86_400_000 })]);
    await client.sync();
    await diag.settle();
    const records = diagStore.records.filter((r) => r.kind === 'nearby');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ t: { event: 'deliver' }, n: { sent: 2, events: 1, refused: 1, farAhead: 1, done: 1, noAnswer: 0 } });
    expect(JSON.stringify(records[0])).not.toMatch(/sam|by:/);
  });
});
