import type { Card } from './events';
import type { Hlc } from './hlc';
import type { LanguageState } from './state';

/**
 * Writing beside recording (decisions.md 128).
 *
 * A written part is the counterpart of a recorded part: a short piece of
 * text, usually one verse, named by its content and never changed. Its name
 * is `w:` and the SHA-256 of its UTF-8 bytes, so the same words always have
 * the same name, a version that holds written parts is known to be written
 * from the version alone, and nothing that handles files (uploads, the
 * missing-file alarm, eviction) ever mistakes one for a blob, whose names
 * are 64 hex characters. The words travel inside `v1.WritingAdded`, not as
 * files: they are small, and every phone that holds the language holds
 * them, offline for as long as it likes.
 *
 * A language says what its team may make (`v1.MediaAllowedSet`): recordings,
 * writing or both, and which leads. A step in its flow may make something
 * (`v1.StepMakesSet`): turn recording or writing into recording or writing,
 * in the same language or another. What it makes does one of three things
 * (`MakesResult`): it stays beside the version it was made from (`v1.Made`),
 * never marked out of date, and a newer version gets its own; it is added
 * to that version (a transcription of a recording, in the team's own
 * language), so the version holds both and the checks after the step hear
 * and read them together; or it becomes the passage's next version (a final
 * recording after the consultant), and then the checks before it count from
 * the version it was made from (`approvedVersion`).
 */

export type Medium = 'recording' | 'writing';

/** A written part as it travels in `v1.WritingAdded`. */
export interface WrittenPart {
  /** `w:` + the SHA-256 of the text's UTF-8 bytes (`writtenPartId`). */
  id: string;
  text: string;
}

/** Longest a written part may be, and most parts one event may carry (invariant 12: small requests). */
export const WRITTEN_PART_MAX = 2000;
export const WRITTEN_PARTS_PER_EVENT = 100;

export const WRITTEN_PREFIX = 'w:';

export function isWrittenPart(id: string): boolean {
  return id.startsWith(WRITTEN_PREFIX);
}

/** The id the words are known by. Callers normalize to NFC first, so the same words typed two ways share a name. */
export function writtenPartId(text: string): string {
  return WRITTEN_PREFIX + sha256Hex(text);
}

/** Recorded or written, read from a list of parts; empty is recorded (a draft with nothing yet). */
export function partsMedium(parts: readonly string[]): Medium {
  return parts.length > 0 && isWrittenPart(parts[0]!) ? 'writing' : 'recording';
}

/** The words of a written part, if its `v1.WritingAdded` has arrived. */
export function writtenText(state: LanguageState, id: string): string | undefined {
  return state.writings?.[id];
}

/** A list of parts as written cards, for `v1.Made` (a written part has no length). */
export function writtenCards(ids: readonly string[]): Card[] {
  return ids.map((hash) => ({ hash, durationMs: 0 }));
}

// ---- what a language may make --------------------------------------------------

export interface MediaAllowed {
  recording: boolean;
  writing: boolean;
  /** Which leads on a passage when both are allowed. */
  first: Medium;
}

/** Recording only, until an admin says otherwise: every language made before writing existed. */
export const RECORDING_ONLY: MediaAllowed = { recording: true, writing: false, first: 'recording' };

export function mediaAllowed(state: LanguageState): MediaAllowed {
  return state.mediaAllowed?.value ?? RECORDING_ONLY;
}

// ---- steps that make something --------------------------------------------------

/**
 * What happens to what a making step makes: it stays beside the version, is
 * added to it (only when it turns recording into writing or writing into
 * recording, in the same language), or becomes the next version (only in
 * the same language).
 */
export type MakesResult = 'beside' | 'added' | 'version';

export const MAKES_RESULTS: readonly MakesResult[] = ['beside', 'added', 'version'];

/**
 * What a making step does. A flow many languages share never names a
 * language: `language` is the same as the team's, or another, and the
 * language's own copy of the step says which other (`otherLanguage`, ISO
 * 639-3 or a glottocode), starting from its reference language.
 */
export interface MakesSpec {
  from: Medium | 'either';
  to: Medium | 'either';
  language: 'same' | 'other';
  otherLanguage?: string;
  /** The step turns what an earlier making step made, not the version (a back translation of the writing). */
  fromKindId?: string;
  /** What happens to what it makes (`MakesResult`). */
  result: MakesResult;
}

/** The making spec of a kind, if it makes something. */
export function makesOf(state: LanguageState, kindId: string): MakesSpec | null {
  return state.stepMakes?.[kindId]?.value ?? null;
}

/** The kind of the earlier step whose output a check reads, if it reads one (`v1.CheckLooksAtSet`). */
export function looksAtOf(state: LanguageState, kindId: string): string | null {
  return state.checkLooksAt?.[kindId]?.value ?? null;
}

/** Ready-made making steps, offered first when a step is added. Ids are stable so two admins adding one offline agree. */
export const MAKING_PRESETS: readonly { id: string; name: string; makes: MakesSpec }[] = [
  { id: 'make-bt-said', name: 'Back translation', makes: { from: 'either', to: 'recording', language: 'other', result: 'beside' } },
  { id: 'make-bt-written', name: 'Written back translation', makes: { from: 'either', to: 'writing', language: 'other', result: 'beside' } },
  { id: 'make-write-down', name: 'Write it down', makes: { from: 'recording', to: 'writing', language: 'same', result: 'beside' } },
  { id: 'make-read-aloud', name: 'Read it aloud', makes: { from: 'writing', to: 'recording', language: 'same', result: 'beside' } },
  { id: 'make-final', name: 'Final recording', makes: { from: 'recording', to: 'recording', language: 'same', result: 'version' } }
];

/**
 * Where the choice starts (decisions.md 128): a step that makes the same
 * kind in the same language makes the next version; anything else stays
 * beside the version it came from. Being added to the version is never the
 * default: an admin picks it.
 */
export function defaultResult(m: Pick<MakesSpec, 'from' | 'to' | 'language'>): MakesResult {
  return m.language === 'same' && m.from !== 'either' && m.from === m.to ? 'version' : 'beside';
}

/**
 * Whether a step with these choices may have this result: added only when
 * it turns recording into writing or writing into recording, in the same
 * language; the next version only in the same language and a known kind.
 */
export function resultAllowed(m: Pick<MakesSpec, 'from' | 'to' | 'language'>, result: MakesResult): boolean {
  if (result === 'beside') return true;
  if (m.language !== 'same' || m.to === 'either') return false;
  return result === 'version' || (m.from !== 'either' && m.from !== m.to);
}

// ---- what was made ---------------------------------------------------------------

export interface MadeView {
  id: string;
  unitId: string;
  /** The step that made it; absent when no step did (brought over from LangQuest v2). */
  kindId?: string;
  fromTakeId?: string;
  fromMadeId?: string;
  /** The language it is in, when not the team's own. */
  language?: string;
  medium: Medium;
  /** Its parts, or the version it became. */
  parts: Card[];
  takeId?: string;
  /** It was added to the version it came from (`fromTakeId`): that version holds both. */
  added?: true;
  by: string;
  hlc: Hlc;
}

/** Everything made in a passage, oldest first. */
export function madeIn(state: LanguageState, unitId: string): MadeView[] {
  const out: MadeView[] = [];
  for (const m of Object.values(state.made ?? {})) {
    if (m.unitId !== unitId) continue;
    const parts = m.parts ?? [];
    const take = m.takeId ? state.takes[m.takeId] : undefined;
    out.push({
      id: m.id, unitId: m.unitId, by: m.by, hlc: m.hlc,
      medium: partsMedium(take ? take.cardHashes : parts.map((p) => p.hash)),
      parts: [...parts],
      ...(m.kindId !== undefined ? { kindId: m.kindId } : {}),
      ...(m.fromTakeId !== undefined ? { fromTakeId: m.fromTakeId } : {}),
      ...(m.fromMadeId !== undefined ? { fromMadeId: m.fromMadeId } : {}),
      ...(m.language !== undefined ? { language: m.language } : {}),
      ...(m.takeId !== undefined ? { takeId: m.takeId } : {}),
      ...(m.added ? { added: true as const } : {})
    });
  }
  return out.sort((a, b) => (a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : a.id < b.id ? -1 : 1));
}

/** The version a made thing comes from, following earlier made things back. */
export function madeRootTake(state: LanguageState, m: Pick<MadeView, 'fromTakeId' | 'fromMadeId'>): string | undefined {
  const seen = new Set<string>();
  let cur: Pick<MadeView, 'fromTakeId' | 'fromMadeId'> | undefined = m;
  while (cur) {
    if (cur.fromTakeId) return cur.fromTakeId;
    const id: string | undefined = cur.fromMadeId;
    if (!id || seen.has(id)) return undefined;
    seen.add(id);
    cur = state.made?.[id];
  }
  return undefined;
}

/**
 * How things made from a version are grouped in Reviews by version: by the
 * step that made them, else (no step) by what they are and their language,
 * so v2's transcriptions and translations each get a column only where some
 * exist.
 */
export function madeGroup(m: Pick<MadeView, 'kindId' | 'medium' | 'language'>): string {
  return m.kindId ? `kind:${m.kindId}` : `${m.medium}:${m.language ?? ''}`;
}

// ---- SHA-256 ------------------------------------------------------------------------
// Core has no dependencies (AGENTS.md), and validation must check a written
// part's name against its words on the phone as the server does (invariant
// 11), so the hash is here. Written parts are short; this is fast enough.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

/** UTF-8 bytes of a string, without TextEncoder (not on every JavaScript engine the app runs on). */
export function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    let c = ch.codePointAt(0)!;
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd; // a lone surrogate, as TextEncoder does
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

export function sha256Hex(text: string): string {
  const bytes = utf8(text);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(padded.length - 4, bitLen >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15]!, b = w[i - 2]!;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, hh = h[7]!;
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i]! + w[i]!) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0; h[1] = (h[1]! + b) >>> 0; h[2] = (h[2]! + c) >>> 0; h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0; h[5] = (h[5]! + f) >>> 0; h[6] = (h[6]! + g) >>> 0; h[7] = (h[7]! + hh) >>> 0;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}
