import { decodeHlc, isHlc } from './hlc';
import type { NearbyPeople } from './nearbyDoor';
import { peopleFromOrg } from './nearbyDoor';
import { base64urlDecode, bytesToHex, isBase64url, linkText, nearbyBytes, newcomerIdBytes, passText } from './nearbySigning';
import type { OrgState } from './org';
import { MANAGE_PRIVILEGES, type Privilege } from './orgTerms';
import { nearbyPayloadError } from './validate';

/**
 * Who a nearby phone is, without a server (docs/nearby-sync-plan.md 5.12, Chains).
 * A certificate is a chain: the Worker signs the first link, and each further link
 * is signed by the key the link before names. It is pure, with `verify` and `sha256`
 * passed in, because the Worker runs this too.
 */

/** Either may answer with a promise: `crypto.subtle` on the Worker does, `@noble/hashes` on a phone does not. */
export type Verify = (publicKey: string, message: Uint8Array, signature: string) => boolean | Promise<boolean>;
export type Sha256 = (bytes: Uint8Array) => Uint8Array | Promise<Uint8Array>;

export interface ChainOrg {
  orgId: string;
  /** The newest seq of this organization's `_org` stream at signing. */
  orgSeq: number;
  scopes: { level: 'org' | 'language'; languageId?: string; privileges: Privilege[] }[];
}

export interface WorkerLink {
  kind: 'worker@1';
  kid: string;
  /** One organization to a link. */
  body: { installKey: string; profileId: string; deviceId: string; expiresAt: number; org: ChainOrg };
  sig: string;
}

export interface JoinPass {
  kind: 'pass@1';
  kid: string;
  body: {
    passId: string; orgId: string; languageId: string; inviter: string; inviterKey: string;
    roles: { roleId: string; privileges: Privilege[] }[]; maxUses: number; expiresAt: number;
  };
  sig: string;
}

/** Issued from phase 6, checked from phase 2. */
export interface InviteLink {
  kind: 'invite@1';
  body: {
    pass: JoinPass; installKey: string; idSalt: string; profileId: string; deviceId: string; name: string;
    roleId: string; privileges: Privilege[];
  };
  /** By the `installKey` the link before names. */
  sig: string;
}

export type ChainLink = WorkerLink | InviteLink;

/** A pair, not a bare key, so another person on a shared phone is not refused because of one person's lost phone. */
export type RevokedKey = readonly [publicKey: string, profileId: string, revokedAtMs: number];

/** The Worker's list for one organization, as its signed text says. The highest `seq` wins. */
export interface RevocationList {
  v: 1;
  kid: string;
  orgId: string;
  seq: number;
  keys: readonly RevokedKey[];
}

export interface CheckChainOptions {
  /** kid to public key. */
  rootKeys: ReadonlyMap<string, string>;
  orgId: string;
  languageId?: string;
  /** Null skips every expiry: batches are carried for months. */
  now: number | null;
  verify: Verify;
  sha256: Sha256;
  /** Given at Hello and for a copy; not for a batch, which applies its date rule per event. */
  revoked?: RevocationList;
  /** 2. */
  maxLinks?: number;
}

export type ChainVerdict =
  | { ok: true; holder: { installKey: string; profileId: string; deviceId: string; name?: string }; org: ChainOrg; links: number; inviter?: string; roleId?: string }
  | { ok: false; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isTexts = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');
const isKey = (v: unknown): v is string => isBase64url(v, 32);
const isSig = (v: unknown): v is string => isBase64url(v, 64);

const isScope = (v: unknown): boolean =>
  isObject(v) && isTexts(v['privileges']) && (v['level'] === 'org' || (v['level'] === 'language' && isText(v['languageId'])));

function isWorkerLink(v: unknown): v is WorkerLink {
  if (!isObject(v) || !isText(v['kid']) || !isSig(v['sig']) || !isObject(v['body'])) return false;
  const { installKey, profileId, deviceId, expiresAt, org } = v['body'];
  // One object, not a list: a link names one organization, so a teammate learns of no other.
  return isKey(installKey) && isText(profileId) && isText(deviceId) && isTime(expiresAt) && isObject(org) &&
    isText(org['orgId']) && isTime(org['orgSeq']) && Array.isArray(org['scopes']) && org['scopes'].every(isScope);
}

function isJoinPass(v: unknown): v is JoinPass {
  if (!isObject(v) || v['kind'] !== 'pass@1' || !isText(v['kid']) || !isSig(v['sig']) || !isObject(v['body'])) return false;
  const { passId, orgId, languageId, inviter, inviterKey, roles, maxUses, expiresAt } = v['body'];
  return isText(passId) && isText(orgId) && isText(languageId) && isText(inviter) && isKey(inviterKey) && isTime(maxUses) && isTime(expiresAt) &&
    Array.isArray(roles) && roles.every((r: unknown) => isObject(r) && isText(r['roleId']) && isTexts(r['privileges']));
}

function isInviteLink(v: unknown): v is InviteLink {
  if (!isObject(v) || !isSig(v['sig']) || !isObject(v['body'])) return false;
  const { pass, installKey, idSalt, profileId, deviceId, name, roleId, privileges } = v['body'];
  return isKey(installKey) && isBase64url(idSalt, 16) && isText(profileId) && isText(deviceId) && typeof name === 'string' && isText(roleId) && isTexts(privileges) && isJoinPass(pass);
}

/** What these scopes give in one language. */
function privilegesAt(org: ChainOrg, languageId: string): Set<Privilege> {
  const out = new Set<Privilege>();
  for (const scope of org.scopes) if (scope.level === 'org' || scope.languageId === languageId) for (const p of scope.privileges) out.add(p);
  return out;
}

/** A check that throws is a failed check: a real verify may throw on bytes it cannot read. */
export async function signedBy(verify: Verify, key: string, message: Uint8Array, sig: string): Promise<boolean> {
  try {
    return (await verify(key, message, sig)) === true;
  } catch {
    return false;
  }
}

/**
 * A newcomer's id, worked out from their key, so that they cannot choose an admin's
 * or an imported person's: the first 16 bytes of the hash, with UUID version 4 and
 * variant bits set, in lower case. Null for a key or salt that is not canonical
 * base64url of the right length. The salt gives a second person on one install a
 * new id rather than the first person's account.
 */
export async function newcomerProfileId(installKey: string, idSalt: string, sha256: Sha256): Promise<string | null> {
  const key = isKey(installKey) ? base64urlDecode(installKey) : null;
  const salt = isBase64url(idSalt, 16) ? base64urlDecode(idSalt) : null;
  if (!key || !salt) return null;
  const id = (await sha256(newcomerIdBytes(key, salt))).slice(0, 16);
  id[6] = (id[6]! & 0x0f) | 0x40;
  id[8] = (id[8]! & 0x3f) | 0x80;
  const hex = bytesToHex(id);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type Accepted = Extract<ChainVerdict, { ok: true }>;
type Refused = Extract<ChainVerdict, { ok: false }>;
const refuse = (reason: string): Refused => ({ ok: false, reason });

/** Null skips expiry. Written so that a clock of NaN counts as past, not as still good. */
const isPast = (now: number | null, expiresAt: number) => now !== null && !(now <= expiresAt);

const isRevoked = (list: RevocationList | undefined, key: string, profileId: string) =>
  !!list && list.keys.some(([k, p]) => k === key && p === profileId);

/**
 * Carl's answer 4, per event: work dated before `revoked_at` stands, and later work
 * from that key and person is refused. A clock that cannot be read counts as later.
 */
export function revokedLater(list: RevocationList | undefined, key: string, profileId: string, hlc: unknown): boolean {
  const entry = list?.keys.find(([k, p]) => k === key && p === profileId);
  return !!entry && !(isHlc(hlc) && decodeHlc(hlc).wallMs < entry[2]);
}

async function checkWorkerLink(link: WorkerLink, opts: CheckChainOptions): Promise<Accepted | Refused> {
  const { installKey, profileId, deviceId, expiresAt, org } = link.body;
  const root = opts.rootKeys.get(link.kid);
  if (root === undefined) return refuse('unknown certificate key');
  if (org.orgId !== opts.orgId) return refuse('wrong organization');
  if (isPast(opts.now, expiresAt)) return refuse('certificate expired');
  if (isRevoked(opts.revoked, installKey, profileId)) return refuse('key revoked');
  if (!await signedBy(opts.verify, root, nearbyBytes('link', linkText(link, '')), link.sig)) return refuse('bad certificate signature');
  return { ok: true, holder: { installKey, profileId, deviceId }, org, links: 1 };
}

/** That is `mayGrantRole`'s rule on signed privileges, so it works with a stale fold. Uses are counted only by the server, at first contact. */
async function checkInviteLink(link: InviteLink, before: Accepted, prevSig: string, opts: CheckChainOptions): Promise<Accepted | Refused> {
  const { pass, installKey, idSalt, profileId, deviceId, name, roleId, privileges } = link.body;
  const inviter = before.holder;
  const root = opts.rootKeys.get(pass.kid);
  if (root === undefined) return refuse('unknown pass key');
  if (pass.body.orgId !== opts.orgId) return refuse('wrong organization');
  if (opts.languageId !== undefined && pass.body.languageId !== opts.languageId) return refuse('wrong language');
  if (pass.body.inviterKey !== inviter.installKey || pass.body.inviter !== inviter.profileId) return refuse('pass names someone else');
  if (isPast(opts.now, pass.body.expiresAt)) return refuse('pass expired');
  if (installKey === inviter.installKey) return refuse('a link cannot vouch for its own key');

  const role = pass.body.roles.find((r) => r.roleId === roleId);
  const chosen = new Set(privileges);
  if (!role || chosen.size !== new Set(role.privileges).size || !role.privileges.every((p) => chosen.has(p))) return refuse('role is not on the pass');
  if (privileges.some((p) => MANAGE_PRIVILEGES.includes(p))) return refuse('a pass cannot grant a manage privilege');
  const held = privilegesAt(before.org, pass.body.languageId);
  if (!held.has('invite_members') || !privileges.every((p) => held.has(p))) return refuse('inviter could not grant this role');

  // By exact string: a chosen id could name an admin, or an imported person who has not signed in yet.
  if (profileId !== await newcomerProfileId(installKey, idSalt, opts.sha256)) return refuse('id does not follow from the key');
  if (isRevoked(opts.revoked, installKey, profileId)) return refuse('key revoked');
  if (!await signedBy(opts.verify, root, nearbyBytes('pass', passText(pass)), pass.sig)) return refuse('bad pass signature');
  if (!await signedBy(opts.verify, inviter.installKey, nearbyBytes('link', linkText(link, prevSig)), link.sig)) return refuse('bad link signature');
  return {
    ok: true,
    holder: { installKey, profileId, deviceId, name },
    org: { orgId: before.org.orgId, orgSeq: before.org.orgSeq, scopes: [{ level: 'language', languageId: pass.body.languageId, privileges }] },
    links: before.links + 1,
    inviter: inviter.profileId,
    roleId
  };
}

/**
 * Whose chain this is, or why not. A loop over the links. It takes unknowns, since a
 * chain comes off the wire with only its size and depth checked, and it never throws
 * on what it is given. For a two-link chain the holder is the newcomer, and `org` is
 * the invite link's privileges at language scope, with the first link's `orgSeq`.
 */
export async function checkChain(chain: readonly unknown[], opts: CheckChainOptions): Promise<ChainVerdict> {
  if (!Array.isArray(chain) || chain.length === 0) return refuse('no chain');
  if (chain.length > (opts.maxLinks ?? 2)) return refuse('too many links');
  // A phone spends no signature work on a form it does not know.
  for (const [i, link] of (chain as readonly unknown[]).entries()) {
    const kind = isObject(link) ? link['kind'] : undefined;
    if (kind !== (i === 0 ? 'worker@1' : 'invite@1')) return refuse(kind === 'worker@1' || kind === 'invite@1' ? 'link out of order' : 'unknown link kind');
  }
  // `canonicalJson` recurses and throws, and the signed texts are built on it.
  const malformed = nearbyPayloadError(chain);
  if (malformed !== null) return refuse(`malformed chain: ${malformed}`);

  const [first, ...later] = chain as readonly unknown[];
  if (!isWorkerLink(first)) return refuse('malformed link');
  let verdict = await checkWorkerLink(first, opts);
  let prevSig = first.sig;
  for (const link of later) {
    if (!verdict.ok) return verdict;
    if (!isInviteLink(link)) return refuse('malformed link');
    verdict = await checkInviteLink(link, verdict, prevSig, opts);
    prevSig = link.sig;
  }
  return verdict;
}

/**
 * Who may do what, once this phone has checked some chains. `orgSeqHere` is
 * `max(store.cursor, the organization checkpoint's serverSeq)`. A one-link chain
 * answers only when it was signed past what this fold has seen, so someone added last
 * week is not turned away, and a fold that has seen further beats it, on a starting
 * copy too. It then decides outright, so a newer certificate with less also counts.
 * Everything else answers from the fold: a two-link chain gets its own rule when
 * phase 6 issues any, and until then its holder waits (the door's `retry: true`).
 */
export function peopleWithChains(org: OrgState, verdicts: Iterable<ChainVerdict>, orgSeqHere: number): NearbyPeople {
  const fold = peopleFromOrg(org);
  // A Map, because a profile id arrives off the wire. A person's newest chain speaks for them, whichever phone it came from.
  const newest = new Map<string, ChainOrg>();
  for (const v of verdicts) {
    if (!v.ok || v.links !== 1) continue;
    const held = newest.get(v.holder.profileId);
    if (!held || v.org.orgSeq > held.orgSeq) newest.set(v.holder.profileId, v.org);
  }
  return {
    privilegesIn(profileId, languageId) {
      const chain = newest.get(profileId);
      return chain && chain.orgSeq > orgSeqHere ? privilegesAt(chain, languageId) : fold.privilegesIn(profileId, languageId);
    },
    languageListed: fold.languageListed
  };
}
