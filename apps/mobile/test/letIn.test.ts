import { emptyOrgState } from '@langquest-next/core';
import { GIVE_IDLE_MS } from '../src/nearby/giveAppModel';
import {
  codeLeft, codeShown, LET_IN_CODE_MS, LET_IN_GIVE_CODE_MS, LET_IN_START, letInCodeMs, letInEndOf, letInGuideFilesLine, letInReducer, letInRoles, letInWhyNot,
  type LetInAction, type LetInState
} from '../src/nearby/letInModel';
import { letInPermit } from '../src/nearby/letInPermitModel';
import type { PassShape } from '../src/nearby/nearbyModel';
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
    const yes = [...up, { t: 'answered', yes: true } as LetInAction, { t: 'part' } as LetInAction];
    expect(run(...yes).stage).toEqual({ t: 'copying', name: 'Nyibol', parts: 1 });
    expect(run(...yes, { t: 'ended', why: 'done' }).stage).toEqual({ t: 'done', name: 'Nyibol' });
    expect(run(...yes, { t: 'ended', why: 'dropped-after' }).stage).toEqual({ t: 'ended', why: 'dropped-after', name: 'Nyibol' });
  });

  it('says the new person\'s guide pictures and audio come later once they are in, and not before or when they were not let in', () => {
    // The starting copy carries no guide files; their first Wi-Fi session with a teammate brings them (5.12, Library files).
    const yes = [...up, { t: 'answered', yes: true } as LetInAction];
    expect(letInGuideFilesLine(run(...yes, { t: 'ended', why: 'done' }).stage)).toBe(true);
    expect(letInGuideFilesLine(run(...yes, { t: 'ended', why: 'dropped-after' }).stage)).toBe(true);
    expect(letInGuideFilesLine(run(...yes, { t: 'ended', why: 'copy-short' }).stage)).toBe(true);
    expect(letInGuideFilesLine(run(...yes).stage)).toBe(false);
    expect(letInGuideFilesLine(run(...up).stage)).toBe(false);
    expect(letInGuideFilesLine(run(...up, { t: 'answered', yes: false }).stage)).toBe(false);
    expect(letInGuideFilesLine(run(...up, { t: 'ended', why: 'dropped' }).stage)).toBe(false);
    expect(letInGuideFilesLine(LET_IN_START.stage)).toBe(false);
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
