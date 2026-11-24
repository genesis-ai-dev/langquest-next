import { base64urlEncode, concatBytes, utf8Encode } from '@langquest-next/core/nearby';
import { nearbyDayOf } from '../src/nearbyKeep';
import { channelKeysOf } from '../src/nearbyOpening';
import { ALONE_TAG, NEARBY_ROOM_DEFAULTS } from '../src/nearbyRoom';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSha256, fakeSigner, memoryNearbyAir, type MemoryFiles, type MemoryNearbyAir } from '../src/testing/memoryNearbyLink';
import type { EventStore } from '../src/types';
import { LANG, ORG, STORES, teammate, type Teammate } from './nearbyFixtures';
import { DISCOVERY, newTime, roomFacts, roomFor, testPhone, turn, unit, type TestRoom } from './nearbyKit';

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

  // Found on two emulators: a start held on its summary stayed on "Starting…", and a stop meanwhile let it turn the radios on after.
  it('a room stopped while its start waits turns no radio on once the wait ends, and says where it waited', async () => {
    const p = await testPhone(server, make(), people[0]!, shelf);
    const real = roomFacts(p);
    let release!: () => void;
    const held = new Promise<void>((done) => { release = done; });
    const r = roomFor(p, air, time, { room: { facts: { ...real, summary: async () => { await held; return real.summary(); } } } });
    const starting = r.room.start(time.now());
    for (let i = 0; i < 100 && r.room.startingAt !== 'summary'; i++) await new Promise((done) => setTimeout(done, 0));
    expect(r.room.startingAt).toBe('summary');
    await r.room.stop();
    expect(stopped(r)).toEqual({ t: 'stopped', why: 'asked' });
    release();
    await starting;
    expect(r.radio.calls.startFind).toBe(0);
    expect(r.room.isRunning).toBe(false);
    expect(r.room.startingAt).toBeNull();
  });

  // The security review's: a stop while the radio's abilities or the keys were still being read found nothing running to stop.
  it('a room stopped before its start has read the radio and the keys turns no radio on after', async () => {
    const p = await testPhone(server, make(), people[0]!, shelf);
    const r = roomFor(p, air, time);
    const capabilities = r.radio.capabilities.bind(r.radio);
    let release!: () => void;
    const held = new Promise<void>((done) => { release = done; });
    r.radio.capabilities = async () => { await held; return capabilities(); };
    const starting = r.room.start(time.now());
    await r.room.stop();
    release();
    await starting;
    expect(r.radio.calls.startFind).toBe(0);
    expect(r.room.isRunning).toBe(false);
    // A later start, as Look again makes, still runs.
    await r.room.start(time.now());
    expect(r.room.isRunning).toBe(true);
    expect(r.radio.calls.startFind).toBe(1);
    await r.room.stop();
  });

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

  it('stops scanning during a session and keeps advertising, and holds the salt only while the responder\'s pipe is open', async () => {
    const [a, b] = await rooms(2);
    await unit(a!.phone, 'a1');
    await unit(b!.phone, 'b1');
    const seen: { scan: boolean[]; salt: boolean[] } = { scan: [], salt: [] };
    for (const r of [a!, b!]) {
      const { holdScan, holdSalt } = r.radio;
      r.radio.holdScan = async (held) => { seen.scan.push(held); await holdScan(held); };
      r.radio.holdSalt = async (held) => { seen.salt.push(held); await holdSalt(held); };
    }
    air.scan();
    for (let i = 0; i < 10; i++) await turn(air, time, [a!, b!]);
    expect(air.pipes.length).toBe(1);
    // Each side held the scan for its session and let it go after, and the responder held its salt and let it go.
    expect(seen.scan.filter((h) => h).length).toBe(2);
    expect(seen.scan.filter((h) => !h).length).toBe(2);
    expect(seen.salt).toEqual([true, false]);
    for (const r of [a!, b!]) {
      expect(r.radio.scanHeld).toBe(false);
      expect(r.radio.saltHeld).toBe(false);
      expect(r.radio.find).not.toBeNull();
    }
  });

  it('a rotation waits while the salt is held, and runs once it is released; a held scan hears nobody', async () => {
    const [a, b] = await rooms(2);
    const before = a!.radio.salt;
    await a!.radio.holdSalt(true);
    air.rotate(a!.radio.name);
    expect(a!.radio.salt).toBe(before);
    await a!.radio.holdSalt(false);
    expect(a!.radio.salt).not.toBe(before);
    let heard = 0;
    b!.radio.onFound(() => { heard += 1; });
    await b!.radio.holdScan(true);
    air.scan();
    expect(heard).toBe(0);
    await b!.radio.holdScan(false);
    air.scan();
    expect(heard).toBe(1);
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

  it('a disguised room that heard only a played-back advert does not stop at "Up to date"; a tap on it, like a real teammate, counts as met', async () => {
    // Why: any phone heard counted as met, so a replay alone stopped a disguised phone at level with nobody found.
    const [a, b] = await rooms(2, [{ room: { stopWhenLevel: true } }, {}]);
    await unit(b!.phone, 'b1');
    await b!.room.tick(time.now());
    const recorded = air.adverts.find((ad) => ad.peer === b!.radio.name)!;
    await b!.room.stop();
    for (let i = 0; i < 40; i++) {
      air.replay(recorded);
      await turn(air, time, [a!], false);
    }
    expect(a!.events.some((e) => e.t === 'level')).toBe(true);
    expect(stopped(a!)).toBeUndefined();
    expect(a!.room.isRunning).toBe(true);
    // The person answered "A teammate may be nearby": that is someone met, and level now stops it.
    const maybe = a!.events.find((e) => e.t === 'maybe') as { tag: string };
    // It tries the tapped phone, which is gone, and once nobody is left to try it is level and stops.
    a!.room.tap(maybe.tag);
    for (let i = 0; i < 40 && !stopped(a!); i++) await turn(air, time, [a!], false);
    expect(stopped(a!)).toEqual({ t: 'stopped', why: 'level' });
  });

  it('an echo holds only while it names this phone\'s current or previous salt: a replay after two rotations draws no connection', async () => {
    // Why: an echo once heard stood for the whole run, so a recording made while the teammate was live drew a connection for good.
    const [a, b] = await rooms(2);
    await unit(b!.phone, 'b1');
    // Sam's phone hears Ana's salt and echoes it in its next advert, which a scanner far away records; then it goes.
    air.scan();
    await b!.room.tick(time.now());
    const recorded = air.adverts.filter((ad) => ad.peer === b!.radio.name).at(-1)!;
    await b!.room.stop();
    const replayed = async (rotations: number) => {
      for (let i = 0; i < rotations; i++) air.rotate(a!.radio.name);
      const before = a!.radio.calls.openPipe;
      for (let i = 0; i < 15; i++) {
        air.replay(recorded);
        await turn(air, time, [a!], false);
      }
      return a!.radio.calls.openPipe - before;
    };
    // While it names Ana's salt, it is an echo, and Ana tries to connect; after two rotations it names neither of her salts.
    expect(await replayed(0)).toBeGreaterThan(0);
    expect(await replayed(2)).toBe(0);
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

  // An iPhone's advert goes out with no scan response, so others know it by its salt alone until Hello (docs/nearby-sync-plan.md section 7, phase 5).
  describe('iPhones', () => {
    const IPHONE = { caps: { scanResponse: false } };
    const maybeOf = (r: TestRoom) => r.events.find((e) => e.t === 'maybe') as { tag: string } | undefined;
    const until = async (all: TestRoom[], done: () => boolean, most = 60) => {
      for (let i = 0; i < most && !done(); i++) await turn(air, time, all);
    };

    it('an Android echoes an iPhone heard by its advert alone, and the iPhone connects once echoed, with no tap', async () => {
      const [android, iphone] = await rooms(2, [{}, IPHONE]);
      await unit(android!.phone, 'a1');
      await unit(iphone!.phone, 'i1');
      await until([android!, iphone!], () => air.pipes.length > 0, 20);
      expect(air.pipes[0]?.from).toBe(iphone!.radio.name);
      for (let i = 0; i < 6; i++) await turn(air, time, [android!, iphone!]);
      expect(await idsOf(android!.phone.store)).toEqual(await idsOf(iphone!.phone.store));
      expect((await idsOf(android!.phone.store)).length).toBe(2);
      expect([...android!.events, ...iphone!.events].some((e) => e.t === 'maybe')).toBe(false);
      // The Android shows nobody it cannot name before a session, and never offers a tap for an iPhone on its own generation.
      expect(air.pipes.length).toBe(1);
      expect(air.maskRepeats).toEqual([]);
    });

    it('an Android on older code never echoes an iPhone: the iPhone offers a tap, and the tap connects', async () => {
      const [android, iphone] = await rooms(2, [{ knobs: { noAdvertAlone: true } }, IPHONE]);
      await unit(android!.phone, 'a1');
      await until([android!, iphone!], () => maybeOf(iphone!) !== undefined);
      expect(air.pipes).toEqual([]);
      iphone!.room.tap(maybeOf(iphone!)!.tag);
      await until([android!, iphone!], () => air.pipes.length > 0, 20);
      for (let i = 0; i < 6; i++) await turn(air, time, [android!, iphone!]);
      expect(air.pipes[0]?.from).toBe(iphone!.radio.name);
      expect(await idsOf(iphone!.phone.store)).toEqual(await idsOf(android!.phone.store));
    });

    it('iPhones offer a tap for each other, one tap covers every iPhone in range, and each is tried again only under its next salt', async () => {
      const all = await rooms(3, [IPHONE, IPHONE, IPHONE]);
      const [x, y, z] = all;
      for (const [i, r] of all.entries()) await unit(r.phone, `u${i}`);
      await until(all, () => maybeOf(x!) !== undefined);
      expect(air.pipes).toEqual([]);
      expect(maybeOf(x!)!.tag.startsWith(ALONE_TAG)).toBe(true);
      x!.room.tap(maybeOf(x!)!.tag);
      await until(all, () => air.pipes.length >= 2, 40);
      for (let i = 0; i < 10; i++) await turn(air, time, all);
      // Only Ana's phone tapped, so only it connected, to both others, once each.
      expect(air.pipes.map((p) => p.from)).toEqual([x!.radio.name, x!.radio.name]);
      expect(new Set(air.pipes.map((p) => p.to))).toEqual(new Set([y!.radio.name, z!.radio.name]));
      // Whoever it met first missed the third's work; under that phone's next salt it is tried again.
      air.rotate(y!.radio.name);
      air.rotate(z!.radio.name);
      await until(all, () => air.pipes.length >= 4, 40);
      for (let i = 0; i < 10; i++) await turn(air, time, all);
      const ids = await idsOf(x!.phone.store);
      expect(ids.length).toBe(3);
      for (const r of all) expect(await idsOf(r.phone.store)).toEqual(ids);
    });

    // Why: two iPhones hear only each other's bare adverts, and no echo can ever come from an
    // iPhone, so waiting the full minute for one only delayed Connect; in the first real-phone
    // test (Carl, 2026-11-19) people gave up before it showed.
    it('an iPhone offers a tap for another iPhone after a short while, since no echo can come from one', async () => {
      const [x, y] = await rooms(2, [IPHONE, IPHONE]);
      const from = time.now();
      await until([x!, y!], () => maybeOf(x!) !== undefined);
      const after = time.now() - from;
      expect(NEARBY_ROOM_DEFAULTS.tapAfterAloneMs).toBeLessThan(NEARBY_ROOM_DEFAULTS.tapAfterMs);
      expect(after).toBeGreaterThanOrEqual(NEARBY_ROOM_DEFAULTS.tapAfterAloneMs);
      expect(after).toBeLessThan(NEARBY_ROOM_DEFAULTS.tapAfterAloneMs + 8_000);
    });

    it('an iPhone still waits the full while for an Android, whose echo may yet come', async () => {
      const [android, iphone] = await rooms(2, [{ knobs: { noAdvertAlone: true } }, IPHONE]);
      await unit(android!.phone, 'a1');
      const from = time.now();
      await until([android!, iphone!], () => maybeOf(iphone!) !== undefined);
      expect(time.now() - from).toBeGreaterThanOrEqual(NEARBY_ROOM_DEFAULTS.tapAfterMs);
    });

    it('of two iPhones that both tapped, the lower salt connects', async () => {
      const [x, y] = await rooms(2, [IPHONE, IPHONE]);
      await unit(x!.phone, 'x1');
      await until([x!, y!], () => maybeOf(x!) !== undefined && maybeOf(y!) !== undefined);
      x!.room.tap(maybeOf(x!)!.tag);
      y!.room.tap(maybeOf(y!)!.tag);
      await until([x!, y!], () => air.pipes.length > 0, 20);
      const lower = x!.radio.salt! < y!.radio.salt! ? x! : y!;
      expect(air.pipes[0]?.from).toBe(lower.radio.name);
    });

    it('an Android ahead on its key hears an iPhone behind by its advert alone, offers a tap, and the tap connects and hands on its key', async () => {
      const key5 = DISCOVERY;
      const key4 = fakeSha256(concatBytes(utf8Encode('lq-nearby-gen-v1'), key5));
      const [android, iphone] = await rooms(2, [
        { keys: { gen: 5, key: base64urlEncode(key5), floor: 1, direct: true, certOrgSeq: 0 } },
        { ...IPHONE, keys: { gen: 4, key: base64urlEncode(key4), floor: 1, direct: true, certOrgSeq: 0 } }
      ]);
      await unit(iphone!.phone, 'i1');
      await until([android!, iphone!], () => maybeOf(android!) !== undefined);
      expect(air.pipes).toEqual([]);
      expect(maybeOf(android!)!.tag.startsWith(ALONE_TAG)).toBe(true);
      android!.room.tap(maybeOf(android!)!.tag);
      await until([android!, iphone!], () => air.pipes.length > 0, 20);
      for (let i = 0; i < 6; i++) await turn(air, time, [android!, iphone!]);
      expect(air.pipes[0]?.from).toBe(android!.radio.name);
      expect(iphone!.keys.current).toMatchObject({ gen: 5, key: base64urlEncode(key5), direct: false });
      expect(await idsOf(android!.phone.store)).toEqual(await idsOf(iphone!.phone.store));
    });
  });

  // Sharing while LangQuest is open (docs/nearby-sync-plan.md 15.6): nobody is looking, so no tap is
  // offered, "Up to date" never stops it (the screen going off does), and level it scans in bursts.
  describe('while LangQuest is open', () => {
    const OPEN = { taps: false, idleLimitMs: Number.POSITIVE_INFINITY, levelScan: { onMs: 6_000, everyMs: 60_000 }, mode: 'open' as const };
    const IPHONE = { caps: { scanResponse: false } };

    it('never offers a tap, and a played-back advert neither draws a connection nor keeps it from "Up to date"', async () => {
      const [a, b] = await rooms(2, [{ room: OPEN }, {}]);
      await unit(b!.phone, 'b1');
      await b!.room.tick(time.now());
      const recorded = air.adverts.find((ad) => ad.peer === b!.radio.name)!;
      await b!.room.stop();
      for (let i = 0; i < 90; i++) {
        air.replay(recorded);
        await turn(air, time, [a!], false);
      }
      expect(air.pipes).toEqual([]);
      expect(a!.events.some((e) => e.t === 'maybe')).toBe(false);
      expect(a!.events.some((e) => e.t === 'level')).toBe(true);
      expect(a!.room.isRunning).toBe(true);
    });

    it('"Up to date" with nobody near never stops it, and it scans six seconds a minute while advertising all along', async () => {
      const [a] = await rooms(1, [{ room: OPEN }]);
      let scanning = 0;
      const ticks = 300;
      for (let i = 0; i < ticks; i++) {
        await turn(air, time, [a!]);
        if (!a!.radio.scanHeld) scanning += 1;
      }
      expect(stopped(a!)).toBeUndefined();
      expect(a!.room.isRunning).toBe(true);
      // Ten minutes in two-second ticks: a burst is three ticks of every thirty.
      expect(scanning).toBeGreaterThanOrEqual(25);
      expect(scanning).toBeLessThanOrEqual(40);
      expect(a!.radio.find).not.toBeNull();
      expect(a!.radio.calls.updateFind).toBe(ticks);
    });

    it('two phones both open and bursting still meet within minutes, and both end up to date', async () => {
      const [a, b] = await rooms(2, [{ room: OPEN }, { room: OPEN }]);
      // Both are level first, with nobody near.
      for (let i = 0; i < 40; i++) await turn(air, time, [a!, b!], false);
      await unit(a!.phone, 'a1');
      await unit(b!.phone, 'b1');
      // The air carries only what a phone hears while it scans.
      let i = 0;
      for (; i < 150 && air.pipes.length === 0; i++) await turn(air, time, [a!, b!]);
      expect(air.pipes.length).toBe(1);
      expect(i * 2_000).toBeLessThanOrEqual(3 * 60_000);
      for (let j = 0; j < 10; j++) await turn(air, time, [a!, b!]);
      expect(await idsOf(a!.phone.store)).toEqual(await idsOf(b!.phone.store));
      expect([...a!.events, ...b!.events].some((e) => e.t === 'maybe')).toBe(false);
    });

    // Carl, 2026-11-24: in place of a run cut at 30 minutes and a 10-minute rest, the same share of time on the
    // air at "Up to date", never cutting work short and never keeping a teammate who arrives waiting long.
    const PAUSED = { ...OPEN, levelPause: { onMs: 180_000, everyMs: 240_000 } };

    it('at "Up to date" its radios are off one minute of every four, advertising nothing, and the run goes on', async () => {
      const [a] = await rooms(1, [{ room: PAUSED }]);
      let off = 0;
      let scanning = 0;
      const ticks = 600;
      for (let i = 0; i < ticks; i++) {
        await turn(air, time, [a!]);
        if (a!.radio.find === null) off += 1;
        else if (!a!.radio.scanHeld) scanning += 1;
      }
      // Twenty minutes in two-second ticks: a quarter off, and the scan's bursts only while on.
      expect(off).toBeGreaterThanOrEqual(140);
      expect(off).toBeLessThanOrEqual(160);
      expect(scanning).toBeGreaterThanOrEqual(40);
      expect(scanning).toBeLessThanOrEqual(70);
      expect(a!.radio.calls.stopFind).toBe(5);
      expect(stopped(a!)).toBeUndefined();
      expect(a!.room.isRunning).toBe(true);
    });

    it('a teammate who arrives while it is off meets it within minutes, and the two never pause with work to do', async () => {
      const [a, b] = await rooms(2, [{ room: PAUSED }, { room: PAUSED }]);
      // Both level and alone for a while: b's radio is gone, as if b were not yet there.
      await b!.room.stop();
      for (let i = 0; i < 100; i++) await turn(air, time, [a!], false);
      expect(a!.radio.find).toBeNull();
      const late = roomFor(b!.phone, air, time, { room: PAUSED });
      await late.room.start(time.now());
      await unit(late.phone, 'b1');
      await unit(a!.phone, 'a1');
      let i = 0;
      for (; i < 150 && air.pipes.length === 0; i++) await turn(air, time, [a!, late]);
      expect(air.pipes.length).toBe(1);
      expect(i * 2_000).toBeLessThanOrEqual(3 * 60_000);
      for (let j = 0; j < 10; j++) await turn(air, time, [a!, late]);
      expect(await idsOf(a!.phone.store)).toEqual(await idsOf(late.phone.store));
      expect([a!, late].some((r) => stopped(r))).toBe(false);
    });

    it('an Android and an iPhone meet with no tap; two iPhones never do, and pass each other over', async () => {
      const [android, iphone] = await rooms(2, [{ room: OPEN }, { ...IPHONE, room: OPEN }]);
      await unit(android!.phone, 'a1');
      await unit(iphone!.phone, 'i1');
      for (let i = 0; i < 40 && air.pipes.length === 0; i++) await turn(air, time, [android!, iphone!]);
      for (let i = 0; i < 6; i++) await turn(air, time, [android!, iphone!]);
      expect(air.pipes.length).toBe(1);
      expect(await idsOf(android!.phone.store)).toEqual(await idsOf(iphone!.phone.store));

      const air2 = memoryNearbyAir({ time, files: shelf });
      air = air2;
      const [x, y] = await rooms(2, [{ ...IPHONE, room: OPEN }, { ...IPHONE, room: OPEN }]);
      await unit(x!.phone, 'x1');
      for (let i = 0; i < 120; i++) await turn(air2, time, [x!, y!]);
      expect(air2.pipes).toEqual([]);
      expect([...x!.events, ...y!.events].some((e) => e.t === 'maybe')).toBe(false);
      // Passed over, each is level and scanning in bursts, not all the time.
      expect(x!.events.some((e) => e.t === 'level')).toBe(true);
      expect(x!.room.isRunning && y!.room.isRunning).toBe(true);
    });
  });

  // Carl, 2026-11-24 (decision 230 as amended): Share nearby notes the day each teammate is met, so the quiet mode
  // goes on taking a teammate whose certificate is older than its window. A gathering must greet every pair that is due.
  describe('on Share nearby where the quiet mode may run', () => {
    const WINDOW = 14 * 86_400_000;

    it('notes the day each pair met, greets a pair that is up to date only once its days are half gone, and once a run', async () => {
      const [a, b] = await rooms(2, [{ notesMetForMs: WINDOW }, { notesMetForMs: WINDOW }]);
      await unit(a!.phone, 'a1');
      await unit(b!.phone, 'b1');
      for (let i = 0; i < 12; i++) await turn(air, time, [a!, b!]);
      expect(air.pipes.length).toBe(1);
      const today = nearbyDayOf(a!.phone.client.nearbyHelloNow);
      expect(await a!.phone.keep.met(0)).toEqual([{ key: people[1]!.key, profileId: 'sam', day: today }]);
      expect(await b!.phone.keep.met(0)).toEqual([{ key: people[0]!.key, profileId: 'ana', day: today }]);
      // Up to date, finished, and met today: nothing more.
      for (let i = 0; i < 12; i++) await turn(air, time, [a!, b!]);
      expect(air.pipes.length).toBe(1);
      await a!.room.stop();
      await b!.room.stop();

      // A later run where both days are eight days old: the two greet once, with nothing to swap, and the days are today's again.
      await a!.phone.keep.noteMet({ key: people[1]!.key, profileId: 'sam', day: today - 8 }, 0);
      await b!.phone.keep.noteMet({ key: people[0]!.key, profileId: 'ana', day: today - 8 }, 0);
      const later = memoryNearbyAir({ time, files: shelf });
      const records: { t: Record<string, string>; n?: Record<string, number> }[] = [];
      const again = [a!, b!].map((r) => roomFor(r.phone, later, time, { notesMetForMs: WINDOW, room: { diag: (x) => records.push(x) } }));
      for (const r of again) await r.room.start(time.now());
      for (let i = 0; i < 24; i++) await turn(later, time, again);
      expect(later.pipes.length).toBe(1);
      // The phone that began it counts it as a greeting, for the room's record.
      for (const r of again) await r.room.stop();
      expect(records.filter((x) => x.t.event === 'room').map((x) => x.n?.greets).sort()).toEqual([0, 1]);
      expect((await a!.phone.keep.met(0)).map((m) => m.day)).toEqual([today]);
      expect((await b!.phone.keep.met(0)).map((m) => m.day)).toEqual([today]);

      // Plain Share nearby, where the quiet mode may not run, greets nobody and notes nothing.
      await a!.phone.keep.noteMet({ key: people[1]!.key, profileId: 'sam', day: today - 8 }, 0);
      const plain = memoryNearbyAir({ time, files: shelf });
      const off = [roomFor(a!.phone, plain, time), roomFor(b!.phone, plain, time)];
      for (const r of off) await r.room.start(time.now());
      for (let i = 0; i < 24; i++) await turn(plain, time, off);
      expect(plain.pipes).toEqual([]);
      expect((await a!.phone.keep.met(0)).map((m) => m.day)).toEqual([today - 8]);
    });
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
