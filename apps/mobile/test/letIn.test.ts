import { emptyOrgState } from '@langquest-next/core';
import { codeShown, LET_IN_START, letInEndOf, letInReducer, letInRoles, letInWhyNot, type LetInAction, type LetInState } from '../src/nearby/letInModel';
import type { PassShape } from '../src/nearby/nearbyModel';

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
    expect(letInEndOf({ ...base, join: { granted: false, refused: 'not let in' }, ended: { how: 'said', reason: 'stopped' } })).toBe('said-no');
    expect(letInEndOf({ ...base, join: { granted: false, refused: 'pass expired' }, ended: { how: 'said', reason: 'identity' } })).toBe('refused');
    expect(letInEndOf({ ...base, versionsDiffer: true, ended: { how: 'said', reason: 'protocol' } })).toBe('versions');
    expect(letInEndOf({ ...base, ended: { how: 'silent' } })).toBe('no-answer');
    expect(letInEndOf({ ...base, ended: { how: 'said', reason: 'stopped', detail: 'no tap in time' } })).toBe('said-no');
  });
});
