import { isSignInName, signInAddress } from './accounts';

/** Supabase Auth's refusal, as `authErrorText` reads it. */
export interface AuthRefusal { code?: string; name?: string; message?: string }

type Answer = { data: { user: { id: string } | null }; error: AuthRefusal | null };

/** What signing in needs: the server's calls (server/auth.ts, server/v2.ts), and the dev account when there is one. */
export interface SignInDeps {
  signInWithPassword: (email: string, password: string) => Promise<Answer>;
  setSession: (session: { access_token: string; refresh_token: string }) => Promise<Answer>;
  signInWithV2Account: (email: string, password: string) => Promise<{ session: { access_token: string; refresh_token: string } } | { code: string }>;
  /**
   * Dev on a local server: `npm run db:test` wipes auth users, so the dev
   * account is made again rather than stranding the developer at sign-in.
   * Answers whether it was (the email and password are the dev account's).
   */
  recreateDevAccount?: (email: string, password: string) => Promise<boolean>;
}

/** Signed in (the terms go to `userId`, AUTH-1), or refused with the reason to say and where, for diagnostics. */
export type SignInOutcome =
  | { kind: 'signed-in'; userId: string | null }
  | { kind: 'refused'; where: string; reason: AuthRefusal; raw: unknown };

/**
 * Sign in with one field, an email or a looked-after account's sign-in name
 * (accounts.ts), and a password. Someone who used LangQuest v2 is unknown
 * here until v2 says the email and password are theirs (docs/v2-import.md
 * section 3), so a wrong-password answer for an email asks v2 before saying so.
 */
export async function signIn(email: string, password: string, deps: SignInDeps): Promise<SignInOutcome> {
  let { data, error } = await deps.signInWithPassword(signInAddress(email), password);
  if (error && await deps.recreateDevAccount?.(email.trim(), password)) {
    ({ data, error } = await deps.signInWithPassword(email.trim(), password));
  }
  if (error?.code === 'invalid_credentials' && email.trim().includes('@')) {
    const v2 = await deps.signInWithV2Account(email, password);
    if ('session' in v2) {
      const moved = await deps.setSession(v2.session);
      // i18n-ignore: `where` labels diagnostics (noteExpected); people see `reason` through authErrorText
      if (moved.error) return { kind: 'refused', where: 'sign in with a v2 account', reason: moved.error, raw: moved.error };
      return { kind: 'signed-in', userId: moved.data.user?.id ?? null };
    }
    if (v2.code !== 'invalid_credentials') {
      return {
        // i18n-ignore: `where` labels diagnostics (noteExpected); people see `reason` through authErrorText
        kind: 'refused', where: 'sign in with a v2 account', raw: v2.code,
        reason: { code: v2.code, ...(v2.code === 'network' ? { name: 'AuthRetryableFetchError' } : {}) }
      };
    }
  }
  // A wrong password or no connection: the server's answer.
  // i18n-ignore: `where` labels diagnostics (noteExpected); people see `reason` through authErrorText
  if (error) return { kind: 'refused', where: 'sign in', reason: error, raw: error };
  return { kind: 'signed-in', userId: data.user?.id ?? null };
}

/** Whether Sign In can be pressed: an email or a sign-in name, and a password. */
export function signInReady(email: string, password: string): boolean {
  return (email.trim().includes('@') || isSignInName(email)) && password.length > 0;
}
