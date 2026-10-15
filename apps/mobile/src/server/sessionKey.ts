/**
 * Where the session is kept: supabase-js's own default, named here so a
 * hand-over (handOver.ts) can move it to another key without a server call.
 * Changing it would sign everyone out. Its own module, so the test can
 * check it without loading the client and the build's settings.
 */
export function sessionStorageKey(serverUrl: string): string {
  return `sb-${new URL(serverUrl).hostname.split('.')[0]}-auth-token`;
}
