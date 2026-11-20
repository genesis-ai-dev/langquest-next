import { type AnyEvent, type LanguageState } from '@langquest-next/core';
import {
  checkChain, eventDigest, nearbyBytes, revokedLater, signedBy, type Attestation, type BatchManifest, type ChainLink, type ChainVerdict, type NearbyPeople, type RevocationList, type Sha256, type Verify
} from '@langquest-next/core/nearby';
import type { NearbyCrypto } from './nearbyLink';
import type { Message } from './nearbyWire';
import type { LocalEvent } from './types';

/**
 * What can be worked out about a page from a teammate with no store and no lock
 * (docs/nearby-sync-plan.md 5.12). Signature work is the slow part, and it runs before
 * `SyncClient.receiveNearby` takes the stream's turn.
 */

export type NearbyBatchPage = Extract<Message, { t: 'batch' }>;
export type NearbyClaimsPage = Extract<Message, { t: 'claims' }>;
export type NearbyPage = NearbyBatchPage | NearbyClaimsPage;

/** What the door takes on every path into `nearby`: a page, Try again, and a new reducer. */
export interface NearbyGate {
  /** Who may do what. A batch passes its chain's verdict, because a certificate newer than this phone's fold decides (`peopleWithChains`). */
  people(verdict?: ChainVerdict): NearbyPeople;
  /** The Worker's list, from phase 2. Later-dated events from a listed key and person stay out, one by one. */
  revoked?: RevocationList;
  /**
   * What a stored chain is checked with when the door runs again over rows already here, as it was
   * checked when their batch arrived. Without all three, the door goes by the fold alone.
   */
  rootKeys?: ReadonlyMap<string, string>;
  verify?: Verify;
  sha256?: Sha256;
}

export interface NearbyIntake extends NearbyGate {
  rootKeys: ReadonlyMap<string, string>;
  verify: Verify;
  sha256: Sha256;
  /** Per signer (core `NEARBY_BUDGET`). `maxManifestBytes` is stored manifest text, which rows and their JSON do not count. */
  budget: { maxRows: number; maxBytes: number; maxManifestBytes: number };
  /** The install key from Hello of the phone sending this: a claim's `via`, and whose budget claims spend. */
  peerKey: string;
  /** This phone's install key: a manifest it signed moves its counter. */
  ownKey?: string;
  /** Ranges a vector entry keeps; core's `NEARBY_VECTOR_MAX_RANGES` when left out. */
  maxRanges?: number;
}

export interface NearbySigner extends Pick<NearbyCrypto, 'publicKey' | 'sign' | 'sha256'> {
  /** This person's chain for this organization, or null when this phone holds no certificate for them. */
  chainFor(actorId: string): NearbyBatchPage['chain'] | null;
  maxRanges?: number;
}

export interface NearbySigned {
  batches: number;
  events: number;
  /** Rows left unsigned because their id or entity id does not name their author: for the screen. */
  unbound: number;
  /** Rows left unsigned because this phone holds no certificate for their author: for the screen. */
  noCertificate: number;
  /** The next number would not be a safe integer, so nothing more is signed under this key. */
  unsafeNumber: boolean;
}

export interface NearbyRefusal {
  id: string;
  reason: string;
  retry: boolean;
}

/** What became of one page. Anything but `taken` wrote nothing. */
export interface NearbyReceipt {
  outcome: 'taken' | 'ignored' | 'dropped';
  reason?: string;
  /** Dropped by the budget per signer; the number stays open. A session counts these to say `bye` with `busy`. */
  overBudget?: boolean;
  /** Rows written. */
  kept: number;
  refused: NearbyRefusal[];
  /** This page's number now counts as received. */
  counted: boolean;
  /** The page's newest stamp is far ahead of this phone's time, for one line on screen. The rows stand. */
  farAhead?: { actorId: string; hlc: string };
}

export const nearbyDropped = (reason: string, extra: Partial<NearbyReceipt> = {}): NearbyReceipt => ({ outcome: 'dropped', reason, kept: 0, refused: [], counted: false, ...extra });

/** A page that passed its signature, with what is known of each event before the door. */
interface Checked {
  /** Digest good, and what the manifest or attestation says of it holds. */
  events: AnyEvent[];
  refused: NearbyRefusal[];
  /** Ids of events refused for good with a matching digest: these count as here, and a digest mismatch never does. */
  settled: Set<string>;
}

/**
 * A checked chain as it is kept: only what its signatures speak for. A field nobody signed
 * would be stored and handed on at a teammate's say, a megabyte to a row, outside any budget.
 */
export function chainAsSigned(chain: readonly ChainLink[]): ChainLink[] {
  return chain.map((link) => (link.kind === 'worker@1' ? { kind: link.kind, kid: link.kid, body: link.body, sig: link.sig } : { kind: link.kind, body: link.body, sig: link.sig }));
}

/** An id as far as it can be told. `String` throws on an object with no way to print itself, and anything can come off the link. */
const wireId = (e: AnyEvent): string => (typeof e.id === 'string' ? e.id : '');

/** Never throws, whatever came off the link: an event no digest can stand for takes the mismatch path. */
async function digestOf(e: AnyEvent, sha256: Sha256): Promise<string> {
  try {
    return await eventDigest(e, sha256);
  } catch {
    return '';
  }
}

/**
 * Steps 2 to 4 of receiving a batch. Null with a reason drops the page and leaves its
 * number open. A forged or tampered manifest never gets as far as an event, and each
 * event then stands on its own, so a subset of a batch checks as well as all of it.
 */
export async function checkBatchPage(manifest: BatchManifest, page: NearbyBatchPage, intake: NearbyIntake, languageId: string): Promise<(Checked & { verdict: ChainVerdict }) | { reason: string }> {
  // Expiry is skipped: batches are carried for months. The revocation list is applied per event below.
  const verdict = await checkChain(page.chain, { rootKeys: intake.rootKeys, orgId: manifest.orgId, languageId, now: null, verify: intake.verify, sha256: intake.sha256 });
  if (!verdict.ok) return { reason: `chain: ${verdict.reason}` };
  const { holder } = verdict;
  if (holder.installKey !== manifest.key || holder.deviceId !== manifest.deviceId || holder.profileId !== manifest.actorId) return { reason: 'the chain names someone else' };
  if (!await signedBy(intake.verify, manifest.key, nearbyBytes('batch', page.manifest), page.sig)) return { reason: 'bad signature' };

  const digests = new Map(manifest.events);
  const out: Checked = { events: [], refused: [], settled: new Set() };
  const seen = new Set<string>();
  for (const e of page.events) {
    const digest = digests.get(e.id);
    if (digest === undefined) { out.refused.push({ id: wireId(e), reason: 'not in the manifest', retry: false }); continue; }
    if (seen.has(e.id)) continue;
    if ((await digestOf(e, intake.sha256)) !== digest) { out.refused.push({ id: e.id, reason: 'digest mismatch', retry: false }); continue; }
    seen.add(e.id);
    const later = revokedLater(intake.revoked, manifest.key, manifest.actorId, e.hlc);
    if (later || e.actorId !== manifest.actorId || e.deviceId !== manifest.deviceId) {
      out.refused.push({ id: e.id, reason: later ? 'dated after its key was revoked' : 'not the signer\'s event', retry: false });
      out.settled.add(e.id);
    } else out.events.push(e);
  }
  return { ...out, verdict };
}

/** A claim stands on the Worker's word alone. Each event must be in the attested rows with the same digest and `serverSeq`. Answers the highest seq that matched. */
export async function checkClaimsPage(attestation: Attestation, page: NearbyClaimsPage, intake: NearbyIntake): Promise<(Checked & { seqOf: Map<string, number>; highest: number }) | { reason: string }> {
  const root = intake.rootKeys.get(page.kid);
  if (root === undefined) return { reason: 'unknown attestation key' };
  if (!await signedBy(intake.verify, root, nearbyBytes('attest', page.text), page.sig)) return { reason: 'bad attestation' };

  const rows = new Map(attestation.rows.map(([id, digest, seq]) => [id, { digest, seq }]));
  const out: Checked = { events: [], refused: [], settled: new Set() };
  const seqOf = new Map<string, number>();
  let highest = 0;
  for (const e of page.events) {
    const row = rows.get(e.id);
    if (!row) { out.refused.push({ id: wireId(e), reason: 'not attested', retry: false }); continue; }
    if (seqOf.has(e.id)) continue;
    if ((await digestOf(e, intake.sha256)) !== row.digest || (e.serverSeq !== undefined && e.serverSeq !== row.seq)) { out.refused.push({ id: e.id, reason: 'digest mismatch', retry: false }); continue; }
    seqOf.set(e.id, row.seq);
    highest = Math.max(highest, row.seq);
    out.events.push(e);
  }
  return { ...out, seqOf, highest };
}

/**
 * Does this phone hold all a manifest speaks for (docs/nearby-sync-plan.md 5.3)? Each
 * id is here under the manifest's digest, or under a later batch of the same signer (a
 * restamp), or redacted here, or it arrived with a matching digest and was let in or
 * refused for good. A row under another digest never counts, so a teammate cannot close
 * a number by leaving events out.
 */
export async function batchIsWhole(manifest: BatchManifest, here: ReadonlyMap<string, LocalEvent>, settled: ReadonlySet<string>, lang: LanguageState, sha256: Sha256): Promise<boolean> {
  for (const [id, digest] of manifest.events) {
    if (settled.has(id) || lang.redactions[id] === true) continue;
    const row = here.get(id);
    if (!row) return false;
    const { via } = row;
    if (via && 'batch' in via && via.key === manifest.key && via.batch > manifest.n) continue;
    if ((await digestOf(row.event, sha256)) !== digest) return false;
  }
  return true;
}
