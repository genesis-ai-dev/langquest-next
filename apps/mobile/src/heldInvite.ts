/**
 * The held invite: the one piece of state the invite flow has
 * (docs/invites-and-accounts.md section 4). Pure, so every situation in
 * section 6 is a test, not a hope.
 *
 * A scanned invite is held by the phone until it has made someone a member.
 * Screens never remember an invite: they read the held one. Who it is for is
 * part of it (`claim`), so it is used by the account the person chose and
 * never by whoever signs in next on a shared phone.
 */

/** Who the held invite is for. */
export type Claim =
  /** Scanned; nobody has said who is joining. Never used without asking. */
  | { kind: 'unclaimed' }
  /** A signed-out person chose "new person" or "I have an account": the next account to sign in here. */
  | { kind: 'next-account' }
  /** This account, now or when the phone is next online. */
  | { kind: 'account'; actorId: string };

export interface HeldInvite {
  token: string;
  orgId?: string;
  /** When it was scanned (ms). */
  heldAt: number;
  claim: Claim;
  /** When the invite itself expires (ms), once the server has said (`withExpiry`). */
  expiresAt?: number;
  /**
   * The one id for joining with this invite as a new person (the `join`
   * function, decisions.md 59): a retry after a lost reply signs the same
   * account in instead of making a second.
   */
  joinId?: string;
}

/**
 * How long an invite nobody has used is held when the server has not said
 * when it expires (scanned offline): a week, as long as an invite lasts
 * unless its maker chose otherwise. Someone who scans in a village and finds
 * a signal days later still joins; claims keep it from surprising the next
 * person on a shared phone.
 */
export const HOLD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Scanning holds the key. Scanning the one already held keeps who it is for
 * (a second scan is not a second decision); any other key replaces it.
 */
export function holdScanned(prev: HeldInvite | null, key: { token: string; orgId?: string }, now: number): HeldInvite {
  // The same key keeps what is known about it: who it is for, its expiry, its join id.
  if (prev && prev.token === key.token) return { ...prev, ...(key.orgId ? { orgId: key.orgId } : {}), heldAt: now };
  return { token: key.token, ...(key.orgId ? { orgId: key.orgId } : {}), heldAt: now, claim: { kind: 'unclaimed' } };
}

/** The server said when the invite expires: hold it until then, not a fixed time. */
export function withExpiry(held: HeldInvite, expiresAtIso: string | undefined): HeldInvite {
  const at = expiresAtIso ? Date.parse(expiresAtIso) : NaN;
  return Number.isFinite(at) ? { ...held, expiresAt: at } : held;
}

/** The person said who is joining. */
export function claim(held: HeldInvite, who: 'next-account' | { actorId: string }): HeldInvite {
  return { ...held, claim: who === 'next-account' ? { kind: 'next-account' } : { kind: 'account', actorId: who.actorId } };
}

export type Step =
  /** Nothing to do (no invite, or not for this session). */
  | { step: 'none' }
  /** Let it go: too old. */
  | { step: 'drop' }
  /** Show it and ask "Join as you?". */
  | { step: 'ask'; held: HeldInvite }
  /** Use it for this account; `held` is bound to the account, to save first. */
  | { step: 'redeem'; held: HeldInvite };

/**
 * What the app does with the held invite now. The only input besides the
 * invite is who is signed in; screens, timing and the order of effects do
 * not enter into it.
 */
export function nextStep(held: HeldInvite | null, actorId: string | null, now: number): Step {
  if (!held) return { step: 'none' };
  if (now > (held.expiresAt ?? held.heldAt + HOLD_MS) || now < held.heldAt - HOLD_MS) return { step: 'drop' };
  if (!actorId) return { step: 'none' };
  switch (held.claim.kind) {
    case 'unclaimed': return { step: 'ask', held };
    case 'next-account': return { step: 'redeem', held: claim(held, { actorId }) };
    case 'account': return held.claim.actorId === actorId ? { step: 'redeem', held } : { step: 'none' };
  }
}

export type DeadReason = 'expired' | 'used' | 'not_found' | 'retired';

export type Outcome =
  | { kind: 'joined'; orgId: string }
  /** Not reached, or the server was busy: keep it and try again later. */
  | { kind: 'retry' }
  /** The server said this key will never work: let it go and say why. */
  | { kind: 'dead'; reason: DeadReason };

/**
 * Read a failed redemption. Only the server's own refusals end a held
 * invite; anything else (no signal, a timeout, a fault) keeps it, because
 * dropping a good invite is the one mistake the person cannot undo.
 */
export function outcomeOfError(message: string): Outcome {
  const m = message.toLowerCase();
  if (m.includes('expired')) return { kind: 'dead', reason: 'expired' };
  if (m.includes('already used')) return { kind: 'dead', reason: 'used' };
  if (m.includes('not found') || m.includes('does not look like an invite')) return { kind: 'dead', reason: 'not_found' };
  if (m.includes('no longer available')) return { kind: 'dead', reason: 'retired' };
  return { kind: 'retry' };
}

/** What the server says about a key before it is used (`preview_invite`). */
export interface InvitePreview {
  status: 'ok' | 'joined' | 'expired' | 'used' | 'not_found' | 'retired';
  orgId?: string;
  orgName?: string | null;
  roleName?: string | null;
  scopeLevel?: 'org' | 'project' | 'lane' | null;
  languageName?: string | null;
  label?: string | null;
  invitedBy?: string | null;
  group?: boolean;
  expiresAt?: string;
}

/** Why a key cannot be used, in the words the person sees. */
export function deadMessage(reason: DeadReason, from?: string | null): string {
  const ask = from ? `Ask ${from} for a new one.` : 'Ask for a new one.';
  switch (reason) {
    case 'expired': return `This invite has expired. ${ask}`;
    case 'used': return `This invite has already been used. ${ask}`;
    case 'not_found': return `This invite isn't valid. Check you scanned the whole code, or ${ask.charAt(0).toLowerCase()}${ask.slice(1)}`;
    case 'retired': return `This invite can no longer be used. ${ask}`;
  }
}

/**
 * The card on the scan screen: who the invite is for and what it gives, from
 * the server's preview only. Without one (offline), a neutral line.
 */
export function inviteCard(p: InvitePreview | null): { title: string; detail: string | null; from: string | null } {
  if (!p || p.status === 'not_found') return { title: 'Invitation to join an organization', detail: null, from: null };
  const title = p.label && !p.group ? `Invite for ${p.label}` : p.label ? p.label : `Invitation to ${p.orgName ?? 'an organization'}`;
  const where = p.scopeLevel === 'lane' && p.languageName ? `${p.languageName} · ${p.orgName ?? ''}`.replace(/ · $/, '') : p.orgName ?? null;
  const detail = [p.roleName, where].filter(Boolean).join(' · ') || null;
  return { title, detail, from: p.invitedBy ?? null };
}
