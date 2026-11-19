import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { MANAGED_DOMAIN } from '../_shared/accounts.ts';
import { headers, reply, serviceClient } from '../_shared/session.ts';

/**
 * Edit Profile's email (LAN-304, docs/decisions/2026-11-18-edit-profile-holds-email-and-password.md):
 * a signed-in person adds an email to a looked-after account, or changes
 * their own, with `{ email }`. Nothing proves the address, as Create Account
 * proves none (Auth's confirmations are off, docs/invites-and-accounts.md
 * section 7): the session is the permission. It is set here with the service
 * role because a change made by the person through Auth would ask Auth to
 * email both addresses (`double_confirm_changes`), and this project sends
 * Auth no mail.
 *
 * A looked-after account that takes an email becomes an own-email account:
 * its sign-in name stops working, helpers' codes stop (take_sign_in_code_v2
 * refuses an own email, decision 59) and Forgot password reaches it. Its
 * steward row, which only said who to ask, goes (flow H). So an account with
 * no password of its own (`has_password` false, set by `join`) is refused
 * until it has one: Edit Profile sets the password first, through the
 * person's own session (Auth keeps that session; a password set here with
 * the service role would end every session of the account), then the email,
 * so a lost connection never leaves an email with no way in.
 *
 * Replies carry `code` for the app (authErrorText reads the same codes as
 * Supabase Auth's), and English words for anyone reading a log.
 */

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } }, auth: { persistSession: false }
  });
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) return reply({ error: 'Sign in required', code: 'session_not_found' }, 401);
  let body: { email?: unknown };
  try { body = await request.json(); } catch { return reply({ error: 'Invalid request', code: 'validation_failed' }, 400); }
  const email = body?.email;
  if (typeof email !== 'string' || email.trim().length > 254 || !EMAIL.test(email.trim())) {
    return reply({ error: 'Type an email address.', code: 'validation_failed' }, 400);
  }
  const address = email.trim().toLowerCase();
  // A looked-after address is made by the server from a name, never chosen.
  if (address.endsWith(`@${MANAGED_DOMAIN}`)) return reply({ error: 'Type an email address.', code: 'validation_failed' }, 400);
  const before = (auth.user.email ?? '').toLowerCase();
  if (address === before) return reply({ email: address });
  if (auth.user.user_metadata?.['has_password'] === false) {
    return reply({ error: 'Choose a password first: a helper\'s code no longer signs in an account with an email.', code: 'password_required' }, 400);
  }

  const service = serviceClient();
  const TAKEN = { error: 'Another account already uses this email.', code: 'email_exists' };
  // Asked first, in any case (migration 20261118160000): Auth says only "Error updating user" for a
  // taken address, and its unique index would let the same address in capitals through.
  const taken = await service.rpc('email_taken', { p_email: address, p_self: auth.user.id });
  if (taken.error) return reply({ error: 'The email could not be saved. Please retry.', code: 'unavailable' }, 503);
  if (taken.data === true) return reply(TAKEN, 409);
  const updated = await service.auth.admin.updateUserById(auth.user.id, { email: address, email_confirm: true });
  if (updated.error) {
    // Taken between the question and the change, by an account made meanwhile.
    if (updated.error.code === 'email_exists' || /already been registered|already exists/i.test(updated.error.message)) return reply(TAKEN, 409);
    return reply({ error: 'The email could not be saved. Please retry.', code: 'unavailable' }, 502);
  }
  if (before.endsWith(`@${MANAGED_DOMAIN}`)) {
    // It granted nothing (decision 59), so a row left behind does no harm: its error is not the person's.
    await service.from('account_stewards').delete().eq('profile_id', auth.user.id);
  }
  return reply({ email: address });
});
