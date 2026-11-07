import type { ChainLink, Sha256 } from './nearbyChain';
import { canonicalJson, isHash } from './libraryDocs';
import type { NearbyVector } from './nearbySend';
import { holdingsFilesHash, holdingsText, isBase64url, nearbyBytes } from './nearbySigning';
import { nearbyPayloadError, objectMemberNameIn } from './validate';

/**
 * Which unconfirmed files each phone last said it holds (docs/nearby-sync-plan.md
 * 5.11, 5.12). Signed by its owner, so a teammate can pass an entry on but cannot
 * forge or wedge it. Entries decide which file to fetch and which to delete first,
 * and can be out of date until the next exchange corrects them.
 */
export interface HoldingEntry {
  counter: number;
  /** Sorted, unconfirmed hashes only. */
  files: readonly string[];
  sig: string;
  chain: ChainLink[];
}

/** By install key. A Map, because a key arrives off the wire. */
export type Holdings = ReadonlyMap<string, HoldingEntry>;

/** Far above a real team or language, so that a bad row costs a refusal and not a walk. */
export const NEARBY_HOLDINGS_MAX_KEYS = 4096;
export const NEARBY_HOLDINGS_MAX_FILES = 100_000;
const MAX_LINKS = 4;

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The lower list by its canonical text. Equal lists are the usual tie, so those skip building two long texts. */
function compareFiles(a: readonly string[], b: readonly string[]): number {
  if (a === b || (a.length === b.length && a.every((f, i) => f === b[i]))) return 0;
  return compareText(canonicalJson(a), canonicalJson(b));
}

/**
 * The higher counter, wholesale, so a phone can retract a file. A tie with different
 * files, which only a restored or lying owner makes, goes to the lower text. The
 * rest of the order is for a refreshed chain under one counter, so the result does
 * not depend on who merges whom.
 */
function newer(a: HoldingEntry, b: HoldingEntry): HoldingEntry {
  if (a.counter !== b.counter) return a.counter > b.counter ? a : b;
  const order = compareFiles(a.files, b.files) || compareText(a.sig, b.sig) || compareText(canonicalJson(a.chain), canonicalJson(b.chain));
  return order <= 0 ? a : b;
}

/** Only the owner changes its own entry, so what is heard about `myKey` is skipped. Verify entries first: this trusts what it is given. */
export function mergeHoldings(mine: Holdings, theirs: Holdings, myKey: string): Holdings {
  const out = new Map(mine);
  for (const [key, entry] of theirs) {
    if (key === myKey) continue;
    const held = out.get(key);
    out.set(key, held ? newer(held, entry) : entry);
  }
  return out;
}

/**
 * This phone's own entry with what it holds now. The counter moves only when the set
 * changed, and from its own number, never one it heard. Answers the same Holdings
 * when nothing changed, so nothing is signed or written.
 */
export async function withMyHolding(
  holdings: Holdings,
  files: Iterable<string>,
  me: { key: string; orgId: string; streamId: string; chain: ChainLink[]; sign(message: Uint8Array): Promise<string>; sha256: Sha256 }
): Promise<Holdings> {
  const sorted = [...new Set(files)].filter(isHash).sort();
  const held = holdings.get(me.key);
  if (compareFiles(held?.files ?? [], sorted) === 0) return holdings;
  const counter = (held?.counter ?? 0) + 1;
  if (!Number.isSafeInteger(counter)) return holdings;
  const filesHash = await holdingsFilesHash(sorted, me.sha256);
  const sig = await me.sign(nearbyBytes('holdings', holdingsText({ orgId: me.orgId, streamId: me.streamId, key: me.key, counter, filesHash })));
  return new Map(holdings).set(me.key, { counter, files: sorted, sig, chain: me.chain });
}

/**
 * Hash to the number of distinct certified people holding it, by the first link's
 * `profileId`. One person's many keys add one copy, so inventing devices cannot make
 * a last copy look safe to delete. Counting a person's two phones, or an inviter and
 * their newcomer, as one errs the safe way: the file looks rarer.
 */
export function copiesOf(holdings: Holdings): Map<string, number> {
  const people = new Map<string, Set<string>>();
  for (const { chain, files } of holdings.values()) {
    const first = chain[0];
    if (first?.kind !== 'worker@1') continue;
    for (const hash of files) {
      let holders = people.get(hash);
      if (!holders) people.set(hash, (holders = new Set()));
      holders.add(first.body.profileId);
    }
  }
  const out = new Map<string, number>();
  for (const [hash, holders] of people) out.set(hash, holders.size);
  return out;
}

function parseEntry(raw: unknown, maxFiles: number): HoldingEntry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { counter, files, sig, chain } = raw as Record<string, unknown>;
  if (typeof counter !== 'number' || !Number.isSafeInteger(counter) || counter < 0) return null;
  if (!Array.isArray(files) || files.length > maxFiles) return null;
  for (let i = 0; i < files.length; i++) {
    if (!isHash(files[i]) || (i > 0 && files[i - 1] >= files[i])) return null;
  }
  if (!isBase64url(sig, 64)) return null;
  if (!Array.isArray(chain) || chain.length > MAX_LINKS || objectMemberNameIn(chain) !== null || nearbyPayloadError(chain) !== null) return null;
  if (!chain.every((link) => typeof link === 'object' && link !== null && !Array.isArray(link))) return null;
  return { counter, files: files as string[], sig, chain: chain as ChainLink[] };
}

/** Holdings as a meta row keeps them. Refuses member names, unsafe counters and non-hash files, and caps sizes. Null for anything else, as a whole. */
export function parseHoldings(raw: unknown, opts: { maxKeys?: number; maxFiles?: number } = {}): Holdings | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const entries = Object.entries(raw);
  if (entries.length > (opts.maxKeys ?? NEARBY_HOLDINGS_MAX_KEYS)) return null;
  const out = new Map<string, HoldingEntry>();
  for (const [key, value] of entries) {
    if (!isBase64url(key, 32)) return null;
    const entry = parseEntry(value, opts.maxFiles ?? NEARBY_HOLDINGS_MAX_FILES);
    if (!entry) return null;
    out.set(key, entry);
  }
  return out;
}

/**
 * What a phone's summary is worked out from. An absent entry and an empty one compare
 * equal, or two phones that know the same things could never say "Up to date".
 * Counters stand for their lists, since only the owner changes one, so no phone
 * hashes thousands of names at each change. `knownSeq` is `max(cursor, claimedSeq)`,
 * so a phone back from town has something to offer.
 */
export function summaryText(knownSeq: number, vector: NearbyVector, holdings: ReadonlyMap<string, { counter: number }>, revokedSeq: number): string {
  const v = [...vector].filter(([, e]) => e.mark !== 0 || e.ahead.length > 0);
  const h = [...holdings].map(([key, e]) => [key, e.counter] as const);
  return canonicalJson({ k: knownSeq, v: Object.fromEntries(v), h: Object.fromEntries(h), r: revokedSeq });
}
