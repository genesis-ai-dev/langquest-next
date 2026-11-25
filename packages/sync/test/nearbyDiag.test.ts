import { Diagnostics, MemoryDiagStore, sanitizeDiag } from '../src/diagnostics';
import { addSynced, emptySyncedTally, nearbyCodeOf, NEARBY_DIAG_SCHEMA, NEARBY_ROOM_MS_CAP, roomDiagOf, sessionDiagOf, type NearbyDiagInput } from '../src/nearbyDiag';
import type { NearbySessionReport } from '../src/nearbySession';
import { FakeServer } from '../src/testing/fakeServer';
import { fakeSigner, memoryNearbyAir, type MemoryFiles, type MemoryNearbyAir } from '../src/testing/memoryNearbyLink';
import { OfflineError } from '../src/types';
import { LANG, STORES, teammate, type Teammate } from './nearbyFixtures';
import { newTime, roomFor, testPhone, turn, unit, type TestRoom } from './nearbyKit';

/**
 * What Share nearby records for field diagnostics (docs/diagnostics.md, docs/nearby-sync-plan.md
 * section 11). Why: "it never finds anyone" and "it stops" must be readable from `npm run diag`,
 * a phone silent to its peer must not be silent to diagnostics, and nothing recorded may say who
 * was met: no tag, key, salt, profile or device id.
 */

const allow = NEARBY_DIAG_SCHEMA;
const clean = (input: NearbyDiagInput) => sanitizeDiag({ id: 'r', kind: 'nearby', at: 1, ...input }, allow);

/** A session as a report says it, with a peer the record must never name. */
const report = {
  role: 'i', ended: { how: 'heard', reason: 'busy' }, peer: { installKey: 'KEY', profileId: 'sam', deviceId: 'd-sam', tag: 'abcdef' }, names: [{ profileId: 'nc-1', name: 'Nyibol' }], refusedTag: null,
  newerAppNeeded: false, clockOff: true, linkKind: 'hotspot', fallbacks: 2, code: 'LINK_DROPPED', signed: null,
  got: { pages: 3, events: 40, refused: 1, droppedPages: 0, overBudget: 0, counted: 40 }, sent: { batches: 1, claims: 0, events: 12, skipped: 0 },
  files: { got: 2, served: 1, answeredNo: 0, toldNo: 0, failed: 1, noRoom: true, cutBackups: false }, holdings: { taken: 1, dropped: 0, sent: 1 },
  older: false, farAhead: [{ actorId: 'sam', hlc: '1' }], handedKey: null, handedKeyRefused: 0, revokedTaken: null, revokedDropped: 0, finals: null, changed: true,
  join: null, versionsDiffer: false, copy: null, copyRefused: null, copyServed: { parts: 0, no: 0, stateRefused: null }, topUp: null, libraryFiles: null, docsAgain: false
} satisfies NearbySessionReport;

describe('nearby diagnostics: the fields', () => {
  it('a code is one of the module\'s codes, from a drop\'s message or an error\'s code, and nothing else', () => {
    expect(nearbyCodeOf(new OfflineError('LINK_DROPPED'))).toBe('LINK_DROPPED');
    expect(nearbyCodeOf(Object.assign(new Error('x'), { code: 'GROUP_BUSY' }))).toBe('GROUP_BUSY');
    expect(nearbyCodeOf(new OfflineError('a later attempt took over'))).toBeUndefined();
    expect(nearbyCodeOf(Object.assign(new Error('x'), { code: 'maria@example.org' }))).toBeUndefined();
    expect(nearbyCodeOf('LINK_DROPPED')).toBeUndefined();
  });

  it('a session says how it ended and what moved, as counts and flags', () => {
    const d = sessionDiagOf(report, 5_000);
    expect(d.t).toEqual({ event: 'session', role: 'i', end: 'heard', bye: 'busy', code: 'LINK_DROPPED', link: 'hotspot' });
    expect(d.n).toMatchObject({ ms: 5_000, fallbacks: 2, events: 40, sent: 12, refused: 1, files: 2, served: 1, fileFails: 1, farAhead: 1, noRoom: 1, clockOff: 1, newerApp: 0 });
    expect(clean(d)).toMatchObject({ t: d.t, n: d.n });
    expect(JSON.stringify(d)).not.toMatch(/KEY|sam|abcdef|nc-1|Nyibol/);
    // A store fault names its class; the fleet's memory link names no link.
    const failed = sessionDiagOf({ ...report, ended: { how: 'failed', error: 'SQLiteError' }, linkKind: 'memory', code: null }, 1);
    expect(failed.t).toEqual({ event: 'session', role: 'i', end: 'failed', error: 'SQLiteError' });
  });

  it('a room says why it stopped, what it heard and what the radio can do', () => {
    const tally = { heard: 2, echoed: 1, alone: 2, maybe: 1, taps: 0, maxUnmatched: 3, pipeFails: 1, strangers: 4, busy: 0, noAnswer: 0, sessions: 1, done: 1, greets: 0, levelMs: 9_000, maxMeetMs: null, code: 'PIPE_TIMEOUT' as const };
    const caps = { sdk: 33, advertise: false, directByName: true, band5: false, hotspot: true, joinHotspot: true, bluetoothOn: true, wifiOn: true, locationOn: true };
    const d = roomDiagOf(tally, 'idle', 60_000, caps);
    expect(d.t).toEqual({ event: 'room', stop: 'idle', code: 'PIPE_TIMEOUT', adv: 'no', direct: 'yes', hotspot: 'yes' });
    expect(d.n).toEqual({ ms: 60_000, levelMs: 9_000, heard: 2, echoed: 1, alone: 2, maybe: 1, taps: 0, maxUnmatched: 3, pipeFails: 1, strangers: 4, busy: 0, noAnswer: 0, sessions: 1, done: 1, greets: 0 });
    expect(clean(d)).toMatchObject(d);
  });

  it('a room stopped by the run limit or at "Up to date" reads as one stopped by asking, and no record runs past ten minutes', () => {
    // Why: only a disguised phone has a run limit or stops when level, so either stop, or a run
    // ending at exactly ten minutes, would mark the person in records support and Claude read.
    const tally = { heard: 1, echoed: 1, alone: 0, maybe: 0, taps: 0, maxUnmatched: 0, pipeFails: 0, strangers: 0, busy: 0, noAnswer: 0, sessions: 1, done: 1, greets: 0, levelMs: 700_000, maxMeetMs: null, code: null };
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

  it('a room says which way it ran, and while LangQuest was open the minutes it ran and scanned, past the ten-minute cap', () => {
    // Why: what the quiet mode costs and whether it meets anyone is read from these (docs/nearby-sync-plan.md 15.6).
    const tally = { heard: 1, echoed: 1, alone: 0, maybe: 0, taps: 0, maxUnmatched: 0, pipeFails: 0, strangers: 0, busy: 0, noAnswer: 0, sessions: 1, done: 1, greets: 0, levelMs: 30_000, maxMeetMs: null, code: null };
    const caps = { sdk: 33, advertise: true, directByName: true, band5: false, hotspot: true, joinHotspot: true, bluetoothOn: true, wifiOn: true, locationOn: true };
    const quiet = (scanMs: number, pauseMs = 0, synced = emptySyncedTally()) => ({ mode: 'open' as const, scanMs, pauseMs, synced });
    const open = roomDiagOf(tally, 'asked', 95 * 60_000, caps, quiet(12 * 60_000 + 20_000));
    expect(open.t).toMatchObject({ event: 'room', stop: 'asked', mode: 'open' });
    expect(open.n).toMatchObject({ ms: NEARBY_ROOM_MS_CAP, openMin: 95, scanMin: 12 });
    expect(clean(open)).toMatchObject(open);
    // Never more scanning than running, and never more than a day.
    expect(roomDiagOf(tally, 'asked', 60_000, caps, quiet(5 * 60_000)).n).toMatchObject({ openMin: 1, scanMin: 1 });
    expect(roomDiagOf(tally, 'asked', 3 * 86_400_000, caps, quiet(0)).n).toMatchObject({ openMin: 24 * 60, scanMin: 0 });
    // Share nearby says its mode and nothing more; a room told no mode says none, as before.
    const screen = roomDiagOf(tally, 'idle', 60_000, caps, { mode: 'screen' });
    expect(screen.t.mode).toBe('screen');
    expect(screen.n).not.toHaveProperty('openMin');
    expect(roomDiagOf(tally, 'idle', 60_000, caps).t).not.toHaveProperty('mode');
  });

  // 2026-11-24 (decision 235 as amended): enough to tell how the quiet mode works for a team, and never who.
  it('a session says its room\'s mode, and why this phone turned a phone away, in a word from a fixed list', () => {
    const refused = (detail?: string) => sessionDiagOf({ ...report, ended: { how: 'said', reason: 'identity', ...(detail ? { detail } : {}) } }, 1, 'open');
    expect(refused('certificate not recent').t).toMatchObject({ event: 'session', mode: 'open', end: 'said', bye: 'identity', refusal: 'window' });
    expect([refused('key revoked'), refused('listed'), refused('wrong organization'), refused('no certificate for this organization'), refused('certificate expired'), refused('bad proof'), refused()]
      .map((d) => d.t.refusal)).toEqual(['revoked', 'revoked', 'org', 'org', 'expired', 'other', 'other']);
    expect(clean(refused('certificate not recent'))?.t).toMatchObject({ refusal: 'window', mode: 'open' });
    // 2026-11-24: a newcomer whose join pass ran out has its own word, not "other", and the allowlist keeps it.
    expect(refused('pass expired').t.refusal).toBe('pass-expired');
    expect(clean(refused('pass expired'))?.t).toMatchObject({ refusal: 'pass-expired' });
    // Being turned away, or another bye, says no reason: this phone does not know it.
    expect(sessionDiagOf({ ...report, ended: { how: 'heard', reason: 'identity' } }, 1, 'screen').t).not.toHaveProperty('refusal');
    expect(sessionDiagOf({ ...report, ended: { how: 'said', reason: 'not-member' } }, 1).t).not.toHaveProperty('refusal');
    expect(sessionDiagOf(report, 1).t).not.toHaveProperty('mode');
  });

  it('a quiet room sums its finished sessions, its pause and its greetings, and its longest wait to meet, capped as other durations', () => {
    const tally = { heard: 2, echoed: 2, alone: 0, maybe: 0, taps: 0, maxUnmatched: 0, pipeFails: 0, strangers: 0, busy: 0, noAnswer: 0, sessions: 3, done: 2, greets: 1, levelMs: 4_000, maxMeetMs: 45_000, code: null };
    const synced = emptySyncedTally();
    addSynced(synced, { ...report, linkKind: 'wifi-direct' }, 90_000);
    addSynced(synced, { ...report, linkKind: 'bluetooth', fallbacks: 0 }, 30_000);
    const d = roomDiagOf(tally, 'rest', 40 * 60_000, null, { mode: 'open', scanMs: 3 * 60_000, pauseMs: 9 * 60_000, synced });
    expect(d.t).toEqual({ event: 'room', stop: 'rest', mode: 'open' });
    expect(d.n).toMatchObject({
      openMin: 40, scanMin: 3, pauseMin: 9, syncMin: 2, events: 80, sent: 24, files: 4, served: 2, fileFails: 2, fallbacks: 2, viaDirect: 1, greets: 1, maxMeetMs: 45_000
    });
    expect(clean(d)).toMatchObject({ t: d.t, n: d.n });
    expect(roomDiagOf({ ...tally, maxMeetMs: 3_600_000 }, 'asked', 60_000, null).n?.maxMeetMs).toBe(NEARBY_ROOM_MS_CAP);
    // Share nearby's room keeps its sessions apart, so it sums none.
    expect(roomDiagOf(tally, 'idle', 60_000, null, { mode: 'screen' }).n).not.toHaveProperty('events');
  });

  // 2026-11-24: whether library documents and files move between teammates must be readable in the
  // field, as counts: never which document or file, nor whose.
  const LIBRARY_FIELDS = ['docsKept', 'docsRefused', 'docsMissing', 'docsCapped', 'libHeld', 'libTheirs', 'libGot', 'libServed'];

  it('a session says the library documents it took and the library files it held, could use, got and served, and nothing of either when there was none', () => {
    const d = sessionDiagOf({ ...report, topUp: { kept: 3, refused: 1, missing: 2, capped: true }, libraryFiles: { held: 5, theirs: 4, got: 3, served: 2, short: 0 } }, 1_000, 'screen');
    expect(d.n).toMatchObject({ docsKept: 3, docsRefused: 1, docsMissing: 2, docsCapped: 1, libHeld: 5, libTheirs: 4, libGot: 3, libServed: 2 });
    // The language's recordings are counted apart, as before.
    expect(d.n).toMatchObject({ files: 2, served: 1, fileFails: 1 });
    expect(clean(d)).toMatchObject({ t: d.t, n: d.n });
    // Asked for no documents and exchanged no library files: no field at all, so "none asked" reads apart from "asked, got none".
    const none = sessionDiagOf(report, 1_000).n!;
    for (const k of LIBRARY_FIELDS) expect(none).not.toHaveProperty(k);
    const empty = sessionDiagOf({ ...report, topUp: { kept: 0, refused: 0, missing: 4, capped: false }, libraryFiles: { held: 0, theirs: 0, got: 0, served: 0, short: 0 } }, 1).n;
    expect(empty).toMatchObject({ docsKept: 0, docsRefused: 0, docsMissing: 4, docsCapped: 0, libHeld: 0, libTheirs: 0, libGot: 0, libServed: 0 });
  });

  it('a quiet room sums the library documents and the library files got and served of its finished sessions, never what a phone holds', () => {
    const tally = { heard: 1, echoed: 1, alone: 0, maybe: 0, taps: 0, maxUnmatched: 0, pipeFails: 0, strangers: 0, busy: 0, noAnswer: 0, sessions: 3, done: 3, greets: 0, levelMs: null, maxMeetMs: null, code: null };
    const synced = emptySyncedTally();
    addSynced(synced, { ...report, topUp: { kept: 2, refused: 1, missing: 0, capped: true }, libraryFiles: { held: 4, theirs: 2, got: 2, served: 1, short: 0 } }, 1_000);
    addSynced(synced, { ...report, topUp: { kept: 1, refused: 0, missing: 1, capped: false } }, 1_000);
    addSynced(synced, { ...report, libraryFiles: { held: 4, theirs: 0, got: 0, served: 3, short: 0 } }, 1_000);
    const d = roomDiagOf(tally, 'asked', 60_000, null, { mode: 'open', scanMs: 0, pauseMs: 0, synced });
    expect(d.n).toMatchObject({ docsKept: 3, docsRefused: 1, docsMissing: 1, docsCapped: 1, libGot: 2, libServed: 4, files: 6, served: 3 });
    expect(d.n).not.toHaveProperty('libHeld');
    expect(d.n).not.toHaveProperty('libTheirs');
    expect(clean(d)).toMatchObject({ t: d.t, n: d.n });
    // A quiet room with nothing of the library says zeros, as it does for events; Share nearby's room sums none.
    expect(roomDiagOf(tally, 'asked', 60_000, null, { mode: 'open', scanMs: 0, pauseMs: 0, synced: emptySyncedTally() }).n).toMatchObject({ docsKept: 0, libGot: 0 });
    const screen = roomDiagOf(tally, 'idle', 60_000, null, { mode: 'screen' }).n!;
    for (const k of LIBRARY_FIELDS) expect(screen).not.toHaveProperty(k);
  });

  // The review of 2026-11-24, item 14: a join on Let someone in wrote no record, and none said what came of a starting copy,
  // so a newcomer who came away short showed in the field only as a complaint.
  it('a join\'s session says it was a join, whether the grant went, whether the steps after the copy ran, and what of the copy moved', () => {
    const newcomer = sessionDiagOf({
      ...report, ended: { how: 'dropped' }, join: { pictures: [1, 2], granted: true, refused: null, exchange: false, exchangeSkip: null },
      copy: { whole: false, filled: 7, docs: { kept: 3, missing: 2, refused: 1, capped: false } }, copyRefused: 'not-filled'
    }, 2_000, 'join');
    expect(newcomer.t).toMatchObject({ event: 'session', mode: 'join', role: 'i', end: 'dropped', copyNo: 'not-filled' });
    expect(newcomer.n).toMatchObject({ granted: 1, exchanged: 0, copyWhole: 0, copyFilled: 7, copyDocsKept: 3, copyDocsMissing: 2, copyDocsRefused: 1 });
    expect(newcomer.n).not.toHaveProperty('copyParts');
    expect(clean(newcomer)).toMatchObject({ t: newcomer.t, n: newcomer.n });
    const inviter = sessionDiagOf({
      ...report, role: 'r', ended: { how: 'done' }, join: { pictures: [1, 2], granted: true, refused: null, exchange: true, exchangeSkip: null },
      copyServed: { parts: 40, no: 1, stateRefused: null }
    }, 9_000, 'join');
    expect(inviter.t).toMatchObject({ mode: 'join', role: 'r', end: 'done' });
    expect(inviter.t).not.toHaveProperty('copyNo');
    expect(inviter.n).toMatchObject({ granted: 1, exchanged: 1, copyParts: 40, copyNos: 1 });
    expect(inviter.n).not.toHaveProperty('copyWhole');
    // A sender with no language to give says why; a refused join says no grant; nothing names who.
    expect(sessionDiagOf({ ...report, copyServed: { parts: 1, no: 1, stateRefused: 'not-filled' } }, 1).t.copyNo).toBe('not-filled');
    expect(sessionDiagOf({ ...report, join: { pictures: null, granted: false, refused: 'pass expired', exchange: false, exchangeSkip: null }, ended: { how: 'said', reason: 'identity', detail: 'pass expired' } }, 1, 'join'))
      .toMatchObject({ t: { refusal: 'pass-expired', mode: 'join' }, n: { granted: 0 } });
    // An ordinary session moved no copy and was no join: none of these fields.
    for (const k of ['granted', 'exchanged', 'copyWhole', 'copyFilled', 'copyParts']) expect(sessionDiagOf(report, 1).n).not.toHaveProperty(k);
    expect(JSON.stringify([newcomer, inviter])).not.toMatch(/KEY|sam|abcdef/);
  });

  // The review of 2026-11-24, item 14, again: `exchanged` 0 beside a whole copy had three causes, an older app, the newcomer's own
  // language not opening, and the person leaving, and the record could not tell them apart.
  it('a join whose newest work did not follow its copy says why, as one count the summaries total, and the schema keeps it', () => {
    const skipped = (exchangeSkip: 'older' | 'no-pieces' | 'left' | null, exchange = false) => sessionDiagOf({
      ...report, ended: { how: 'done' }, join: { pictures: [1, 2], granted: true, refused: null, exchange, exchangeSkip },
      copy: { whole: true, filled: 3, docs: { kept: 0, missing: 0, refused: 0, capped: false } }
    }, 1, 'join');
    const SKIPS = ['exchangeOlder', 'exchangeNoPieces', 'exchangeLeft'];
    const only = (d: ReturnType<typeof skipped>) => SKIPS.filter((k) => k in d.n!);
    expect(skipped('older').n).toMatchObject({ exchanged: 0, exchangeOlder: 1 });
    expect(skipped('no-pieces').n).toMatchObject({ exchanged: 0, exchangeNoPieces: 1 });
    expect(skipped('left').n).toMatchObject({ exchanged: 0, exchangeLeft: 1 });
    for (const why of ['older', 'no-pieces', 'left'] as const) {
      expect(only(skipped(why))).toHaveLength(1);
      expect(clean(skipped(why))!.n).toMatchObject(skipped(why).n!);
    }
    // Ran, or not known: none of the three.
    expect(only(skipped(null, true))).toEqual([]);
    expect(only(skipped(null))).toEqual([]);
    for (const k of SKIPS) expect(NEARBY_DIAG_SCHEMA.nearby.n).toContain(k);
  });

  // The review of the fixes, 2026-11-24: a teammate whose checkpoint moved refused the copy as `moved`, which the list did not
  // know, so the record said nothing of why; and a copy whole before its documents were cut, or documents this build cannot
  // read, showed nowhere.
  it('a copy refused because its teammate moved, cut during its documents, or with documents this build cannot read, says so', () => {
    const moved = sessionDiagOf({
      ...report, ended: { how: 'done' }, copy: null, copyRefused: 'moved'
    }, 1, 'open');
    expect(moved.t.copyNo).toBe('moved');
    expect(clean(moved)!.t).toMatchObject({ copyNo: 'moved' });
    const cut = sessionDiagOf({
      ...report, ended: { how: 'dropped' }, join: { pictures: [1, 2], granted: true, refused: null, exchange: false, exchangeSkip: null },
      copy: { whole: true, filled: 9, docs: { kept: 4, missing: 0, refused: 0, capped: false, unreadable: 2, cut: true } }
    }, 1, 'join');
    expect(cut.n).toMatchObject({ copyWhole: 1, copyDocsCut: 1, copyDocsUnreadable: 2, copyDocsKept: 4 });
    expect(clean(cut)!.n).toMatchObject(cut.n!);
    const whole = sessionDiagOf({ ...report, copy: { whole: true, filled: 9, docs: { kept: 4, missing: 0, refused: 0, capped: false } } }, 1);
    expect(whole.n).toMatchObject({ copyDocsCut: 0, copyDocsUnreadable: 0 });
    // A member's documents, and a quiet room's sum of them.
    const topUp = sessionDiagOf({ ...report, topUp: { kept: 3, refused: 0, missing: 0, capped: false, unreadable: 1 } }, 1);
    expect(topUp.n).toMatchObject({ docsUnreadable: 1 });
    const synced = emptySyncedTally();
    addSynced(synced, { ...report, topUp: { kept: 3, refused: 0, missing: 0, capped: false, unreadable: 1 } }, 1);
    addSynced(synced, { ...report, topUp: { kept: 1, refused: 0, missing: 0, capped: false, unreadable: 2 } }, 1);
    expect(synced.docsUnreadable).toBe(3);
    for (const k of ['docsUnreadable', 'copyDocsUnreadable', 'copyDocsCut']) expect(NEARBY_DIAG_SCHEMA.nearby.n).toContain(k);
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

  // 2026-11-24 (decision 235 as amended): a phone offline for weeks with the quiet mode writes one record a run,
  // not one a session, so its queue keeps the start of the trip; a session that went wrong still has its own.
  it('while LangQuest is open a finished session writes no record of its own: the room sums it, says its mode and the one who began it says how long it took to meet', async () => {
    const OPEN = { taps: false, idleLimitMs: Number.POSITIVE_INFINITY, levelScan: { onMs: 6_000, everyMs: 60_000 }, mode: 'open' as const };
    const [a, b] = await rooms(2, [{ room: OPEN }, { room: OPEN }]);
    await unit(a!.phone, 'a1');
    await unit(b!.phone, 'b1');
    for (let i = 0; i < 12; i++) await turn(air, time, [a!, b!]);
    await a!.room.stop('rest');
    await b!.room.stop();
    for (const r of [a!, b!]) {
      expect(sessions(r.diag)).toEqual([]);
      expect(roomRecord(r.diag)).toMatchObject({ t: { event: 'room', mode: 'open' }, n: { sessions: 1, done: 1, events: 1, sent: 1, viaDirect: 0, pauseMin: 0 } });
      for (const d of r.diag) expect(clean(d)).toMatchObject(d);
    }
    expect(roomRecord(a!.diag)!.t.stop).toBe('rest');
    expect(roomRecord(b!.diag)!.t.stop).toBe('asked');
    const began = [a!, b!].filter((r) => roomRecord(r.diag)!.n!.maxMeetMs !== undefined);
    expect(began.length).toBe(1);
    expect(roomRecord(began[0]!.diag)!.n!.maxMeetMs).toBeGreaterThan(0);
  });

  // The review of 2026-11-24, item 14: summed in the room's record, what came of a copy was lost.
  it('while LangQuest is open a finished session that moved a starting copy writes its own record, saying what of it moved', async () => {
    const OPEN = { taps: false, idleLimitMs: Number.POSITIVE_INFINITY, levelScan: { onMs: 6_000, everyMs: 60_000 }, mode: 'open' as const };
    const giver = await testPhone(server, make(), people[0]!, shelf);
    await unit(giver, 'a1');
    await giver.client.sync();
    // A phone with nothing from the server, whose copy is to come from a teammate.
    const taker = await testPhone(server, make(), people[1]!, shelf);
    const target = {
      languageId: LANG, org: null,
      language: { holdsCopy: () => taker.client.holdsCopy(), adoptStartingCopy: (c: Parameters<typeof taker.client.adoptStartingCopy>[0]) => taker.client.adoptStartingCopy(c), keptOnDisk: false, state: () => taker.client.getState() as never }
    };
    const out: (TestRoom & { diag: NearbyDiagInput[] })[] = [];
    for (const [p, session] of [[giver, { copy: { language: giver.client } }], [taker, { takeCopy: target }]] as const) {
      const diag: NearbyDiagInput[] = [];
      out.push({ ...roomFor(p, air, time, { room: { ...OPEN, diag: (x) => diag.push(x) }, session }), diag });
    }
    for (const r of out) await r.room.start(time.now());
    for (let i = 0; i < 12; i++) await turn(air, time, out);
    for (const r of out) await r.room.stop();
    const [gave, took] = out as [typeof out[0], typeof out[0]];
    expect(await taker.client.holdsCopy()).toBe(true);
    expect(sessions(took.diag)).toEqual([expect.objectContaining({ t: expect.objectContaining({ end: 'done', mode: 'open' }), n: expect.objectContaining({ copyWhole: 1 }) })]);
    expect(sessions(gave.diag)).toHaveLength(1);
    expect(sessions(gave.diag)[0]!.n!['copyParts']).toBeGreaterThan(0);
    for (const r of out) for (const d of r.diag) expect(clean(d)).toMatchObject(d);
  });

  it('on Share nearby a session still writes its own record, now saying its mode', async () => {
    const [a, b] = await rooms(2, [{ room: { mode: 'screen' } }, { room: { mode: 'screen' } }]);
    await unit(a!.phone, 'a1');
    for (let i = 0; i < 10; i++) await turn(air, time, [a!, b!]);
    for (const r of [a!, b!]) expect(sessions(r.diag).map((x) => x.t)).toEqual([expect.objectContaining({ end: 'done', mode: 'screen' })]);
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
