/**
 * Why the phone heard SIGNED_OUT: the person chose it (Sign out, handing
 * the phone on, deleting the account), or the server ended the sign-in.
 * Only the second is worth a diagnostics record (`auth` op `ended`), with
 * Supabase Auth's code for it when renewing was refused. Pure, with no app
 * imports, so sessionSafeFetch.ts can tell it about a refusal.
 *
 * supabase-js tells its listeners about a sign-out before `signOut`
 * resolves, so a sign-out run inside `signingOutByChoice` is heard while
 * the flag is up.
 */

let chosen = 0;

/** Run a sign-out the person asked for. */
export async function signingOutByChoice<T>(run: () => Promise<T>): Promise<T> {
  chosen += 1;
  try {
    return await run();
  } finally {
    chosen -= 1;
  }
}

/** Whether a sign-out the person asked for is under way. */
export function signOutChosen(): boolean {
  return chosen > 0;
}

/** How long a refused renewal explains a sign-out that follows it. */
const REFUSAL_EXPLAINS_MS = 30_000;

let refusal: { code?: string; status: number; at: number } | null = null;

/** Supabase Auth refused to renew a sign-in; supabase-js signs out next. */
export function noteRefusal(code: string | undefined, status: number, now: number = Date.now()): void {
  refusal = { ...(code ? { code } : {}), status, at: now };
}

/** The refusal behind a sign-out just heard, if one came moments before; it is used once. */
export function takeRefusal(now: number = Date.now()): { code?: string; status: number } | null {
  const r = refusal;
  refusal = null;
  if (!r || now - r.at > REFUSAL_EXPLAINS_MS) return null;
  return r.code ? { code: r.code, status: r.status } : { status: r.status };
}
