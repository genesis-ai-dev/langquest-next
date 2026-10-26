// Global Viewer access, as the server reports it (`get_user_state`,
// decisions.md 158). Pure, so it can be tested.

/**
 * - `needs_setup`: granted, no authenticator yet.
 * - `needs_code`: an authenticator, but this sign-in has not entered a code.
 * - `on`: every organization may be read, as a Viewer.
 * - `revoked`: was a Global Viewer; access is over.
 */
export type GlobalViewerAccess = 'needs_setup' | 'needs_code' | 'on' | 'revoked';

const ACCESS: readonly GlobalViewerAccess[] = ['needs_setup', 'needs_code', 'on', 'revoked'];

/** The access in `get_user_state`'s answer; null for an account that is not a Global Viewer's. */
export function accessOf(userState: unknown): GlobalViewerAccess | null {
  const v = (userState as { globalViewer?: unknown } | null)?.globalViewer;
  return ACCESS.includes(v as GlobalViewerAccess) ? (v as GlobalViewerAccess) : null;
}

/** A code as typed ("123 456"), or null until it is six digits. */
export function codeOf(typed: string): string | null {
  const digits = typed.replace(/[\s-]/g, '');
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** An authenticator key in groups of four, for typing it in by hand. */
export function keyInGroups(secret: string): string {
  return secret.replace(/\s/g, '').replace(/(.{4})(?=.)/g, '$1 ');
}

/**
 * Global Viewer access applies only to an organization this phone has
 * folded (it exists), and adds Viewer's privilege to whatever the person
 * holds there as a member.
 */
export function viewsAsGlobalViewer(access: GlobalViewerAccess | null, orgExists: boolean): boolean {
  return access === 'on' && orgExists;
}

/** How many organizations a page of the list holds. */
export const ORGANIZATIONS_PAGE = 50;

/** Whether there may be another page: this one came back full. */
export function hasMore(page: readonly unknown[]): boolean {
  return page.length === ORGANIZATIONS_PAGE;
}

/** Whether the server turned a code down as wrong (rather than failing): Supabase says so by code, or by a 422. */
export function codeIsWrong(refused: { code?: string | undefined; status?: number | undefined }): boolean {
  return refused.code === 'mfa_verification_failed' || refused.status === 422;
}

/** The unfinished set-ups among an account's authenticators: an unverified authenticator app, which a new set-up replaces. */
export function unfinishedSetups(factors: readonly { id: string; type: string; status: string }[]): string[] {
  return factors.filter((f) => f.type === 'totp' && f.status === 'unverified').map((f) => f.id);
}
