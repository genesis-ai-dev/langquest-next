import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { originsOf, originWords } from '../src/nearby/nearbyHistoryModel';
import { nearbyViewOf, NEARBY_RUN_START, type NearbyRunState, type NearbyView } from '../src/nearby/nearbyRunModel';
import { NOTHING_TO_CARRY } from '../src/nearby/readyToCarryModel';
import {
  endedWords, linesShown, nearbyRowWords, PERMISSION_WORDS, RADIO_WORDS, SEEN_WORDS, stageOf, STOP_WORDS, teammatesShown, TEAMMATE_WORDS, WHY_NOT_WORDS
} from '../src/nearby/shareNearbyModel';

// Share nearby's states (docs/nearby-sync-plan.md 5.8, section 8): tested through the model, since
// the web has no Share nearby and no radio runs in a test. Every state has words in English.

const ROOT = join(import.meta.dirname, '..');
type Tree = { [k: string]: string | Tree };
const en = JSON.parse(readFileSync(join(ROOT, 'src/i18n/en.json'), 'utf8')) as Tree;
const disguiseEn = JSON.parse(readFileSync(join(ROOT, 'src/disguise/i18n/en.json'), 'utf8')) as Tree;
const has = (tree: Tree, key: string) => typeof key.split('.').reduce<Tree | string | undefined>((at, k) => (typeof at === 'object' ? at[k] : undefined), tree) === 'string';

const view = (over: Partial<Omit<Parameters<typeof nearbyViewOf>[0], 'run'>> = {}, run: Partial<NearbyRunState> = {}): NearbyView => nearbyViewOf({
  offered: true, whyNot: null, radiosOff: [], permissions: { state: 'granted', step: { t: 'ready' } }, worn: false, holding: 0, hold: true, carry: NOTHING_TO_CARRY,
  ...over, run: { ...NEARBY_RUN_START, ...run }
});

describe('the Share nearby row on Sync', () => {
  it('names a new person only where Share nearby offers Let someone in, and says why not while it cannot run', () => {
    expect(nearbyRowWords(null, null)).toEqual({ sub: 'nearby.rowSubJoin', help: 'nearby.rowHelpJoin' });
    // A run-out pass still shows Let someone in on Share nearby, disabled, so the row still names it.
    expect(nearbyRowWords(null, 'expired')).toEqual({ sub: 'nearby.rowSubJoin', help: 'nearby.rowHelpJoin' });
    for (const why of ['loading', 'not-in-build', 'no-pass', 'no-role', 'read-only'] as const) {
      expect(nearbyRowWords(null, why), why).toEqual({ sub: 'nearby.rowSub', help: 'nearby.rowHelp' });
    }
    expect(nearbyRowWords('android-too-old', null)).toEqual({ sub: 'nearby.why.androidTooOld', help: 'nearby.rowHelp' });
    expect(nearbyRowWords('no-key', 'no-pass')).toEqual({ sub: 'nearby.why.noKey', help: 'nearby.rowHelp' });
    for (const k of ['rowSub', 'rowSubJoin', 'rowHelp', 'rowHelpJoin']) expect(has(en, `nearby.${k}`), k).toBe(true);
  });
});

describe('Share nearby\'s states', () => {
  it('says why it cannot run before anything else, the phone too old among them', () => {
    expect(stageOf(view({ whyNot: 'android-too-old', radiosOff: ['bluetooth'] }))).toEqual({ t: 'unavailable', why: 'android-too-old' });
    expect(stageOf(view({ whyNot: 'loading' }))).toEqual({ t: 'unavailable', why: 'loading' });
  });

  it('on a phone that wears a cover, hands a press, the warning and its stops to the cover\'s notes, before radios and prompts', () => {
    expect(stageOf(view({ worn: true, radiosOff: ['wifi'] }))).toEqual({ t: 'cover', stopped: null });
    expect(stageOf(view({ worn: true }, { pressed: true, stopped: null }))).toEqual({ t: 'starting' });
    expect(stageOf(view({ worn: true, permissions: { state: 'needed', step: { t: 'warn' } } }, { pressed: true }))).toEqual({ t: 'cover', stopped: null });
    expect(stageOf(view({ worn: true }, { stopped: 'left' }))).toEqual({ t: 'cover', stopped: 'left' });
  });

  it('asks for radios, then says why before Android asks, then the settings when Android will not ask', () => {
    expect(stageOf(view({ radiosOff: ['bluetooth', 'location'] }))).toEqual({ t: 'radios', off: ['bluetooth', 'location'] });
    const explain = { t: 'explain' as const, reason: 'nearby-devices' as const, permissions: ['BLUETOOTH_SCAN' as const] };
    expect(stageOf(view({ permissions: { state: 'needed', step: explain } }))).toEqual({ t: 'permission', reason: 'nearby-devices', permissions: ['BLUETOOTH_SCAN'] });
    expect(stageOf(view({ permissions: { state: 'blocked', step: { t: 'settings' } } }))).toEqual({ t: 'settings' });
  });

  it('then a stop that latched, then running, level or sharing, then starting', () => {
    expect(stageOf(view({}, { stopped: 'idle' }))).toEqual({ t: 'stopped', why: 'idle' });
    expect(stageOf(view({}, { running: true }))).toEqual({ t: 'running', level: false, sharing: false });
    expect(stageOf(view({}, { running: true, level: true, met: true }))).toEqual({ t: 'running', level: true, sharing: false });
    // Level with nobody heard this run is still looking for teammates (5.11).
    expect(stageOf(view({}, { running: true, level: true }))).toEqual({ t: 'running', level: false, sharing: false });
    expect(stageOf(view({}, { running: true, current: { tag: 't', role: 'i', eventsIn: 0, eventsOut: 0, filesIn: 0, filesOut: 0 } }))).toMatchObject({ sharing: true });
    expect(stageOf(view())).toEqual({ t: 'starting' });
  });

  it('has English words for every state, and leaves the stops only a covered phone has to the cover\'s own words', () => {
    const keys = [
      ...Object.values(WHY_NOT_WORDS), ...Object.values(RADIO_WORDS), ...Object.values(PERMISSION_WORDS), ...Object.values(TEAMMATE_WORDS), ...Object.values(SEEN_WORDS),
      ...Object.values(STOP_WORDS).filter((k): k is NonNullable<typeof k> => k !== null),
      ...['done', 'dropped', 'stalled', 'no-answer', 'silent', 'heard', 'said', 'failed', 'odd'].map(endedWords).filter((k) => k !== null)
    ];
    expect(keys.filter((k) => !has(en, k))).toEqual([]);
    expect([STOP_WORDS.run, STOP_WORDS.level, STOP_WORDS.left]).toEqual([null, null, null]);
    for (const k of ['start', 'startLine', 'warning', 'warned', 'left', 'run', 'level']) expect(has(disguiseEn, `disguise.nearby.${k}`), k).toBe(true);
    expect(endedWords('done')).toBeNull();
  });

  it('draws no line or row for a played-back advert or a stranger: nothing moved and nobody named', () => {
    const line = { tag: 't', profileId: null, role: 'i' as const, how: 'silent', linkKind: null, eventsIn: 0, eventsOut: 0, refused: 0, filesIn: 0, filesOut: 0, filesFailed: 0, noRoom: false, cutBackups: false, olderFromServer: false };
    expect(linesShown([line])).toEqual([]);
    expect(linesShown([line, { ...line, profileId: 'sam', how: 'done' }, { ...line, eventsIn: 2 }]).map((l) => l.profileId ?? l.eventsIn)).toEqual([2, 'sam']);
    expect(teammatesShown([{ tag: 'a', key: null, profileId: null, older: false, state: 'missed' }, { tag: 'b', key: null, profileId: null, older: false, state: 'maybe' }]).map((m) => m.tag)).toEqual(['b']);
  });
});

describe('the History line for a row still nearby', () => {
  const row = (status: string, via: unknown) => ({ event: { id: 'e', actorId: 'sam', hlc: 'h1' }, status, via }) as never;

  it('names the phone a row came from, says a batch row is not on the server yet, and leaves confirmed rows alone', () => {
    const names = new Map([['K-sam', 'sam']]);
    const origins = originsOf([row('nearby', { batch: 1, key: 'K-sam' })], names);
    expect(origins.get('sam\nh1')).toEqual({ from: 'sam', claim: false });
    expect(originWords(origins.get('sam\nh1')!)).toBe('nearby.history.nearby');
    expect(originWords(originsOf([row('nearby', { claim: { key: 'K-x', seq: 3 } })], names).get('sam\nh1')!)).toBe('nearby.history.claimUnknown');
    expect(originsOf([row('confirmed', undefined), row('pending', { batch: 1, key: 'K-sam' })], names).size).toBe(0);
    expect(originWords(null)).toBeNull();
    for (const k of ['nearby', 'nearbyUnknown', 'claim', 'claimUnknown']) expect(has(en, `nearby.history.${k}`), k).toBe(true);
  });
});
