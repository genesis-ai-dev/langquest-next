import { base64urlEncode, concatBytes, utf8Encode } from '@langquest-next/core/nearby';
import { channelKeysOf } from '../src/nearbyOpening';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSha256, fakeSigner, memoryNearbyAir, type MemoryFiles, type MemoryNearbyAir } from '../src/testing/memoryNearbyLink';
import type { EventStore } from '../src/types';
import { LANG, ORG, STORES, teammate, type Teammate } from './nearbyFixtures';
import { DISCOVERY, newTime, roomFor, testPhone, turn, unit, type TestRoom } from './nearbyKit';

/**
 * The room's loop (docs/nearby-sync-plan.md 5.8, 5.11, 5.12), on memory radios and simulated
 * time. Why: a played-back advert must draw no connection and show nobody, no mask may repeat
 * under a salt, a phone talks to one teammate at a time, a phone behind a generation is still
 * met, and the radios stop by themselves where a stranger cannot hold them on.
 */

const idsOf = async (store: EventStore) => (await store.page(ORG, LANG, null, 10_000)).map((l) => l.event.id).sort();
const shown = (r: TestRoom) => r.events.filter((e) => e.t === 'teammates').at(-1);
const stopped = (r: TestRoom) => r.events.find((e) => e.t === 'stopped');

describe.each(STORES)('a room on the %s store', (_name, make) => {
  let server: FakeServer;
  let shelf: MemoryFiles;
  let time: ReturnType<typeof newTime>;
  let air: MemoryNearbyAir;
  let people: Teammate[];

  beforeEach(async () => {
    server = new FakeServer();
    shelf = new Map();
    time = newTime();
    air = memoryNearbyAir({ time, files: shelf });
    people = [await teammate('ana'), await teammate('sam'), await teammate('cy')];
  });

  const rooms = async (n: number, o: Parameters<typeof roomFor>[3][] = []) => {
    const out: TestRoom[] = [];
    for (let i = 0; i < n; i++) out.push(roomFor(await testPhone(server, make(), people[i]!, shelf), air, time, o[i] ?? {}));
    for (const r of out) await r.room.start(time.now());
    return out;
  };

  it('two teammates show only once echoed, the lower tag connects, and both end up to date', async () => {
    const [a, b] = await rooms(2);
    await unit(a!.phone, 'a1');
    await unit(b!.phone, 'b1');
    // The first burst: each hears the other, and neither has been echoed yet.
    air.scan();
    expect(shown(a!)).toBeUndefined();
    expect(air.pipes).toEqual([]);
    for (let i = 0; i < 10; i++) await turn(air, time, [a!, b!]);
    expect(air.pipes.length).toBe(1);
    const tags = [a!, b!].map((r) => (shown(r) as { seen: readonly { tag: string }[] }).seen[0]!.tag);
    // The lower tag connected: the one the other phone shows is the higher.
    expect(air.pipes[0]!.from).toBe(tags[0]! > tags[1]! ? a!.radio.name : b!.radio.name);
    expect(await idsOf(a!.phone.store)).toEqual(await idsOf(b!.phone.store));
    expect(a!.events.some((e) => e.t === 'level')).toBe(true);
    expect(b!.events.some((e) => e.t === 'level')).toBe(true);
    expect(air.maskRepeats).toEqual([]);
  });

  it('stops at "Up to date" when told to, and only Look again starts it', async () => {
    const [a, b] = await rooms(2, [{ room: { stopWhenLevel: true } }, {}]);
    await unit(a!.phone, 'a1');
    for (let i = 0; i < 10 && !stopped(a!); i++) await turn(air, time, [a!, b!]);
    expect(stopped(a!)).toEqual({ t: 'stopped', why: 'level' });
    const calls = a!.radio.calls.updateFind;
    await turn(air, time, [a!]);
    expect(a!.radio.calls.updateFind).toBe(calls);
    await a!.room.lookAgain(time.now());
    expect(a!.room.isRunning).toBe(true);
    expect(a!.radio.calls.startFind).toBe(2);
  });

  it('a played-back advert draws no connection and shows nobody, and the screen offers a tap after a while', async () => {
    const [a, b] = await rooms(2);
    await unit(b!.phone, 'b1');
    await b!.room.tick(time.now());
    const recorded = air.adverts.find((ad) => ad.peer === b!.radio.name)!;
    await b!.room.stop();
    for (let i = 0; i < 40; i++) {
      air.replay(recorded);
      await turn(air, time, [a!], false);
    }
    expect(air.pipes).toEqual([]);
    expect(shown(a!)).toBeUndefined();
    expect(a!.events.some((e) => e.t === 'maybe')).toBe(true);
    // Waiting on a tap holds off nothing.
    expect(a!.events.some((e) => e.t === 'level')).toBe(true);
    // The slot changes at the same rate with or without the replay.
    expect(a!.radio.calls.updateFind).toBe(40);
    expect(air.maskRepeats).toEqual([]);
  });

  it('a tap connects where no echo came', async () => {
    const [a, b] = await rooms(2, [{}, { caps: { advertise: true } }]);
    await unit(b!.phone, 'b1');
    // Sam's phone hears nothing, so it never echoes; only a tap gets Ana's phone to connect.
    b!.room['found'] = () => undefined;
    for (let i = 0; i < 40 && !a!.events.some((e) => e.t === 'maybe'); i++) await turn(air, time, [a!, b!]);
    const maybe = a!.events.find((e) => e.t === 'maybe') as { tag: string };
    expect(air.pipes).toEqual([]);
    a!.room.tap(maybe.tag);
    for (let i = 0; i < 20 && air.pipes.length === 0; i++) await turn(air, time, [a!, b!]);
    for (let i = 0; i < 5; i++) await turn(air, time, [a!, b!]);
    expect(air.pipes.length).toBe(1);
    expect(await idsOf(a!.phone.store)).toEqual(await idsOf(b!.phone.store));
  });

  it('refreshes the scan response every tick with a new mask, never repeated under a salt', async () => {
    const [a] = await rooms(1);
    for (let i = 0; i < 300; i++) await a!.room.tick(time.now() + i);
    expect(a!.radio.calls.updateFind).toBe(300);
    expect(air.maskRepeats).toEqual([]);
    expect(a!.radio.find!.payload.length).toBe(14);
  });

  it('a phone ahead hears one behind, is echoed through a salt no key matched, connects whatever the tags, and hands on its key', async () => {
    const sha = (x: Uint8Array) => fakeSha256(x);
    const key5 = DISCOVERY;
    const older = (k: Uint8Array) => sha(concatBytes(utf8Encode('lq-nearby-gen-v1'), k));
    const key4 = older(key5);
    const [a, b] = await rooms(2, [
      { keys: { gen: 5, key: base64urlEncode(key5), floor: 1, direct: true, certOrgSeq: 0 } },
      { keys: { gen: 4, key: base64urlEncode(key4), floor: 1, direct: true, certOrgSeq: 0 } }
    ]);
    // Ana scans down to her floor, Sam only from his generation.
    expect(a!.radio.find!.scanKeys.length).toBe(5);
    expect(b!.radio.find!.scanKeys.length).toBe(4);
    await unit(b!.phone, 'b1');
    for (let i = 0; i < 10 && air.pipes.length === 0; i++) await turn(air, time, [a!, b!]);
    expect(air.pipes[0]?.from).toBe(a!.radio.name);
    for (let i = 0; i < 6; i++) await turn(air, time, [a!, b!]);
    const ended = a!.events.find((e) => e.t === 'ended') as { report: { ended: { how: string } } };
    expect(ended.report.ended.how).toBe('done');
    expect(typesSent(air.pipes[0]!.pair.sent.a.frames)[0]).toBe('you-first');
    // Sam took generation 5 by hand-on, and Find runs under it now.
    expect(b!.keys.current).toMatchObject({ gen: 5, key: base64urlEncode(key5), direct: false });
    expect(b!.radio.calls.startFind).toBe(2);
    expect(b!.radio.find!.kFind).toEqual(channelKeysOf(fakeSigner('x'), key5).kFind);
  });

  it('scans at most 16 generations, and none below the floor', async () => {
    const [a, b] = await rooms(2, [{ keys: { gen: 40, key: base64urlEncode(DISCOVERY), floor: 1 } }, { keys: { gen: 9, key: base64urlEncode(DISCOVERY), floor: 7 } }]);
    expect(a!.radio.find!.scanKeys.length).toBe(16);
    expect(b!.radio.find!.scanKeys.length).toBe(3);
  });

  it('talks to one teammate at a time, and three phones all end with everything', async () => {
    const all = await rooms(3);
    for (const [i, r] of all.entries()) await unit(r.phone, `u${i}`);
    for (let i = 0; i < 40; i++) await turn(air, time, all);
    for (const r of all) {
      let open = 0;
      for (const e of r.events) {
        if (e.t === 'session') open += 1;
        if (e.t === 'ended') open -= 1;
        expect(open).toBeLessThanOrEqual(1);
      }
    }
    const ids = await idsOf(all[0]!.phone.store);
    expect(ids.length).toBe(3);
    for (const r of all) expect(await idsOf(r.phone.store)).toEqual(ids);
  });

  it('a refused phone is not picked again', async () => {
    const [a, b] = await rooms(2);
    a!.phone.people = { privilegesIn: () => new Set(), languageListed: () => true };
    b!.phone.people = { privilegesIn: () => new Set(), languageListed: () => true };
    for (let i = 0; i < 30; i++) await turn(air, time, [a!, b!]);
    expect(air.pipes.length).toBe(1);
    expect(a!.events.some((e) => e.t === 'level')).toBe(true);
  });

  it('a phone that cannot advertise still connects', async () => {
    const [a, b] = await rooms(2, [{ caps: { advertise: false } }, {}]);
    await unit(b!.phone, 'b1');
    for (let i = 0; i < 20 && air.pipes.length === 0; i++) await turn(air, time, [a!, b!]);
    expect(air.pipes[0]?.from).toBe(a!.radio.name);
  });

  describe('stopping by itself', () => {
    it('stops at the idle limit with nobody in range, and stays stopped', async () => {
      const [a] = await rooms(1, [{ room: { idleLimitMs: 60_000 } }]);
      for (let i = 0; i < 40 && !stopped(a!); i++) await turn(air, time, [a!]);
      expect(stopped(a!)).toEqual({ t: 'stopped', why: 'idle' });
      expect(a!.radio.calls.stopAll).toBe(1);
    });

    it('a stranger\'s connection does not hold the radios on', async () => {
      const lone = await rooms(1, [{ room: { idleLimitMs: 60_000 } }]);
      let quiet = 0;
      for (; !stopped(lone[0]!); quiet++) await turn(air, time, lone);
      const busy = memoryNearbyAir({ time, files: shelf });
      air = busy;
      const [a] = await rooms(1, [{ room: { idleLimitMs: 60_000 } }]);
      const stranger = busy.radio('stranger');
      let ticks = 0;
      for (; !stopped(a!); ticks++) {
        const pipe = await stranger.openPipe(a!.radio.name, a!.radio.salt!, 0);
        await pipe.sendOpening(fakeSigner(`s${ticks}`).randomBytes(80));
        await turn(busy, time, [a!]);
      }
      expect(ticks).toBe(quiet);
      expect(busy.pipes.every((p) => p.pair.sent.b.opening === 0 && p.pair.sent.b.frames.length === 0)).toBe(true);
    });

    it('stops at the run limit even during a session', async () => {
      const [a, b] = await rooms(2, [{ room: { runLimitMs: 20_000 } }, {}]);
      for (let i = 0; i < 30; i++) await unit(a!.phone, `a${i}`);
      // Sam's phone takes its time over each page, so the session is running at the limit.
      const inner = b!.phone.client.receiveNearby.bind(b!.phone.client);
      b!.phone.client.receiveNearby = async (page, intake) => { await time.sleep(30_000); return inner(page, intake); };
      for (let i = 0; i < 30 && !stopped(a!); i++) await turn(air, time, [a!, b!]);
      expect(stopped(a!)).toEqual({ t: 'stopped', why: 'run' });
      const aEnded = a!.events.find((e) => e.t === 'ended') as { report: { ended: unknown } };
      expect(aEnded.report.ended).toEqual({ how: 'said', reason: 'stopped' });
      for (let i = 0; i < 120 && !b!.events.some((e) => e.t === 'ended'); i++) await turn(air, time, [b!]);
      const ended = b!.events.filter((e) => e.t === 'ended').map((e) => (e as { report: { ended: { how: string; reason?: string } } }).report.ended);
      expect(ended.some((e) => (e.how === 'heard' && e.reason === 'stopped') || e.how === 'dropped')).toBe(true);
    });
  });
});

function typesSent(frames: readonly Uint8Array[]): string[] {
  return frames.map((f) => (JSON.parse(new TextDecoder().decode(f)) as { t: string }).t);
}
