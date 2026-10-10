import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const headers = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const authorization = request.headers.get('Authorization') ?? '';
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false }
  });
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) return reply({ error: 'Sign in required' }, 401);
  const relayUrl = Deno.env.get('INVITE_RELAY_URL');
  const relaySecret = Deno.env.get('INVITE_RELAY_SECRET');
  if (!relayUrl || !relaySecret) return reply({ error: 'Email delivery is not configured. Share the QR or invite link instead.' }, 503);
  try {
    const { inviteId, token, email, locale } = await request.json();
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || typeof token !== 'string' || !/^[0-9a-f]{32,128}$/i.test(token)
      || typeof inviteId !== 'string') return reply({ error: 'Invalid invitation details' }, 400);
    const { data: invite, error } = await client.from('invites').select('*')
      .eq('id', inviteId).eq('issued_by', auth.user.id).single();
    if (error || !invite || invite.redeemed_by || new Date(invite.expires_at).getTime() <= Date.now()) {
      return reply({ error: 'This invite is unavailable' }, 403);
    }
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))]
      .map((b) => b.toString(16).padStart(2, '0')).join('');
    if (hash !== invite.token_hash) return reply({ error: 'This invite is unavailable' }, 403);
    const normalized = email.trim().toLowerCase();
    const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false }
    });
    // Bind one recipient to this single-use invite. Concurrent attempts cannot
    // use it to send to multiple addresses. A new recipient needs a new invite.
    const reserved = await service.from('invites').update({ email: normalized })
      .eq('id', inviteId).is('email', null);
    if (reserved.error) throw reserved.error;
    const row = await service.from('invites').select('email,email_sent_at').eq('id',inviteId).single();
    if (row.error) throw row.error;
    if (row.data.email !== normalized) return reply({ error: 'This invite already has an email recipient.' },409);
    if (row.data.email_sent_at) return reply({ sent: true });
    const response = await fetch(relayUrl, {
      method: 'POST', signal: AbortSignal.timeout(25_000),
      headers: { Authorization: `Bearer ${relaySecret}`, 'Content-Type':'application/json' },
      // The inviter's app language, so the email is in it (LAN-42); the Worker accepts only its own catalogs.
      body: JSON.stringify({ inviteId, orgId: invite.org_id, token,
        email: normalized, expiresAt: invite.expires_at,
        ...(typeof locale === 'string' && /^[a-z]{2,3}(-[A-Za-z]{4})?$/.test(locale) ? { locale } : {}) })
    });
    if (response.status === 409) return reply({ error: 'Delivery is pending or could not be confirmed. Check the recipient inbox or share the invite link.' },409);
    if (!response.ok) return reply({ error: 'Email delivery failed. Your QR and link still work. Please retry.' },502);
    const saved = await service.from('invites').update({ email_sent_at: new Date().toISOString() }).eq('id',inviteId);
    if (saved.error) throw saved.error;
    return reply({ sent: true });
  } catch {
    return reply({ error: 'Unable to send this invitation. Please retry.' },500);
  }
});
