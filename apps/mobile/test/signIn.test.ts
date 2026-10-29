import { nameNeedsFix, signIn, signInReady, type SignInDeps } from '../src/auth/signIn';
import { signInAddress } from '../src/auth/accounts';

const user = (id: string) => ({ data: { user: { id } }, error: null });
const refused = (code: string, message = code) => ({ data: { user: null }, error: { code, message } });
const tokens = { access_token: 'a', refresh_token: 'r' };

/** A server that knows `accounts` (address -> password) and v2 accounts, and records what was asked. */
function server(o: { accounts?: Record<string, string>; v2?: Record<string, string>; v2Down?: string } = {}) {
  const asked: string[] = [];
  const accounts = { ...o.accounts };
  const deps: SignInDeps = {
    signInWithPassword: async (email, password) => {
      asked.push(`password ${email}`);
      return accounts[email] === password ? user(`id:${email}`) : refused('invalid_credentials');
    },
    setSession: async () => { asked.push('session'); return user('id:v2'); },
    signInWithV2Account: async (email, password) => {
      asked.push(`v2 ${email}`);
      if (o.v2Down) return { code: o.v2Down };
      return o.v2?.[email.trim()] === password ? { session: tokens } : { code: 'invalid_credentials' };
    }
  };
  return { deps, asked, accounts };
}

describe('signing in (AUTH-1, docs/v2-import.md section 3)', () => {
  it('an email and its password sign in, and the terms go to that account', async () => {
    const { deps } = server({ accounts: { 'ana@x.org': 'pw' } });
    expect(await signIn(' Ana@x.org ', 'pw', deps)).toEqual({ kind: 'signed-in', userId: 'id:ana@x.org' });
  });

  it('a looked-after account signs in by its sign-in name', async () => {
    const { deps, asked } = server({ accounts: { [signInAddress('akol-3')]: 'pw' } });
    expect(await signIn('akol-3', 'pw', deps)).toMatchObject({ kind: 'signed-in' });
    // A sign-in name is never a v2 account: v2 is not asked.
    expect(asked.some((a) => a.startsWith('v2'))).toBe(false);
  });

  it('someone from v2 is signed in with the session v2 vouched for', async () => {
    const { deps, asked } = server({ v2: { 'old@x.org': 'pw' } });
    expect(await signIn('old@x.org', 'pw', deps)).toEqual({ kind: 'signed-in', userId: 'id:v2' });
    expect(asked).toEqual(['password old@x.org', 'v2 old@x.org', 'session']);
  });

  it('a password neither knows is the wrong password', async () => {
    const { deps } = server({ v2: { 'old@x.org': 'other' } });
    expect(await signIn('old@x.org', 'pw', deps)).toMatchObject({ kind: 'refused', where: 'sign in', reason: { code: 'invalid_credentials' } });
  });

  it('v2 out of reach is said as no connection, not a wrong password', async () => {
    const { deps } = server({ v2Down: 'network' });
    expect(await signIn('old@x.org', 'pw', deps)).toEqual({
      kind: 'refused', where: 'sign in with a v2 account', raw: 'network', reason: { code: 'network', name: 'AuthRetryableFetchError' }
    });
  });

  it('a dev account a wiped server forgot is made again, then signed in', async () => {
    const { deps, accounts } = server();
    const outcome = await signIn('dev@x.org', 'devpw', {
      ...deps,
      recreateDevAccount: async (email, password) => { accounts[email] = password; return true; }
    });
    expect(outcome).toEqual({ kind: 'signed-in', userId: 'id:dev@x.org' });
  });

  it('Sign In is ready with an email or a sign-in name, and a password', () => {
    expect(signInReady('ana@x.org', 'pw')).toBe(true);
    expect(signInReady('akol-3', 'pw')).toBe(true);
    expect(signInReady('ana@x.org', '')).toBe(false);
    expect(signInReady('not a name!', 'pw')).toBe(false);
  });

  it('AUTH-003 Sign In stays disabled until both fields can be used', () => {
    expect(signInReady('', '')).toBe(false);
    expect(signInReady('a', 'x')).toBe(false); // a sign-in name is two characters or more
    expect(signInReady('nobody', '')).toBe(false);
    expect(signInReady('nobody', 'x')).toBe(true);
    // Off for what cannot be a name, the screen says why (UI audit, finding 35); a first letter is not judged.
    expect(signInReady('Nyibol Deng', 'x')).toBe(false);
    expect(nameNeedsFix('Nyibol Deng')).toBe(true);
    expect(nameNeedsFix('nyibol_deng')).toBe(true);
    expect(nameNeedsFix('n')).toBe(false);
    expect(nameNeedsFix('Nyibol-Deng-482')).toBe(false);
    expect(nameNeedsFix('ana@x')).toBe(false);
    expect(nameNeedsFix('')).toBe(false);
    expect(signInReady('user@example.org', 'x')).toBe(true);
    expect(signInReady('-bad-name', 'x')).toBe(false);
    expect(signInReady('Nyibol-482', 'x')).toBe(true);
  });
});
