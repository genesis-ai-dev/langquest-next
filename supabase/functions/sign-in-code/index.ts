import { headers, reply, serviceClient, sha256Hex, signInAs } from '../_shared/session.ts';

/**
 * A looked-after person uses a sign-in code from someone helping them
 * (docs/invites-and-accounts.md flow F, decisions.md 59). Called signed out:
 * holding the code is the permission. The code is taken once, and given back
 * if the sign-in could not be made, so a failed attempt can be repeated.
 *
 * Without a password (this app since decisions.md 59): it signs the person
 * straight in and returns the session, who helped, and, when the helper said
 * the old phone is lost, signs every other session of the account out.
 * With a password (builds before 59): it sets that password and returns the
 * sign-in name, and the phone signs in with both, as before.
 */
Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  let code: unknown, password: unknown;
  try { ({ code, password } = await request.json()); } catch { return reply({ error: 'Invalid request' }, 400); }
  if (typeof code !== 'string' || !/^[0-9a-f]{64}$/i.test(code)) return reply({ error: 'This code is not valid.' }, 400);
  if (password !== undefined && (typeof password !== 'string' || password.length < 6 || password.length > 128)) {
    return reply({ error: 'Choose a password of 6 or more characters.' }, 400);
  }
  const hash = await sha256Hex(code.toLowerCase());
  const service = serviceClient();

  if (typeof password === 'string') {
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
  }

  const taken = await service.rpc('take_sign_in_code_v2', { p_code_hash: hash });
  if (taken.error) return reply({ error: 'Unable to use this code. Please retry.' }, 500);
  const row = (taken.data as { profile_id: string; email: string; lost: boolean; helper_name: string | null }[] | null)?.[0];
  if (!row) return reply({ error: 'This code has expired or was already used. Ask for a new one.' }, 410);
  let tokens;
  try {
    tokens = await signInAs(service, row.email);
  } catch {
    await service.rpc('release_sign_in_code', { p_code_hash: hash });
    return reply({ error: 'Unable to sign in right now. Please retry.' }, 502);
  }
  // The old phone is lost: end every session but this new one.
  let oldPhoneSignedOut = false;
  if (row.lost) oldPhoneSignedOut = !(await service.auth.admin.signOut(tokens.access_token, 'others')).error;
  return reply({
    session: tokens,
    signInName: row.email.split('@')[0],
    helper: row.helper_name,
    ...(row.lost ? { oldPhoneSignedOut } : {})
  });
});
