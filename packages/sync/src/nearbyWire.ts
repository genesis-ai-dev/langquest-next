import {
  NEARBY_BATCH_MAX_EVENTS, isBase64url, isHash, nearbyPayloadError, objectMemberNameIn, parseVector, utf8Encode, type AnyEvent, type ChainLink, type NearbyVector
} from '@langquest-next/core';
import { NEARBY_MESSAGE_MAX, type HostDetails } from './nearbyLink';

/**
 * The messages between two phones (docs/nearby-sync-plan.md 5.12). UTF-8 JSON on a
 * sealed link. After the first store build this can only grow, through the protocol
 * range and the abilities in `hello`, because phones in the field keep speaking what
 * they shipped with: `hello` never loses a field.
 *
 * Everything off the wire is hostile. `parseMessage` builds each message from the
 * fields it knows, checks every list's size, and reads the maps into Maps. A `have`
 * is the one shape that differs on the wire, where its maps are JSON objects.
 * Events pass through as objects: the door judges them, one at a time, so that one
 * bad event costs itself and not the session. Chains pass through with only their
 * size and depth checked, for `checkChain`, which takes unknowns.
 */
export type Message =
  | { t: 'hello'; protocol: { min: number; max: number }; can: string[]; reducerVersion: number; linesVersion: number; deviceId: string; wallMs: number; chain: ChainLink[]; proof: string }
  /** The initiator, in place of its hello, under an older generation. */
  | { t: 'you-first' }
  /** The hand-on, one hop: a newer generation of the session's language. */
  | { t: 'discovery-key'; gen: number; key: string }
  /** `joinHotspot` is false on a disguised phone. */
  | { t: 'arrange'; summary: string; radios: { directByName: boolean; band5: boolean; hotspot: boolean; joinHotspot: boolean } }
  | ({ t: 'host' } & HostDetails)
  | { t: 'ready' }
  /** `vector` and `holdings` (counters) are by install key. */
  | { t: 'have'; orgId: string; languageId: string; cursor: number; claimedSeq: number; revokedSeq: number; vector: NearbyVector; holdings: ReadonlyMap<string, number> }
  /** The Worker's list, sent only when the other's seq is lower. */
  | { t: 'revoked'; text: string; kid: string; sig: string }
  /** At most `NEARBY_HOLDINGS_MESSAGE_FILES` hashes a message; `sig` and `chain` on the last part. */
  | { t: 'holdings'; key: string; counter: number; files: string[]; more: boolean; sig?: string; chain?: ChainLink[] }
  | { t: 'holdings-end' }
  | { t: 'batch'; manifest: string; sig: string; chain: ChainLink[]; events: AnyEvent[] }
  /** The Worker's attestation; `events` may be a subset of its rows. */
  | { t: 'claims'; text: string; kid: string; sig: string; events: AnyEvent[] }
  | { t: 'events-done'; older: boolean }
  | { t: 'file-ask'; transferId: string; hash: string; format: string }
  | { t: 'file-no'; transferId: string; reason: 'not-here' | 'not-referenced' | 'redacted' }
  | { t: 'files-done' }
  | { t: 'done' }
  | { t: 'final'; summary: string }
  | { t: 'bye'; reason: 'done' | 'nothing' | 'busy' | 'protocol' | 'identity' | 'not-member' | 'stopped' }
  // Phase 6, with the abilities let-in and starting-copy (section 14.1).
  /** The newcomer, first. */
  | { t: 'join-ask'; installKey: string; idSalt: string; profileId: string; deviceId: string; name: string; proof: string }
  /** The inviter, after one tap; the pass is inside the chain. */
  | { t: 'join-grant'; chain: ChainLink[]; proof: string; discoveryKey: string; gen: number; floor: number }
  | { t: 'copy-ask'; part: 'state' | 'rows' | 'names' | 'doc'; stream?: string; after?: string; hash?: string }
  | { t: 'copy-part'; part: string; stream?: string; next: string | null; body: string }
  | { t: 'copy-no'; reason: 'versions' | 'not-filled' | 'not-allowed' | 'not-here' };

/** A message a phone does not know is ignored. A malformed one ends the session with `bye`. */
export type ParsedMessage = { kind: 'message'; message: Message } | { kind: 'unknown' } | { kind: 'malformed'; reason: string };

export const NEARBY_HOLDINGS_MESSAGE_FILES = 8000;
export const NEARBY_COPY_PART_MAX_CHARS = 900 * 1024;
/** `checkChain` stops at 2; a little room, so a longer form can be refused by name. */
const MAX_LINKS = 4;
const MAX_ABILITIES = 64;
/** What an event's own fields may hold (`EVENT_FIELD_MAX_CHARS`), for ids and labels here. */
const MAX_FIELD_CHARS = 256;
/**
 * A phone stores at most 32 ranges an entry today, as an argument. A `have` is
 * only a claim and that number can grow in a later build, so the wire allows more.
 */
const MAX_WIRE_RANGES = 256;
/** A transfer id and a format go into a file's staging name and a native call, so they hold no path. */
const TRANSFER_ID = /^[A-Za-z0-9_-]{1,64}$/;
const FORMAT = /^[a-z0-9]{1,8}$/;
const SUMMARY = /^[0-9a-f]{8}$/;

type Raw = Record<string, unknown>;

const isRaw = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isText = (v: unknown, max = MAX_FIELD_CHARS): v is string => typeof v === 'string' && v.length <= max;
const isId = (v: unknown): v is string => isText(v) && v !== '';
const isSig = (v: unknown): v is string => isBase64url(v, 64);
const isKey = (v: unknown): v is string => isBase64url(v, 32);
/** `canonicalJson` recurses over a link when it is checked, so depth is bounded here as it is for an event. */
const isChain = (v: unknown): v is ChainLink[] => Array.isArray(v) && v.length <= MAX_LINKS && v.every(isRaw) && nearbyPayloadError(v) === null;
const isEvents = (v: unknown): v is AnyEvent[] => Array.isArray(v) && v.length <= NEARBY_BATCH_MAX_EVENTS && v.every(isRaw);
const isOneOf = <T extends string>(v: unknown, values: readonly T[]): v is T => (values as readonly unknown[]).includes(v);
const optional = <K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } => (value === undefined ? {} : ({ [key]: value } as { [P in K]?: V }));
const optionalIs = (v: unknown, is: (x: unknown) => boolean) => v === undefined || is(v);

function parseCounters(raw: unknown): ReadonlyMap<string, number> | null {
  if (!isRaw(raw)) return null;
  const out = new Map<string, number>();
  for (const [key, counter] of Object.entries(raw)) {
    if (!isKey(key) || !isCount(counter)) return null;
    out.set(key, counter);
  }
  return out;
}

/** The fields of one message: null when one of them is not what it should be, undefined when no phone here knows `t`. */
function read(t: string, o: Raw): Message | null | undefined {
  switch (t) {
    case 'hello': {
      const p = o['protocol'];
      if (!isRaw(p) || !isCount(p['min']) || !isCount(p['max'])) return null;
      const can = o['can'];
      if (!Array.isArray(can) || can.length > MAX_ABILITIES || !can.every((a) => isId(a))) return null;
      // On a QR link, and only there, `deviceId`, `chain` and `proof` are empty until the grant.
      const { reducerVersion, linesVersion, deviceId, wallMs, chain, proof } = o;
      if (!isCount(reducerVersion) || !isCount(linesVersion) || !isText(deviceId) || !isCount(wallMs) || !isChain(chain) || !(proof === '' || isSig(proof))) return null;
      return { t, protocol: { min: p['min'], max: p['max'] }, can: can as string[], reducerVersion, linesVersion, deviceId, wallMs, chain, proof };
    }
    case 'you-first': case 'ready': case 'holdings-end': case 'files-done': case 'done':
      return { t };
    case 'discovery-key': {
      // `handedKeyHolds` judges the number and the key, and a failure there ends nothing.
      const { gen, key } = o;
      return typeof gen === 'number' && isText(key) ? { t, gen, key } : null;
    }
    case 'arrange': {
      const r = o['radios'];
      if (!isRaw(r) || !isSummary(o['summary'])) return null;
      const { directByName, band5, hotspot, joinHotspot } = r;
      if (typeof directByName !== 'boolean' || typeof band5 !== 'boolean' || typeof hotspot !== 'boolean' || typeof joinHotspot !== 'boolean') return null;
      return { t, summary: o['summary'], radios: { directByName, band5, hotspot, joinHotspot } };
    }
    case 'host': {
      const { kind, ssid, passphrase, port, band, security } = o;
      if (!isOneOf(kind, ['wifi-direct', 'hotspot', 'bluetooth'] as const)) return null;
      const isPort = (v: unknown) => isCount(v) && v <= 65535;
      if (![ssid, passphrase, band, security].every((v) => optionalIs(v, isText)) || !optionalIs(port, isPort)) return null;
      return {
        t, kind, ...optional('ssid', ssid as string | undefined), ...optional('passphrase', passphrase as string | undefined), ...optional('port', port as number | undefined),
        ...optional('band', band as string | undefined), ...optional('security', security as string | undefined)
      };
    }
    case 'have': {
      const { orgId, languageId, cursor, claimedSeq, revokedSeq } = o;
      if (!isId(orgId) || !isId(languageId) || !isCount(cursor) || !isCount(claimedSeq) || !isCount(revokedSeq)) return null;
      const vector = parseVector(o['vector'], { maxRanges: MAX_WIRE_RANGES });
      const holdings = parseCounters(o['holdings']);
      return vector && holdings ? { t, orgId, languageId, cursor, claimedSeq, revokedSeq, vector, holdings } : null;
    }
    case 'revoked': {
      const { text, kid, sig } = o;
      return typeof text === 'string' && isId(kid) && isSig(sig) ? { t, text, kid, sig } : null;
    }
    case 'holdings': {
      const { key, counter, files, more, sig, chain } = o;
      if (!isKey(key) || !isCount(counter) || typeof more !== 'boolean') return null;
      if (!Array.isArray(files) || files.length > NEARBY_HOLDINGS_MESSAGE_FILES || !files.every((f) => isHash(f))) return null;
      if (!optionalIs(sig, isSig) || !optionalIs(chain, isChain)) return null;
      return { t, key, counter, files: files as string[], more, ...optional('sig', sig as string | undefined), ...optional('chain', chain as ChainLink[] | undefined) };
    }
    case 'batch': {
      const { manifest, sig, chain, events } = o;
      return typeof manifest === 'string' && isSig(sig) && isChain(chain) && isEvents(events) ? { t, manifest, sig, chain, events } : null;
    }
    case 'claims': {
      const { text, kid, sig, events } = o;
      return typeof text === 'string' && isId(kid) && isSig(sig) && isEvents(events) ? { t, text, kid, sig, events } : null;
    }
    case 'events-done':
      return typeof o['older'] === 'boolean' ? { t, older: o['older'] } : null;
    case 'file-ask': {
      const { transferId, hash, format } = o;
      return isTransferId(transferId) && isHash(hash) && isText(format) && FORMAT.test(format) ? { t, transferId, hash, format } : null;
    }
    case 'file-no': {
      const { transferId, reason } = o;
      return isTransferId(transferId) && isOneOf(reason, ['not-here', 'not-referenced', 'redacted'] as const) ? { t, transferId, reason } : null;
    }
    case 'final':
      return isSummary(o['summary']) ? { t, summary: o['summary'] } : null;
    case 'bye':
      return isOneOf(o['reason'], ['done', 'nothing', 'busy', 'protocol', 'identity', 'not-member', 'stopped'] as const) ? { t, reason: o['reason'] } : null;
    case 'join-ask': {
      const { installKey, idSalt, profileId, deviceId, name, proof } = o;
      return isKey(installKey) && isBase64url(idSalt, 16) && isId(profileId) && isId(deviceId) && isText(name) && isSig(proof)
        ? { t, installKey, idSalt, profileId, deviceId, name, proof } : null;
    }
    case 'join-grant': {
      const { chain, proof, discoveryKey, gen, floor } = o;
      return isChain(chain) && isSig(proof) && isKey(discoveryKey) && isCount(gen) && isCount(floor) ? { t, chain, proof, discoveryKey, gen, floor } : null;
    }
    case 'copy-ask': {
      const { part, stream, after, hash } = o;
      if (!isOneOf(part, ['state', 'rows', 'names', 'doc'] as const) || !optionalIs(stream, isText) || !optionalIs(after, isText) || !optionalIs(hash, isHash)) return null;
      return { t, part, ...optional('stream', stream as string | undefined), ...optional('after', after as string | undefined), ...optional('hash', hash as string | undefined) };
    }
    case 'copy-part': {
      const { part, stream, next, body } = o;
      if (!isId(part) || !optionalIs(stream, isText) || !(next === null || isText(next)) || !isText(body, NEARBY_COPY_PART_MAX_CHARS)) return null;
      return { t, part, ...optional('stream', stream as string | undefined), next, body };
    }
    case 'copy-no':
      return isOneOf(o['reason'], ['versions', 'not-filled', 'not-allowed', 'not-here'] as const) ? { t, reason: o['reason'] } : null;
    default:
      return undefined;
  }
}

function isSummary(v: unknown): v is string {
  return typeof v === 'string' && SUMMARY.test(v);
}

function isTransferId(v: unknown): v is string {
  return typeof v === 'string' && TRANSFER_ID.test(v);
}

/**
 * UTF-8 bytes as a string, or null when they are not valid UTF-8. Sync assumes no
 * `TextDecoder` on the runtimes it runs on, and a decoder that patched bad bytes
 * would hand on text its sender never wrote.
 */
export function utf8Decode(bytes: Uint8Array): string | null {
  const parts: string[] = [];
  let units: number[] = [];
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!;
    const extra = b < 0x80 ? 0 : b >= 0xc2 && b <= 0xdf ? 1 : b >= 0xe0 && b <= 0xef ? 2 : b >= 0xf0 && b <= 0xf4 ? 3 : -1;
    if (extra < 0 || i + extra >= bytes.length) return null;
    let c = extra === 0 ? b : b & (0x3f >> extra);
    for (let k = 1; k <= extra; k++) {
      const next = bytes[i + k]!;
      if ((next & 0xc0) !== 0x80) return null;
      c = (c << 6) | (next & 0x3f);
    }
    // Overlong forms, surrogates and past the last code point.
    if ((extra === 2 && c < 0x800) || (extra === 3 && (c < 0x10000 || c > 0x10ffff)) || (c >= 0xd800 && c <= 0xdfff)) return null;
    if (c < 0x10000) units.push(c);
    else units.push(0xd800 + ((c - 0x10000) >> 10), 0xdc00 + ((c - 0x10000) & 0x3ff));
    i += extra + 1;
    if (units.length >= 8192) {
      parts.push(String.fromCharCode(...units));
      units = [];
    }
  }
  parts.push(String.fromCharCode(...units));
  return parts.join('');
}

/** A message as bytes for `NearbyLink.send`. Senders close pages well under the ceiling, so going over it is a bug here and not something a teammate did. */
export function encodeMessage(m: Message): Uint8Array {
  const wire = m.t === 'have' ? { ...m, vector: Object.fromEntries(m.vector), holdings: Object.fromEntries(m.holdings) } : m;
  const bytes = utf8Encode(JSON.stringify(wire));
  if (bytes.length > NEARBY_MESSAGE_MAX) throw new RangeError(`${m.t} message of ${bytes.length} bytes is over the ${NEARBY_MESSAGE_MAX} a link carries`);
  return bytes;
}

/** Never throws. Member names are refused everywhere but inside events, which the door refuses one at a time. */
export function parseMessage(bytes: Uint8Array): ParsedMessage {
  if (bytes.length > NEARBY_MESSAGE_MAX) return { kind: 'malformed', reason: 'too large' };
  const text = utf8Decode(bytes);
  if (text === null) return { kind: 'malformed', reason: 'not UTF-8' };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { kind: 'malformed', reason: 'not JSON' };
  }
  if (!isRaw(raw) || typeof raw['t'] !== 'string') return { kind: 'malformed', reason: 'no type' };
  const t = raw['t'];
  const message = read(t, raw);
  if (message === undefined) return { kind: 'unknown' };
  if (message === null) return { kind: 'malformed', reason: `bad ${t}` };
  const named = t === 'batch' || t === 'claims' ? objectMemberNameIn([raw['chain'], raw['kid']]) : objectMemberNameIn(raw);
  return named === null ? { kind: 'message', message } : { kind: 'malformed', reason: `${t} uses a member name` };
}
