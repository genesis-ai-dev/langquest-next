import { decodeHlc, isHlc } from './hlc';
import type { NearbyPeople } from './nearbyDoor';
import { peopleFromOrg } from './nearbyDoor';
import { base64urlDecode, bytesToHex, isBase64url, linkText, nearbyBytes, nearbyPayloadError, newcomerIdBytes, passText } from './nearbySigning';
import { mayGrantRole, type OrgState } from './org';
import { MANAGE_PRIVILEGES, type Privilege } from './orgTerms';

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
  | { ok: true; holder: { installKey: string; profileId: string; deviceId: string; name?: string }; org: ChainOrg; links: number; inviter?: string; inviterKey?: string; roleId?: string }
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

/** What a newcomer asked with, which the invite link names (`join-ask`, docs/nearby-sync-plan.md 14.1). */
export interface JoinAsk {
  installKey: string;
  idSalt: string;
  profileId: string;
  deviceId: string;
  name: string;
}

/**
 * Why this inviter may not let this newcomer in under this pass and role, or null. The one rule
 * the issuing side and `checkChain` share, so a phone never signs a link its teammates refuse.
 * That is `mayGrantRole`'s rule on signed privileges, so it works with a stale fold. Uses are
 * counted only by the server, at first contact. Signatures are the caller's.
 */
export async function inviteRefusal(
  pass: JoinPass, inviter: Extract<ChainVerdict, { ok: true }>, ask: JoinAsk & { roleId: string; privileges: readonly Privilege[] }, opts: Pick<CheckChainOptions, 'orgId' | 'languageId' | 'now' | 'sha256' | 'revoked'>
): Promise<string | null> {
  const { holder } = inviter;
  if (pass.body.orgId !== opts.orgId || inviter.org.orgId !== opts.orgId) return 'wrong organization';
  if (opts.languageId !== undefined && pass.body.languageId !== opts.languageId) return 'wrong language';
  if (pass.body.inviterKey !== holder.installKey || pass.body.inviter !== holder.profileId) return 'pass names someone else';
  if (isPast(opts.now, pass.body.expiresAt)) return 'pass expired';
  if (ask.installKey === holder.installKey) return 'a link cannot vouch for its own key';

  const role = pass.body.roles.find((r) => r.roleId === ask.roleId);
  const chosen = new Set(ask.privileges);
  if (!role || chosen.size !== new Set(role.privileges).size || !role.privileges.every((p) => chosen.has(p))) return 'role is not on the pass';
  if (ask.privileges.some((p) => MANAGE_PRIVILEGES.includes(p))) return 'a pass cannot grant a manage privilege';
  const held = privilegesAt(inviter.org, pass.body.languageId);
  if (!held.has('invite_members') || !ask.privileges.every((p) => held.has(p))) return 'inviter could not grant this role';

  // By exact string: a chosen id could name an admin, or an imported person who has not signed in yet.
  if (ask.profileId !== await newcomerProfileId(ask.installKey, ask.idSalt, opts.sha256)) return 'id does not follow from the key';
  if (isRevoked(opts.revoked, ask.installKey, ask.profileId)) return 'key revoked';
  return null;
}

async function checkInviteLink(link: InviteLink, before: Accepted, prevSig: string, opts: CheckChainOptions): Promise<Accepted | Refused> {
  const { pass, installKey, profileId, deviceId, name, roleId, privileges } = link.body;
  const inviter = before.holder;
  const root = opts.rootKeys.get(pass.kid);
  if (root === undefined) return refuse('unknown pass key');
  const refused = await inviteRefusal(pass, before, link.body, opts);
  if (refused !== null) return refuse(refused);
  if (!await signedBy(opts.verify, root, nearbyBytes('pass', passText(pass)), pass.sig)) return refuse('bad pass signature');
  if (!await signedBy(opts.verify, inviter.installKey, nearbyBytes('link', linkText(link, prevSig)), link.sig)) return refuse('bad link signature');
  return {
    ok: true,
    holder: { installKey, profileId, deviceId, name },
    org: { orgId: before.org.orgId, orgSeq: before.org.orgSeq, scopes: [{ level: 'language', languageId: pass.body.languageId, privileges }] },
    links: before.links + 1,
    inviter: inviter.profileId,
    inviterKey: inviter.installKey,
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
 * May this inviter still let someone in under this role, by this fold? Core's twin of the
 * server's `_invite_still_granted` and the stops of Carl's answer 9 that a fold can speak for:
 * the inviter removed or lost Invite or the role's privileges (`mayGrantRole`), the role
 * retired or unknown, the role grown a manage privilege (answer 8), or the inviter's key
 * revoked. Uses and an organization turned off stay with the server.
 */
export function inviteStillGranted(org: OrgState, at: { inviter: string; inviterKey: string; roleId: string; languageId: string }, revoked?: RevocationList): boolean {
  if (isRevoked(revoked, at.inviterKey, at.inviter)) return false;
  if (!Object.prototype.hasOwnProperty.call(org.roles, at.roleId)) return false;
  const role = org.roles[at.roleId]!;
  if (role.retired || (role.privileges.value ?? []).some((p) => MANAGE_PRIVILEGES.includes(p))) return false;
  return mayGrantRole(org, at.inviter, at.roleId, { level: 'language', languageId: at.languageId });
}

const hasEntry = (org: OrgState, profileId: string) =>
  Object.prototype.hasOwnProperty.call(org.members, profileId) && Object.keys(org.members[profileId]!).length > 0;

/**
 * Who may do what, once this phone has checked some chains (docs/nearby-sync-plan.md 5.12,
 * Chains). `orgSeqHere` is `max(store.cursor, the organization checkpoint's serverSeq)`.
 *
 * A one-link chain answers only when it was signed past what this fold has seen, so someone
 * added last week is not turned away, and a fold that has seen further beats it, on a starting
 * copy too. It then decides outright, so a newer certificate with less also counts.
 *
 * A two-link chain (a newcomer) answers only while this fold has no entry at all for them, so a
 * removal sticks and an admin's raised role answers from the fold. An inviter whose key is on
 * the list stops it at once. With the fold at or past the chain's `orgSeq`, the inviter must
 * still be able to grant the role (`inviteStillGranted`), and the answer is the signed
 * privileges the role still holds in the fold; below it, the signed link decides, so a team that
 * has not synced carries on. Everything else answers from the fold.
 */
export function peopleWithChains(org: OrgState, verdicts: Iterable<ChainVerdict>, orgSeqHere: number, revoked?: RevocationList): NearbyPeople {
  const fold = peopleFromOrg(org);
  // Maps, because a profile id arrives off the wire. A person's newest chain speaks for them, whichever phone it came from.
  const newest = new Map<string, ChainOrg>();
  const newcomers = new Map<string, Extract<ChainVerdict, { ok: true }>>();
  for (const v of verdicts) {
    if (!v.ok) continue;
    const id = v.holder.profileId;
    if (v.links === 1) {
      const held = newest.get(id);
      if (!held || v.org.orgSeq > held.orgSeq) newest.set(id, v.org);
    } else if (v.links === 2 && v.inviter !== undefined && v.inviterKey !== undefined && v.roleId !== undefined) {
      const held = newcomers.get(id);
      if (!held || v.org.orgSeq > held.org.orgSeq) newcomers.set(id, v);
    }
  }
  const asNewcomer = (v: Extract<ChainVerdict, { ok: true }>, languageId: string): Set<Privilege> => {
    const signed = privilegesAt(v.org, languageId);
    const scope = v.org.scopes[0];
    const at = { inviter: v.inviter!, inviterKey: v.inviterKey!, roleId: v.roleId!, languageId: scope?.languageId ?? '' };
    if (isRevoked(revoked, at.inviterKey, at.inviter)) return new Set();
    if (v.org.orgSeq > orgSeqHere) return signed;
    if (!inviteStillGranted(org, at, revoked)) return new Set();
    const now = new Set(org.roles[at.roleId]!.privileges.value ?? []);
    return new Set([...signed].filter((p) => now.has(p)));
  };
  return {
    privilegesIn(profileId, languageId) {
      const chain = newest.get(profileId);
      if (chain && chain.orgSeq > orgSeqHere) return privilegesAt(chain, languageId);
      const newcomer = newcomers.get(profileId);
      if (newcomer && !hasEntry(org, profileId)) return asNewcomer(newcomer, languageId);
      return fold.privilegesIn(profileId, languageId);
    },
    languageListed: fold.languageListed
  };
}
