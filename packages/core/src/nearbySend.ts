import type { AnyEvent, LocalEventStatus } from './events';
import { isServerEventId, NEARBY_NOT_CARRIED, nearbyCopy } from './nearbyDoor';
import { isBase64url } from './nearbySigning';
import { EVENT_PRIVILEGE, ORG_EVENT_TYPES } from './org';

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

/**
 * Carl's answer 21, from decision 169: 70,000 rows (the 99th percentile day, 1,150,
 * times 60 days offline) and 50 MB per signer. Stored manifests have 50 MB of their own,
 * because a manifest naming 200 ids costs about 30 KB, so one row under each would come
 * to 2 GB at the row budget; honest full batches at 70,000 rows hold about 11 MB. A phone
 * passes these in, so a test or a later build can move them, and they do not move quietly.
 */
export const NEARBY_BUDGET = { maxRows: 70_000, maxBytes: 50_000_000, maxManifestBytes: 50_000_000 } as const;

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

/** Everything at or below `mark`, or in a range above it? */
export function isCounted(vector: NearbyVector, key: string, n: number): boolean {
  const entry = vector.get(key);
  return !!entry && (n <= entry.mark || entry.ahead.some(([from, to]) => from <= n && n <= to));
}

/** An entry in one form only: ranges in order with no two touching, and none touching the mark. Two phones that counted the same numbers then write the same text. */
function settled(start: number, ranges: readonly (readonly [number, number])[]): NearbyVectorEntry {
  let mark = start;
  const ahead: [number, number][] = [];
  for (const [from, to] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = ahead[ahead.length - 1];
    if (from <= mark + 1) mark = Math.max(mark, to);
    else if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else ahead.push([from, to]);
  }
  return { mark, ahead };
}

const withEntry = (vector: NearbyVector, key: string, entry: NearbyVectorEntry): NearbyVector => new Map(vector).set(key, entry);

/**
 * Records a whole batch's number. Past the cap on ranges it records no number that
 * neither fills nor extends one, so a hostile sender can fragment the list but
 * cannot force a gap closed, and under-recording costs only a re-send.
 */
export function countBatch(vector: NearbyVector, key: string, n: number, opts: { maxRanges: number }): NearbyVector {
  if (!Number.isSafeInteger(n) || n < 1 || isCounted(vector, key, n)) return vector;
  const { mark, ahead } = vector.get(key) ?? { mark: 0, ahead: [] };
  const touches = n === mark + 1 || ahead.some(([from, to]) => n === from - 1 || n === to + 1);
  if (!touches && ahead.length >= opts.maxRanges) return vector;
  return withEntry(vector, key, settled(mark, [...ahead, [n, n]]));
}

/** A signer's own word that nothing of its at or below `floor` is still unsent on its phone. It can hurt only its own entry. */
export function applyFloor(vector: NearbyVector, key: string, floor: number): NearbyVector {
  const { mark, ahead } = vector.get(key) ?? { mark: 0, ahead: [] };
  if (!Number.isSafeInteger(floor) || floor <= mark) return vector;
  return withEntry(vector, key, settled(floor, ahead));
}

/** A row as the store gives it. */
export interface NearbyRow {
  event: AnyEvent;
  status: LocalEventStatus;
  via?: NearbyVia;
}

/**
 * The rows that go with one signed batch, stripped for the wire. A confirmed row
 * goes by claim instead, and a restamped one has left the batch by losing its `via`.
 */
export function batchRowsToSend(rows: readonly NearbyRow[], batch: { key: string; n: number }, isRedacted: (id: string) => boolean): AnyEvent[] {
  return rows
    .filter(({ event, status, via }) =>
      (status === 'pending' || status === 'nearby') && !!via && 'batch' in via && via.batch === batch.n && via.key === batch.key &&
      !isRedacted(event.id) && !NEARBY_NOT_CARRIED.includes(event.type))
    .map(({ event }) => nearbyCopy(event));
}

/**
 * Should this row go to a teammate by claim? Only what the server confirmed, past
 * what they have been told of, and only up to what the Worker has vouched for in
 * order, so a failed page cannot push their mark past rows they never got.
 */
export function shouldClaim(row: NearbyRow, them: { cursor: number; claimedSeq: number }, here: { attestedSeq: number; isRedacted: (id: string) => boolean }): boolean {
  const { event, status } = row;
  if (status !== 'confirmed' || event.serverSeq === undefined) return false;
  if (event.serverSeq <= Math.max(them.cursor, them.claimedSeq) || event.serverSeq > here.attestedSeq) return false;
  if (isServerEventId(event.id) || EVENT_PRIVILEGE[event.type] === null) return false;
  if (NEARBY_NOT_CARRIED.includes(event.type) || (ORG_EVENT_TYPES as readonly string[]).includes(event.type)) return false;
  return !here.isRedacted(event.id);
}
