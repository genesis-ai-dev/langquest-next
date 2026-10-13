import { supabase } from './supabase';

/**
 * Sign in with a LangQuest v2 account (docs/v2-import.md section 3). Sign In
 * asks this after this app turned the email and password down: the
 * `v2-sign-in` function checks them with v2 once and, when they are right,
 * makes this person's account here with their v2 id, so the work the import
 * brought over is already theirs. Answers the session to sign in with, or
 * the code of why not, for `authErrorText` to say.
 */
export async function signInWithV2Account(email: string, password: string): Promise<
  { session: { access_token: string; refresh_token: string } } | { code: string }
> {
  const { data, error } = await supabase.functions.invoke('v2-sign-in', { body: { email: email.trim(), password } });
  if (error) {
    const context = (error as { context?: Response }).context;
    const reply = context ? ((await context.json().catch(() => null)) as { code?: string } | null) : null;
    // No reply at all is a connection that failed: say so as Sign In does.
    return { code: reply?.code ?? (context ? 'unavailable' : 'network') };
  }
  const session = (data as { session?: { access_token: string; refresh_token: string } } | null)?.session;
  return session ? { session } : { code: 'unavailable' };
}
