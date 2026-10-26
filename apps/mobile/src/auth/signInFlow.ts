// The ways in, once each (AUTH-1): sign in, create an account, sign in with a
// code. Each times itself, tells diagnostics, accepts the terms for the
// account it made or signed in, and answers what the screen shows. The
// screen calls these through `useAuthStep` (useSignIn.ts).
import { authErrorText, signInCodeErrorText } from '../account/accountText';
import { recordAuth, recordAuthFailure, since } from '../diagnostics/authDiag';
import { failureMessage, noteExpected, reportError } from '../diagnostics/report';
import { t } from '../i18n';
import { inviteOutcome } from '../invites/inviteOutcome';
import { redeemSignInCode } from '../invites/invites';
import { setSession, signInWithPassword, signUp } from '../server/auth';
import { rememberPassword } from '../server/lock';
import { recreateDevAccount } from '../server/personas';
import { signInWithV2Account } from '../server/v2';
import { recordHelp } from './signInHelp';
import { signIn } from './signIn';
import { signInAddress } from './accounts';
import { signBackIn } from './signBackIn';

/** What a screen shows after trying to get in: the words for a refusal, done, or an address to confirm first. */
export type AuthResult = { kind: 'error'; text: string } | { kind: 'done' } | { kind: 'check-email' };

/** What a way in needs from the app around it. */
export interface AuthHost {
  /** Queue the terms for this account (AUTH-1); the account outbox delivers and retries. */
  acceptTerms: (userId: string) => Promise<void>;
  toast: (text: string) => void;
  isDev: boolean;
}

/** Queue the terms for this account; a failure to queue is a fault, reported, never a reason to block sign-in. */
async function recordTerms(host: AuthHost, userId: string): Promise<void> {
  try {
    await host.acceptTerms(userId);
  } catch (e) {
    host.toast(failureMessage('accept terms', e));
  }
}

/** Email or sign-in name and password. Signing in accepts the terms (the session the screen was given is the guest's, so the terms go to the account that just signed in). */
export async function signInWithEmail(email: string, password: string, host: AuthHost): Promise<AuthResult> {
  const started = Date.now();
  try {
    // Signed out of this phone before: the password opens the lock, with no connection (decisions.md 168).
    const local = await signBackIn('password', password, { address: signInAddress(email) });
    if (local.kind === 'ok') return { kind: 'done' };
    if (local.kind === 'wait') return { kind: 'error', text: t('entry.lock.wait') };
    const outcome = await signIn(email, password, {
      signInWithPassword, setSession, signInWithV2Account, ...(host.isDev ? { recreateDevAccount } : {})
    });
    // A wrong password or no connection: the server's answer, said in the language showing.
    if (outcome.kind === 'refused') {
      noteExpected(outcome.where, outcome.raw);
      recordAuthFailure('sign_in', outcome.reason, { ms: since(started) });
      // Offline after a password the lock here did not take: it was wrong, whatever the connection.
      const offlineWrong = local.kind === 'wrong' && outcome.reason.name === 'AuthRetryableFetchError';
      return { kind: 'error', text: offlineWrong ? t('entry.errors.wrongPassword') : authErrorText(outcome.reason, t('entry.signIn.failed')) };
    }
    recordAuth('sign_in', 'ok', { n: { ms: since(started) } });
    // Next time, this password signs them back in here with no connection.
    if (outcome.userId) void rememberPassword(outcome.userId, signInAddress(email), password);
    if (outcome.userId) await recordTerms(host, outcome.userId);
    return { kind: 'done' };
  } catch (e) {
    recordAuthFailure('sign_in', e, { ms: since(started) });
    return { kind: 'error', text: failureMessage('sign in', e) };
  }
}

/**
 * Create an account. With a session the terms are recorded now and the app
 * routes on by itself; without one the address has to be confirmed first,
 * and signing in records them.
 */
export async function createAccountWithEmail(email: string, password: string, host: AuthHost): Promise<AuthResult> {
  const started = Date.now();
  try {
    const { data, error } = await signUp(email.trim(), password);
    if (error) {
      noteExpected('sign up', error);
      recordAuthFailure('sign_up', error, { ms: since(started) });
      return { kind: 'error', text: authErrorText(error, t('entry.createAccount.failed')) };
    }
    recordAuth('sign_up', 'ok', { n: { ms: since(started) } });
    if (data.session && data.user) {
      await recordTerms(host, data.user.id);
      return { kind: 'done' };
    }
    return { kind: 'check-email' };
  } catch (e) {
    recordAuthFailure('sign_up', e, { ms: since(started) });
    return { kind: 'error', text: failureMessage('sign up', e) };
  }
}

/** Sign in with a code a teammate made on a phone that is signed in (the function's reply is English: said in the language showing). */
export async function signInWithKey(code: string, host: AuthHost): Promise<AuthResult> {
  const started = Date.now();
  try {
    const help = await redeemSignInCode(code);
    const { data, error } = await setSession(help.session);
    if (error) {
      noteExpected('sign in with code', error);
      recordAuthFailure('code', error, { ms: since(started) });
      return { kind: 'error', text: authErrorText(error, t('entry.signInKey.failed')) };
    }
    recordAuth('code', 'ok', { n: { ms: since(started) } });
    if (data.user) {
      await recordHelp(data.user.id, help.helper).catch((e: unknown) => { reportError('record sign-in help', e); });
      await host.acceptTerms(data.user.id).catch((e: unknown) => { reportError('accept terms', e); });
    }
    host.toast(help.oldPhoneSignedOut ? t('entry.signInKey.signedInOldPhone')
      : help.helper ? t('entry.signInKey.signedInWith', { name: help.helper }) : t('entry.signInKey.signedIn'));
    return { kind: 'done' };
  } catch (e) {
    noteExpected('sign-in code', e);
    // The function says "expired or already used" in its reply, as an invite does.
    recordAuthFailure('code', e, { ms: since(started) }, inviteOutcome);
    return { kind: 'error', text: e instanceof Error ? signInCodeErrorText(e.message) : t('common.tryWhenConnected') };
  }
}
