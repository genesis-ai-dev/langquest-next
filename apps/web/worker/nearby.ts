import type { AnyEvent, Privilege } from '@langquest-next/core';
import {
  attestationText, base64urlEncode, certRequestText, eventDigest, isBase64url, joinPassBody, linkText, nearbyBytes, NEARBY_BATCH_MAX_EVENTS,
  passRoles, revocationText, signedBy, signJoinPass, type Attestation, type ChainOrg, type JoinPass, type RevokedKey, type Sha256, type Verify, type WorkerLink
} from '@langquest-next/core/nearby';
import { NotAuthorizedError } from '@langquest-next/sync';
import { hexBytes, type NearbySigner } from './nearbyKeys';

/**
 * Nearby sync's two Worker routes (docs/nearby-sync-plan.md 5.5, 5.10, 5.12
 * "The server's names" and "Claims"). Written as literals so `server-calls`
 * sees them (decisions.md 151): once a store build calls them they cannot be
 * renamed.
 *
 * `POST /api/nearby/certificate`, bearer token, `{ publicKey, deviceId, languages, proof }`:
 * one `worker@1` link per organization that has nearby on, the discovery keys
 * of the languages named that this person may read, each organization's
 * signed revocation list, and, where `nearby_join` is on too, a join pass for
 * each language named where they hold Invite (14.1, Carl's answers 8, 11, 17,
 * 18), signed with core's `joinPassBody` and `signJoinPass` over the roles
 * core's `passRoles` keeps, the same functions phones use, and nothing written.
 * `{ revoked: true }` for a revoked key.
 *
 * `POST /api/nearby/attest`, bearer token, `{ orgId, streamId, afterSeq }`: the
 * Worker reads the rows itself, as the caller, and signs their ids, digests and
 * `serverSeq`. No digest comes in the request, or it would sign whatever it
 * was sent. `null` while nearby is off for the organization; 403 for someone
 * who may not read the stream, on or off, so the route tells no outsider which
 * organizations have nearby on.
 */
export const CERTIFICATE_PATH = '/api/nearby/certificate';
export const ATTEST_PATH = '/api/nearby/attest';

export const isNearbyPath = (path: string) => path === CERTIFICATE_PATH || path === ATTEST_PATH;

/** What supabase-js answers for an RPC, as far as these routes read it. */
export interface RpcAnswer {
  data: unknown;
  error: { code?: string; message: string } | null;
}

export interface NearbyDeps {
  /** The Worker's key, imported once per isolate; null without `NEARBY_SIGNING_KEY` (or one no phone trusts). */
  signer(): Promise<NearbySigner | null>;
  /**
   * The profile a token belongs to, asking `session_is_live` every time and
   * uncached, because decision 118's 30-second cache would let a phone whose
   * sessions were just ended make a new key. Throws when that cannot be asked.
   */
  certificateCaller(token: string): Promise<string | null>;
  /** The profile a token belongs to (the API's own `profileOf`). */
  profileOf(token: string): Promise<string | null>;
  /** The per-minute limiter keyed by profile id (`NEARBY_RATE_LIMIT`). */
  allowed(profileId: string): Promise<boolean>;
  /** `nearby_certificate_facts` with the service client. */
  facts(profileId: string, deviceId: string, publicKey: string, languages: string[]): Promise<RpcAnswer>;
  /** `_org_feature_on(org, 'nearby')` with the service client. */
  nearbyOn(orgId: string): Promise<RpcAnswer>;
  /**
   * `pull_events` with the caller's own token, mapped as `SupabaseTransport.pull`
   * maps rows, so `can_read_stream` decides what the Worker reads. Throws
   * `NotAuthorizedError` for someone who may not read the stream.
   */
  pullAs(token: string, orgId: string, streamId: string, afterSeq: number, limit: number): Promise<AnyEvent[]>;
  now(): number;
  verify: Verify;
  sha256: Sha256;
}

/** A certificate lasts a year (5.5): shorter revokes faster, but risks stranding long-offline teams. */
export const CERTIFICATE_MS = 365 * 86_400_000;

/** Pages an attestation reads past rows no digest can stand for, so a run of them does not stop claims for good. */
const ATTEST_PAGES = 5;

const MAX_BODY = 64 * 1024;
const MAX_LANGUAGES = 500;

const NO_STORE = { 'cache-control': 'private, no-store' };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...NO_STORE } });

const notReady = () => json(503, { error: 'Nearby sync is not set up here yet.' });
const behind = () => json(503, { error: 'The server is being updated. Try again later.' });

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isId = (v: unknown, max = 256): v is string => typeof v === 'string' && v.length >= 1 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const isCount = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= min;

async function bodyOf(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text().catch(() => '');
  if (text.length > MAX_BODY) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const tokenOf = (request: Request) => /^Bearer (.+)$/.exec(request.headers.get('authorization') ?? '')?.[1];

export async function handleNearby(request: Request, deps: NearbyDeps): Promise<Response> {
  if (request.method !== 'POST') return json(405, { error: 'Only POST is supported.' });
  const path = new URL(request.url).pathname;
  try {
    return path === CERTIFICATE_PATH ? await certificate(request, deps) : await attest(request, deps);
  } catch (e) {
    console.error(`${path}:`, e);
    return json(502, { error: 'The server could not answer just now. Try again.' });
  }
}

// ---- the certificate ---------------------------------------------------------------

interface FactsPass {
  languageId: string;
  /** The person's privileges in that language. */
  held: Privilege[];
  roles: { roleId: string; privileges: Privilege[] }[];
}

interface FactsOrg {
  orgId: string;
  orgSeq: number;
  scopes: ChainOrg['scopes'];
  discoveryKeys: { languageId: string; gen: number; floor: number; key: string }[];
  passes: FactsPass[];
  revokedSeq: number;
  revocations: RevokedKey[];
}

const isPrivileges = (v: unknown): v is Privilege[] => Array.isArray(v) && v.every((p) => isId(p, 100));

/** One organization of `nearby_certificate_facts`' answer, checked, with keys as base64url; null for anything the migration would not write. */
function factsOrg(v: unknown): FactsOrg | null {
  if (!isObject(v) || !isId(v['orgId']) || !isCount(v['orgSeq']) || !isCount(v['revokedSeq'])) return null;
  const { scopes, discoveryKeys, revocations } = v;
  // Absent from a database before passes came, which reads as none.
  const passes = v['passes'] ?? [];
  if (!Array.isArray(scopes) || !Array.isArray(discoveryKeys) || !Array.isArray(revocations) || !Array.isArray(passes)) return null;
  const out: FactsOrg = { orgId: v['orgId'], orgSeq: v['orgSeq'], scopes: [], discoveryKeys: [], passes: [], revokedSeq: v['revokedSeq'], revocations: [] };
  for (const s of scopes as unknown[]) {
    if (!isObject(s) || !Array.isArray(s['privileges']) || !(s['privileges'] as unknown[]).every((p) => isId(p, 100))) return null;
    const privileges = s['privileges'] as Privilege[];
    // The role id stays out: an older fold may not know the role, so a chain carries resolved privileges (5.5).
    if (s['level'] === 'org') out.scopes.push({ level: 'org', privileges });
    else if (s['level'] === 'language' && isId(s['languageId'])) out.scopes.push({ level: 'language', languageId: s['languageId'], privileges });
    else return null;
  }
  for (const k of discoveryKeys as unknown[]) {
    const key = isObject(k) ? hexBytes(k['key']) : null;
    if (!isObject(k) || !isId(k['languageId']) || !isCount(k['gen'], 1) || !isCount(k['floor'], 1) || key?.length !== 32) return null;
    out.discoveryKeys.push({ languageId: k['languageId'], gen: k['gen'], floor: k['floor'], key: base64urlEncode(key) });
  }
  for (const p of passes as unknown[]) {
    if (!isObject(p) || !isId(p['languageId']) || !isPrivileges(p['held']) || !Array.isArray(p['roles'])) return null;
    const roles: FactsPass['roles'] = [];
    for (const r of p['roles'] as unknown[]) {
      if (!isObject(r) || !isId(r['roleId']) || !isPrivileges(r['privileges'])) return null;
      roles.push({ roleId: r['roleId'], privileges: r['privileges'] });
    }
    out.passes.push({ languageId: p['languageId'], held: p['held'], roles });
  }
  for (const r of revocations as unknown[]) {
    if (!isObject(r) || !isBase64url(r['publicKey'], 32) || !isId(r['profileId']) || !isCount(r['revokedAtMs'])) return null;
    out.revocations.push([r['publicKey'], r['profileId'], r['revokedAtMs']]);
  }
  return out;
}

async function certificate(request: Request, deps: NearbyDeps): Promise<Response> {
  const signer = await deps.signer();
  if (!signer) return notReady();
  const token = tokenOf(request);
  let profileId: string | null = null;
  try {
    profileId = token ? await deps.certificateCaller(token) : null;
  } catch (e) {
    // A session that cannot be asked about is not taken as live here: a new key waits for the next check.
    console.error('nearby certificate session check:', e);
    return json(503, { error: 'The server could not check your sign-in just now. Try again later.' });
  }
  if (!profileId) return json(401, { error: 'Sign in again.' });
  if (!await deps.allowed(profileId)) return json(429, { error: 'Too many requests. Try again later.' });

  const body = await bodyOf(request);
  const { publicKey, deviceId, languages, proof } = body ?? {};
  if (!isBase64url(publicKey, 32) || !isId(deviceId) || !isBase64url(proof, 64) ||
      !Array.isArray(languages) || languages.length > MAX_LANGUAGES || !languages.every((l) => isId(l, 513) && l.includes('/'))) {
    return json(400, { error: 'Send { publicKey, deviceId, languages, proof }.' });
  }
  // Proof that the caller holds the key, over a text with no time in it: field clocks are wrong, and it is useless without this person's token.
  if (!await signedBy(deps.verify, publicKey, nearbyBytes('certRequest', certRequestText({ profileId, deviceId, publicKey })), proof)) {
    return json(403, { error: 'That proof is not signed by this key.' });
  }

  const { data, error } = await deps.facts(profileId, deviceId, publicKey, languages as string[]);
  if (error?.code === 'PGRST202') return behind();
  if (error?.code === '22023') return json(400, { error: error.message });
  if (error) throw new Error(`nearby_certificate_facts: ${error.message}`);
  if (!isObject(data)) throw new Error('nearby_certificate_facts: no answer');
  if (data['revoked'] === true) return json(200, { revoked: true });
  if (data['limited'] === true) return json(429, { error: 'Too many new keys today. Try again tomorrow.', limited: true });
  if (!Array.isArray(data['orgs'])) throw new Error('nearby_certificate_facts: no organizations');
  const orgs = (data['orgs'] as unknown[]).map(factsOrg);
  if (orgs.some((o) => o === null)) throw new Error('nearby_certificate_facts: an organization it would not write');

  const expiresAt = deps.now() + CERTIFICATE_MS;
  const chains: { orgId: string; chain: WorkerLink[] }[] = [];
  const discoveryKeys: { orgId: string; languageId: string; gen: number; floor: number; key: string }[] = [];
  const revocations: { orgId: string; text: string; kid: string; sig: string }[] = [];
  const passes: { orgId: string; languageId: string; pass: JoinPass }[] = [];
  for (const org of orgs as FactsOrg[]) {
    const unsigned: Omit<WorkerLink, 'sig'> = {
      kind: 'worker@1',
      kid: signer.kid,
      // One organization to a link, so a teammate learns of no other.
      body: { installKey: publicKey, profileId, deviceId, expiresAt, org: { orgId: org.orgId, orgSeq: org.orgSeq, scopes: org.scopes } }
    };
    chains.push({ orgId: org.orgId, chain: [{ ...unsigned, sig: await signer.sign(nearbyBytes('link', linkText(unsigned, ''))) }] });
    for (const k of org.discoveryKeys) discoveryKeys.push({ orgId: org.orgId, ...k });
    // One pass to a window (Carl's answer 17): the same id all window long for this organization, language, person and key.
    for (const p of org.passes) {
      const roles = passRoles(p.roles, new Set(p.held));
      const body = await joinPassBody({ orgId: org.orgId, languageId: p.languageId, inviter: profileId, inviterKey: publicKey, roles, nowMs: deps.now() }, deps.sha256);
      if (body) passes.push({ orgId: org.orgId, languageId: p.languageId, pass: await signJoinPass(body, signer.kid, signer.sign) });
    }
    // A list with no seq yet has nothing a phone could take: it reads seq 1 and up.
    if (org.revokedSeq >= 1) {
      const text = revocationText({ v: 1, kid: signer.kid, orgId: org.orgId, seq: org.revokedSeq, keys: org.revocations });
      revocations.push({ orgId: org.orgId, text, kid: signer.kid, sig: await signer.sign(nearbyBytes('revoked', text)) });
    }
  }
  // With no organization on, every list is empty, and the phone drops what it holds.
  return json(200, { chains, discoveryKeys, passes, revocations });
}

// ---- the attestation ---------------------------------------------------------------

/** The organization and person streams are never claimed (5.12, `shouldClaim`), so the Worker vouches for neither. */
const isLanguageStream = (orgId: string, streamId: string) => !orgId.startsWith('_') && !streamId.startsWith('_');

async function attest(request: Request, deps: NearbyDeps): Promise<Response> {
  const signer = await deps.signer();
  if (!signer) return notReady();
  const token = tokenOf(request);
  const profileId = token ? await deps.profileOf(token) : null;
  if (!token || !profileId) return json(401, { error: 'Sign in again.' });

  const body = await bodyOf(request);
  const { orgId, streamId, afterSeq } = body ?? {};
  if (!isId(orgId) || !isId(streamId) || !isCount(afterSeq)) return json(400, { error: 'Send { orgId, streamId, afterSeq }.' });
  if (!isLanguageStream(orgId, streamId)) return json(400, { error: 'Only a language\'s stream is attested.' });

  // As the caller, before anything else: someone who may not read this stream gets nothing signed, and learns
  // nothing of whether nearby is on for its organization (403 either way).
  const page = async (after: number): Promise<AnyEvent[] | null> => {
    try {
      return await deps.pullAs(token, orgId, streamId, after, NEARBY_BATCH_MAX_EVENTS);
    } catch (e) {
      if (e instanceof NotAuthorizedError) return null;
      throw e;
    }
  };
  const first = await page(afterSeq);
  if (first === null) return json(403, { error: 'You cannot read this language.' });

  const on = await deps.nearbyOn(orgId);
  if (on.error?.code === 'PGRST202') return behind();
  if (on.error) throw new Error(`_org_feature_on: ${on.error.message}`);
  if (on.data !== true) return json(200, null);

  const rows: Attestation['rows'] = [];
  let after = afterSeq;
  for (let n = 0; n < ATTEST_PAGES; n += 1) {
    const events = n === 0 ? first : await page(after);
    if (events === null) return json(403, { error: 'You cannot read this language.' });
    for (const e of events) {
      if (rows.length === NEARBY_BATCH_MAX_EVENTS) break;
      const seq = e.serverSeq;
      if (!isCount(seq, 1) || seq <= after) throw new Error('pull_events: rows out of order');
      after = seq;
      // A row no digest can stand for is left out: it travels by neither claim nor batch.
      const digest = await eventDigest(e, deps.sha256);
      if (digest !== '') rows.push([e.id, digest, seq]);
    }
    // Stop at the first page that gave anything: the phone asks again from its last row.
    if (rows.length > 0 || events.length < NEARBY_BATCH_MAX_EVENTS) break;
  }
  const text = attestationText({ v: 1, kid: signer.kid, orgId, streamId, rows });
  return json(200, { text, kid: signer.kid, sig: await signer.sign(nearbyBytes('attest', text)) });
}
