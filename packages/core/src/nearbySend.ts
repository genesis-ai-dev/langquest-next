import { isBase64url } from './nearbySigning';

/**
 * What one phone counts as received from each signer (docs/nearby-sync-plan.md
 * 5.3, 5.12). Numbers are a signer's batches, per stream, and each entry is a
 * mark, everything at or below it, and ranges above it. Only a verified manifest
 * moves an entry here. A Have from a teammate parses to the same shape, and it
 * only says what to send.
 */
export interface NearbyVectorEntry {
  mark: number;
  ahead: readonly (readonly [from: number, to: number])[];
}

/** By install key. A Map, because a key arrives off the wire and `__proto__` on a plain object sets its prototype. */
export type NearbyVector = ReadonlyMap<string, NearbyVectorEntry>;

/** How a row came: signed in a batch by this key, or claimed by a phone with the server's word for it. */
export type NearbyVia = { batch: number; key: string } | { claim: { key: string; seq: number } };

/** Ranges one entry may keep, as a starting guess. Callers pass the number; past it a phone under-records, which costs only a re-send. */
export const NEARBY_VECTOR_MAX_RANGES = 32;
/** Far above any team, so that a bad row or message costs a refusal and not a walk. */
export const NEARBY_VECTOR_MAX_KEYS = 4096;

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

function parseEntry(raw: unknown, maxRanges: number): NearbyVectorEntry | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const { mark, ahead } = raw as { mark?: unknown; ahead?: unknown };
  if (!isCount(mark) || !Array.isArray(ahead) || ahead.length > maxRanges) return null;
  const ranges: (readonly [number, number])[] = [];
  let last = mark;
  for (const range of ahead as unknown[]) {
    if (!Array.isArray(range) || range.length !== 2) return null;
    const [from, to] = range as unknown[];
    if (!isCount(from) || !isCount(to) || from <= last || to < from) return null;
    ranges.push([from, to]);
    last = to;
  }
  return { mark, ahead: ranges };
}

/**
 * A vector from the device's meta row or a teammate's Have: 32-byte base64url
 * keys, ranges above the mark that are sorted, disjoint, safe and capped. Null
 * for anything else, as a whole.
 */
export function parseVector(raw: unknown, opts: { maxRanges: number; maxKeys?: number }): NearbyVector | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const entries = Object.entries(raw);
  if (entries.length > (opts.maxKeys ?? NEARBY_VECTOR_MAX_KEYS)) return null;
  const out = new Map<string, NearbyVectorEntry>();
  for (const [key, value] of entries) {
    if (!isBase64url(key, 32)) return null;
    const entry = parseEntry(value, opts.maxRanges);
    if (!entry) return null;
    out.set(key, entry);
  }
  return out;
}
