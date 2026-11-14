import { headers, reply, serviceClient, sha256Hex, signInAs } from '../_shared/session.ts';

/**
 * Forgot password (docs/invites-and-accounts.md flow G, decisions.md 200).
 * Called signed out, in two steps:
 *
 * - `{ email, locale }`: someone asks on Sign In. When the address is an
 *   account's own email, a one-time code is kept by its hash
 *   (password_reset_begin) and the email Worker sends a link holding it, in
 *   the language the app showed. The answer is the same whether or not the
 *   address has an account here, so nobody learns who uses LangQuest by
 *   typing addresses. An address unknown here may be someone from LangQuest
 *   v2 who has not signed in to this app yet: v2 is asked to send its own
 *   reset email, as its app would, and they sign in here with the password
 *   they choose there (docs/v2-import.md section 3).
 * - `{ code, password, lost? }`: the link was opened and a new password typed. The
 *   code is taken once (given back if the password could not be set), the
 *   password is set, and the person is signed in. Setting a password ends the
 *   account's other sessions (Supabase Auth does this); their work waits on
 *   those phones until they sign in there again.
 *
 * Replies carry `code` for the app (authErrorText reads the same codes as
 * Supabase Auth's), and English words for anyone reading a log.
 */

/** How long a link works: the migration's interval, said in the email. */
const MINUTES = 60;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const CODE = /^[0-9a-f]{64}$/i;
const LOCALE = /^[a-z]{2,3}(-[A-Za-z]{4})?$/;
const BUSY = { error: 'Unable to do this right now. Please retry.', code: 'unavailable' };

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return reply({ error: 'Invalid request', code: 'validation_failed' }, 400); }
  if (!body || typeof body !== 'object') return reply({ error: 'Invalid request', code: 'validation_failed' }, 400);
  if ('code' in body) return await choose(body.code, body.password, body.lost);
  return await ask(request, body.email, body.locale);
});

/** Send a link to choose a new password, when the address is an account's own email. */
async function ask(request: Request, email: unknown, locale: unknown): Promise<Response> {
  if (typeof email !== 'string' || email.trim().length > 254 || !EMAIL.test(email.trim())) {
    return reply({ error: 'Type the email address you sign in with.', code: 'validation_failed' }, 400);
  }
  const relayUrl = Deno.env.get('INVITE_RELAY_URL');
  const relaySecret = Deno.env.get('INVITE_RELAY_SECRET');
  if (!relayUrl || !relaySecret) return reply({ error: 'Email delivery is not configured.', code: 'unavailable' }, 503);
  const address = email.trim().toLowerCase();
  const service = serviceClient();
  const code = newCode();
  const hash = await sha256Hex(code);
  const begun = await service.rpc('password_reset_begin', { p_email: address, p_ip: callerAddress(request), p_code_hash: hash });
  if (begun.error) return reply(BUSY, 503);
  const row = (begun.data as { outcome: string; profile_id: string | null }[] | null)?.[0];
  if (!row) return reply(BUSY, 503);
  if (row.outcome === 'email' || row.outcome === 'address' || row.outcome === 'busy') {
    return reply({ error: 'Too many tries. Wait a while and retry.', code: 'over_request_rate_limit' }, 429);
  }
  if (row.outcome === 'none') {
    await askV2(address);
    return reply({ sent: true });
  }

  // A run for field diagnostics (diag.jobs `password_reset_email`): sent or
  // failed and the email service's code; never the address or the code.
  const started = Date.now();
  const record = (outcome: 'ok' | 'error', n: Record<string, number>, errorClass: string | null = null) => {
    service.rpc('diag_job_ingest', {
      p_job: 'password_reset_email', p_started_at: new Date(started).toISOString(), p_ms: Date.now() - started,
      p_outcome: outcome, p_n: n, p_error_class: errorClass
    }).then(() => {}, () => {});
  };
  let failure: string | null = null;
  try {
    const response = await fetch(new URL('/send-reset', relayUrl), {
      method: 'POST', signal: AbortSignal.timeout(25_000),
      headers: { Authorization: `Bearer ${relaySecret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: address, code, expiresAt: new Date(Date.now() + MINUTES * 60_000).toISOString(),
        // The language the app showed, so the email is in it (LAN-42); the Worker accepts only its own catalogs.
        ...(typeof locale === 'string' && LOCALE.test(locale) ? { locale } : {})
      })
    });
    if (!response.ok) {
      failure = await response.json().then((b: { code?: unknown }) => typeof b?.code === 'string' ? b.code : null, () => null) ?? `http${response.status}`;
    }
  } catch {
    failure = 'unreached';
  }
  if (failure) {
    // A code nobody was sent never works.
    await service.rpc('password_reset_drop', { p_code_hash: hash });
    record('error', { failed: 1 }, failure);
    return reply({ error: 'The email could not be sent. Please retry.', code: 'unavailable' }, 502);
  }
  record('ok', { sent: 1 });
  return reply({ sent: true });
}

/**
 * Set the new password with the code from the link, and sign the person in. With `lost`
 * ("A phone of mine was lost or taken", which builds before nearby sync never send), the
 * person's nearby install keys are revoked first (docs/nearby-sync-plan.md section 6): the
 * authority is the mailbox, not a session, so a taken phone cannot use it against its
 * owner's new phone. A failure gives the code back so the person can retry.
 */
async function choose(code: unknown, password: unknown, lost: unknown): Promise<Response> {
  if (typeof code !== 'string' || !CODE.test(code)) return reply({ error: 'This link is not valid.', code: 'expired' }, 400);
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    return reply({ error: 'Choose a password of 6 or more characters.', code: 'weak_password' }, 400);
  }
  const hash = await sha256Hex(code.toLowerCase());
  const service = serviceClient();
  const taken = await service.rpc('password_reset_take', { p_code_hash: hash });
  if (taken.error) return reply(BUSY, 503);
  const row = (taken.data as { profile_id: string; email: string }[] | null)?.[0];
  if (!row) return reply({ error: 'This link has expired or was already used. Ask for a new one.', code: 'expired' }, 410);
  if (lost === true) {
    const revoked = await service.rpc('revoke_install_keys', { p_profile: row.profile_id, p_by: 'New password: a phone was lost or taken' });
    if (revoked.error) {
      await service.rpc('password_reset_release', { p_code_hash: hash });
      return reply(BUSY, 503);
    }
  }
  const updated = await service.auth.admin.updateUserById(row.profile_id, { password });
  if (updated.error) {
    await service.rpc('password_reset_release', { p_code_hash: hash });
    const weak = updated.error.code === 'weak_password' || updated.error.status === 422;
    return weak
      ? reply({ error: 'Choose a stronger password.', code: 'weak_password' }, 400)
      : reply({ error: 'The new password could not be saved. Please retry.', code: 'unavailable' }, 502);
  }
  // The password is set from here on. Without a session the phone signs in with it.
  try {
    return reply({ session: await signInAs(service, row.email), email: row.email, userId: row.profile_id });
  } catch {
    return reply({ email: row.email, userId: row.profile_id });
  }
}

/**
 * Someone from LangQuest v2 who has not signed in here yet has no account
 * here: v2 sends its own reset email, as its app's Forgot password does. v2
 * answers the same whether or not it knows the address. Only production
 * reaches v2; best effort, never holding up the answer for long.
 */
async function askV2(address: string): Promise<void> {
  const url = Deno.env.get('V2_SUPABASE_URL');
  const key = Deno.env.get('V2_SUPABASE_ANON_KEY');
  if (!url || !key) return;
  try {
    await fetch(`${url}/auth/v1/recover`, {
      method: 'POST', signal: AbortSignal.timeout(10_000),
      headers: { apikey: key, 'content-type': 'application/json' }, body: JSON.stringify({ email: address })
    });
  } catch { /* v2 unreachable: nothing more to do */ }
}

/** 32 random bytes as hex, like an invite's token: the code the link carries. */
function newCode(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Who is asking, as the platform's proxy saw them: Cloudflare's header, else the first forwarded address. */
function callerAddress(request: Request): string | null {
  const ip = request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0];
  return ip?.trim().slice(0, 64) || null;
}
