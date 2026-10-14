import type { ListedOrganization } from '../accountData';

/**
 * The organizations Request Access lists for what was typed: those on the
 * phone whose name, or a language they list, holds it, then any more the
 * server found for the same words (the phone has only the first 500 by
 * name), in name order. Offline, the phone's alone.
 */
export function matchOrganizations(listed: ListedOrganization[], query: string, found: { query: string; list: ListedOrganization[] }): ListedOrganization[] {
  if (!query) return listed;
  const here = listed.filter((o) => o.name.toLowerCase().includes(query) || o.languages.some((l) => l.toLowerCase().includes(query)));
  const there = found.query === query ? found.list.filter((o) => !here.some((h) => h.org_id === o.org_id)) : [];
  return there.length ? [...here, ...there].sort((a, b) => a.name.localeCompare(b.name)) : here;
}

/** The shortest password Create Account takes. */
export const MIN_PASSWORD = 6;

/** Whether Create Account can be pressed: an email, and a password of 6 or more typed twice alike (AUTH-020). */
export function createAccountReady(email: string, password: string, confirm: string): boolean {
  return email.trim().includes('@') && password.length >= MIN_PASSWORD && password === confirm;
}
