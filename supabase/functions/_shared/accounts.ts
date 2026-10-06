/**
 * Looked-after accounts on the server side: the same rule as the app's
 * apps/mobile/src/accounts.ts (accountsParity.test.ts holds them together).
 * Pure, so the Edge Functions and the tests share it.
 */
export const MANAGED_DOMAIN = 'people.langquest.org';

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
