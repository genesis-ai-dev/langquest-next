import {
  checkChain, firstContactText, nearbyBytes, signedBy, type InviteLink, type JoinPass, type Sha256, type Verify
} from '@langquest-next/core/nearby';
import { MANAGED_DOMAIN, makeSignInName } from '../../../supabase/functions/_shared/accounts';
import type { RpcAnswer } from './nearby';

/**
 * Joining offline, the server's door (docs/nearby-sync-plan.md 14.1, "First time online"). A
 * newcomer let in by a teammate's phone holds a two-link chain: the inviter's `worker@1` link,
 * then an `invite@1` link the inviter's key signed under a pass the Worker signed. At first
 * contact their phone sends it here, and the relay brings it for a newcomer whose work a
 * teammate carries (section 6, "Authors with no account yet"). Both go through
 * `accountFromChain`, so one implementation is tested here with fakes.
 *
 * `POST /api/nearby/join`, signed out, `{ chain, proof, profileId, requestId, token? }`, `proof`
 * by the newcomer's key over the First contact text. Written as a literal so `server-calls` sees
 * it (decisions.md 151). It answers as `supabase/functions/join` does: `{ session, orgId,
 * signInName }`, with `session` left out once key sign-in no longer applies (the key's first
 * session, Carl's answer 10); 410 with `{ error, status }` for a refusal; 429 (the per-address
 * limit, before any signature work) and 503 (no key list, a database error or `PGRST202`) for
 * not yet. `token`, an ordinary invite, lets in the same id when the pass no longer takes them:
 * the token is the permission (decision 59), and the chain still says whose id it is.
 */
export const JOIN_PATH = '/api/nearby/join';

/** What the newcomer's account needs from the database and Auth, shared with the relay. */
export interface AccountDeps {
  /** The public keys phones trust (`NEARBY_CERT_KEYS`). */
  rootKeys(): ReadonlyMap<string, string>;
  /** `nearby_join_state` with the service client. */
  state(a: { profileId: string; key: string; salt: string; pass: JoinPass['body']; roleId: string }): Promise<RpcAnswer>;
  /** `nearby_join_finish` with the service client. */
  finish(a: { profileId: string; key: string; salt: string; deviceId: string; name: string; pass: JoinPass['body']; roleId: string; token?: string }): Promise<RpcAnswer>;
  /** `preview_invite` with the service client. */
  preview(token: string): Promise<RpcAnswer>;
  /**
   * `auth.admin.createUser` with this very id, a looked-after address, `email_confirm`,
   * `user_metadata: { has_password: false }` and `app_metadata: { managed: true, chain_key }`,
   * which only the service role can write.
   */
  createUser(a: { id: string; email: string; chainKey: string }): Promise<{ error: { message: string } | null }>;
  /** Digits for a sign-in name, as `join` draws them. */
  random(): number;
  verify: Verify;
  sha256: Sha256;
}

export interface JoinDeps extends AccountDeps {
  /** `JOIN_RATE_LIMIT`, per address, run before any signature check. */
  allowed(address: string): Promise<boolean>;
  /** Supabase's own one-time sign-in token, made and used here (`generateLink`, then `verifyOtp`), as `_shared/session.ts` does. */
  signIn(email: string): Promise<{ access_token: string; refresh_token: string }>;
}

/** A chain `checkChain` took, with two links: the newcomer and the link that let them in. */
export interface CheckedJoin {
  holder: { installKey: string; profileId: string; deviceId: string; name?: string };
  link: InviteLink;
}

export type ChainAccount =
  | { kind: 'in'; orgId: string; email: string; signIn: boolean }
  | { kind: 'refused'; error: string; status: string }
  | { kind: 'later'; why: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{32,128}$/i;
const MAX_BODY = 64 * 1024;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The word the app reads beside a refusal, as `join` answers `status`. */
export function refusalStatus(reason: string): string {
  if (/expired/.test(reason)) return 'expired';
  if (/already used/.test(reason)) return 'used';
  if (/ is off /.test(reason)) return 'off';
  if (/not found/.test(reason)) return 'not_found';
  return 'retired';
}

/**
 * A newcomer's chain, or why not: exactly two links, the pass under a root key, the inviter's link
 * under a root key, and the invite link signed by the inviter's key, with the id following from
 * the newcomer's key (`checkChain`). No expiry: a lost reply may be retried months later, and the
 * server's own stops decide a first use (`pass_refusal`).
 */
export async function checkJoinChain(chain: unknown, deps: Pick<AccountDeps, 'rootKeys' | 'verify' | 'sha256'>): Promise<{ ok: true; checked: CheckedJoin } | { ok: false; reason: string }> {
  if (!Array.isArray(chain) || chain.length !== 2) return { ok: false, reason: 'a newcomer\'s chain has two links' };
  const second: unknown = chain[1];
  const pass = isObject(second) && isObject(second['body']) && isObject(second['body']['pass']) && isObject(second['body']['pass']['body'])
    ? second['body']['pass']['body'] : null;
  if (!pass || typeof pass['orgId'] !== 'string' || typeof pass['languageId'] !== 'string') return { ok: false, reason: 'malformed link' };
  const verdict = await checkChain(chain, {
    rootKeys: deps.rootKeys(), orgId: pass['orgId'], languageId: pass['languageId'], now: null, verify: deps.verify, sha256: deps.sha256, maxLinks: 2
  });
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  if (verdict.links !== 2) return { ok: false, reason: 'a newcomer\'s chain has two links' };
  return { ok: true, checked: { holder: verdict.holder, link: second as InviteLink } };
}

const later = (why: string): ChainAccount => ({ kind: 'later', why });
const refused = (error: string, status = refusalStatus(error)): ChainAccount => ({ kind: 'refused', error, status });

/** A database answer that is no refusal: a function not there yet (`PGRST202`) or any other failure. */
const failed = (a: RpcAnswer, what: string): ChainAccount | null => {
  if (!a.error) return null;
  // The database's own refusal of what it was given: core and SQL disagree, which no retry mends.
  if (a.error.code === '22023') return refused(a.error.message, 'chain');
  return later(`${what}: ${a.error.code === 'PGRST202' ? 'the server is being updated' : a.error.message}`);
};

interface JoinState { state: 'new' | 'mine' | 'taken' | 'deleted'; redeemed: boolean; member: boolean; keyed: boolean; refusal: string | null }

function stateOf(data: unknown): JoinState | null {
  if (!isObject(data) || !['new', 'mine', 'taken', 'deleted'].includes(data['state'] as string)) return null;
  return {
    state: data['state'] as JoinState['state'], redeemed: data['redeemed'] === true, member: data['member'] === true, keyed: data['keyed'] === true,
    refusal: typeof data['refusal'] === 'string' ? data['refusal'] : null
  };
}

/**
 * The newcomer's account, in this order (14.1, The account): an id that exists is reached only by
 * its own `chain_key`, and anything else holding it, or a deleted id, is refused; the pass is asked
 * (`pass_refusal`, inside `nearby_join_state`) before any Auth call, unless this person already
 * redeemed it, so a dead pass makes no account; then `createUser` with the phone's own id, and
 * `nearby_join_finish` for the profile, the install key and the redemption. It never deletes an
 * account: a relay-made one may already hold events. A refusal after a create (a race for the last
 * use) leaves the account, which holds nothing and only this key reaches. `relay` skips the work
 * when the account, its key row and a live membership are already there.
 */
export async function accountFromChain(checked: CheckedJoin, deps: AccountDeps, o: { token?: string; relay?: boolean } = {}): Promise<ChainAccount> {
  const { holder, link } = checked;
  const pass = link.body.pass.body;
  const ask = { profileId: holder.profileId, key: holder.installKey, salt: link.body.idSalt, pass, roleId: link.body.roleId };

  const first = await deps.state(ask);
  const stateFailed = failed(first, 'nearby_join_state');
  if (stateFailed) return stateFailed;
  let s = stateOf(first.data);
  if (!s) return later('nearby_join_state: no answer');
  if (s.state === 'taken') return refused('this id belongs to someone else', 'taken');
  if (s.state === 'deleted') return refused('this account was deleted', 'deleted');
  if (o.relay && s.state === 'mine' && s.keyed && s.member) return { kind: 'in', orgId: pass.orgId, email: '', signIn: false };

  if (o.token !== undefined) {
    // The token is the permission, and only for the chain's organization.
    const preview = await deps.preview(o.token);
    if (preview.error) return later(`preview_invite: ${preview.error.message}`);
    const p = isObject(preview.data) ? preview.data : {};
    const status = typeof p['status'] === 'string' ? p['status'] : 'not_found';
    if (status === 'not_found' || p['orgId'] !== pass.orgId) return refused('invite not found', 'not_found');
    if (s.state === 'new' && status !== 'ok') return refused(`invite ${status}`, status);
  } else if (s.refusal !== null && !s.redeemed && !(s.state === 'mine' && s.member)) {
    return refused(s.refusal);
  }

  if (s.state === 'new') {
    // A fixed id: an "already" error is not retried with another id, only with another sign-in name.
    let made = false;
    for (let attempt = 0; attempt < 10 && !made; attempt += 1) {
      const email = `${makeSignInName(link.body.name, Math.floor(deps.random() * 2 ** 32), attempt < 5 ? 3 : 5)}@${MANAGED_DOMAIN}`;
      const created = await deps.createUser({ id: holder.profileId, email, chainKey: holder.installKey });
      if (!created.error) { made = true; break; }
      // Another call made it meanwhile, or the address is taken: the id's state says which.
      const again = await deps.state(ask);
      const againFailed = failed(again, 'nearby_join_state');
      if (againFailed) return againFailed;
      s = stateOf(again.data);
      if (!s) return later('nearby_join_state: no answer');
      if (s.state === 'mine') { made = true; break; }
      if (s.state !== 'new') return refused('this id belongs to someone else', 'taken');
    }
    if (!made) return later('createUser: no sign-in name was free');
  }

  const done = await deps.finish({
    profileId: holder.profileId, key: holder.installKey, salt: link.body.idSalt, deviceId: holder.deviceId, name: link.body.name, pass, roleId: link.body.roleId,
    ...(o.token !== undefined ? { token: o.token } : {})
  });
  if (done.error?.code === '42501') return refused('this id belongs to someone else', 'taken');
  const finishFailed = failed(done, 'nearby_join_finish');
  if (finishFailed) return finishFailed;
  const f = isObject(done.data) ? done.data : null;
  if (!f) return later('nearby_join_finish: no answer');
  if (typeof f['refused'] === 'string') return refused(f['refused']);
  if (typeof f['orgId'] !== 'string' || typeof f['email'] !== 'string') return later('nearby_join_finish: no organization');
  return { kind: 'in', orgId: f['orgId'], email: f['email'], signIn: f['signIn'] === true };
}

// ---- the route -------------------------------------------------------------------

const NO_STORE = { 'cache-control': 'private, no-store' };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...NO_STORE } });
const notYet = () => json(503, { error: 'Unable to join right now. Please retry.' });

export async function handleJoin(request: Request, deps: JoinDeps): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Only POST is supported.' });
  try {
    return await join(request, deps);
  } catch (e) {
    console.error(`${JOIN_PATH}:`, e);
    return notYet();
  }
}

async function join(request: Request, deps: JoinDeps): Promise<Response> {
  // Before any signature work: a town's phones may share one address, and the phone reads 429 as not yet.
  if (!await deps.allowed(request.headers.get('cf-connecting-ip') ?? 'unknown')) return json(429, { error: 'Too many requests. Try again later.' });
  if (deps.rootKeys().size === 0) return json(503, { error: 'Nearby sync is not set up here yet.' });

  const text = await request.text().catch(() => '');
  let body: unknown = null;
  if (text.length <= MAX_BODY) {
    try { body = JSON.parse(text); } catch { body = null; }
  }
  const { chain, proof, profileId, requestId, token } = isObject(body) ? body : {};
  if (!Array.isArray(chain) || typeof proof !== 'string' || typeof profileId !== 'string' || typeof requestId !== 'string' || !UUID.test(requestId) ||
      (token !== undefined && (typeof token !== 'string' || !TOKEN.test(token)))) {
    return json(400, { error: 'Send { chain, proof, profileId, requestId }.' });
  }

  const chained = await checkJoinChain(chain, deps);
  if (!chained.ok) return json(410, { error: `chain: ${chained.reason}`, status: 'chain' });
  const { holder } = chained.checked;
  // By exact string: the id the chain derives, never one the request names.
  if (profileId !== holder.profileId) return json(410, { error: 'the chain names someone else', status: 'chain' });
  const signed = nearbyBytes('firstContact', firstContactText({ profileId, deviceId: holder.deviceId, publicKey: holder.installKey, requestId }));
  if (!await signedBy(deps.verify, holder.installKey, signed, proof)) return json(410, { error: 'that proof is not signed by this key', status: 'proof' });

  const account = await accountFromChain(chained.checked, deps, typeof token === 'string' ? { token } : {});
  if (account.kind === 'later') {
    console.error(`${JOIN_PATH}: ${account.why}`);
    return notYet();
  }
  if (account.kind === 'refused') return json(410, { error: account.error, status: account.status });
  const signInName = account.email.split('@')[0];
  if (!account.signIn) return json(200, { orgId: account.orgId, signInName });
  let session: { access_token: string; refresh_token: string };
  try {
    session = await deps.signIn(account.email);
  } catch (e) {
    console.error(`${JOIN_PATH}: sign-in`, e);
    return json(503, { error: 'Unable to sign in right now. Please retry.' });
  }
  return json(200, { session, orgId: account.orgId, signInName });
}
