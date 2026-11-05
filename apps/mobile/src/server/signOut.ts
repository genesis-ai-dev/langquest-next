import type { SupabaseClient } from '@supabase/supabase-js';
import { accessTokenFresh, savedSession } from '../session/authState';
import { signingOutByChoice } from '../session/signOutCause';

interface KeyValue {
  getItem(key: string): Promise<string | null>;
  removeItem(key: string): Promise<void>;
}

/**
 * Sign out of this device only (decision 87). The default, `global`, ended
 * the person's sign-in on every device, so signing out of a computer at a
 * workshop signed their phone out at its next moment online. While the
 * token is still good, the server is asked to end this one session; offline,
 * or with an expired token, nothing is asked, which used to fail after
 * half a minute of retries. Either way the phone forgets the sign-in and the
 * app hears SIGNED_OUT, as one the person chose (signOutCause.ts).
 */
export function signOutThisDevice(client: SupabaseClient, storage: KeyValue, key: string): Promise<void> {
  return signingOutByChoice(async () => {
    if (accessTokenFresh(savedSession(await storage.getItem(key)))) {
      // Online this ends the session on the server; offline supabase-js forgets it here and reports the network error.
      await client.auth.signOut({ scope: 'local' });
      if (await storage.getItem(key) === null) return;
    }
    await storage.removeItem(key);
    // Nothing stored now: this asks the server nothing, forgets the session in memory and tells the app.
    await client.auth.signOut({ scope: 'local' });
  });
}
