import { MANAGED_DOMAIN, makeSignInName } from '../_shared/accounts.ts';
import { headers, reply, serviceClient, signInAs } from '../_shared/session.ts';

/**
 * Join by invite as a new person, with no email and no password
 * (docs/invites-and-accounts.md flow A, decisions.md 59). Called signed out:
 * holding the invite is the permission. It makes a looked-after account,
 * named as the inviter typed (or, for a group invite, as the person typed),
 * adds the membership the invite grants, and signs the phone in.
 *
 * Safe to repeat: the phone sends one request id per join, and a repeat
 * (the reply was lost) signs the same account in again instead of making a
 * second one. Redeeming is idempotent per person. A repeat is a retry, not a
 * way back in (decisions.md 75): it works for an hour, and only while the
 * account is still looked after with no password of its own. After that,
 * getting back in is a helper's code.
 */
const REPEAT_MS = 60 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a dead invite means, in the words the app already shows (heldInvite.ts outcomeOfError). */
const DEAD: Record<string, string> = {
  expired: 'invite expired',
  used: 'invite already used',
  not_found: 'invite not found',
  retired: 'invite role is no longer available'
};

function randomPassword(): string {
  // Never shown or stored anywhere: the account signs in with codes, or with
  // a password the person sets later in Settings.
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  let token: unknown, requestId: unknown, typedName: unknown;
  try { ({ token, requestId, name: typedName } = await request.json()); } catch { return reply({ error: 'Invalid request' }, 400); }
  if (typeof token !== 'string' || !/^[0-9a-f]{32,128}$/i.test(token)) return reply({ error: 'invite not found' }, 410);
  if (typeof requestId !== 'string' || !UUID.test(requestId)) return reply({ error: 'Invalid request' }, 400);
  const service = serviceClient();

  // The same request again: the account exists already.
  const seen = await service.from('invite_join_requests').select('profile_id, created_at').eq('request_id', requestId).maybeSingle();
  if (seen.error) return reply({ error: 'Unable to join right now. Please retry.' }, 503);
  let profileId: string | null = seen.data?.profile_id ?? null;
  let email: string | null = null;
  let name: string | null = null;

  if (profileId) {
    const user = await service.auth.admin.getUserById(profileId);
    email = user.data.user?.email ?? null;
    if (!email) return reply({ error: 'Unable to join right now. Please retry.' }, 503);
    const fresh = Date.now() - Date.parse(String(seen.data?.created_at)) < REPEAT_MS;
    const lookedAfter = email.endsWith(`@${MANAGED_DOMAIN}`) && user.data.user?.user_metadata?.['has_password'] === false;
    if (!fresh || !lookedAfter) return reply({ error: 'This join was already used. Ask whoever invited you for a code to sign back in.' }, 410);
  } else {
    // What the server says the invite is; the link's own claims count for nothing.
    const preview = await service.rpc('preview_invite', { p_token: token });
    if (preview.error) return reply({ error: 'Unable to join right now. Please retry.' }, 503);
    const p = preview.data as { status: string; label?: string | null; group?: boolean };
    if (p.status !== 'ok') return reply({ error: DEAD[p.status] ?? 'invite not found', status: p.status }, 410);
    // A one-person invite names the person; a group invite asks them.
    name = (p.label && !p.group ? p.label : typeof typedName === 'string' ? typedName : '').trim();
    if (name.length < 1 || name.length > 100) return reply({ error: 'Type your name to join.', needsName: true }, 400);

    // Three digits keep sign-in names apart; on the rare clash, new digits.
    for (let attempt = 0; attempt < 5 && !profileId; attempt++) {
      const candidate = `${makeSignInName(name, crypto.getRandomValues(new Uint16Array(1))[0]!)}@${MANAGED_DOMAIN}`;
      // `has_password: false` tells the app there is no password to sign back in with until they set one.
      const made = await service.auth.admin.createUser({
        email: candidate, password: randomPassword(), email_confirm: true, user_metadata: { has_password: false }
      });
      if (made.error && /already|exists|registered/i.test(made.error.message)) continue;
      if (made.error || !made.data.user) return reply({ error: 'Unable to join right now. Please retry.' }, 503);
      profileId = made.data.user.id;
      email = candidate;
    }
    if (!profileId || !email) return reply({ error: 'Unable to join right now. Please retry.' }, 503);
    const recorded = await service.from('invite_join_requests').insert({ request_id: requestId, profile_id: profileId });
    // Another call with this id won the race: drop this account; the phone's retry finds the other.
    if (recorded.error) {
      await service.auth.admin.deleteUser(profileId);
      return reply({ error: 'Unable to join right now. Please retry.' }, 503);
    }
    // Members see them by this name (decisions.md 47).
    await service.from('profiles').upsert({ id: profileId, display_name: name });
  }

  // Add the membership. Idempotent per person, so a repeat changes nothing.
  const joined = await service.rpc('redeem_invite_for', { p_actor: profileId, p_token: token });
  if (joined.error) {
    const message = joined.error.message;
    const dead = Object.values(DEAD).find((m) => message.includes(m));
    if (dead) {
      // The invite ran out between the preview and now: the new account has no use.
      if (name !== null) await service.auth.admin.deleteUser(profileId);
      return reply({ error: dead }, 410);
    }
    return reply({ error: 'Unable to join right now. Please retry.' }, 503);
  }

  let tokens;
  try { tokens = await signInAs(service, email); } catch { return reply({ error: 'Unable to sign in right now. Please retry.' }, 503); }
  return reply({ session: tokens, orgId: joined.data as string, signInName: email.split('@')[0] });
});
