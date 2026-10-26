// Pure pieces of the organization screens (org.tsx): no React, no I/O, so
// they are tested on their own (test/orgModel.test.ts). The organization's
// own rules (who may grant what, a language's scope) are in orgAdmin.ts.
import { t } from '../i18n';
import { refusalKind } from '../diagnostics/refusalModel';

/** Why the listing could not be read or changed: the server's refusal (its words are a developer's English), or the connection. */
export function listingFailure(e: { code?: string }): string {
  return refusalKind(e) === 'not_allowed' ? t('org.listing.notAllowed') : t('common.tryWhenConnected');
}

/** Why the invite email was not sent, by the send-invite function's status (its own words are English). */
export function sendFailure(status: number): string {
  switch (status) {
    case 503: return t('org.invite.emailNotSetUp');
    case 409: return t('org.invite.emailPending');
    case 502: return t('org.invite.emailFailed');
    case 401: case 403: return t('org.invite.emailUnavailable');
    case 0: return t('common.tryWhenConnected');
    default: return t('org.invite.emailRetry');
  }
}

/** Why no sign-in code was made: the server's refusal (its words are a developer's English), or the connection. */
export function signInFailure(e: unknown): string {
  return e instanceof Error && /not allowed/i.test(e.message) ? t('org.signIn.notAllowed') : t('common.tryWhenConnected');
}

/** Enough of an email address to try sending to: something, an @, something with a dot. */
export function looksLikeEmail(address: string): boolean {
  return /\S+@\S+\.\S+/.test(address.trim());
}

/** The roles still in use, the most privileged first, then by name. */
export function liveRoles(roles: Record<string, { retired?: boolean; name: { value?: string | null }; privileges: { value?: readonly unknown[] | null } }> | undefined): { id: string; name: string; privileges: number }[] {
  return Object.entries(roles ?? {}).filter(([, r]) => !r.retired)
    .map(([id, r]) => ({ id, name: r.name.value || id, privileges: r.privileges.value?.length ?? 0 }))
    .sort((a, b) => b.privileges - a.privileges || a.name.localeCompare(b.name));
}
