/**
 * App starts from the sign-in saved on the phone (decision 87). Since the
 * session moved to the Keychain and Keystore (decision 60, amended
 * 2026-10-15), it is no longer in AsyncStorage after its first read, so app
 * start must read it where supabase-js keeps it. Reading AsyncStorage showed
 * Sign In to anyone who opened the app offline an hour after their last
 * connection, though nobody had signed out.
 */
const fake = vi.hoisted(() => ({ secure: new Map<string, string>(), legacy: new Map<string, string>() }));

vi.mock('../src/server/supabase', () => ({ SESSION_KEY: 'sb-key', signOutHere: async () => undefined, supabase: {}, supabaseConfigError: null }));
vi.mock('../src/server/secureStorage', async () => {
  const { secureKeyValue } = await import('../src/server/secureStorageModel');
  return {
    secureStorage: secureKeyValue(
      { get: async (k) => fake.secure.get(k) ?? null, set: async (k, v) => { fake.secure.set(k, v); }, delete: async (k) => { fake.secure.delete(k); } },
      { getItem: async (k) => fake.legacy.get(k) ?? null, removeItem: async (k) => { fake.legacy.delete(k); } }
    )
  };
});

it('finds the saved sign-in at every start, after it has moved out of AsyncStorage', async () => {
  const { savedSignIn } = await import('../src/server/auth');
  fake.legacy.set('sb-key', '{"access_token":"a"}');
  expect(await savedSignIn()).toBe('{"access_token":"a"}');
  // Moved on its first read: what the old app start read is gone.
  expect(fake.legacy.has('sb-key')).toBe(false);
  vi.resetModules();
  const again = await import('../src/server/auth');
  expect(await again.savedSignIn()).toBe('{"access_token":"a"}');
});
