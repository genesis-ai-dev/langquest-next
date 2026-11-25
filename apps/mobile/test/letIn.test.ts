import { emptyOrgState } from '@langquest-next/core';
import { GIVE_IDLE_MS } from '../src/nearby/giveAppModel';
import { NEARBY_PASS_USED_UP } from '@langquest-next/sync/nearby';
import {
  codeLeft, codeShown, COPY_SHOWN_MAX, copyShown, LET_IN_CODE_MS, LET_IN_GIVE_CODE_MS, LET_IN_START, LET_IN_USED_UP, letInCodeMs, letInEndOf, letInGuideFilesLine, letInGuideFilesWent, letInReducer, letInRoles,
  letInWhyNot, type LetInAction, type LetInCopyReady, type LetInState
} from '../src/nearby/letInModel';
import { letInPermit } from '../src/nearby/letInPermitModel';
import { copyReadAgain, copyReadyOf, LET_IN_WARN_DAYS, letInDaysLeft, passInEffect, readCopyReady, type PassShape } from '../src/nearby/nearbyModel';
import { nearbyPermissionsFor } from '../src/nearby/nearbyPermissionsModel';

/**
 * Let someone in on the inviter's phone (docs/nearby-sync-plan.md 14.1, 3). Why these tests: a
 * pass never lets anyone in with a manage privilege, whatever it says; Let someone in shows only
 * with a live pass; a No sends nothing and stays a No; a second phone is told about; and a code
 * dies at its two minutes.
 */

const pass = (roles: PassShape['body']['roles'], expiresAt = 2_000): PassShape => ({
  kind: 'pass@1', kid: 'k1', sig: 's',
  body: { passId: 'p1', orgId: 'o1', languageId: 'l1', inviter: 'ana', inviterKey: 'K'.repeat(43), roles, maxUses: 10, expiresAt }
} as PassShape);

describe('which roles a pass offers, and when it is offered', () => {
  it('leaves out any role with a manage privilege and names roles as the organization does', () => {
    const org = emptyOrgState();
    org.roles['translator'] = { name: { value: 'Translator', hlc: '', eventId: '' }, privileges: { value: ['translate'], hlc: '', eventId: '' }, retired: false } as never;
    const p = pass([
      { roleId: 'translator', privileges: ['translate', 'view_status'] },
      { roleId: 'sneaky', privileges: ['translate', 'invite_members'] },
      { roleId: 'empty', privileges: [] }
    ] as PassShape['body']['roles']);
    expect(letInRoles(p, org)).toEqual([{ roleId: 'translator', name: 'Translator' }]);
    expect(letInRoles(null, org)).toEqual([]);
  });

  it('needs a live pass, the flag when the server has said, a role, the radios allowed and Wi-Fi', () => {
    const p = pass([{ roleId: 'translator', privileges: ['translate'] }] as PassShape['body']['roles']);
    const roles = [{ roleId: 'translator', name: 'Translator' }];
    const base = { inBuild: true, readOnly: false, pass: p, features: null, roles, now: 1_000 };
    expect(letInWhyNot(base)).toBeNull();
    expect(letInWhyNot({ ...base, features: ['nearby', 'nearby_join'] })).toBeNull();
    expect(letInWhyNot({ ...base, features: ['nearby'] })).toBe('no-pass');
    expect(letInWhyNot({ ...base, pass: null })).toBe('no-pass');
    expect(letInWhyNot({ ...base, pass: undefined })).toBe('loading');
    expect(letInWhyNot({ ...base, now: 3_000 })).toBe('expired');
    expect(letInWhyNot({ ...base, roles: [] })).toBe('no-role');
    expect(letInWhyNot({ ...base, readOnly: true })).toBe('read-only');
    expect(letInWhyNot({ ...base, inBuild: false })).toBe('not-in-build');
    expect(letInWhyNot({ ...base, permitted: false })).toBe('permissions');
    expect(letInWhyNot({ ...base, wifiOn: false })).toBe('wifi-off');
  });

  // The review of 2026-11-24, item 7: a pass lets in `maxUses` people and only this phone uses it, but nothing counted, so an
  // eleventh newcomer was let in, then cut by teammates and refused by the server.
  it('says the pass is used up once this phone let in its count, and offers a pass with room first', () => {
    const roles = [{ roleId: 'translator', name: 'Translator' }];
    const p = pass([{ roleId: 'translator', privileges: ['translate'] }] as PassShape['body']['roles']);
    const base = { inBuild: true, readOnly: false, pass: p, features: null, roles, now: 1_000 };
    expect(letInWhyNot({ ...base, used: 9 })).toBeNull();
    expect(letInWhyNot({ ...base, used: 10 })).toBe('used-up');
    // This window's pass used up, the next window's held: the next one is offered.
    const next = { ...p, body: { ...p.body, passId: 'p2', expiresAt: 5_000 } } as PassShape;
    expect(passInEffect([p, next], 1_000, (id) => (id === 'p1' ? 10 : 0))?.body.passId).toBe('p2');
    expect(passInEffect([p, next], 1_000)?.body.passId).toBe('p1');
    // None with room: the one in effect, so the screen says it is used up.
    expect(passInEffect([p], 1_000, () => 10)?.body.passId).toBe('p1');
    // The session's word, which the screen reads.
    expect(LET_IN_USED_UP).toBe(NEARBY_PASS_USED_UP);
    expect(letInEndOf({ ended: { how: 'said', reason: 'stopped', detail: NEARBY_PASS_USED_UP }, versionsDiffer: false, clockOff: false, join: { granted: false, refused: NEARBY_PASS_USED_UP } }))
      .toBe('used-up');
  });

  // The review of 2026-11-24, item 5: an inviter whose own download never finished could give no copy, but the code still
  // showed, and the newcomer was let in with only the organization.
  it('shows no code until this phone can give a whole copy, and says how far its fill has come', () => {
    const roles = [{ roleId: 'translator', name: 'Translator' }];
    const p = pass([{ roleId: 'translator', privileges: ['translate'] }] as PassShape['body']['roles']);
    const base = { inBuild: true, readOnly: false, pass: p, features: null, roles, now: 1_000 };
    expect(letInWhyNot({ ...base, copy: null })).toBe('loading');
    expect(letInWhyNot({ ...base, copy: { ok: true } })).toBeNull();
    expect(letInWhyNot({ ...base, copy: { ok: false, why: 'downloading' } })).toBe('copy-not-ready');
    const filling = copyReadyOf({ ok: false, why: 'filling', fill: { filled: 3, total: 9 } }, { ok: true });
    expect(filling).toEqual({ ok: false, why: 'filling', fill: { filled: 3, total: 9 } });
    expect(letInWhyNot({ ...base, copy: filling })).toBe('copy-not-ready');
    // The organization, not downloaded to the server's newest, is as short a copy as the language.
    expect(copyReadyOf({ ok: true }, { ok: false, why: 'downloading' })).toEqual({ ok: false, why: 'downloading' });
    expect(copyReadyOf({ ok: true }, { ok: true })).toEqual({ ok: true });
    expect(copyReadyOf(null, { ok: true })).toBeNull();
  });

  // The review of the fixes, 2026-11-24: the copy was read only on mount, on focus and after a session, so a language not yet
  // open left the screen saying "Checking this phone" until the person left, and "filled N of M" never moved while it stayed.
  it('says nothing against the copy while a session is not open, and reads it again until it is known ready', async () => {
    const ready = (r: LetInCopyReady) => ({ canGiveCopy: async () => r });
    expect(await readCopyReady(null, ready({ ok: true }))).toBeUndefined();
    expect(await readCopyReady(ready({ ok: true }), null)).toBeUndefined();
    const filling = { ok: false, why: 'filling', fill: { filled: 3, total: 9 } } as const;
    expect(await readCopyReady(ready(filling), ready({ ok: true }))).toEqual(filling);
    expect(await readCopyReady(ready({ ok: true }), ready({ ok: true }))).toEqual({ ok: true });
    // Read again while not read, while a session is not open, and while not ready; never once ready.
    expect([null, undefined, filling, { ok: false, why: 'downloading' } as const].map(copyReadAgain)).toEqual([true, true, true, true]);
    expect(copyReadAgain({ ok: true })).toBe(false);
    // A session not open says nothing against the copy: the reasons before the check still decide.
    const roles = [{ roleId: 'translator', name: 'Translator' }];
    const p = pass([{ roleId: 'translator', privileges: ['translate'] }] as PassShape['body']['roles']);
    expect(letInWhyNot({ inBuild: true, readOnly: false, pass: p, features: null, roles, now: 1_000 })).toBeNull();
  });
});

// Carl, 2026-11-24 (decision 240 as amended): a pass ends with its window, the same date for every pass, and the screen
// let someone in hours before it said nothing. It says the days left, and warns under 30.
describe('how long this phone can still let people in', () => {
  const DAY = 86_400_000;
  it('counts whole days, rounded up, to the last pass\'s expiry, and warns under 30', () => {
    expect(LET_IN_WARN_DAYS).toBe(30);
    expect(letInDaysLeft(100 * DAY, 10 * DAY)).toEqual({ days: 90, warn: false });
    expect(letInDaysLeft(40 * DAY, 10 * DAY)).toEqual({ days: 30, warn: false });
    expect(letInDaysLeft(40 * DAY - 1, 10 * DAY)).toEqual({ days: 30, warn: false });
    expect(letInDaysLeft(39 * DAY, 10 * DAY)).toEqual({ days: 29, warn: true });
    // Hours before the end it still says a day, not none.
    expect(letInDaysLeft(10 * DAY + 3_600_000, 10 * DAY)).toEqual({ days: 1, warn: true });
    expect(letInDaysLeft(10 * DAY, 10 * DAY)).toEqual({ days: 1, warn: true });
  });

  it('says nothing with no pass, or once it has run out, which the screen says another way', () => {
    expect(letInDaysLeft(null, 5)).toBeNull();
    expect(letInDaysLeft(5, 6)).toBeNull();
    expect(letInDaysLeft(5, Number.NaN)).toBeNull();
  });
});

describe('the nearby permissions, asked where they are missing', () => {
  // Why: Let someone in only checked them, and told the person to open Share nearby and come back,
  // with no way there. A carrier coming from Give the app, which asks only for its own Wi-Fi
  // permission, was stuck (Carl, 2026-11-19). It now asks Android itself, as Give the app does;
  // only a phone that wears a cover is sent to Share nearby, whose warning comes before any
  // prompt (decision 231).
  it('asks Android here, with the line Share nearby gives for this Android version', () => {
    expect(letInPermit({ sdk: 34, answers: {}, worn: false })).toEqual({ t: 'explain', reason: 'nearby-devices', permissions: [...nearbyPermissionsFor(34)] });
    expect(letInPermit({ sdk: 30, answers: {}, worn: false })?.t).toBe('explain');
    expect(letInPermit({ sdk: 30, answers: {}, worn: false })).toMatchObject({ reason: 'location' });
    // Only what is missing is asked: Give the app may have had Nearby devices allowed already.
    const some = letInPermit({ sdk: 34, answers: { NEARBY_WIFI_DEVICES: 'granted' }, worn: false });
    expect(some).toMatchObject({ t: 'explain', reason: 'nearby-devices' });
    expect(some && some.t === 'explain' ? some.permissions : []).not.toContain('NEARBY_WIFI_DEVICES');
  });

  it('sends to the app\'s settings once Android will not ask again, and says nothing once all is allowed', () => {
    expect(letInPermit({ sdk: 34, answers: { BLUETOOTH_SCAN: 'never_ask_again' }, worn: false })).toEqual({ t: 'settings' });
    const all = { NEARBY_WIFI_DEVICES: 'granted', BLUETOOTH_SCAN: 'granted', BLUETOOTH_ADVERTISE: 'granted', BLUETOOTH_CONNECT: 'granted' } as const;
    expect(letInPermit({ sdk: 34, answers: all, worn: false })).toBeNull();
    // Below Android 10 nothing is asked (Share nearby is not offered there).
    expect(letInPermit({ sdk: 28, answers: {}, worn: false })).toBeNull();
    // Not read yet: nothing is said.
    expect(letInPermit({ sdk: 34, answers: undefined, worn: false })).toBeNull();
  });

  it('asks nothing on a phone that wears a cover, which goes to Share nearby for its warning first', () => {
    expect(letInPermit({ sdk: 34, answers: {}, worn: true })).toEqual({ t: 'covered' });
    expect(letInPermit({ sdk: 34, answers: { BLUETOOTH_SCAN: 'never_ask_again' }, worn: true })).toEqual({ t: 'covered' });
  });
});

describe('the screen', () => {
  const run = (...actions: LetInAction[]): LetInState => actions.reduce(letInReducer, LET_IN_START);
  const up: LetInAction[] = [{ t: 'role', roleId: 'translator' }, { t: 'host' }, { t: 'showing', uri: 'langquestnext://join?v=1', until: 120_000 }, { t: 'connected' }, { t: 'asked', name: 'Nyibol', pictures: [1, 2] }];

  it('shows nothing until a role is chosen and Show the code pressed', () => {
    expect(run({ t: 'host' }).stage).toEqual({ t: 'choose' });
    expect(run(...up).stage).toEqual({ t: 'asked', name: 'Nyibol', pictures: [1, 2] });
  });

  it('a No stays a No: the session\'s end after it changes nothing, and New code keeps the role', () => {
    const no = run(...up, { t: 'answered', yes: false }, { t: 'ended', why: 'refused' });
    expect(no.stage).toEqual({ t: 'ended', why: 'said-no', name: 'Nyibol' });
    expect(no.roleId).toBe('translator');
    expect(run(...up, { t: 'answered', yes: false }, { t: 'host' }).stage).toEqual({ t: 'starting' });
  });

  it('a yes copies, and the session says done or that the copy is left to a teammate', () => {
    const yes = [...up, { t: 'answered', yes: true } as LetInAction, { t: 'copy', parts: 1, progress: null, rest: false } as LetInAction];
    expect(run(...yes).stage).toEqual({ t: 'copying', name: 'Nyibol', parts: 1, shown: null, rest: false });
    expect(run(...yes, { t: 'ended', why: 'done' }).stage).toEqual({ t: 'done', name: 'Nyibol' });
    expect(run(...yes, { t: 'ended', why: 'dropped-after' }).stage).toEqual({ t: 'ended', why: 'dropped-after', name: 'Nyibol' });
  });

  // Carl, 2026-11-25: a bar beside the parts sent, so the inviter sees how long is left.
  it('the bar follows the inviter\'s estimate, never back, short of the end until the copy is whole, and then the rest goes unmeasured', () => {
    const copy = (parts: number, sent: number, total: number, rest = false): LetInAction => ({ t: 'copy', parts, progress: { sent, total }, rest });
    const yes = [...up, { t: 'answered', yes: true } as LetInAction];
    const stage = (...more: LetInAction[]) => run(...yes, ...more).stage;
    expect(stage({ t: 'copy', parts: 3, progress: null, rest: false })).toMatchObject({ parts: 3, shown: null, rest: false });
    expect(stage(copy(3, 25, 100))).toMatchObject({ shown: 0.25 });
    // The estimate grew: the bar stays where it was.
    expect(stage(copy(3, 25, 100), copy(4, 26, 200))).toMatchObject({ parts: 4, shown: 0.25 });
    expect(stage(copy(9, 100, 100))).toMatchObject({ shown: COPY_SHOWN_MAX });
    expect(stage(copy(9, 50, 100), copy(10, 100, 100, true))).toMatchObject({ parts: 10, rest: true });
    // A report that changes nothing on screen leaves the state as it was.
    const before = run(...yes, copy(3, 25, 100));
    expect(letInReducer(before, copy(3, 25.1, 100))).toBe(before);
    // Not while asking or after.
    expect(run(...up, copy(1, 1, 2)).stage.t).toBe('asked');
  });

  it('the bar\'s share moves in half-percent steps, and only once there is an estimate', () => {
    expect(copyShown(null, null)).toBeNull();
    expect(copyShown(0.3, null)).toBe(0.3);
    expect(copyShown(null, { sent: 0, total: 0 })).toBeNull();
    expect(copyShown(null, { sent: 1, total: 3 })).toBe(0.33);
    expect(copyShown(0.5, { sent: 1, total: 3 })).toBe(0.5);
  });

  it('says the new person\'s guide pictures and audio come later once they are in, and not before or when they were not let in', () => {
    // The starting copy carries no guide files; their first Wi-Fi session with a teammate brings them (5.12, Library files).
    const yes = [...up, { t: 'answered', yes: true } as LetInAction];
    expect(letInGuideFilesLine(run(...yes, { t: 'ended', why: 'done' }).stage)).toBe(true);
    expect(letInGuideFilesLine(run(...yes, { t: 'ended', why: 'done', guideFilesWent: false }).stage)).toBe(true);
    expect(letInGuideFilesLine(run(...yes, { t: 'ended', why: 'dropped-after' }).stage)).toBe(true);
    expect(letInGuideFilesLine(run(...yes, { t: 'ended', why: 'copy-short' }).stage)).toBe(true);
    expect(letInGuideFilesLine(run(...yes).stage)).toBe(false);
    expect(letInGuideFilesLine(run(...up).stage)).toBe(false);
    expect(letInGuideFilesLine(run(...up, { t: 'answered', yes: false }).stage)).toBe(false);
    expect(letInGuideFilesLine(run(...up, { t: 'ended', why: 'dropped' }).stage)).toBe(false);
    expect(letInGuideFilesLine(LET_IN_START.stage)).toBe(false);
  });

  // The review of 2026-11-24, item 2: the join's link now sends the guides' files after a whole copy, and the done screen still
  // said they reach the new person later.
  it('says nothing of the new person\'s guide pictures and audio once the link sent some', () => {
    const yes = [...up, { t: 'answered', yes: true } as LetInAction];
    const went = run(...yes, { t: 'ended', why: 'done', guideFilesWent: true }).stage;
    expect(went).toEqual({ t: 'done', name: 'Nyibol', guideFilesWent: true });
    expect(letInGuideFilesLine(went)).toBe(false);
    // Only the done screen can follow files sent: a drop before the steps after the copy, or a short copy, never ran them.
    expect(run(...yes, { t: 'ended', why: 'dropped-after', guideFilesWent: true }).stage).toEqual({ t: 'ended', why: 'dropped-after', name: 'Nyibol' });
  });

  it('counts guide pictures and audio as sent only when the session ended done and its library files step served one', () => {
    const done = { how: 'done' };
    expect(letInGuideFilesWent({ ended: done, libraryFiles: { served: 4 } })).toBe(true);
    // A newcomer on an older build, or none held here: no library files step, or nothing served in it.
    expect(letInGuideFilesWent({ ended: done, libraryFiles: null })).toBe(false);
    expect(letInGuideFilesWent({ ended: done, libraryFiles: { served: 0 } })).toBe(false);
    // The link dropped during the steps after a whole copy: the screen says done, and the rest reach them later.
    expect(letInGuideFilesWent({ ended: { how: 'dropped' }, libraryFiles: { served: 2 } })).toBe(false);
    expect(letInEndOf({ ended: { how: 'dropped' }, versionsDiffer: false, clockOff: false, join: { granted: true, refused: null, exchange: true } })).toBe('done');
  });

  it('a second phone that tried the code is told about until a new code', () => {
    const s = run(...up, { t: 'turned-away' });
    expect(s.turnedAway).toBe(true);
    expect(run(...up, { t: 'turned-away' }, { t: 'ended', why: 'expired' }, { t: 'host' }).turnedAway).toBe(false);
  });

  it('a code is shown only while it is up and under its two minutes', () => {
    const showing = run({ t: 'role', roleId: 'translator' }, { t: 'host' }, { t: 'showing', uri: 'u', until: 120_000 }).stage;
    expect(codeShown(showing, 119_999)).toBe('u');
    expect(codeShown(showing, 120_000)).toBeNull();
    expect(codeShown({ t: 'connected' }, 0)).toBeNull();
  });

  it('reads how a session ended on the inviter\'s side', () => {
    const base = { versionsDiffer: false, clockOff: false, join: { granted: false, refused: null as string | null } };
    expect(letInEndOf({ ...base, join: { granted: true, refused: null }, ended: { how: 'done' } })).toBe('done');
    expect(letInEndOf({ ...base, join: { granted: true, refused: null }, ended: { how: 'dropped' } })).toBe('dropped-after');
    // 2026-11-24: the copy was whole and the two went on to the newest work; a drop there leaves them in, with nothing to finish.
    expect(letInEndOf({ ...base, join: { granted: true, refused: null, exchange: true }, ended: { how: 'dropped' } })).toBe('done');
    expect(letInEndOf({ ...base, join: { granted: true, refused: null, exchange: false }, ended: { how: 'dropped' } })).toBe('dropped-after');
    // The review of the fixes, 2026-11-24 (item 3): the newcomer asked for names or documents, so its copy was whole and its person
    // set; a drop then cut only those, and the screen says they can work, not that their copy needs finishing.
    expect(letInEndOf({ ...base, join: { granted: true, refused: null, exchange: false, copyWhole: true }, ended: { how: 'dropped' } })).toBe('dropped-docs');
    expect(letInEndOf({ ...base, join: { granted: true, refused: null, exchange: true, copyWhole: true }, ended: { how: 'dropped' } })).toBe('done');
    expect(letInGuideFilesLine({ t: 'ended', why: 'dropped-docs', name: 'Nyibol' })).toBe(true);
    // Let in, but this phone had no copy of the language or organization to give: a teammate finishes it.
    expect(letInEndOf({ ...base, join: { granted: true, refused: null }, ended: { how: 'done' }, copyServed: { stateRefused: 'not-filled' } })).toBe('copy-short');
    expect(letInEndOf({ ...base, join: { granted: true, refused: null }, ended: { how: 'done' }, copyServed: { stateRefused: null } })).toBe('done');
    expect(letInEndOf({ ...base, join: { granted: false, refused: 'not let in' }, ended: { how: 'said', reason: 'stopped' } })).toBe('said-no');
    expect(letInEndOf({ ...base, join: { granted: false, refused: 'pass expired' }, ended: { how: 'said', reason: 'identity' } })).toBe('refused');
    expect(letInEndOf({ ...base, versionsDiffer: true, ended: { how: 'said', reason: 'protocol' } })).toBe('versions');
    expect(letInEndOf({ ...base, ended: { how: 'silent' } })).toBe('no-answer');
    expect(letInEndOf({ ...base, ended: { how: 'said', reason: 'stopped', detail: 'no tap in time' } })).toBe('said-no');
  });
});

describe('a code on Give the app\'s group (docs/nearby-sync-plan.md 14.5)', () => {
  const run = (...actions: LetInAction[]): LetInState => actions.reduce(letInReducer, LET_IN_START);
  const shown = (onGiveGroup?: boolean) => run(
    { t: 'role', roleId: 'translator' }, { t: 'host' }, { t: 'showing', uri: 'u', until: 900_000, ...(onGiveGroup === undefined ? {} : { onGiveGroup }) }
  ).stage;

  it('lives as long as Give the app waits for a phone, since the new phone is still installing; a code of this phone\'s own, two minutes', () => {
    expect(letInCodeMs(false)).toBe(LET_IN_CODE_MS);
    expect(LET_IN_CODE_MS).toBe(120_000);
    expect(letInCodeMs(true)).toBe(LET_IN_GIVE_CODE_MS);
    expect(LET_IN_GIVE_CODE_MS).toBe(GIVE_IDLE_MS);
    expect(LET_IN_GIVE_CODE_MS).toBe(15 * 60_000);
  });

  it('the screen knows which group the code is on while it is up', () => {
    expect(shown(true)).toEqual({ t: 'showing', uri: 'u', until: 900_000, onGiveGroup: true });
    expect(shown(false)).toEqual({ t: 'showing', uri: 'u', until: 900_000, onGiveGroup: false });
    expect(shown()).toEqual({ t: 'showing', uri: 'u', until: 900_000, onGiveGroup: false });
    expect(codeShown(shown(true), 899_999)).toBe('u');
    expect(codeShown(shown(true), 900_000)).toBeNull();
  });

  it('counts down in seconds for two minutes, and in whole minutes, rounded up, for Give the app\'s fifteen', () => {
    expect(codeLeft(90, false)).toEqual({ unit: 'seconds', n: 90 });
    expect(codeLeft(900, true)).toEqual({ unit: 'minutes', n: 15 });
    expect(codeLeft(841, true)).toEqual({ unit: 'minutes', n: 15 });
    expect(codeLeft(61, true)).toEqual({ unit: 'minutes', n: 2 });
    expect(codeLeft(1, true)).toEqual({ unit: 'minutes', n: 1 });
    expect(codeLeft(0, true)).toEqual({ unit: 'minutes', n: 0 });
  });
});
