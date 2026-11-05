import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.116.0';

/** What the phone needs to be signed in: it hands these to `supabase.auth.setSession`. */
export interface Tokens { access_token: string; refresh_token: string }

/**
 * Sign an account in without a password: Supabase's own one-time sign-in
 * token, made and used here, never sent anywhere (docs/invites-and-accounts.md).
 * Holding an invite or a helper's code is the permission; the caller checked it.
 */
export async function signInAs(service: SupabaseClient, email: string): Promise<Tokens> {
  const link = await service.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link.data?.properties?.hashed_token;
  if (link.error || !tokenHash) throw new Error(link.error?.message ?? 'no sign-in token');
  const anon = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const { data, error } = await anon.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  if (error || !data.session) throw new Error(error?.message ?? 'no session');
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
}

export const headers = { 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info' };
export const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function sha256Hex(text: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function serviceClient(): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}
