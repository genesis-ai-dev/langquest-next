// Edit Profile's email and password (LAN-304): pure, so its rules are tested
// on their own (test/profileModel.test.ts). The screen is
// screens/profileEdit.tsx; the server's side is supabase/functions/change-email.
import { isManagedEmail, signInName } from '../auth/accounts';
import { MIN_PASSWORD } from '../auth/model';
import { t } from '../i18n';

/** The change-email function's rule for an address (supabase/functions/change-email). */
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** What the email field starts with: an own email as it is; nothing for a looked-after account, whose address nobody can use. */
export function ownEmail(email: string | null): string {
  return email && !isManagedEmail(email) ? email : '';
}

/**
 * What Save does with the email field. `same`: nothing (the address the
 * account has, or still empty on an account with none). `change`: give the
 * account this address. `bad`: not an address this account can take (a
 * looked-after address is made by the server, never chosen). `empty`: an
 * own email was cleared; an account with one keeps one.
 */
export type EmailEdit = { kind: 'same' } | { kind: 'change'; address: string } | { kind: 'bad' } | { kind: 'empty' };

export function emailEdit(typed: string, current: string | null): EmailEdit {
  const address = typed.trim().toLowerCase();
  const own = ownEmail(current).trim().toLowerCase();
  if (address === own) return { kind: 'same' };
  if (!address) return { kind: 'empty' };
  if (address.length > 254 || !EMAIL.test(address) || isManagedEmail(address)) return { kind: 'bad' };
  return { kind: 'change', address };
}

/**
 * Must a password come with this email? Yes for an account with none of its
 * own (a looked-after account made by joining, `has_password` false): an
 * email ends helpers' codes for it (decision 59), so without a password an
 * address mistyped, and never proven, would leave no way back in.
 */
export function passwordRequired(edit: EmailEdit, hasPassword: boolean | null): boolean {
  return edit.kind === 'change' && hasPassword === false;
}

/**
 * Why Save cannot go ahead, or '' when it can. Save stays tappable so the
 * screen can say so, and nothing is written, name included (ACCT-019). A
 * password is typed twice, as on Create Account and New password.
 */
export function saveProblem(p: { edit: EmailEdit; password: string; confirm: string; hasPassword: boolean | null }): string {
  if (p.password && p.password.length < MIN_PASSWORD) return t('account.profile.shortPassword');
  if (p.password && p.confirm !== p.password) return t('entry.createAccount.mismatch');
  if (p.edit.kind === 'bad') return t('entry.errors.badEmail');
  if (p.edit.kind === 'empty') return t('account.profile.emailRequired');
  if (!p.password && passwordRequired(p.edit, p.hasPassword)) return t('account.profile.passwordWithEmail');
  return '';
}

/** Why the change-email function refused, from its code (setAccountEmail in accountAuth.ts). */
export function emailErrorText(code: string): string {
  switch (code) {
    case 'offline': return t('account.profile.emailNeedsConnection');
    case 'email_exists': return t('account.profile.emailTaken');
    case 'validation_failed': return t('entry.errors.badEmail');
    case 'session_not_found': return t('entry.errors.sessionEnded');
    case 'password_required': return t('account.profile.passwordWithEmail');
    default: return t('account.profile.emailFailed');
  }
}

/**
 * What the person signs in with, said under the password field: the address
 * being saved, else their own email, else their sign-in name (looked after),
 * which they should write down.
 */
export function signInLine(current: string | null, edit: EmailEdit): string {
  if (edit.kind === 'change') return t('account.profile.signInWithEmail', { email: edit.address });
  const own = ownEmail(current);
  if (own) return t('account.profile.signInWithEmail', { email: own });
  const name = signInName(current);
  return name ? t('account.profile.signInWith', { name }) : '';
}

/** The toast once everything is saved: what to sign in with, when a new password or email changed it. */
export function savedText(p: { current: string | null; edit: EmailEdit; password: boolean }): string {
  const address = p.edit.kind === 'change' ? p.edit.address : null;
  if (p.password) {
    const who = address ?? (ownEmail(p.current) || signInName(p.current));
    return who ? t('account.profile.savedWithPassword', { name: who }) : t('account.profile.saved');
  }
  return address ? t('account.profile.savedWithEmail', { email: address }) : t('account.profile.saved');
}
