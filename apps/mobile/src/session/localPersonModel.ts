/**
 * The local person (docs/nearby-sync-plan.md 14.1, 5 "Working"): someone a teammate's phone let
 * in with no server, who works under the id their install key gives until first contact. Kept
 * in `secureStorage` outside any session (src/server/localPerson.android.ts), never sealed by
 * decision 168's lock, one to an install, because a local person cannot sign out and Sign In is
 * unreachable for them. Pure: what is stored comes in as text, and what to store goes out as a
 * value, so every rule is tested without a phone. Nothing here holds or logs a key: the install
 * key stays in the Keystore (server/nearbyKey.android.ts), and this names only its public half.
 */

/** Where the record is kept in `secureStorage`. */
export const LOCAL_PERSON_KEY = 'nearby-local-person';

/**
 * How far joining has gone, in order; a record never goes back.
 * - `asking`: a new install key and `idSalt` made and the id worked out, kept so a dropped link
 *   or another inviter gets the same id; no grant yet.
 * - `filling`: granted (the two-link chain is here), the starting copy not whole yet. Still no
 *   person: `Shell` remounts on the actor id, so the copy finishes first (section 7, phase 6).
 * - `ready`: the copy is whole; the phone works as this person, with no server session.
 * - `joined`: first contact gave a session for this id; the certificate route has not answered
 *   yet, which is what ends key sign-in (Carl's answer 10), so it is asked again until it does.
 * - `done`: the certificate route answered. The record stays only until the organization's fold
 *   has any entry for the person, so the membership overlay holds through the first download.
 */
export const LOCAL_STAGES = ['asking', 'filling', 'ready', 'joined', 'done'] as const;
export type LocalStage = (typeof LOCAL_STAGES)[number];

export interface LocalPerson {
  v: 1;
  /** `newcomerProfileId(installKey, idSalt)`: the id the server will make the account under. */
  profileId: string;
  /** base64url, 16 bytes. */
  idSalt: string;
  /** The install key's public half, base64url: the Keystore seed this person's proofs are signed with. */
  installKey: string;
  deviceId: string;
  /** The name they typed, as the invite link names it. */
  name: string;
  stage: LocalStage;
  /** The two-link chain from `join-grant`, from `filling` on. */
  chain: unknown[] | null;
  /** First contact's request id, made once and sent with every try, so a repeat is a repeat. */
  requestId?: string;
  /** The join route refused (410): the person and their work stay, and a screen says why. */
  refused?: { status: string; at: number };
  /** The account exists, but key sign-in no longer applies: a helper's code signs them in. */
  needsCode?: { signInName: string; at: number };
}

/** What the invite link gives this person, for the membership overlay (core `withChainMembership`). */
export interface LocalMembership {
  profileId: string;
  orgId: string;
  languageId: string;
  roleId: string;
  privileges: string[];
  /** Who let them in, for the welcome. */
  inviter: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '' && v.length <= 200;
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const B64URL = /^[A-Za-z0-9_-]+$/;
const isB64 = (v: unknown, chars: number): v is string => typeof v === 'string' && v.length === chars && B64URL.test(v);

const stageAt = (s: LocalStage) => LOCAL_STAGES.indexOf(s);

/** The invite link's body, when the chain's second link is one and names this record's key, id, device and name. */
function inviteBodyOf(p: Pick<LocalPerson, 'profileId' | 'idSalt' | 'installKey' | 'deviceId' | 'name'>, chain: unknown): Record<string, unknown> | null {
  if (!Array.isArray(chain) || chain.length !== 2) return null;
  const link = chain[1] as unknown;
  if (!isObject(link) || link['kind'] !== 'invite@1' || !isObject(link['body'])) return null;
  const body = link['body'];
  if (body['profileId'] !== p.profileId || body['installKey'] !== p.installKey || body['idSalt'] !== p.idSalt ||
      body['deviceId'] !== p.deviceId || body['name'] !== p.name) return null;
  const pass = isObject(body['pass']) && isObject(body['pass']['body']) ? body['pass']['body'] : null;
  if (!pass || !isText(pass['orgId']) || !isText(pass['languageId']) || !isText(pass['inviter'])) return null;
  if (!isText(body['roleId']) || !Array.isArray(body['privileges']) || !body['privileges'].every((x) => typeof x === 'string')) return null;
  return body;
}

/**
 * The record as stored, or null when there is none or it cannot be read. A granted record whose
 * chain names another key, id, device or name is no record: `checkChain` and the grant's own
 * checks ran when it was kept, so a mismatch means it was changed since, and nobody is set from it.
 */
export function parseLocalPerson(raw: string | null | undefined): LocalPerson | null {
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!isObject(v) || v['v'] !== 1) return null;
  const { profileId, idSalt, installKey, deviceId, name, stage, chain, requestId, refused, needsCode } = v;
  if (!isText(profileId) || !isB64(idSalt, 22) || !isB64(installKey, 43) || !isText(deviceId) || typeof name !== 'string' || name.length > 200) return null;
  if (!LOCAL_STAGES.includes(stage as LocalStage)) return null;
  const out: LocalPerson = { v: 1, profileId, idSalt, installKey, deviceId, name, stage: stage as LocalStage, chain: null };
  if (out.stage !== 'asking') {
    if (!inviteBodyOf(out, chain)) return null;
    out.chain = chain as unknown[];
  }
  if (requestId !== undefined) {
    if (!isText(requestId)) return null;
    out.requestId = requestId;
  }
  if (isObject(refused) && isText(refused['status']) && isTime(refused['at'])) out.refused = { status: refused['status'], at: refused['at'] };
  if (isObject(needsCode) && typeof needsCode['signInName'] === 'string' && isTime(needsCode['at'])) out.needsCode = { signInName: needsCode['signInName'], at: needsCode['at'] };
  return out;
}

/** The record as it is kept. */
export function localPersonText(p: LocalPerson): string {
  return JSON.stringify(p);
}

/**
 * Whether `next` may be kept over what is held: only one local person to an install. A record
 * with nothing granted yet is a leftover a new key replaces (section 14.1, 3); anyone granted
 * keeps the install until they are removed, and a record never goes back a stage.
 */
export function mayKeepLocalPerson(held: LocalPerson | null, next: LocalPerson): boolean {
  if (next.stage !== 'asking' && !inviteBodyOf(next, next.chain)) return false;
  if (!held) return true;
  if (held.profileId !== next.profileId) return held.stage === 'asking';
  return held.installKey === next.installKey && held.idSalt === next.idSalt && stageAt(next.stage) >= stageAt(held.stage);
}

/** The membership the invite link gives, once granted; null before. */
export function membershipOf(p: LocalPerson | null | undefined): LocalMembership | null {
  if (!p || p.stage === 'asking') return null;
  const body = inviteBodyOf(p, p.chain);
  if (!body) return null;
  const pass = (body['pass'] as { body: Record<string, string> }).body;
  return {
    profileId: p.profileId, orgId: pass['orgId']!, languageId: pass['languageId']!, roleId: body['roleId'] as string,
    privileges: [...(body['privileges'] as string[])], inviter: pass['inviter']!
  };
}

/** Does the organization's fold have any entry for this person, live or removed? Then the overlay goes (section 14.1, 6 "After"). */
export function foldKnows(members: Record<string, Record<string, unknown>> | null | undefined, profileId: string): boolean {
  return !!members && Object.prototype.hasOwnProperty.call(members, profileId) && Object.keys(members[profileId]!).length > 0;
}

/**
 * The membership to lay over this organization's fold for the local person (section 14.1, 5
 * "Membership"): only in the organization their chain names, so a chain never gives a role
 * anywhere else, and only from the grant on.
 */
export function overlayFor(p: LocalPerson | null | undefined, orgId: string | null): LocalMembership | null {
  const m = membershipOf(p);
  return m && m.orgId === orgId ? m : null;
}

/** The record has done its work once the certificate route answered and the fold has the person (section 14.1, 6 "After"). */
export function recordDone(p: LocalPerson | null | undefined, members: Record<string, Record<string, unknown>> | null | undefined): p is LocalPerson {
  return p?.stage === 'done' && foldKnows(members, p.profileId);
}
