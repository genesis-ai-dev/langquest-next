import { inviteRefusal, type ChainVerdict, type InviteLink, type JoinAsk, type JoinPass, type RevocationList, type Sha256, type WorkerLink, inviteStillGranted } from './nearbyChain';
import { linkText, nearbyBytes, passIdOf, passText, passWindowAt } from './nearbySigning';
import { emptyOrgState, type OrgState } from './org';
import { MANAGE_PRIVILEGES, type Privilege } from './orgTerms';
import { OBJECT_MEMBER_NAMES } from './validate';

/**
 * Joining offline, core's half (docs/nearby-sync-plan.md 14.1, phase 6): the pass the Worker
 * signs, the invite link an inviter's phone signs under it, whether a pass still holds by this
 * phone's fold, the two pictures both phones show, the membership a newcomer's own phone
 * overlays, and the organization state a starting copy carries. Pure, behind the nearby entry.
 */

/** Uses a pass allows (section 14.1). Counted only by the server, at first contact. */
export const JOIN_PASS_USES = 10;

type PassRole = JoinPass['body']['roles'][number];
type Signer = (message: Uint8Array) => string | Promise<string>;

/**
 * The roles a pass may name (Carl's answer 8): not retired, no privilege in `MANAGE_PRIVILEGES`,
 * and every privilege held by the inviter in that language, which is `_invite_still_granted`'s
 * rule. Sorted by role id, each role's privileges sorted, so every answer in a window signs the
 * same text.
 */
export function passRoles(roles: Iterable<{ roleId: string; privileges: readonly Privilege[]; retired?: boolean }>, held: ReadonlySet<Privilege>): PassRole[] {
  if (!held.has('invite_members')) return [];
  const out: PassRole[] = [];
  for (const r of roles) {
    if (r.retired || r.privileges.length === 0) continue;
    if (r.privileges.some((p) => MANAGE_PRIVILEGES.includes(p) || !held.has(p))) continue;
    out.push({ roleId: r.roleId, privileges: [...new Set(r.privileges)].sort() });
  }
  return out.sort((a, b) => (a.roleId < b.roleId ? -1 : a.roleId > b.roleId ? 1 : 0));
}

/**
 * A pass's body for one organization, language, inviter and key (Carl's answer 17): one id per
 * 90-day window, derived from those, expiring at the window's end. Null with no role to offer,
 * since a pass with no role lets nobody in.
 */
export async function joinPassBody(
  p: { orgId: string; languageId: string; inviter: string; inviterKey: string; roles: readonly PassRole[]; nowMs: number }, sha256: Sha256
): Promise<JoinPass['body'] | null> {
  if (p.roles.length === 0) return null;
  const { window, expiresAt } = passWindowAt(p.nowMs);
  const passId = await passIdOf({ orgId: p.orgId, languageId: p.languageId, inviter: p.inviter, inviterKey: p.inviterKey, window }, sha256);
  return {
    passId, orgId: p.orgId, languageId: p.languageId, inviter: p.inviter, inviterKey: p.inviterKey,
    roles: p.roles.map((r) => ({ roleId: r.roleId, privileges: [...r.privileges] })), maxUses: JOIN_PASS_USES, expiresAt
  };
}

/** The Worker's signature over a pass, under its key `kid`. */
export async function signJoinPass(body: JoinPass['body'], kid: string, sign: Signer): Promise<JoinPass> {
  return { kind: 'pass@1', kid, body, sig: await sign(nearbyBytes('pass', passText({ kind: 'pass@1', kid, body }))) };
}

/**
 * The inviter's phone signs the second link (section 14.1, after the one tap), naming the chosen
 * role and its privileges as the pass gives them. It refuses by the rule `checkChain` applies, so
 * it never signs a link a teammate or the server would refuse: an expired pass, a pass for
 * another inviter, key or organization, a role off the pass or with a manage privilege, a role
 * this inviter could not grant, an id that does not follow from the key, or a self-link. The
 * caller checks that its own certificate still holds (expiry, the revocation list) and asks
 * `joinPassStop` of its fold first.
 */
export async function issueInviteLink(o: {
  inviterLink: WorkerLink; pass: JoinPass; ask: JoinAsk; roleId: string; now: number; sha256: Sha256; sign: Signer; revoked?: RevocationList;
}): Promise<{ ok: true; link: InviteLink } | { ok: false; reason: string }> {
  const { inviterLink, pass, ask, roleId } = o;
  const role = pass.body.roles.find((r) => r.roleId === roleId);
  if (!role) return { ok: false, reason: 'role is not on the pass' };
  if (!(o.now <= inviterLink.body.expiresAt)) return { ok: false, reason: 'certificate expired' };
  const inviter: Extract<ChainVerdict, { ok: true }> = {
    ok: true, holder: { installKey: inviterLink.body.installKey, profileId: inviterLink.body.profileId, deviceId: inviterLink.body.deviceId }, org: inviterLink.body.org, links: 1
  };
  const body: InviteLink['body'] = {
    pass, installKey: ask.installKey, idSalt: ask.idSalt, profileId: ask.profileId, deviceId: ask.deviceId, name: ask.name, roleId, privileges: [...role.privileges]
  };
  const refused = await inviteRefusal(pass, inviter, body, { orgId: inviterLink.body.org.orgId, languageId: pass.body.languageId, now: o.now, sha256: o.sha256, ...(o.revoked ? { revoked: o.revoked } : {}) });
  if (refused !== null) return { ok: false, reason: refused };
  return { ok: true, link: { kind: 'invite@1', body, sig: await o.sign(nearbyBytes('link', linkText({ kind: 'invite@1', body }, inviterLink.sig))) } };
}

/**
 * Why a pass this phone holds no longer lets anyone in under this role, by what this phone knows,
 * or null (Carl's answer 9: automatic stops only, and no withdraw). Past expiry; the inviter's key
 * on the revocation list; and, once this fold has seen as far as the inviter's certificate
 * (`orgSeqHere` at or past `certOrgSeq`), the inviter lost Invite or the role's privileges, the
 * role retired or grew a manage privilege. Below that the pass's own word stands, as a teammate's
 * `peopleWithChains` would read it. Uses and an organization turned off are the server's.
 */
export function joinPassStop(pass: JoinPass, roleId: string, here: { now: number; org: OrgState; orgSeqHere: number; certOrgSeq: number; revoked?: RevocationList }): string | null {
  const { body } = pass;
  if (!(here.now <= body.expiresAt)) return 'pass expired';
  const role = body.roles.find((r) => r.roleId === roleId);
  if (!role) return 'role is not on the pass';
  if (role.privileges.some((p) => MANAGE_PRIVILEGES.includes(p))) return 'a pass cannot grant a manage privilege';
  if (here.revoked?.keys.some(([k, p]) => k === body.inviterKey && p === body.inviter)) return 'key revoked';
  if (here.orgSeqHere < here.certOrgSeq) return null;
  return inviteStillGranted(here.org, { inviter: body.inviter, inviterKey: body.inviterKey, roleId, languageId: body.languageId }, here.revoked)
    ? null : 'inviter could not grant this role';
}

// ---- the two pictures ------------------------------------------------------------

/** How many pictures there are to choose from: decision 168's sixteen, in the app's order (`PICTURES`). */
export const JOIN_PICTURE_COUNT = 16;

/**
 * Two of decision 168's sixteen pictures, worked out from the session's `th`, which both sides
 * of one link share and a QR holder on another link does not (section 14.1). Distinct, in the
 * order shown. Each comes from a nibble of the SHA-256 of `th` under its own prefix, the second
 * skipping the first's, so there is no bias. The order of the app's list is part of the wire
 * contract, since both phones must show the same two.
 */
export async function joinPictures(thHex: string, sha256: Sha256): Promise<[number, number]> {
  const h = await sha256(nearbyBytes('pictures', thHex));
  const nibbles: number[] = [];
  for (const b of h) nibbles.push(b >> 4, b & 15);
  const first = nibbles[0]!;
  // 63 more nibbles, each a 15-in-16 chance to differ from the first: one always does, in practice.
  const second = nibbles.slice(1).find((n) => n !== first) ?? (first + 1) % JOIN_PICTURE_COUNT;
  return [first, second];
}

// ---- the newcomer's own membership -------------------------------------------------

/** What the checked chain gives a newcomer on their own phone: the link's signed role and privileges in its language. */
export interface ChainMembership {
  profileId: string;
  roleId: string;
  languageId: string;
  privileges: readonly Privilege[];
}

/** The role id the overlay gives a newcomer: never one a fold can hold, so no role of the organization's is changed. */
export const chainRoleId = (roleId: string) => `nearby-chain:${roleId}`;

/**
 * A newcomer's organization state with the chain's membership laid over it (section 14.1, 5,
 * Membership), so `privilegesFor` and everything below it answer as for a member. It gives the
 * link's signed privileges, under a role of its own, not the fold's role of that id: any teammate
 * may send a starting copy, and a role raised since would otherwise hand a local person a manage
 * privilege. None of those ever passes, whatever the link says. Once the fold has any entry for
 * the person, live or removed, the fold answers and this does nothing, so a removal sticks and a
 * raised role counts. It writes nothing to the log and leaves `org` as it was.
 */
export function withChainMembership(org: OrgState, member: ChainMembership | null): OrgState {
  if (!member || OBJECT_MEMBER_NAMES.includes(member.profileId)) return org;
  if (Object.prototype.hasOwnProperty.call(org.members, member.profileId) && Object.keys(org.members[member.profileId]!).length > 0) return org;
  const roleId = chainRoleId(member.roleId);
  const known = Object.prototype.hasOwnProperty.call(org.roles, member.roleId) ? org.roles[member.roleId] : undefined;
  const none = { hlc: '', eventId: '' };
  const privileges = [...new Set(member.privileges)].filter((p) => !MANAGE_PRIVILEGES.includes(p)).sort();
  return {
    ...org,
    roles: { ...org.roles, [roleId]: { name: { value: known?.name.value ?? member.roleId, ...none }, privileges: { value: privileges, ...none }, retired: false } },
    members: {
      ...org.members,
      [member.profileId]: { [`language:${member.languageId}`]: { roleId: { value: roleId, ...none }, removed: { value: false, ...none }, scope: { level: 'language', languageId: member.languageId } } }
    }
  };
}

// ---- the organization in a starting copy -------------------------------------------

const copied = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));

/**
 * What a starting copy carries of the organization (section 14.1, 4): it starts empty and copies
 * an allowlist, so a field added later stays out until someone adds it here. The organization's
 * name, `roles`, `license`, `library`, `recommendations`, this language, and the live members at
 * organization scope or at this language. `invites`, `joinDecisions`, `clusters`, redactions,
 * other languages and anyone removed stay out. Idempotent, since a newcomer may pass on a copy
 * they were given. The newcomer's first pull from 0 replaces it.
 */
export function newcomerOrgState(state: OrgState, languageId: string): OrgState {
  const out = emptyOrgState();
  out.org = copied(state.org);
  out.roles = copied(state.roles);
  out.license = copied(state.license);
  out.library = copied(state.library);
  out.recommendations = copied(state.recommendations);
  if (!OBJECT_MEMBER_NAMES.includes(languageId) && Object.prototype.hasOwnProperty.call(state.languages, languageId)) {
    out.languages[languageId] = copied(state.languages[languageId]!);
  }
  for (const [profileId, memberships] of Object.entries(state.members)) {
    if (OBJECT_MEMBER_NAMES.includes(profileId)) continue;
    for (const [key, m] of Object.entries(memberships)) {
      if (OBJECT_MEMBER_NAMES.includes(key) || m.removed.value !== false) continue;
      if (m.scope.level !== 'org' && m.scope.languageId !== languageId) continue;
      (out.members[profileId] ??= {})[key] = copied(m);
    }
  }
  return out;
}
