/**
 * The two kinds of account (docs/invites-and-accounts.md section 3). Pure,
 * so the sign-in screen, the session and the tests share one rule.
 *
 * A looked-after account belongs to someone with no email of their own. Its
 * address is `<sign-in name>@people.langquest.org`; nothing is delivered
 * there, and the server's `is_managed_email` uses the same domain.
 */
export const MANAGED_DOMAIN = 'people.langquest.org';

export function isManagedEmail(email: string | null | undefined): boolean {
  return !!email && email.trim().toLowerCase().endsWith(`@${MANAGED_DOMAIN}`);
}

/** What Sign In sends: an email as typed, or a sign-in name made into its address. */
export function signInAddress(input: string): string {
  const raw = input.trim().toLowerCase();
  return raw.includes('@') ? raw : `${raw}@${MANAGED_DOMAIN}`;
}

/** The sign-in name of a looked-after account, or null for an own-email account. */
export function signInName(email: string | null | undefined): string | null {
  return isManagedEmail(email) ? email!.trim().toLowerCase().split('@')[0]! : null;
}

/**
 * A readable sign-in name from a person's name: lower-case letters and
 * digits joined by dashes, then three digits so two Nyibols never collide
 * (`nyibol-deng-482`). Names in other scripts keep only what is ASCII;
 * nothing left gives `member`.
 */
export function makeSignInName(name: string, digits: number): string {
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
    .replace(/-+$/g, '');
  return `${base || 'member'}-${String(Math.abs(Math.trunc(digits)) % 1000).padStart(3, '0')}`;
}

/** A sign-in name a person could type back: what makeSignInName produces, or older hand-made ones. */
export function isSignInName(input: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,40}$/.test(input.trim().toLowerCase());
}

/**
 * The name to save for an account with no profile name, or null when it has
 * one. Members see each other by profile name (decisions.md 47); without one
 * they see a placeholder ("Purple Hexagon"). An account made with an email
 * and password gets no name at sign-up, so joining by invite left it unnamed.
 * Its email's local part is the name, as Create Organization gives it.
 */
export function profileNameToSave(saved: string | null | undefined, email: string | null | undefined): string | null {
  if (saved?.trim()) return null;
  const local = email?.trim().split('@')[0]?.trim();
  return local ? local.slice(0, 100) : null;
}
