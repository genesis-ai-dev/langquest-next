import { mayWriteFiles, privilegesFor, type OrgState } from '@langquest-next/core';
import { parseRevocationList, peopleWithChains, type ChainLink, type RevocationList } from '@langquest-next/core/nearby';
import {
  nearbyClient, nearbyFiles, SqliteNearbyMarks, type NearbyCrypto, type NearbyFetchFile, type NearbyGate, type NearbyMaker, type NearbyMarks, type NearbySigner
} from '@langquest-next/sync/nearby';
import * as Crypto from 'expo-crypto';
import { File, Paths } from 'expo-file-system';
import { installKey } from '../server/nearbyKey';
import { fileLedgerDriver, getStore } from '../storage/store';
import type { BlobStore } from '../sync/blobs';
import { currentHoldChoice, nearbyOrg } from './holdChoice';
import { nobleSha256, nobleVerify, phoneCryptoOf } from './nearbyCryptoModel';
import { parseCertKeys, parseChains, type HeldChains, type SignedText } from './nearbyModel';
import type { NearbyFilesOptions } from './nearbyPhone';

/**
 * Nearby sync's pieces on an Android phone (docs/nearby-sync-plan.md 5.5, 5.12): the Worker's
 * public keys, the chains and revocation lists this phone keeps, the client's nearby half,
 * and the door's lookup with real Ed25519 (`@noble/curves`) and SHA-256 (`@noble/hashes`).
 * Chains (`nearbyChain:<profileId>`) and lists (`nearbyRevoked:<org>`) are plain meta rows
 * (5.12, "The store"): what a teammate's phone already holds, outside decision 168's seal, so a
 * signed-out person's unsent work can still be signed (Carl's answer 5). Keys stay in the
 * Keystore (server/nearbySecrets.ts) and are never logged.
 */

/** `EXPO_PUBLIC_NEARBY_CERT_KEYS`, inlined at bundle time: a phone trusts only what is bundled in it. */
export const ROOT_KEYS: ReadonlyMap<string, string> = parseCertKeys(process.env.EXPO_PUBLIC_NEARBY_CERT_KEYS);

const chainKey = (profileId: string) => `nearbyChain:${profileId}`;
/** Who has a `nearbyChain:` row here, since meta has no prefix scan: kept beside the rows, and cleared with them. */
const CHAIN_PEOPLE = 'nearbyChainPeople';
const revokedKey = (orgId: string) => `nearbyRevoked:${orgId}`;
const random = (n: number) => Crypto.getRandomBytes(n);

/** Each person's chains, read once and kept beside the meta row, so `holdsCertificate` can answer at once. */
const chains = new Map<string, HeldChains>();

export async function readChains(profileId: string): Promise<HeldChains> {
  const held = chains.get(profileId);
  if (held) return held;
  const read = parseChains(await (await getStore()).meta(chainKey(profileId)));
  chains.set(profileId, read);
  return read;
}

/** Replaced whole, never merged, so a turned-off organization's goes (5.12). */
export async function keepChains(profileId: string, next: HeldChains): Promise<void> {
  const store = await getStore();
  await store.setMeta(chainKey(profileId), JSON.stringify(next));
  chains.set(profileId, next);
  const people = await chainPeople();
  if (!people.includes(profileId)) await store.setMeta(CHAIN_PEOPLE, JSON.stringify([...people, profileId]));
}

/** Everyone on this phone a certificate answer was ever kept for, signed in or not. */
export async function chainPeople(): Promise<string[]> {
  try {
    const parsed = JSON.parse((await (await getStore()).meta(CHAIN_PEOPLE)) ?? '[]') as unknown;
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

/** A new install key: every chain on this phone named the old one, whoever's it was (5.12, `revoked`). */
export async function forgetAllChains(): Promise<void> {
  const store = await getStore();
  await store.clearMeta('nearbyChain:');
  await store.clearMeta(CHAIN_PEOPLE);
  chains.clear();
}

/** Does this phone hold this person's certificate for this organization? Only then is there anyone to claim to. */
export function holdsCertificate(profileId: string, orgId: string): boolean {
  return chains.get(profileId)?.[orgId] !== undefined;
}

/** The newest revocation list held for an organization, as signed. Kept only after its signature checked (nearbyIdentity.android.ts). */
export async function readRevoked(orgId: string): Promise<{ list: RevocationList; signed: SignedText } | null> {
  const raw = await (await getStore()).meta(revokedKey(orgId));
  if (!raw) return null;
  try {
    const signed = JSON.parse(raw) as SignedText;
    const list = parseRevocationList(signed.text, { orgId, kid: signed.kid });
    return list && typeof signed.sig === 'string' ? { list, signed: { orgId, text: signed.text, kid: signed.kid, sig: signed.sig } } : null;
  } catch {
    return null;
  }
}

export async function keepRevoked(signed: SignedText): Promise<void> {
  await (await getStore()).setMeta(revokedKey(signed.orgId), JSON.stringify(signed));
}

/**
 * One nearby half per person and organization, shared by every language client of theirs on
 * this phone, so a row taken in one language is known to the others' pulls at once. It asks the
 * Worker to attest pulled work only while this person holds a chain for that organization.
 */
const makers = new Map<string, NearbyMaker>();

export async function nearbyMakerFor(orgId: string, actorId: string): Promise<NearbyMaker> {
  await readChains(actorId);
  const id = `${actorId}\n${orgId}`;
  let maker = makers.get(id);
  if (!maker) {
    maker = nearbyClient({ sha256: nobleSha256, holdsCertificate: () => holdsCertificate(actorId, orgId) });
    makers.set(id, maker);
  }
  return maker;
}

/** This install's `NearbyCrypto`, or null until a key is made. */
export async function phoneCrypto(): Promise<NearbyCrypto | null> {
  const key = await installKey();
  return key ? phoneCryptoOf(key.seed, random) : null;
}

/**
 * The door's lookup for one organization (`NearbyGate`): who may do what from the fold, unless
 * a checked chain signed past `orgSeqHere` decides (`peopleWithChains`), the newest
 * revocation list held, and what a stored chain is checked with when the door runs again.
 */
export async function nearbyGateFor(orgId: string, org: OrgState, orgSeqHere: number): Promise<NearbyGate> {
  const revoked = (await readRevoked(orgId))?.list;
  return {
    people: (verdict) => peopleWithChains(org, verdict ? [verdict] : [], orgSeqHere),
    ...(revoked ? { revoked } : {}),
    rootKeys: ROOT_KEYS,
    verify: nobleVerify,
    sha256: nobleSha256
  };
}

/**
 * The signer for one organization: this install's key, and the chain of each of these people
 * held here, signed in or not (Carl's answer 5). Null with no install key. Only a session
 * someone signed in opened calls it (5.5).
 */
export async function nearbySignerFor(orgId: string, actorIds: readonly string[]): Promise<NearbySigner | null> {
  const crypto = await phoneCrypto();
  if (!crypto) return null;
  const held = new Map<string, ChainLink[]>();
  for (const actorId of actorIds) {
    const chain = (await readChains(actorId))[orgId];
    if (chain) held.set(actorId, chain as ChainLink[]);
  }
  return { publicKey: crypto.publicKey, sign: crypto.sign, sha256: crypto.sha256, chainFor: (actorId) => held.get(actorId) ?? null };
}

/**
 * The signer a Share nearby that `signedIn` opened uses: this install's key, and the chain for
 * this organization of everyone on this phone who holds one, so a signed-out person's unsent work
 * is signed and travels too (Carl's answer 5, docs/nearby-sync-plan.md 5.5 and 5.12
 * `signUnsigned`). Anyone here with no certificate for this organization stays unsigned.
 */
export async function phoneSignerFor(orgId: string, signedIn: string): Promise<NearbySigner | null> {
  const others = (await chainPeople()).filter((p) => p !== signedIn);
  return nearbySignerFor(orgId, [signedIn, ...others]);
}

// ---- teammates' files (docs/nearby-sync-plan.md 5.6) -----------------------------------

/**
 * A language session's nearby files on an Android phone (docs/nearby-sync-plan.md 5.6): the marks
 * in the file ledger's database, the file store's half of a nearby move, "Hold teammates'
 * recordings" as `useNearbyIdentity` worked it out, and what this person may do from the
 * organization's fold. The native write into the staging name arrives with the radios; this is
 * where it lands and how it is kept.
 */

const NEARBY_STAGING = '.nearby.part';

let marks: Promise<NearbyMarks> | undefined;
function nearbyMarks(): Promise<NearbyMarks> {
  marks ??= fileLedgerDriver().then((driver) => SqliteNearbyMarks.open(driver)).catch((error: unknown) => { marks = undefined; throw error; });
  return marks;
}

type Stored = Parameters<BlobStore['stagingFor']>[0];

/** The file store's half of a nearby move: `<hash>.<format>.nearby.part`, renamed only once native's hash matched. */
export function nearbyFetchFileOf(store: BlobStore): NearbyFetchFile {
  const staging = (file: { hash: string; format: string }): File | null => {
    try { return store.stagingFor(file as Stored, true); } catch { return null; }
  };
  return {
    stagingUri: (file) => staging(file)?.uri ?? null,
    commit: async (file, stagingUri, size) => {
      // Only the name this store gave for this file: a staging name for one hash never becomes another's.
      if (staging(file)?.uri !== stagingUri) throw new Error('not this file\'s staging name');
      store.commitStaged(file as Stored, size, true);
    },
    discard: async (stagingUri) => {
      if (!stagingUri.endsWith(NEARBY_STAGING)) return;
      try { new File(stagingUri).delete(); } catch { /* the store's startup cleanup takes any staging file left */ }
    },
    uriOf: (file) => store.uriFor(file as Stored),
    freeBytes: () => Paths.availableDiskSpace,
    remove: (files) => store.remove(files as Parameters<BlobStore['remove']>[0])
  };
}

export async function nearbyFilesFor(orgId: string, actorId: string, languageId: string, files: BlobStore): Promise<NearbyFilesOptions> {
  const [held, crypto] = await Promise.all([nearbyMarks(), phoneCrypto()]);
  return {
    fetchFile: nearbyFetchFileOf(files),
    nearbyFiles: nearbyFiles({
      marks: held,
      installKey: () => crypto?.publicKey ?? null,
      canReview: (language) => {
        const org = nearbyOrg(orgId);
        return org ? privilegesFor(org, actorId, language).has('review') : true;
      }
    }),
    holdChoice: currentHoldChoice,
    // Not known yet: as today, everything here may go up.
    mayUpload: () => {
      const org = nearbyOrg(orgId);
      return org ? mayWriteFiles(org, actorId, languageId) : true;
    }
  };
}
