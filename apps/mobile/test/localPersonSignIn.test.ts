import { person } from './localPersonFixtures';
import type { LocalPerson } from '../src/session/localPersonModel';

/**
 * No other account signs in over someone let in offline (docs/nearby-sync-plan.md 14.1, 5). Why:
 * a local person's unsent work waits under their own id; another account's session on this phone
 * would leave it with nobody to send it, and their copy would be read as someone else's. Only a
 * session for the local person's own id goes on: first contact's, or a helper's code made for them.
 */

const fake = vi.hoisted(() => ({
  local: null as LocalPerson | null, calls: [] as string[], invoked: [] as { name: string; body: unknown }[],
  reply: { data: null, error: null } as { data: unknown; error: unknown }
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android', select: (o: Record<string, unknown>) => o['android'] ?? o['default'] } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'u-1' }));
vi.stubGlobal('__DEV__', false);
// What signInFlow.ts reaches for the other ways in, none of them asked here.
vi.mock('../src/server/lock', () => ({ rememberPassword: async () => undefined }));
vi.mock('../src/server/account', () => ({ profileNames: async () => ({ data: [] }) }));
vi.mock('../src/server/personas', () => ({ recreateDevAccount: async () => undefined }));
vi.mock('../src/server/v2', () => ({ signInWithV2Account: async () => undefined }));
vi.mock('../src/auth/signInHelp', () => ({ recordHelp: async () => undefined }));
vi.mock('../src/auth/signBackIn', () => ({ signBackIn: async () => ({ kind: 'none' }) }));
vi.mock('../src/auth/passwordReset', () => ({ askForResetLink: async () => undefined, chooseNewPassword: async () => undefined, ResetError: class extends Error {} }));
vi.mock('../src/diagnostics/authDiag', () => ({ recordAuth: () => undefined, recordAuthFailure: () => undefined, since: () => 0 }));
vi.mock('../src/diagnostics/report', () => ({ failureMessage: () => 'failed', noteExpected: () => undefined, reportError: () => undefined }));
vi.mock('../src/server/localPerson', () => ({ readLocalPerson: async () => fake.local }));
vi.mock('../src/session/signOutCause', () => ({ signingOutByChoice: (fn: () => Promise<void>) => fn() }));
vi.mock('../src/server/secureStorage', () => ({ secureStorage: { getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined } }));
vi.mock('../src/server/supabase', () => ({
  SESSION_KEY: 'sb-session', signOutHere: async () => undefined, supabaseConfigError: null,
  supabase: {
    auth: {
      signInWithPassword: async () => { fake.calls.push('password'); return { data: { user: null, session: null }, error: null }; },
      signUp: async () => { fake.calls.push('signUp'); return { data: { user: null, session: null }, error: null }; },
      setSession: async () => { fake.calls.push('setSession'); return { data: { user: null, session: null }, error: null }; }
    },
    functions: { invoke: async (name: string, o: { body: unknown }) => { fake.invoked.push({ name, body: o.body }); return fake.reply; } }
  }
}));

/** An access token whose `sub` is this id, as Supabase signs them (only the claims are read here). */
const tokenFor = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;

beforeEach(() => { fake.local = null; fake.calls = []; fake.invoked = []; fake.reply = { data: null, error: null }; });

describe('signing in while someone let in offline holds the phone', () => {
  it('lets anyone sign in on a phone with no local person, or with only a leftover ask', async () => {
    const auth = await import('../src/server/auth');
    await auth.signInWithPassword('a@b.c', 'pw');
    fake.local = person({ stage: 'asking' });
    await auth.setSession({ access_token: tokenFor('akol'), refresh_token: 'r' });
    expect(fake.calls).toEqual(['password', 'setSession']);
  });

  it('refuses a password, a new account and another id\'s session from the grant on, and asks the server nothing', async () => {
    const auth = await import('../src/server/auth');
    for (const stage of ['filling', 'ready', 'joined', 'done'] as const) {
      fake.local = person({ stage, profileId: 'newcomer-1' });
      await expect(auth.signInWithPassword('a@b.c', 'pw')).rejects.toBeInstanceOf(auth.LocalPersonHere);
      await expect(auth.signUp('a@b.c', 'pw')).rejects.toBeInstanceOf(auth.LocalPersonHere);
      await expect(auth.setSession({ access_token: tokenFor('akol'), refresh_token: 'r' })).rejects.toBeInstanceOf(auth.LocalPersonHere);
      await expect(auth.setSession({ access_token: 'not a token', refresh_token: 'r' })).rejects.toBeInstanceOf(auth.LocalPersonHere);
    }
    expect(fake.calls).toEqual([]);
  });

  it('takes a session for the local person\'s own id: first contact, or a helper\'s code made for them', async () => {
    const auth = await import('../src/server/auth');
    fake.local = person({ stage: 'ready', profileId: 'newcomer-1' });
    await auth.setSession({ access_token: tokenFor('newcomer-1'), refresh_token: 'r' });
    expect(fake.calls).toEqual(['setSession']);
  });
});

describe('a helper\'s code on a phone a local person holds', () => {
  const host = { acceptTerms: async () => undefined, toast: () => undefined, isDev: false };
  const CODE = 'c'.repeat(64);

  it('names the local person, so the server refuses a code made for anyone else before taking it', async () => {
    const { signInWithKey } = await import('../src/auth/signInFlow');
    fake.local = person({ stage: 'joined', profileId: '7f0e7ae2-0000-4000-8000-000000000001' });
    fake.reply = {
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
        name: 'FunctionsHttpError', context: new Response(JSON.stringify({ error: 'This code was made for someone else.' }), { status: 403 })
      })
    };
    const result = await signInWithKey(CODE, host);
    expect(fake.invoked).toEqual([{ name: 'sign-in-code', body: { code: CODE, profileId: '7f0e7ae2-0000-4000-8000-000000000001' } }]);
    const { t } = await import('../src/i18n');
    expect(result).toEqual({ kind: 'error', text: t('entry.signInKey.forSomeoneElse') });
    expect(fake.calls).toEqual([]);
  });

  it('sends the code alone for everyone else, as before', async () => {
    const { signInWithKey } = await import('../src/auth/signInFlow');
    fake.local = person({ stage: 'asking' });
    fake.reply = { data: { session: { access_token: tokenFor('someone'), refresh_token: 'r' }, signInName: 's', helper: null }, error: null };
    await signInWithKey(CODE, host);
    expect(fake.invoked).toEqual([{ name: 'sign-in-code', body: { code: CODE } }]);
  });
});
