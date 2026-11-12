/**
 * The `sub` of an access token, for a check every client makes at sign-in (server/auth.ts), apart
 * from firstContactModel.ts so the web, which never has a local person, need not load that (the
 * web budget, decision 232). Pure.
 */

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The `sub` of a Supabase access token, or null: a session is adopted only when it is this very id. */
export function tokenSubject(jwt: string): string | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const claims = JSON.parse(globalThis.atob(padded)) as unknown;
    return isObject(claims) && typeof claims['sub'] === 'string' ? claims['sub'] : null;
  } catch {
    return null;
  }
}

