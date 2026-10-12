import { headers, reply, serviceClient, signInAs } from '../_shared/session.ts';

/**
 * Sign in with a LangQuest v2 account (docs/v2-import.md section 3). The
 * app calls this when this app does not know the email and password typed
 * on Sign In. v2 checks them once, through its own sign-in, as the old app
 * would; the session v2 hands back is signed out again at once, and nothing
 * else in v2 is touched. Then this app makes the account with the v2 id,
 * so everything the import brought over in that person's name is already
 * theirs, with the same email and password, and signs the phone in.
 *
 * An email this app already has under another id is not taken over: that
 * person signs in with their own password here, and brings their v2 work
 * from Settings.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The words the app already shows for a wrong email or password. */
const WRONG = { error: 'Invalid login credentials', code: 'invalid_credentials' };
const BUSY = { error: 'Unable to sign in right now. Please retry.', code: 'unavailable' };
const UNREACHABLE = { error: 'LangQuest could not be reached. Please retry.', code: 'unavailable' };

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const v2Url = Deno.env.get('V2_SUPABASE_URL');
  const v2Key = Deno.env.get('V2_SUPABASE_ANON_KEY');
  if (!v2Url || !v2Key) return reply({ error: 'Signing in with a LangQuest account is not set up here.', code: 'unavailable' }, 503);

  let email: unknown, password: unknown;
  try { ({ email, password } = await request.json()); } catch { return reply({ error: 'Invalid request' }, 400); }
  if (typeof email !== 'string' || !EMAIL.test(email.trim()) || typeof password !== 'string' || password.length < 1 || password.length > 200) {
    return reply(WRONG, 400);
  }
  const address = email.trim().toLowerCase();
  const service = serviceClient();
  const allowed = await service.rpc('v2_import_sign_in_try', { p_email: address });
  if (allowed.error) return reply(BUSY, 503);
  if (allowed.data === false) return reply({ error: 'Too many tries with this email. Wait an hour.', code: 'over_request_rate_limit' }, 429);

  // v2's own answer to these credentials.
  let v2: { access_token?: string; user?: { id?: string; email?: string; email_confirmed_at?: string | null; user_metadata?: Record<string, unknown> } };
  try {
    const res = await fetch(`${v2Url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: v2Key, 'content-type': 'application/json' }, body: JSON.stringify({ email: address, password })
    });
    if (res.status === 400 || res.status === 401) {
      await service.rpc('v2_import_sign_in_try', { p_email: address, p_failed: true });
      return reply(WRONG, 400);
    }
    if (!res.ok) return reply(UNREACHABLE, 503);
    v2 = await res.json();
  } catch {
    return reply(UNREACHABLE, 503);
  }
  const v2Id = v2.user?.id;
  if (v2.access_token) {
    // Leave no v2 session behind: the person signed in here, not there.
    void fetch(`${v2Url}/auth/v1/logout?scope=local`, { method: 'POST', headers: { apikey: v2Key, authorization: `Bearer ${v2.access_token}` } }).catch(() => {});
  }
  if (!v2Id || !UUID.test(v2Id) || !v2.user?.email_confirmed_at) return reply(WRONG, 400);

  const existing = await service.auth.admin.getUserById(v2Id);
  if (existing.data.user) {
    // Already brought over: its password here is its own now.
    return reply({ error: 'This account has already moved here. Use the password you set here.', code: 'v2_already_here' }, 409);
  }
  const made = await service.auth.admin.createUser({
    id: v2Id, email: address, password, email_confirm: true,
    user_metadata: { has_password: true, from_v2: true }
  });
  if (made.error) {
    if (/already|exists|registered/i.test(made.error.message)) {
      return reply({ error: 'You already have an account here with this email. Sign in with the password you use here.', code: 'v2_same_email' }, 409);
    }
    return reply(BUSY, 503);
  }
  // A name for someone the import has not named yet; one already there is theirs.
  const name = typeof v2.user.user_metadata?.['username'] === 'string' ? (v2.user.user_metadata['username'] as string).trim().slice(0, 100) : '';
  if (name) await service.from('profiles').upsert({ id: v2Id, display_name: name }, { onConflict: 'id', ignoreDuplicates: true });
  try {
    return reply({ session: await signInAs(service, address), fromV2: true });
  } catch {
    return reply(BUSY, 503);
  }
});
