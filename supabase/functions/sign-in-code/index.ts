import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

/**
 * A looked-after person uses a sign-in key from their steward to choose a
 * new password (docs/invites-and-accounts.md flow F). Called signed out:
 * holding the key is the permission, as holding an invite is. The key is
 * taken once (`take_sign_in_code`), and given back if the password could
 * not be set, so a failed attempt can be repeated.
 *
 * Returns the person's sign-in name; the phone then signs in with it and
 * the new password like anyone else.
 */
const headers = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  let code: unknown, password: unknown;
  try { ({ code, password } = await request.json()); } catch { return reply({ error: 'Invalid request' }, 400); }
  if (typeof code !== 'string' || !/^[0-9a-f]{64}$/i.test(code)) return reply({ error: 'This code is not valid.' }, 400);
  if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
    return reply({ error: 'Choose a password of 6 or more characters.' }, 400);
  }
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.toLowerCase())))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const service = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false }
  });
  const taken = await service.rpc('take_sign_in_code', { p_code_hash: hash });
  if (taken.error) return reply({ error: 'Unable to use this code. Please retry.' }, 500);
  const row = (taken.data as { profile_id: string; email: string }[] | null)?.[0];
  if (!row) return reply({ error: 'This code has expired or was already used. Ask for a new one.' }, 410);
  const updated = await service.auth.admin.updateUserById(row.profile_id, { password });
  if (updated.error) {
    await service.rpc('release_sign_in_code', { p_code_hash: hash });
    return reply({ error: 'The new password could not be saved. Please retry.' }, 502);
  }
  return reply({ signInName: row.email.split('@')[0] });
});
