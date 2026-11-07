import type { Privilege } from './orgTerms';

/**
 * Who a nearby phone is, without a server (docs/nearby-sync-plan.md 5.12, Chains).
 * The types the wire and the signing texts name. `checkChain` and
 * `peopleWithChains` come with phase 2, against these shapes.
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
