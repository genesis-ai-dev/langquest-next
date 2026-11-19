// Edit Profile's email reaching the server (LAN-304): setAccountEmail calls the
// change-email function, renews the session so the app sees the new address,
// and finds this phone's lock by it; a refusal comes back as the function's code.
const fake = vi.hoisted(() => ({
  calls: [] as string[],
  reply: null as null | { data: unknown; error: unknown }
}));

vi.mock('../src/server/auth', () => ({
  changeEmail: async (email: string) => { fake.calls.push(`change ${email}`); return fake.reply ?? { data: { email }, error: null }; },
  refreshSignIn: async () => { fake.calls.push('refresh'); return { data: {}, error: null }; },
  choosePassword: async () => ({ error: null }),
  signOutHere: async () => undefined
}));
vi.mock('../src/server/lock', () => ({
  LOCKS_ON_SIGN_OUT: true,
  lockAndSignOut: async () => undefined,
  rememberPassword: async () => undefined,
  setLockPattern: async () => ({ kind: 'ok' }),
  rememberAddress: async (actorId: string, address: string) => { fake.calls.push(`lock ${actorId} ${address}`); }
}));
vi.mock('../src/web/forgetBrowser', () => ({ signOutAndForget: async () => undefined }));
vi.mock('../src/notifications/notifications', () => ({ tryUnregisterNotifications: async () => true, unregisterNotifications: async () => undefined }));
vi.mock('../src/sync/handOver', () => ({ HANDS_OVER: false, signOutHandingOver: async () => undefined }));

import { setAccountEmail } from '../src/account/accountAuth';

/** What supabase-js gives back for a function's non-2xx reply: the Response as `context`. */
const refused = (status: number, body: unknown) => ({
  data: null,
  error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { name: 'FunctionsHttpError', context: new Response(JSON.stringify(body), { status }) })
});

beforeEach(() => { fake.calls.length = 0; fake.reply = null; });

describe('saving a new email', () => {
  it('saves it on the server, then renews the session and moves the lock to it', async () => {
    expect(await setAccountEmail('akol', 'akol@example.org')).toBeNull();
    expect(fake.calls).toEqual(['change akol@example.org', 'refresh', 'lock akol akol@example.org']);
  });

  it('a refusal is the function\'s code, and changes nothing here', async () => {
    fake.reply = refused(409, { error: 'Another account already uses this email.', code: 'email_exists' });
    expect(await setAccountEmail('akol', 'mary@example.org')).toEqual({ code: 'email_exists', message: 'Another account already uses this email.' });
    expect(fake.calls).toEqual(['change mary@example.org']);
  });

  it('no connection is `offline`, and a reply this build cannot read is `unknown`', async () => {
    fake.reply = { data: null, error: Object.assign(new Error('Failed to send a request to the Edge Function'), { name: 'FunctionsFetchError' }) };
    expect((await setAccountEmail('akol', 'akol@example.org'))?.code).toBe('offline');
    fake.reply = refused(500, 'not json');
    expect((await setAccountEmail('akol', 'akol@example.org'))?.code).toBe('unknown');
  });
});
