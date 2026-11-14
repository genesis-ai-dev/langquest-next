import type { LocalPerson } from '../src/session/localPersonModel';

/** A local person and the chain a grant would give them, for the tests of joining offline (docs/nearby-sync-plan.md 14.1). */

export const KEY = 'A'.repeat(42) + 'g';
export const SALT = 'B'.repeat(21) + 'A';

export function inviteChain(p: { profileId: string; installKey?: string; idSalt?: string; deviceId?: string; name?: string; orgId?: string; languageId?: string; roleId?: string }): unknown[] {
  return [
    { kind: 'worker@1', kid: 'k1', body: { installKey: 'I'.repeat(43), profileId: 'inviter-1', deviceId: 'dev-i', expiresAt: 1, org: { orgId: p.orgId ?? 'org-1', orgSeq: 3, scopes: [] } }, sig: 's' },
    {
      kind: 'invite@1',
      body: {
        pass: { kind: 'pass@1', kid: 'k1', body: { passId: 'p1', orgId: p.orgId ?? 'org-1', languageId: p.languageId ?? 'lang-1', inviter: 'inviter-1', inviterKey: 'I'.repeat(43), roles: [], maxUses: 10, expiresAt: 9 }, sig: 's' },
        installKey: p.installKey ?? KEY, idSalt: p.idSalt ?? SALT, profileId: p.profileId, deviceId: p.deviceId ?? 'dev-n', name: p.name ?? 'Nyibol',
        roleId: p.roleId ?? 'translator', privileges: ['translate', 'view_status']
      },
      sig: 's'
    }
  ];
}

export function person(over: Partial<LocalPerson> = {}): LocalPerson {
  const profileId = over.profileId ?? 'newcomer-1';
  const stage = over.stage ?? 'ready';
  return {
    v: 1, profileId, idSalt: SALT, installKey: KEY, deviceId: 'dev-n', name: 'Nyibol', stage,
    chain: stage === 'asking' ? null : inviteChain({ profileId }), ...over
  };
}
