import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { sessionStorageKey } from './sessionKey';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Why this build cannot reach a server, or null when it can.
 *
 * `EXPO_PUBLIC_*` is inlined at bundle time, so a build made without those
 * values has them `undefined` here forever; an EAS build never sees `.env`
 * because it is gitignored. This used to `throw` at module scope, which is
 * the worst possible way to say so: the import fails, `registerRootComponent`
 * never runs, and the release app is a white screen with nothing to read.
 * Report it as a value and let `App` put it on the screen. The one release
 * build allowed a local server is `npm run export:web -- development`, which
 * sets EXPO_PUBLIC_LOCAL_RELEASE for the web smoke test against a local stack.
 */
export const supabaseConfigError: string | null = !url || !anon
  // i18n-ignore: for the developer who made the build (it names env vars); computed before any language is chosen
  ? 'This build has no server configuration. EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY were not set when it was built (see apps/mobile/.env.example).'
  : !__DEV__ && process.env.EXPO_PUBLIC_LOCAL_RELEASE !== '1' && /^https?:\/\/(127\.0\.0\.1|localhost|10\.0\.2\.2|192\.168\.)/.test(url)
    // i18n-ignore: for the developer who made the build (a local server URL in a device build)
    ? `This build points at ${url}, which only exists on a developer machine. A device build needs the hosted Supabase URL.`
    : null;

/** Where Storage objects live, for native uploads that bypass the JS heap. */
export const supabaseUrl = url ?? 'https://unconfigured.invalid';
export const supabaseAnonKey = anon ?? 'unconfigured';

/** Where the session is kept (sessionKey.ts). */
export const SESSION_KEY = sessionStorageKey(supabaseUrl);

// A placeholder keeps `createClient` from throwing when the config is
// missing; nothing calls it, because App shows the error instead.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    storageKey: SESSION_KEY,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false
  }
});

/**
 * A client for someone signed out of this phone whose work is still to
 * go (decisions.md 60). Its session lives under `storageKey`, so a renewed
 * token is kept there and survives a restart; it renews only when used.
 */
export function clientKeptAt(storageKey: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { storage: AsyncStorage, storageKey, autoRefreshToken: false, persistSession: true, detectSessionInUrl: false }
  });
}
