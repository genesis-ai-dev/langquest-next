import { Diagnostics, MemoryDiagStore, sanitizeDiag } from '../src/diagnostics';
import { nearbyCodeOf, NEARBY_DIAG_SCHEMA, NEARBY_ROOM_MS_CAP, roomDiagOf, sessionDiagOf, type NearbyDiagInput } from '../src/nearbyDiag';
import type { NearbySessionReport } from '../src/nearbySession';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSigner, memoryNearbyAir, type MemoryFiles, type MemoryNearbyAir } from '../src/testing/memoryNearbyLink';
import { OfflineError } from '../src/types';
import { STORES, teammate, type Teammate } from './nearbyFixtures';
import { newTime, roomFor, testPhone, turn, unit, type TestRoom } from './nearbyKit';

/**
 * What Share nearby records for field diagnostics (docs/diagnostics.md, docs/nearby-sync-plan.md
 * section 11). Why: "it never finds anyone" and "it stops" must be readable from `npm run diag`,
 * a phone silent to its peer must not be silent to diagnostics, and nothing recorded may say who
 * was met: no tag, key, salt, profile or device id.
 */

const allow = NEARBY_DIAG_SCHEMA;
const clean = (input: NearbyDiagInput) => sanitizeDiag({ id: 'r', kind: 'nearby', at: 1, ...input }, allow);

describe('nearby diagnostics: the fields', () => {
  it('a code is one of the module\'s codes, from a drop\'s message or an error\'s code, and nothing else', () => {
    expect(nearbyCodeOf(new OfflineError('LINK_DROPPED'))).toBe('LINK_DROPPED');
    expect(nearbyCodeOf(Object.assign(new Error('x'), { code: 'GROUP_BUSY' }))).toBe('GROUP_BUSY');
    expect(nearbyCodeOf(new OfflineError('a later attempt took over'))).toBeUndefined();
    expect(nearbyCodeOf(Object.assign(new Error('x'), { code: 'maria@example.org' }))).toBeUndefined();
    expect(nearbyCodeOf('LINK_DROPPED')).toBeUndefined();
  });

  it('a session says how it ended and what moved, as counts and flags', () => {
    const report = {
      role: 'i', ended: { how: 'heard', reason: 'busy' }, peer: { installKey: 'KEY', profileId: 'sam', deviceId: 'd-sam', tag: 'abcdef' }, refusedTag: null,
      newerAppNeeded: false, clockOff: true, linkKind: 'hotspot', fallbacks: 2, code: 'LINK_DROPPED', signed: null,
      got: { pages: 3, events: 40, refused: 1, droppedPages: 0, overBudget: 0, counted: 40 }, sent: { batches: 1, claims: 0, events: 12, skipped: 0 },
      files: { got: 2, served: 1, answeredNo: 0, toldNo: 0, failed: 1, noRoom: true, cutBackups: false }, holdings: { taken: 1, dropped: 0, sent: 1 },
      older: false, farAhead: [{ actorId: 'sam', hlc: '1' }], handedKey: null, handedKeyRefused: 0, revokedTaken: null, revokedDropped: 0, finals: null, changed: true,
      join: null, versionsDiffer: false, copy: null, copyRefused: null, copyServed: { parts: 0, no: 0 }
    } satisfies NearbySessionReport;
    const d = sessionDiagOf(report, 5_000);
    expect(d.t).toEqual({ event: 'session', role: 'i', end: 'heard', bye: 'busy', code: 'LINK_DROPPED', link: 'hotspot' });
    expect(d.n).toMatchObject({ ms: 5_000, fallbacks: 2, events: 40, sent: 12, refused: 1, files: 2, served: 1, fileFails: 1, farAhead: 1, noRoom: 1, clockOff: 1, newerApp: 0 });
    expect(clean(d)).toMatchObject({ t: d.t, n: d.n });
    expect(JSON.stringify(d)).not.toMatch(/KEY|sam|abcdef/);
    // A store fault names its class; the fleet's memory link names no link.
    const failed = sessionDiagOf({ ...report, ended: { how: 'failed', error: 'SQLiteError' }, linkKind: 'memory', code: null }, 1);
    expect(failed.t).toEqual({ event: 'session', role: 'i', end: 'failed', error: 'SQLiteError' });
  });

  it('a room says why it stopped, what it heard and what the radio can do', () => {
    const tally = { heard: 2, echoed: 1, maybe: 1, taps: 0, maxUnmatched: 3, pipeFails: 1, strangers: 4, busy: 0, noAnswer: 0, sessions: 1, done: 1, levelMs: 9_000, code: 'PIPE_TIMEOUT' as const };
    const caps = { sdk: 33, advertise: false, directByName: true, band5: false, hotspot: true, joinHotspot: true, bluetoothOn: true, wifiOn: true, locationOn: true };
    const d = roomDiagOf(tally, 'idle', 60_000, caps);
    expect(d.t).toEqual({ event: 'room', stop: 'idle', code: 'PIPE_TIMEOUT', adv: 'no', direct: 'yes', hotspot: 'yes' });
    expect(d.n).toEqual({ ms: 60_000, levelMs: 9_000, heard: 2, echoed: 1, maybe: 1, taps: 0, maxUnmatched: 3, pipeFails: 1, strangers: 4, busy: 0, noAnswer: 0, sessions: 1, done: 1 });
    expect(clean(d)).toMatchObject(d);
  });

  it('a room stopped by the run limit or at "Up to date" reads as one stopped by asking, and no record runs past ten minutes', () => {
    // Why: only a disguised phone has a run limit or stops when level, so either stop, or a run
    // ending at exactly ten minutes, would mark the person in records support and Claude read.
    const tally = { heard: 1, echoed: 1, maybe: 0, taps: 0, maxUnmatched: 0, pipeFails: 0, strangers: 0, busy: 0, noAnswer: 0, sessions: 1, done: 1, levelMs: 700_000, code: null };
    const caps = { sdk: 33, advertise: true, directByName: true, band5: false, hotspot: true, joinHotspot: true, bluetoothOn: true, wifiOn: true, locationOn: true };
    const plain = roomDiagOf(tally, 'asked', 2 * NEARBY_ROOM_MS_CAP, caps);
    expect(roomDiagOf(tally, 'run', NEARBY_ROOM_MS_CAP + 1_999, caps)).toEqual(plain);
    expect(plain.t.stop).toBe('asked');
    expect(plain.n).toMatchObject({ ms: NEARBY_ROOM_MS_CAP, levelMs: NEARBY_ROOM_MS_CAP });
    const short = { ...tally, levelMs: 30_000 };
    expect(roomDiagOf(short, 'level', 90_000, caps)).toEqual(roomDiagOf(short, 'asked', 90_000, caps));
    // Stops a plain phone makes are kept as they are.
    expect(roomDiagOf(short, 'idle', 90_000, caps).t.stop).toBe('idle');
    expect(roomDiagOf(short, 'wait', 90_000, caps).t.stop).toBe('wait');
  });

  it('the allowlist drops a code it does not list and a reason it does not know', () => {
    expect(clean({ t: { event: 'find', code: 'SOMETHING_NEW', why: 'curious' }, n: { heard: 1, peers: 3 } })).toMatchObject({ t: { event: 'find' }, n: { heard: 1 } });
  });

  it('a recorder keeps `nearby` only once it is allowed, so the web, which never allows it, carries no schema', async () => {
    const store = new MemoryDiagStore();
    let id = 0;
    const diag = new Diagnostics({ store, newId: () => `n${id++}` });
    diag.record('nearby', { t: { event: 'find', code: 'BLUETOOTH_OFF' } });
    diag.allow(NEARBY_DIAG_SCHEMA);
    diag.record('nearby', { orgId: 'org1', streamId: 'p1', t: { event: 'find', code: 'BLUETOOTH_OFF' } });
    await diag.settle();
    expect(store.records.map((r) => [r.kind, r.streamId, r.t])).toEqual([['nearby', 'p1', { event: 'find', code: 'BLUETOOTH_OFF' }]]);
  });
});

describe('nearby diagnostics: what a room records', () => {
  const make = STORES[0][1];
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
    people = [await teammate('ana'), await teammate('sam')];
  });

  const rooms = async (n: number, o: Parameters<typeof roomFor>[3][] = []) => {
    const out: (TestRoom & { diag: NearbyDiagInput[] })[] = [];
    for (let i = 0; i < n; i++) {
      const diag: NearbyDiagInput[] = [];
      const room = roomFor(await testPhone(server, make(), people[i]!, shelf), air, time, { ...o[i], room: { ...o[i]?.room, diag: (x) => diag.push(x) } });
      out.push({ ...room, diag });
    }
    for (const r of out) await r.room.start(time.now());
    return out;
  };
  const roomRecord = (d: NearbyDiagInput[]) => d.find((x) => x.t.event === 'room');
  const sessions = (d: NearbyDiagInput[]) => d.filter((x) => x.t.event === 'session');

  it('two teammates who exchanged: one session record each, and a room record when stopped, naming nobody', async () => {
    const [a, b] = await rooms(2);
    await unit(a!.phone, 'a1');
    await unit(b!.phone, 'b1');
    for (let i = 0; i < 10; i++) await turn(air, time, [a!, b!]);
    await a!.room.stop();
    await b!.room.stop();
    for (const r of [a!, b!]) {
      expect(sessions(r.diag).map((s) => s.t.end)).toEqual(['done']);
      expect(sessions(r.diag)[0]!.n!.events).toBe(1);
      expect(roomRecord(r.diag)).toMatchObject({ t: { event: 'room', stop: 'asked', adv: 'yes' }, n: { heard: 1, echoed: 1, sessions: 1, done: 1 } });
      expect(roomRecord(r.diag)!.n!.levelMs).toBeGreaterThan(0);
      for (const d of r.diag) expect(clean(d)).toMatchObject(d);
    }
    const text = JSON.stringify([a!.diag, b!.diag]);
    for (const who of people) for (const secret of [who.profileId, who.deviceId, who.key]) expect(text).not.toContain(secret);
    for (const r of [a!, b!]) expect(text).not.toContain(r.radio.salt!);
  });

  it('heard but never echoed, as a replay leaves it: a tap offered, no session', async () => {
    const [a, b] = await rooms(2);
    await b!.room.tick(time.now());
    const recorded = air.adverts.find((ad) => ad.peer === b!.radio.name)!;
    await b!.room.stop();
    for (let i = 0; i < 40; i++) {
      air.replay(recorded);
      await turn(air, time, [a!], false);
    }
    await a!.room.stop();
    expect(roomRecord(a!.diag)!.n).toMatchObject({ heard: 1, echoed: 0, maybe: 1, sessions: 0 });
    expect(sessions(a!.diag)).toEqual([]);
  });

  it('nobody in range: it stops idle having heard no one', async () => {
    const [a] = await rooms(1, [{ room: { idleLimitMs: 60_000 } }]);
    for (let i = 0; i < 40 && !roomRecord(a!.diag); i++) await turn(air, time, [a!]);
    expect(roomRecord(a!.diag)).toMatchObject({ t: { stop: 'idle' }, n: { heard: 0, echoed: 0, sessions: 0 } });
    expect(roomRecord(a!.diag)!.n!.ms).toBeGreaterThanOrEqual(60_000);
  });

  it('a stranger\'s openings are counted, silent to the stranger and not to diagnostics', async () => {
    const [a] = await rooms(1);
    const stranger = air.radio('stranger');
    for (let i = 0; i < 3; i++) {
      const pipe = await stranger.openPipe(a!.radio.name, a!.radio.salt!, 0);
      await pipe.sendOpening(fakeSigner(`s${i}`).randomBytes(80));
      await turn(air, time, [a!]);
    }
    for (let i = 0; i < 5; i++) await turn(air, time, [a!]);
    await a!.room.stop();
    expect(roomRecord(a!.diag)!.n).toMatchObject({ strangers: 3, sessions: 0 });
    expect(sessions(a!.diag)).toEqual([]);
  });

  it('a disguised phone\'s room records the same as a plain phone\'s stopped by asking at the same moment', async () => {
    // Why: a disguised phone stops at ten minutes and at "Up to date"; neither may show in diagnostics.
    const run = async (worn: boolean) => {
      server = new FakeServer();
      shelf = new Map();
      time = newTime();
      air = memoryNearbyAir({ time, files: shelf });
      const limits = worn ? { runLimitMs: NEARBY_ROOM_MS_CAP, stopWhenLevel: true } : {};
      const [a, b] = await rooms(2, [{ room: { idleLimitMs: 1_800_000, ...limits } }, { room: { idleLimitMs: 1_800_000 } }]);
      await unit(a!.phone, 'a1');
      await unit(b!.phone, 'b1');
      return { a: a!, b: b! };
    };
    // "Up to date": the worn phone stops itself; the plain one is stopped on the same turn.
    const worn = await run(true);
    let turns = 0;
    for (; turns < 40 && !roomRecord(worn.a.diag); turns++) await turn(air, time, [worn.a, worn.b]);
    expect(worn.a.events.find((e) => e.t === 'stopped')).toEqual({ t: 'stopped', why: 'level' });
    const plain = await run(false);
    for (let i = 0; i < turns; i++) await turn(air, time, [plain.a, plain.b]);
    await plain.a.room.stop();
    expect(roomRecord(worn.a.diag)).toEqual(roomRecord(plain.a.diag));
    expect(roomRecord(plain.a.diag)!.t.stop).toBe('asked');
    // The run limit, alone: the plain phone runs on past ten minutes and is then stopped.
    const alone = async (o: Parameters<typeof roomFor>[3]) => {
      time = newTime();
      air = memoryNearbyAir({ time, files: shelf });
      const [a] = await rooms(1, [o]);
      return a!;
    };
    const wornAlone = await alone({ room: { idleLimitMs: 1_800_000, runLimitMs: NEARBY_ROOM_MS_CAP, stopWhenLevel: true } });
    for (let i = 0; i < 400 && !roomRecord(wornAlone.diag); i++) await turn(air, time, [wornAlone]);
    expect(wornAlone.events.find((e) => e.t === 'stopped')).toEqual({ t: 'stopped', why: 'run' });
    const plainAlone = await alone({ room: { idleLimitMs: 1_800_000 } });
    for (let i = 0; i < 400; i++) await turn(air, time, [plainAlone]);
    await plainAlone.room.stop();
    expect(roomRecord(wornAlone.diag)).toEqual(roomRecord(plainAlone.diag));
    expect(roomRecord(plainAlone.diag)!.n!.ms).toBe(NEARBY_ROOM_MS_CAP);
  });

  it('a pipe that would not open is counted with its code', async () => {
    const [a, b] = await rooms(2);
    a!.radio.openPipe = async () => { throw new OfflineError('PIPE_TIMEOUT'); };
    b!.radio.openPipe = async () => { throw new OfflineError('PIPE_TIMEOUT'); };
    await unit(a!.phone, 'a1');
    for (let i = 0; i < 10; i++) await turn(air, time, [a!, b!]);
    await a!.room.stop();
    await b!.room.stop();
    const fails = [a!, b!].map((r) => roomRecord(r.diag)!);
    expect(fails.some((f) => (f.n!.pipeFails ?? 0) > 0 && f.t.code === 'PIPE_TIMEOUT')).toBe(true);
  });
});
