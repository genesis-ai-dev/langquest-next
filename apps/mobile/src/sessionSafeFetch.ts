// i18n-ignore-file: HTTP plumbing; its strings are header names and error messages for the sync layer, never shown.
/**
 * The fetch every Supabase client on the phone uses (decision 87). Two
 * rules keep a person signed in through a long time offline and a moment
 * online:
 *
 * - Renewing the sign-in: supabase-js keeps the saved sign-in only when the
 *   network failed or the server answered 5xx; any other answer, with an
 *   expired token, deletes it. A 429 when many phones share one connection,
 *   or a web page from something between the phone and Supabase, is not the
 *   server saying the sign-in is over, so those reach supabase-js as a
 *   network failure and it tries again later. Only Supabase Auth's own
 *   error, with its code, ends a sign-in.
 * - Everything else: while the sign-in cannot be renewed, supabase-js sends
 *   requests with the public key, as no one, and the server answers "not a
 *   member". A person who still has a saved sign-in is offline for this,
 *   not refused, so such a request fails as a network failure would.
 *
 * Pure (no app imports), so the tests run it against supabase-js itself.
 */
export interface SessionSafeOptions {
  /** The project's public key: a request carrying it as its bearer is sent as no one. */
  anonKey: string;
  /** Whether this client's storage still holds a sign-in. */
  hasSavedSession: () => Promise<boolean>;
  /** The fetch underneath; the global one when left out. */
  base?: typeof fetch;
}

/** The message fetch failures carry, so OfflineError (supabaseTransport.ts) and supabase-js both read it as no network. */
export const NOT_RENEWED = 'Network request failed: the sign-in could not be renewed yet';

export function sessionSafeFetch(opts: SessionSafeOptions): typeof fetch {
  const base = opts.base ?? ((input, init) => fetch(input, init));
  return async (input, init) => {
    const url = urlOf(input);
    if (isRenewal(url)) {
      const res = await base(input, init);
      if (res.ok || await endsTheSignIn(res)) return res;
      throw new TypeError(`Network request failed: sign-in renewal answered ${res.status}`);
    }
    if (isData(url) && bearerOf(input, init) === opts.anonKey && await opts.hasSavedSession()) {
      throw new TypeError(NOT_RENEWED);
    }
    return base(input, init);
  };
}

/** Supabase Auth's own refusal: JSON with an error code, and not a rate limit or a timeout. */
async function endsTheSignIn(res: Response): Promise<boolean> {
  if (res.status === 408 || res.status === 429 || res.status >= 500) return false;
  try {
    const body = (await res.clone().json()) as { code?: unknown; error_code?: unknown } | null;
    return typeof body?.code === 'string' || typeof body?.error_code === 'string';
  } catch {
    return false;
  }
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isRenewal(url: string): boolean {
  return /\/auth\/v1\/token\?(.*&)?grant_type=refresh_token(&|$)/.test(url);
}

/** Requests that act as the person: the database, files and functions. Auth's own calls are left alone. */
function isData(url: string): boolean {
  return /\/(rest|storage|functions)\/v1\//.test(url);
}

function bearerOf(input: RequestInfo | URL, init: RequestInit | undefined): string | null {
  const headers = new Headers(init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined));
  const auth = headers.get('Authorization');
  return auth?.startsWith('Bearer ') ? auth.slice('Bearer '.length) : null;
}
