// A blue check's code by email (decisions.md 172, docs/verified-organizations.md).
// An admin of an organization names its domain and an address at it; the
// database makes a 6-digit code for them (org_verification_begin, service
// role only, so no client ever holds a code it was not emailed), and the
// invite-email Worker sends it. The app then confirms it with
// org_verification_confirm, as the person.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { reply, headers, serviceClient } from '../_shared/session.ts';

/** What the database answers instead of a code, and the status the app gets for it. */
const REFUSED: Record<string, number> = {
  not_allowed: 403, bad_domain: 400, public_domain: 400, bad_email: 400, email_not_at_domain: 400,
  already_verified: 409, waiting: 409, too_soon: 429, too_many: 429
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } }, auth: { persistSession: false }
  });
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) return reply({ error: 'Sign in required', reason: 'sign_in' }, 401);
  // The invite relay's address names its invite route; the code route sits beside it on the same Worker.
  const inviteRelay = Deno.env.get('INVITE_RELAY_URL');
  const relaySecret = Deno.env.get('INVITE_RELAY_SECRET');
  if (!inviteRelay || !relaySecret) return reply({ error: 'Email delivery is not configured.', reason: 'no_email' }, 503);
  const relayUrl = inviteRelay.replace(/\/send-invite$/, '/send-code');
  let body: { orgId?: unknown; domain?: unknown; email?: unknown; locale?: unknown };
  try { body = await request.json(); } catch { return reply({ error: 'Invalid request', reason: 'bad_request' }, 400); }
  const { orgId, domain, email, locale } = body;
  if (typeof orgId !== 'string' || !orgId || orgId.length > 200 || typeof domain !== 'string' || domain.length > 253
    || typeof email !== 'string' || email.length > 254) return reply({ error: 'Invalid request', reason: 'bad_request' }, 400);
  const service = serviceClient();
  const started = Date.now();
  // A run for field diagnostics (diag.jobs `verification_email`): sent or failed and the email service's code,
  // with the organization's id; never the address or the code. Never holds up or fails the send.
  const record = (outcome: 'ok' | 'error', n: Record<string, number>, errorClass: string | null = null) => {
    service.rpc('diag_job_ingest', {
      p_job: 'verification_email', p_started_at: new Date(started).toISOString(), p_ms: Date.now() - started,
      p_outcome: outcome, p_n: n, p_error_class: errorClass, p_org: orgId
    }).then(() => {}, () => {});
  };
  try {
    const { data, error } = await service.rpc('org_verification_begin', { p_actor: auth.user.id, p_org: orgId, p_domain: domain, p_email: email });
    if (error) throw error;
    const begun = data as { ok: boolean; reason?: string; requestId?: string; code?: string; email?: string; domain?: string; orgName?: string; expiresAt?: string };
    if (!begun.ok) return reply({ error: 'Not sent', reason: begun.reason ?? 'refused' }, REFUSED[begun.reason ?? ''] ?? 400);
    const response = await fetch(relayUrl, {
      method: 'POST', signal: AbortSignal.timeout(25_000),
      headers: { Authorization: `Bearer ${relaySecret}`, 'Content-Type': 'application/json' },
      // The admin's app language, so the email is in it; the Worker accepts only its own catalogs.
      body: JSON.stringify({ requestId: begun.requestId, email: begun.email, code: begun.code, orgName: begun.orgName,
        domain: begun.domain, expiresAt: begun.expiresAt,
        ...(typeof locale === 'string' && /^[a-z]{2,3}(-[A-Za-z]{4})?$/.test(locale) ? { locale } : {}) })
    });
    if (!response.ok) {
      const code = await response.json().then((b: { code?: unknown }) => typeof b?.code === 'string' ? b.code : null, () => null);
      record('error', { failed: 1 }, code ?? `http${response.status}`);
      return reply({ error: 'Email delivery failed', reason: 'send_failed' }, 502);
    }
    record('ok', { sent: 1 });
    return reply({ sent: true, email: begun.email, expiresAt: begun.expiresAt });
  } catch {
    record('error', { failed: 1 }, 'exception');
    return reply({ error: 'Unable to send the code', reason: 'send_failed' }, 500);
  }
});
