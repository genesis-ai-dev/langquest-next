import { person } from './localPersonFixtures';
import type { LocalPerson } from '../src/session/localPersonModel';

/**
 * No other account signs in over someone let in offline (docs/nearby-sync-plan.md 14.1, 5). Why:
 * a local person's unsent work waits under their own id; another account's session on this phone
 * would leave it with nobody to send it, and their copy would be read as someone else's. Only a
 * session for the local person's own id goes on: first contact's, or a helper's code made for them.
 */

const fake = vi.hoisted(() => ({ local: null as LocalPerson | null, calls: [] as string[] }));

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
    }
  }
}));

/** An access token whose `sub` is this id, as Supabase signs them (only the claims are read here). */
const tokenFor = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;

beforeEach(() => { fake.local = null; fake.calls = []; });

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
