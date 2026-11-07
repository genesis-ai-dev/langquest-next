import type { AnyEvent } from './events';
import type { JoinPass, RevocationList, Sha256, WorkerLink, InviteLink } from './nearbyChain';
import { canonicalJson, isHash } from './libraryDocs';
import { nearbyPayloadError, utf8Encode } from './validate';

/**
 * What gets hashed and signed between nearby phones (docs/nearby-sync-plan.md 5.12,
 * Manifests and canonical bytes). Every text is `canonicalJson` with a prefix per
 * purpose, so a signature made for one purpose cannot be replayed for another.
 * Once a store build has signed with these, they cannot change: a new form gets a
 * new prefix. `packages/core/test/nearbyVectors.ts` fixes each one.
 */

export const NEARBY_PREFIXES = {
  event: 'lq-nearby-event-v1\n',
  batch: 'lq-nearby-batch-v1\n',
  attest: 'lq-nearby-attest-v1\n',
  revoked: 'lq-nearby-revoked-v1\n',
  holdings: 'lq-nearby-holdings-v1\n',
  newcomer: 'lq-nearby-newcomer-v1\n',
  proof: 'lq-nearby-proof-v1\n',
  link: 'lq-nearby-link-v1\n',
  pass: 'lq-nearby-pass-v1\n',
  passId: 'lq-nearby-passid-v1\n',
  certRequest: 'lq-nearby-certreq-v1\n',
  firstContact: 'lq-nearby-join-v1\n',
  summary: 'lq-nearby-summary-v1\n'
} as const;

/** The bytes a text stands for: always the prefix and the text together, as UTF-8. */
export function nearbyBytes(purpose: keyof typeof NEARBY_PREFIXES, text: string): Uint8Array {
  return utf8Encode(NEARBY_PREFIXES[purpose] + text);
}

// ---- plain bytes -----------------------------------------------------------------

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function base64urlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    out += B64[a >> 2]! + B64[((a & 3) << 4) | (b >> 4)]!;
    if (i + 1 < bytes.length) out += B64[((b & 15) << 2) | (c >> 6)]!;
    if (i + 2 < bytes.length) out += B64[c & 63]!;
  }
  return out;
}

/** The bytes of base64url with no padding, or null. Only one text stands for any bytes: spare bits must be clear. */
export function base64urlDecode(text: string): Uint8Array | null {
  if (text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let bits = 0;
  let held = 0;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const v = B64.indexOf(text[i]!);
    if (v < 0) return null;
    bits = (bits << 6) | v;
    held += 6;
    if (held >= 8) {
      held -= 8;
      out[n++] = (bits >> held) & 0xff;
      bits &= (1 << held) - 1;
    }
  }
  return bits === 0 ? out : null;
}

/** Is this base64url for exactly `size` bytes? */
export function isBase64url(text: unknown, size: number): text is string {
  return typeof text === 'string' && text.length === Math.ceil((size * 4) / 3) && base64urlDecode(text)?.length === size;
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

// ---- events ----------------------------------------------------------------------

/** What an event's digest covers. No `serverSeq`, and an absent parent stays absent however a row carries it: a pull drops an empty one (`SupabaseTransport.pull`). */
export function eventText(e: AnyEvent): string {
  return canonicalJson({
    id: e.id, type: e.type, orgId: e.orgId, streamId: e.streamId, actorId: e.actorId, deviceId: e.deviceId, hlc: e.hlc,
    parentEventId: e.parentEventId || undefined, payload: e.payload
  });
}

/**
 * An event's digest, lowercase hex. Empty for an event the door's first step
 * would refuse, because `canonicalJson` recurses and throws and this runs before
 * the door does. An empty digest matches no manifest, whose digests are hashes,
 * so it takes the digest mismatch path. One the Worker attests that way still
 * stops at the door's first step.
 */
export async function eventDigest(e: AnyEvent, sha256: Sha256): Promise<string> {
  if (typeof e !== 'object' || e === null || nearbyPayloadError(e) !== null) return '';
  return bytesToHex(await sha256(nearbyBytes('event', eventText(e))));
}

/** The same JSON, whatever order the keys came in. Iterative: a pull page runs this on whatever the server holds. */
function sameJson(left: unknown, right: unknown): boolean {
  const stack: [unknown, unknown][] = [[left, right]];
  while (stack.length > 0) {
    const [a, b] = stack.pop()!;
    if (a === b) continue;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      const other = b as unknown[];
      if (a.length !== other.length) return false;
      a.forEach((item, i) => stack.push([item, other[i]]));
      continue;
    }
    const given = (o: object) => Object.entries(o).filter(([, v]) => v !== undefined);
    const ofA = given(a);
    if (ofA.length !== given(b).length) return false;
    for (const [k, v] of ofA) {
      if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
      stack.push([v, (b as Record<string, unknown>)[k]]);
    }
  }
  return true;
}

/** Are these one event, byte for byte, the whole envelope less `serverSeq`? Comparing `hlc` is not enough: a copy can match there and differ in its payload. */
export function sameEventBytes(a: AnyEvent, b: AnyEvent): boolean {
  for (const k of ['id', 'type', 'orgId', 'streamId', 'actorId', 'deviceId', 'hlc'] as const) if (a[k] !== b[k]) return false;
  return (a.parentEventId || undefined) === (b.parentEventId || undefined) && sameJson(a.payload, b.payload);
}

// ---- batches and attestations ----------------------------------------------------

/** A batch closes at this many events, or this much event text, so a page always fits in a message. */
export const NEARBY_BATCH_MAX_EVENTS = 200;
export const NEARBY_BATCH_MAX_TEXT_BYTES = 512 * 1024;

export interface BatchManifest {
  v: 1;
  orgId: string;
  streamId: string;
  /** The signer's install key; the vector and `n` are per this. */
  key: string;
  /** A label for the clock check, which proves nothing. */
  deviceId: string;
  /** One author to a batch, because a certificate names one person. */
  actorId: string;
  n: number;
  /** None of this key's batches at or below this has a row still pending or nearby on its phone. */
  floor: number;
  /** In clock order, at most `NEARBY_BATCH_MAX_EVENTS`. */
  events: [id: string, digest: string][];
}

/** The string on the wire and in the store, exactly as signed, so nobody has to reproduce it. */
export function manifestText(m: BatchManifest): string {
  return canonicalJson(m);
}

/** What the Worker vouches for: rows it read itself. There is no expiry. */
export interface Attestation {
  v: 1;
  kid: string;
  orgId: string;
  streamId: string;
  /** At most `NEARBY_BATCH_MAX_EVENTS`. */
  rows: [id: string, digest: string, serverSeq: number][];
}

export function attestationText(a: Attestation): string {
  return canonicalJson(a);
}

const parsedObject = (text: unknown): Record<string, unknown> | null => {
  if (typeof text !== 'string') return null;
  try {
    const raw: unknown = JSON.parse(text);
    return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};
const isWord = (v: unknown): v is string => typeof v === 'string' && v !== '';
const isSeq = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

/**
 * A manifest off the wire, for this session's organization and language. Null for
 * anything else: the wrong stream, unsafe numbers, over the cap, an id twice, a
 * floor past its own number, or any text its signer's build would not have written.
 * It is built from the fields it knows and compared back, so nothing unread is signed.
 */
export function parseBatchManifest(text: unknown, session: { orgId: string; streamId: string }): BatchManifest | null {
  const raw = parsedObject(text);
  if (!raw) return null;
  const { v, orgId, streamId, key, deviceId, actorId, n, floor, events } = raw;
  if (v !== 1 || orgId !== session.orgId || streamId !== session.streamId) return null;
  if (!isBase64url(key, 32) || !isWord(deviceId) || !isWord(actorId)) return null;
  if (!isSeq(n) || n < 1 || !isSeq(floor) || floor < 0 || floor > n) return null;
  if (!Array.isArray(events) || events.length > NEARBY_BATCH_MAX_EVENTS) return null;
  const seen = new Set<unknown>();
  for (const entry of events as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2 || !isWord(entry[0]) || !isHash(entry[1]) || seen.has(entry[0])) return null;
    seen.add(entry[0]);
  }
  const manifest: BatchManifest = { v, orgId: session.orgId, streamId: session.streamId, key, deviceId, actorId, n, floor, events: events as [string, string][] };
  return manifestText(manifest) === text ? manifest : null;
}

/** The Worker's word off the wire, for this session's organization and language and the `kid` the message names. Null for anything else. */
export function parseAttestation(text: unknown, session: { orgId: string; streamId: string; kid: string }): Attestation | null {
  const raw = parsedObject(text);
  if (!raw) return null;
  const { v, kid, orgId, streamId, rows } = raw;
  if (v !== 1 || kid !== session.kid || orgId !== session.orgId || streamId !== session.streamId) return null;
  if (!Array.isArray(rows) || rows.length > NEARBY_BATCH_MAX_EVENTS) return null;
  const seen = new Set<unknown>();
  for (const row of rows as unknown[]) {
    if (!Array.isArray(row) || row.length !== 3 || !isWord(row[0]) || !isHash(row[1]) || !isSeq(row[2]) || row[2] < 1 || seen.has(row[0])) return null;
    seen.add(row[0]);
  }
  const attestation: Attestation = { v, kid: session.kid, orgId: session.orgId, streamId: session.streamId, rows: rows as [string, string, number][] };
  return attestationText(attestation) === text ? attestation : null;
}

export function revocationText(list: RevocationList): string {
  return canonicalJson(list);
}

// ---- holdings --------------------------------------------------------------------

/** `files` sorted. The receiver works this out itself, so a signature speaks for the list. */
export async function holdingsFilesHash(files: readonly string[], sha256: Sha256): Promise<string> {
  return bytesToHex(await sha256(utf8Encode(canonicalJson(files))));
}

export function holdingsText(h: { orgId: string; streamId: string; key: string; counter: number; filesHash: string }): string {
  return canonicalJson({ v: 1, orgId: h.orgId, streamId: h.streamId, key: h.key, counter: h.counter, filesHash: h.filesHash });
}

// ---- who someone is --------------------------------------------------------------

/** The one text that is not JSON: the decoded key, then the decoded salt. Hashed, and `newcomerProfileId` takes it from there. */
export function newcomerIdBytes(installKey: Uint8Array, idSalt: Uint8Array): Uint8Array {
  return concatBytes(utf8Encode(NEARBY_PREFIXES.newcomer), installKey, idSalt);
}

export function proofText(role: 'i' | 'r', thHex: string): string {
  return `${role}\n${thHex}`;
}

/** `prev` is the `sig` of the link before, or ''. An `invite@1` link has no `kid`, which canonicalizes as absent. */
export function linkText(link: Pick<WorkerLink, 'kind' | 'kid' | 'body'> | Pick<InviteLink, 'kind' | 'body'>, prev: string): string {
  return canonicalJson({ kind: link.kind, kid: 'kid' in link ? link.kid : undefined, body: link.body, prev });
}

export function passText(pass: Pick<JoinPass, 'kind' | 'kid' | 'body'>): string {
  return canonicalJson({ kind: pass.kind, kid: pass.kid, body: pass.body });
}

/** The length of a pass's window (Carl's answer 17): every certificate answer in a window gives the same id. */
export const PASS_WINDOW_MS = 7776000000;

export function passWindowAt(nowMs: number): { window: number; expiresAt: number } {
  const window = Math.floor(nowMs / PASS_WINDOW_MS);
  return { window, expiresAt: (window + 1) * PASS_WINDOW_MS };
}

export function passIdText(p: { orgId: string; languageId: string; inviter: string; inviterKey: string; window: number }): string {
  return canonicalJson({ orgId: p.orgId, languageId: p.languageId, inviter: p.inviter, inviterKey: p.inviterKey, window: p.window });
}

/** The first 16 bytes of the text's SHA-256, in lowercase hex. */
export async function passIdOf(p: { orgId: string; languageId: string; inviter: string; inviterKey: string; window: number }, sha256: Sha256): Promise<string> {
  return bytesToHex((await sha256(nearbyBytes('passId', passIdText(p)))).slice(0, 16));
}

/** No time in it: field clocks are wrong, and this is useless without that person's token. */
export function certRequestText(r: { profileId: string; deviceId: string; publicKey: string }): string {
  return canonicalJson({ profileId: r.profileId, deviceId: r.deviceId, publicKey: r.publicKey });
}

export function firstContactText(r: { profileId: string; deviceId: string; publicKey: string; requestId: string }): string {
  return canonicalJson({ profileId: r.profileId, deviceId: r.deviceId, publicKey: r.publicKey, requestId: r.requestId });
}

/** A summary as a message and `nearbyPeers` carry it: 4 bytes of hash as hex, with the two bits the scan response has no room for clear. */
export async function summaryOf(summaryText: string, sha256: Sha256): Promise<string> {
  const short = (await sha256(nearbyBytes('summary', summaryText))).slice(0, 4);
  short[0] = short[0]! & 0x3f;
  return bytesToHex(short);
}

// ---- the opening -----------------------------------------------------------------

/** Exactly this many raw bytes each way: nonce, masked key, tag. Frozen for the life of the app, because a phone that cannot open it never reaches Hello. */
export const NEARBY_OPENING_BYTES = 80;

const label = (text: string) => utf8Encode(text);

/** What the HMAC under `kOpen` masks a role's ephemeral key with. `nonces` is `nonce_i`, and for `r` then `nonce_r`. */
export function openingMaskInput(role: 'i' | 'r', salt: Uint8Array, ...nonces: Uint8Array[]): Uint8Array {
  return concatBytes(label(`eph-${role}`), salt, ...nonces);
}

/** What the tag on `i`'s opening covers. */
export function openingTagInputI(salt: Uint8Array, nonceI: Uint8Array, maskedI: Uint8Array): Uint8Array {
  return concatBytes(label('i'), salt, nonceI, maskedI);
}

/** What the tag on `r`'s opening covers. Binding `i`'s whole opening stops reuse of a recorded reply. */
export function openingTagInputR(salt: Uint8Array, openingI: Uint8Array, nonceR: Uint8Array, maskedR: Uint8Array): Uint8Array {
  return concatBytes(label('r'), salt, openingI, nonceR, maskedR);
}

/** What `th` is the SHA-256 of. */
export function transcriptInput(ephI: Uint8Array, ephR: Uint8Array, nonceI: Uint8Array, nonceR: Uint8Array): Uint8Array {
  return concatBytes(label('lq-nearby-th-v1\n'), ephI, ephR, nonceI, nonceR);
}
