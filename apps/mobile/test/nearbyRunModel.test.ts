import { NOTHING_TO_CARRY } from '../src/nearby/readyToCarryModel';
import { radiosMayRun, type RadiosGate } from '../src/nearby/nearbyModel';
import {
  certOrgSeqOf, listedKey, mergeFarAhead, namesOf, NEARBY_RUN_LIMIT_MS, NEARBY_RUN_START, NEARBY_SESSIONS_KEPT, nearbyOffered, nearbyRunReducer, nearbyViewOf,
  orgSeqHereOf, radiosFor, roomLimitsFor, sessionLineOf, swapOf, type NearbyRunAction, type NearbyRunState, type SessionReportLike
} from '../src/nearby/nearbyRunModel';

/**
 * Share nearby's run as plain data (src/nearby/nearbyRunModel.ts and `radiosMayRun` in
 * nearbyModel.ts; docs/nearby-sync-plan.md 5.8, section 8's Radios): the one gate, what a press,
 * a lock and the room's stops do, and what the screen is handed. `useNearby` asks the gate on
 * every start path, and turns the room's reports into these actions.
 */

const OPEN: RadiosGate = { focused: true, onScreen: true, covered: false, worn: false, pressed: false, stopped: false };

const run = (...actions: NearbyRunAction[]): NearbyRunState => actions.reduce(nearbyRunReducer, NEARBY_RUN_START);
/** The gate as the hook asks it, from the run's state. */
const gateOf = (s: NearbyRunState, g: Partial<RadiosGate> = {}) => radiosMayRun({ ...OPEN, ...g, pressed: s.pressed, stopped: s.stopped !== null });

const report = (over: Partial<SessionReportLike> = {}): SessionReportLike => ({
  role: 'i', ended: { how: 'done' }, peer: { profileId: 'sam', tag: 'aaaaaaaaaaaa' }, newerAppNeeded: false, clockOff: false, linkKind: 'wifi-direct',
  got: { events: 4, refused: 1 }, sent: { events: 2 }, files: { got: 3, served: 1, failed: 0, noRoom: false, cutBackups: false }, older: false, farAhead: [],
  ...over
});

describe('the one gate', () => {
  it('opens only focused, on screen, not covered and not stopped', () => {
    expect(radiosMayRun(OPEN)).toBe(true);
    for (const closed of [{ focused: false }, { onScreen: false }, { covered: true }, { stopped: true }]) expect(radiosMayRun({ ...OPEN, ...closed })).toBe(false);
  });

  it('on a worn phone, also needs a press', () => {
    expect(radiosMayRun({ ...OPEN, worn: true })).toBe(false);
    expect(radiosMayRun({ ...OPEN, worn: true, pressed: true })).toBe(true);
    expect(radiosMayRun({ ...OPEN, worn: true, pressed: true, covered: true })).toBe(false);
  });
});

describe('a worn phone', () => {
  const worn = true;

  it('opening the screen starts nothing, and a press starts it', () => {
    expect(gateOf(NEARBY_RUN_START, { worn })).toBe(false);
    expect(gateOf(run({ t: 'reopened', worn }), { worn })).toBe(false);
    expect(gateOf(run({ t: 'press', worn }), { worn })).toBe(true);
  });

  it('a lock clears the press and stops it for good: a typed code is still refused, and only a new press restarts', () => {
    const locked = run({ t: 'press', worn }, { t: 'started' }, { t: 'covered', worn });
    expect(locked).toMatchObject({ pressed: false, running: false, stopped: 'left' });
    // The code typed: the cover is up again, and nothing restarts.
    expect(gateOf(locked, { worn, covered: false })).toBe(false);
    expect(gateOf(nearbyRunReducer(locked, { t: 'reopened', worn }), { worn })).toBe(false);
    const again = nearbyRunReducer(locked, { t: 'press', worn });
    expect(again).toMatchObject({ pressed: true, stopped: null });
    expect(gateOf(again, { worn })).toBe(true);
  });

  it('a lock with no press changes nothing', () => {
    expect(run({ t: 'covered', worn })).toBe(NEARBY_RUN_START);
  });

  it('stops at the run limit and at "Up to date", and both latch until a new press', () => {
    expect(roomLimitsFor(true)).toEqual({ idleLimitMs: 300_000, waitLimitMs: 1_800_000, runLimitMs: NEARBY_RUN_LIMIT_MS, stopWhenLevel: true });
    expect(NEARBY_RUN_LIMIT_MS).toBe(600_000);
    for (const why of ['run', 'level'] as const) {
      const stopped = run({ t: 'press', worn }, { t: 'started' }, { t: 'room', report: { t: 'stopped', why }, worn });
      expect(stopped).toMatchObject({ running: false, stopped: why, pressed: false });
      expect(gateOf(stopped, { worn })).toBe(false);
      expect(gateOf(nearbyRunReducer(stopped, { t: 'look-again', worn }), { worn })).toBe(true);
    }
  });

  it('is warned at the first press, and again at each press after a lock', () => {
    const warned = run({ t: 'press', worn }, { t: 'warned' });
    expect(warned).toMatchObject({ warned: true, warnedOnce: true });
    const pressedAgain = nearbyRunReducer(nearbyRunReducer(warned, { t: 'covered', worn }), { t: 'press', worn });
    expect(pressedAgain).toMatchObject({ warned: false, warnedOnce: true });
  });

  it('never joins a hotspot, whose dialog names the application, and may still host', () => {
    const caps = { directByName: true, band5: true, hotspot: true, joinHotspot: true };
    expect(radiosFor(caps, true)).toEqual({ directByName: true, band5: true, hotspot: true, joinHotspot: false });
    expect(radiosFor(caps, false)).toEqual(caps);
    expect(radiosFor({ ...caps, joinHotspot: false }, false).joinHotspot).toBe(false);
  });
});

describe('a phone with no cover', () => {
  const worn = false;

  it('starts by itself, stops in the background or on a blur, and resumes on coming back', () => {
    expect(gateOf(NEARBY_RUN_START)).toBe(true);
    const away = run({ t: 'started' }, { t: 'room', report: { t: 'stopped', why: 'asked' }, worn });
    expect(away).toMatchObject({ running: false, stopped: null });
    expect(gateOf(away, { onScreen: false })).toBe(false);
    expect(gateOf(away, { focused: false })).toBe(false);
    expect(gateOf(away)).toBe(true);
  });

  it('a stop by itself latches through the background, and Look again or reopening the screen restarts it', () => {
    expect(roomLimitsFor(false)).toEqual({ idleLimitMs: 300_000, waitLimitMs: 1_800_000, stopWhenLevel: false });
    for (const why of ['idle', 'wait', 'no-key'] as const) {
      const idle = run({ t: 'started' }, { t: 'room', report: { t: 'stopped', why }, worn });
      expect(idle.stopped).toBe(why);
      expect(gateOf(idle)).toBe(false);
      expect(gateOf(nearbyRunReducer(idle, { t: 'look-again', worn }))).toBe(true);
      expect(gateOf(nearbyRunReducer(idle, { t: 'reopened', worn }))).toBe(true);
    }
    expect(run({ t: 'failed' }).stopped).toBe('failed');
  });

  it('is never covered, so a lock does nothing', () => {
    expect(run({ t: 'started' }, { t: 'covered', worn })).toMatchObject({ running: true, stopped: null });
  });
});

describe('teammates and what came across', () => {
  const worn = false;
  const seen = (tags: string[], key: string | null = null) => ({ t: 'room' as const, report: { t: 'teammates' as const, seen: tags.map((tag) => ({ tag, key, older: false })) }, worn });

  it('shows a teammate once echoed, named from nearbyNames, and one with no echo as waiting on a tap', () => {
    const names = new Map([['K1', 'sam']]);
    const s = run({ t: 'started' }, { ...seen(['t1'], 'K1'), names }, { t: 'room', report: { t: 'maybe', tag: 't2' }, worn });
    expect(s.teammates).toEqual([
      { tag: 't1', key: 'K1', profileId: 'sam', older: false, state: 'here' },
      { tag: 't2', key: null, profileId: null, older: false, state: 'maybe' }
    ]);
    // A repeated "maybe" adds nothing; a tap shows it; and once echoed it is here.
    expect(nearbyRunReducer(s, { t: 'room', report: { t: 'maybe', tag: 't2' }, worn }).teammates).toHaveLength(2);
    expect(nearbyRunReducer(s, { t: 'tapped', tag: 't2' }).teammates[1]!.state).toBe('here');
    expect(nearbyRunReducer(s, seen(['t1', 't2'])).teammates.map((t) => [t.tag, t.state])).toEqual([['t1', 'here'], ['t2', 'here']]);
    // Someone who left drops off the list; one waiting on a tap stays.
    expect(nearbyRunReducer(s, seen([])).teammates.map((t) => t.tag)).toEqual(['t2']);
  });

  it('follows a session: exchanging, progress, then a line of what came across and the teammate done', () => {
    let s = run({ t: 'started' }, seen(['t1']), { t: 'room', report: { t: 'level' }, worn });
    expect(s.level).toBe(true);
    s = nearbyRunReducer(s, { t: 'room', report: { t: 'session', tag: 't1', role: 'i' }, worn });
    expect(s).toMatchObject({ level: false, current: { tag: 't1', role: 'i', eventsIn: 0 } });
    expect(s.teammates[0]!.state).toBe('exchanging');
    // The teammate stays on the list while the room, scanning held, leaves it out.
    expect(nearbyRunReducer(s, seen([])).teammates.map((t) => [t.tag, t.state])).toEqual([['t1', 'exchanging']]);
    s = nearbyRunReducer(s, { t: 'progress', report: report() });
    expect(s.current).toMatchObject({ eventsIn: 4, eventsOut: 2, filesIn: 3, filesOut: 1 });
    s = nearbyRunReducer(s, { t: 'room', report: { t: 'ended', tag: 't1', report: report({ clockOff: true, farAhead: [{ actorId: 'kim', hlc: '9' }] }) }, worn });
    expect(s.current).toBeNull();
    expect(s.teammates[0]).toMatchObject({ tag: 't1', profileId: 'sam', state: 'done' });
    expect(s.sessions).toEqual([sessionLineOf('t1', report())]);
    expect(s).toMatchObject({ clockOff: true, farAhead: [{ actorId: 'kim', hlc: '9' }], newerAppNeeded: false });
  });

  it('says "Up to date" only once this run heard someone: level with nobody heard is still looking (5.11)', () => {
    const upToDate = (s: NearbyRunState) => nearbyViewOf({
      offered: true, whyNot: null, radiosOff: [], permissions: { state: 'granted', step: { t: 'ready' } }, worn, run: s, holding: 0, hold: true, carry: NOTHING_TO_CARRY
    }).level;
    const level = { t: 'room' as const, report: { t: 'level' as const }, worn };
    // Nobody ever heard: the room is level at once, and the screen keeps looking.
    const alone = run({ t: 'started' }, level);
    expect(upToDate(alone)).toBe(false);
    // Someone heard after the room went level, with nothing to swap: the room says level no more, and the screen is up to date.
    expect(upToDate(nearbyRunReducer(alone, seen(['t1'])))).toBe(true);
    // One who echoed no salt may be a played-back advert: met only once the person taps it, as the room counts it.
    const maybe = { t: 'room' as const, report: { t: 'maybe' as const, tag: 't2' }, worn };
    expect(upToDate(run({ t: 'started' }, maybe, level))).toBe(false);
    expect(upToDate(run({ t: 'started' }, maybe, { t: 'tapped', tag: 't2' }, level))).toBe(true);
    // One who connected to this phone was met too.
    expect(upToDate(run({ t: 'started' }, { t: 'room', report: { t: 'session', tag: null, role: 'r' }, worn }, { t: 'room', report: { t: 'ended', tag: null, report: report({ role: 'r' }) }, worn }, level))).toBe(true);
    // Met and gone stays met; a new run starts with nobody heard again.
    const met = run({ t: 'started' }, seen(['t1']), seen([]), level);
    expect(upToDate(met)).toBe(true);
    const again = run({ t: 'started' }, seen(['t1']), { t: 'room', report: { t: 'stopped', why: 'asked' }, worn }, { t: 'started' }, level);
    expect(upToDate(again)).toBe(false);
    // Found on two emulators: opened again, the screen said the last run's "Up to date" until the room started.
    expect(upToDate(nearbyRunReducer(met, { t: 'reopened', worn }))).toBe(false);
    expect(upToDate(nearbyRunReducer(met, { t: 'reopened', worn: !worn }))).toBe(false);
  });

  it('learns a responder\'s teammate from its report, and marks a session that did not end well as missed', () => {
    let s = run({ t: 'started' }, { t: 'room', report: { t: 'session', tag: null, role: 'r' }, worn });
    s = nearbyRunReducer(s, { t: 'room', report: { t: 'ended', tag: null, report: report({ role: 'r', ended: { how: 'dropped' }, newerAppNeeded: true }) }, worn });
    expect(s.teammates).toEqual([{ tag: 'aaaaaaaaaaaa', key: null, profileId: 'sam', older: false, state: 'missed' }]);
    expect(s.sessions[0]).toMatchObject({ role: 'r', how: 'dropped', tag: 'aaaaaaaaaaaa' });
    expect(s.newerAppNeeded).toBe(true);
    // A silent end with nobody known names no teammate.
    const silent = nearbyRunReducer(s, { t: 'room', report: { t: 'ended', tag: null, report: report({ peer: null, ended: { how: 'silent' } }) }, worn });
    expect(silent.teammates).toHaveLength(1);
  });

  it('a stop clears who is here, keeps what came across, and progress with no session changes nothing', () => {
    let s = run({ t: 'started' }, seen(['t1']), { t: 'room', report: { t: 'ended', tag: 't1', report: report() }, worn });
    expect(nearbyRunReducer(s, { t: 'progress', report: report() })).toBe(s);
    s = nearbyRunReducer(s, { t: 'room', report: { t: 'stopped', why: 'asked' }, worn });
    expect(s).toMatchObject({ teammates: [], running: false });
    expect(s.sessions).toHaveLength(1);
    expect(nearbyRunReducer(s, { t: 'find-error', code: 'BLUETOOTH_OFF' }).findError).toBe('BLUETOOTH_OFF');
    expect(nearbyRunReducer({ ...s, findError: 'X' }, { t: 'started' }).findError).toBeNull();
  });

  it('keeps the newest lines only', () => {
    let s = run({ t: 'started' });
    for (let i = 0; i < NEARBY_SESSIONS_KEPT + 3; i++) s = nearbyRunReducer(s, { t: 'room', report: { t: 'ended', tag: `t${i}`, report: report() }, worn });
    expect(s.sessions).toHaveLength(NEARBY_SESSIONS_KEPT);
    expect(s.sessions.at(-1)!.tag).toBe(`t${NEARBY_SESSIONS_KEPT + 2}`);
  });

  it('keeps one far-ahead line per author, the furthest', () => {
    expect(mergeFarAhead([{ actorId: 'a', hlc: '5' }], [{ actorId: 'a', hlc: '3' }, { actorId: 'b', hlc: '1' }, { actorId: 'a', hlc: '7' }]))
      .toEqual([{ actorId: 'a', hlc: '7' }, { actorId: 'b', hlc: '1' }]);
  });
});

describe('what the room is given', () => {
  it('offers Share nearby only with a certificate and a discovery key', () => {
    const key = { gen: 1, key: 'k', floor: 1, direct: true };
    expect(nearbyOffered(true, key)).toBe(true);
    expect(nearbyOffered(false, key)).toBe(false);
    expect(nearbyOffered(true, null)).toBe(false);
    expect(nearbyOffered(true, undefined)).toBe(false);
  });

  it('takes orgSeqHere as the organization\'s cursor or its checkpoint, whichever is further', () => {
    expect(orgSeqHereOf(null)).toBe(0);
    expect(orgSeqHereOf({ cursor: 12, checkpointSeq: null })).toBe(12);
    expect(orgSeqHereOf({ cursor: 12, checkpointSeq: 40 })).toBe(40);
  });

  it('reads the certificate\'s orgSeq, and an unreadable one never allows a hand-on', () => {
    expect(certOrgSeqOf([{ kind: 'worker@1', body: { org: { orgSeq: 77 } } }])).toBe(77);
    expect(certOrgSeqOf(undefined)).toBe(Number.POSITIVE_INFINITY);
    expect(certOrgSeqOf([{ body: { org: { orgSeq: '7' } } }])).toBe(Number.POSITIVE_INFINITY);
  });

  it('keeps a key on the revocation list from being picked, and an unknown key is not listed', () => {
    const list = { keys: [['K1', 'sam', 5]] as const };
    expect(listedKey(list, 'K1')).toBe(true);
    expect(listedKey(list, 'K2')).toBe(false);
    expect(listedKey(list, null)).toBe(false);
    expect(listedKey(null, 'K1')).toBe(false);
  });

  it('works out from holdings whether two phones have anything to swap, and an unknown key counts as yes', () => {
    const holdings = new Map([['me', { files: ['a', 'b'] }], ['them', { files: ['b', 'c'] }], ['same', { files: ['a', 'b'] }]]);
    expect(swapOf(holdings, 'me', 'them')).toEqual({ hasWhatIWant: true, wantsWhatIHave: true });
    expect(swapOf(holdings, 'me', 'same')).toEqual({ hasWhatIWant: false, wantsWhatIHave: false });
    expect(swapOf(holdings, 'me', null)).toEqual({ hasWhatIWant: true, wantsWhatIHave: true });
    expect(swapOf(holdings, 'nobody', 'them')).toEqual({ hasWhatIWant: true, wantsWhatIHave: false });
  });

  it('reads nearbyNames, and anything unreadable as nothing', () => {
    expect(namesOf(JSON.stringify([['K1', 'sam'], ['K2', 3], 'x']))).toEqual(new Map([['K1', 'sam']]));
    expect(namesOf(null)).toEqual(new Map());
    expect(namesOf('{')).toEqual(new Map());
    expect(namesOf('{}')).toEqual(new Map());
  });
});

describe('what the screen is handed', () => {
  it('asks a worn phone for a press until it has one, and passes the run through', () => {
    const facts = {
      offered: true, whyNot: null, radiosOff: [], permissions: { state: 'granted' as const, step: { t: 'ready' as const } }, worn: true, holding: 3, hold: false, carry: NOTHING_TO_CARRY
    };
    expect(nearbyViewOf({ ...facts, run: NEARBY_RUN_START })).toMatchObject({ needsPress: true, holding: 3, hold: false, running: false });
    const pressed = run({ t: 'press', worn: true }, { t: 'started' });
    expect(nearbyViewOf({ ...facts, run: pressed })).toMatchObject({ needsPress: false, running: true });
    expect(nearbyViewOf({ ...facts, worn: false, run: NEARBY_RUN_START }).needsPress).toBe(false);
  });
});
