import { currentLanguage } from '../i18n';
import { passwordReset } from '../server/auth';
import { newPasswordBody } from './model';

/**
 * Forgot password (docs/invites-and-accounts.md flow G, decisions.md 200),
 * through the password-reset function. Both need a connection; a refusal is
 * a ResetError with the function's code, or `offline` when it was never
 * reached, which authErrorText and resetErrorText (accountText.ts) put into
 * words.
 */
export class ResetError extends Error {
  override name = 'ResetError';
  constructor(readonly code: string, message: string) { super(message); }
}

/** The tokens a phone signs in with (`setSession`). */
interface Tokens { access_token: string; refresh_token: string }

/**
 * Ask for a link to choose a new password, emailed in the language showing.
 * The function answers alike whether or not the address has an account.
 */
export async function askForResetLink(email: string): Promise<void> {
  await call({ email: email.trim(), locale: currentLanguage() });
}

/**
 * Set a new password with a link's code. Answers the account it is for and,
 * usually, a session to sign in with; without one, the phone signs in with
 * the email and the new password. With `lost`, the server first revokes the
 * person's nearby keys (docs/nearby-sync-plan.md section 6).
 */
export async function chooseNewPassword(code: string, password: string, lost = false): Promise<{ email: string; userId: string; session?: Tokens }> {
  return call(newPasswordBody(code, password, lost));
}

async function call<T>(body: Parameters<typeof passwordReset>[0]): Promise<T> {
  const { data, error } = await passwordReset(body);
  if (!error) return data as T;
  if ((error as { name?: string }).name === 'FunctionsFetchError') throw new ResetError('offline', error.message);
  const context = (error as { context?: unknown }).context as { json?: () => Promise<unknown> } | undefined;
  const reply = typeof context?.json === 'function'
    ? await context.json().catch(() => null) as { error?: unknown; code?: unknown } | null
    : null;
  throw new ResetError(typeof reply?.code === 'string' ? reply.code : 'unknown', typeof reply?.error === 'string' ? reply.error : error.message);
}
