import { accountKeys, deleteAccount, type DeletionDeps } from '../src/accountDeletion';

// Account deletion on the phone (decisions.md 46).

const me = '8c1f0a52-1d2e-4d7a-9a51-3b8e2f6c0d11';
const other = 'f2b7c9e0-5a44-4c1b-8e0f-9d6a1b2c3d44';
const keys = [
  `inbox:${me}`, `inbox-read:${me}:org1`, `profile-directory:${me}`, `organizations:${me}`,
  `terms-version:${me}`, `vision:${me}`, `joined:${me}`, 'push-token',
  `inbox:${other}`, `organizations:${other}`, 'public-projects', 'held-invite', 'sb-ref-auth-token'
];

function phone(serverError: string | null = null) {
  const stored = new Set(keys);
  const calls: string[] = [];
  const deps: DeletionDeps = {
    deleteOnServer: async () => { calls.push('server'); return serverError; },
    storage: {
      getAllKeys: async () => [...stored],
      multiRemove: async (ks) => { calls.push('forget'); ks.forEach((k) => stored.delete(k)); }
    },
    signOutHere: async () => { calls.push('signOut'); }
  };
  return { stored, calls, deps };
}

describe('account deletion on the phone', () => {
  it('forgets only this account and the push token', () => {
    expect(accountKeys(keys, me).sort()).toEqual([
      `inbox:${me}`, `inbox-read:${me}:org1`, `profile-directory:${me}`, `organizations:${me}`,
      `terms-version:${me}`, `vision:${me}`, `joined:${me}`, 'push-token'
    ].sort());
  });

  it('asks the server first, then forgets, then signs out', async () => {
    const p = phone();
    await deleteAccount(me, p.deps);
    expect(p.calls).toEqual(['server', 'forget', 'signOut']);
    expect([...p.stored].sort()).toEqual([`inbox:${other}`, `organizations:${other}`, 'public-projects', 'held-invite', 'sb-ref-auth-token'].sort());
  });

  it('changes nothing on the phone when the server refuses', async () => {
    const p = phone('sign in required');
    await expect(deleteAccount(me, p.deps)).rejects.toThrow('sign in required');
    expect(p.calls).toEqual(['server']);
    expect(p.stored.size).toBe(keys.length);
  });
});
