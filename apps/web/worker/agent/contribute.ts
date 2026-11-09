import {
  buildIndexes, CommandError, commands, decodeHlc, derivePassage, encodeHlc, LISTENER_KIND, mayViewLanguage, privilegesFor, recordedCard, validateEvent,
  type AnyEvent, type EventSpec, type LanguageState, type NoteAnchor, type OrgState
} from '@langquest-next/core';
import { positionIn, type LanguageRecords } from '../languageRecords';
import { canRead, sha256Hex, type Grant } from './tokens';
import { languageAccess, parseVoiceNotes, reviewableKinds, VOICE_NOTE_FRESH_MS, type Refusal, type VoiceNote } from './view';

/**
 * Work made in another app, written back into LangQuest (decisions.md 205):
 * a new version of a passage, from audio pieces uploaded first, and a new
 * passage under a book. Both are written as the token's person, from the
 * token's device, with the events the app itself appends, so phones and
 * the database see nothing new. Both take an Idempotency-Key: the new ids
 * come from it, so a retry finds what the first try made.
 */

/** One piece of a new version, as PUT …/audio returned it, in playing order. */
export interface AudioPiece {
  hash: string;
  format: 'm4a' | 'wav';
  durationMs: number;
}

/**
 * Is this audio new: uploaded through the API in the last six hours and
 * named by nothing in the language yet, or one of `own` (pieces already on
 * this passage)? Naming any other audio would hand out a link to it, as
 * with voice notes (decisions.md 77).
 */
async function newAudio(records: LanguageRecords, hashes: readonly string[], now: number, own: ReadonlySet<string> = new Set()): Promise<boolean> {
  const ask = hashes.filter((h) => !own.has(h));
  if (!ask.length) return true;
  const { named, stored } = await records.files(ask);
  return !ask.some((h) => {
    const at = stored.get(h);
    return named.has(h) || (at !== undefined && decodeHlc(at).wallMs < now - VOICE_NOTE_FRESH_MS);
  });
}

/** Pieces one version may hold: a long passage recorded in short parts. */
export const MAX_VERSION_PIECES = 200;
/** The longest Idempotency-Key, as other APIs allow. */
export const IDEMPOTENCY_KEY_MAX = 255;

export interface VersionInput {
  pieces: AudioPiece[];
  /** What changed, for the team; "Recorded in <app>" when left out. */
  note?: string;
  /** The app behind the token, for the default note. */
  app: string;
  key: string;
}

export interface PassageInput {
  label: string;
  /** The book (or chapter, or folder) that holds it; the parent of afterUnitId when left out. */
  parentUnitId?: string;
  /** The unit it follows; the end of its parent when left out. */
  afterUnitId?: string;
  key: string;
}

interface Context {
  grant: Grant;
  org: OrgState;
  records: LanguageRecords;
  languageId: string;
  now: number;
}

const refuse = (status: number, code: string, error: string): Refusal => ({ status, code, error });
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const deviceOf = (tokenId: string) => `api-${tokenId}`;

/** The Idempotency-Key header: visible ASCII, at most 255 characters. */
export function parseIdempotencyKey(raw: string | null): string | Refusal {
  if (raw === null || raw.length === 0) {
    return refuse(400, 'idempotency_key', 'Send an Idempotency-Key header, such as your own id for this change, so a retry records nothing new.');
  }
  if (raw.length > IDEMPOTENCY_KEY_MAX || !/^[\x21-\x7e]+$/.test(raw)) {
    return refuse(400, 'idempotency_key', `Idempotency-Key is visible ASCII without spaces, at most ${IDEMPOTENCY_KEY_MAX} characters.`);
  }
  return raw;
}

function parsePiece(v: unknown): AudioPiece | null {
  const o = (v ?? {}) as Record<string, unknown>;
  if (typeof o['hash'] !== 'string' || !/^[0-9a-f]{64}$/.test(o['hash']) || (o['format'] !== 'm4a' && o['format'] !== 'wav')) return null;
  if (!(typeof o['durationMs'] === 'number' && Number.isFinite(o['durationMs']) && o['durationMs'] >= 0)) return null;
  return { hash: o['hash'], format: o['format'], durationMs: Math.round(o['durationMs']) };
}

export function parseVersion(body: unknown, key: string, app: string): VersionInput | Refusal {
  const b = (body ?? {}) as Record<string, unknown>;
  const raw = b['pieces'];
  const pieces = Array.isArray(raw) ? raw.map(parsePiece) : null;
  if (!pieces || pieces.length === 0 || pieces.length > MAX_VERSION_PIECES || pieces.some((p) => p === null) || new Set(pieces.map((p) => p!.hash)).size !== pieces.length) {
    return refuse(400, 'bad_request', `pieces is a list of 1 to ${MAX_VERSION_PIECES} different pieces, in playing order, each what PUT …/audio returned, with durationMs.`);
  }
  if (b['note'] !== undefined && !str(b['note'], 4000)) return refuse(400, 'bad_request', 'note must be non-empty text of at most 4000 characters.');
  return { pieces: pieces as AudioPiece[], key, app, ...(b['note'] !== undefined ? { note: (b['note'] as string).trim() } : {}) };
}

export function parsePassage(body: unknown, key: string): PassageInput | Refusal {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!str(b['label'], 200)) return refuse(400, 'bad_request', 'label is required: what the team will call the passage, such as "Luke 1:5-25" (at most 200 characters).');
  for (const k of ['parentUnitId', 'afterUnitId'] as const) {
    if (b[k] !== undefined && !str(b[k], 400)) return refuse(400, 'bad_request', `${k} must be a unit id.`);
  }
  if (b['parentUnitId'] === undefined && b['afterUnitId'] === undefined) {
    return refuse(400, 'bad_request', 'Say where it goes: parentUnitId (the book that holds it), afterUnitId (the passage it follows), or both.');
  }
  return {
    label: (b['label'] as string).trim(), key,
    ...(b['parentUnitId'] !== undefined ? { parentUnitId: b['parentUnitId'] as string } : {}),
    ...(b['afterUnitId'] !== undefined ? { afterUnitId: b['afterUnitId'] as string } : {})
  };
}

/** The events of one write, stamped one after another from the token's device, each checked as the database will. */
function envelopes(ctx: Context, specs: EventSpec[]): AnyEvent[] | Refusal {
  const device = deviceOf(ctx.grant.tokenId);
  const out = specs.map((s, i) => ({
    id: s.id, type: s.type, orgId: ctx.grant.orgId, streamId: ctx.languageId, actorId: ctx.grant.profileId, deviceId: device,
    hlc: encodeHlc(ctx.now, i, device), payload: s.payload
  }) as AnyEvent);
  for (const e of out) {
    const invalid = validateEvent(e);
    if (invalid) return refuse(400, 'invalid', invalid);
  }
  return out;
}

/** What a version write answers: its id, and whether it was there already. */
export interface VersionMade { takeId: string; duplicate: boolean; events: AnyEvent[] }

/**
 * A new version of a passage from pieces uploaded with PUT …/audio, as the
 * app's Publish makes it (core `publishVersion`): the pieces' recordings,
 * the take, its submission, and the note on what changed. It continues the
 * passage's latest version and replaces no draft, so a draft the token's
 * person has open on a phone stays theirs.
 *
 * Its id comes from the token, the passage and the Idempotency-Key, so a
 * retry finds the version made and records nothing. The same key with
 * other pieces is refused (409), never answered as the first one.
 */
export async function versionEvents(ctx: Context, unitId: string, input: VersionInput): Promise<VersionMade | Refusal> {
  const { grant, org, records, languageId } = ctx;
  if (!grant.scopes.includes('record')) return refuse(403, 'scope', 'This token was not given the "record" scope.');
  const can = languageAccess(grant, org, languageId);
  if (!can) return refuse(404, 'no_language', 'This token cannot open that language.');
  if (!privilegesFor(org, grant.profileId, languageId).has('translate')) {
    return refuse(403, 'privilege', 'The account behind this token cannot translate in this language, which adding versions needs.');
  }
  if (positionIn(records.passages, unitId) < 0) return refuse(404, 'no_passage', 'There is no passage with that id in this language.');
  const state = await records.view([unitId]);
  const idx = buildIndexes(state);
  if (!idx.passages.includes(unitId)) return refuse(404, 'no_passage', 'There is no passage with that id in this language.');
  const commandId = `api-ver-${(await sha256Hex([grant.tokenId, unitId, input.key].join('\n'))).slice(0, 32)}`;
  const takeId = `take:${commandId}`;
  const hashes = input.pieces.map((p) => p.hash);
  const made = state.takes[takeId];
  if (made) {
    return made.unitId === unitId && made.cardHashes.join() === hashes.join()
      ? { takeId, duplicate: true, events: [] }
      : refuse(409, 'idempotency_conflict', 'This Idempotency-Key already made a version of this passage with other pieces. Use a new key for a new version.');
  }
  const s = derivePassage(state, unitId, idx);
  // A piece is new audio from PUT …/audio, or a piece of a version of this very passage: naming any other audio would hand out a link to it.
  const ownPieces = new Set(s.versions.flatMap((v) => v.cardHashes));
  if (!(await newAudio(records, hashes, ctx.now, ownPieces))) {
    return refuse(400, 'bad_piece', 'Each piece must be audio you uploaded with PUT …/audio in the last six hours, or a piece of a version of this passage.');
  }
  const latest = s.latest;
  let specs: EventSpec[];
  try {
    specs = commands(state, idx).publishVersion({
      commandId, unitId, cardHashes: hashes, actorId: grant.profileId,
      // Continue the latest version, never a draft: a draft on a phone is its recorder's to finish (decisions.md 83).
      parentTakeId: latest?.takeId ?? null,
      ...(input.note || latest ? { note: input.note ?? `Recorded in ${input.app}` } : {})
    });
  } catch (e) {
    if (e instanceof CommandError) return refuse(409, 'unchanged', `${e.message} This version has the same pieces as the passage's latest.`);
    throw e;
  }
  const recordings: EventSpec[] = [];
  const seen = new Set<string>();
  input.pieces.forEach((p, i) => {
    if (ownPieces.has(p.hash) || seen.has(p.hash)) return;
    seen.add(p.hash);
    recordings.push({
      id: `${commandId}:rec${i}`, type: 'v1.RecordingAdded',
      payload: { recordingId: `rec:${commandId}:${i}`, unitId, kind: 'target', cards: [{ hash: p.hash, durationMs: p.durationMs, format: p.format }] }
    });
  });
  const events = envelopes(ctx, [...recordings, ...specs]);
  return 'status' in events ? events : { takeId, duplicate: false, events };
}

/**
 * A string that sorts after `lo` and before `hi` (null: nothing after),
 * for a new unit's place (`order` compares as plain strings, decisions.md
 * 205). It uses printable ASCII only. Null when no such string exists,
 * which only happens when `hi` is `lo` followed by `!`s.
 */
export function orderBetween(lo: string, hi: string | null): string | null {
  const FIRST = 0x21;
  const LAST = 0x7e;
  if (hi !== null && !(lo < hi)) return null;
  let out = '';
  let top = hi;
  for (let i = 0; i < lo.length + (hi?.length ?? 0) + 2; i++) {
    // Past its end, lo counts as below every character and an unbounded top as above them.
    const a = i < lo.length ? lo.charCodeAt(i) : FIRST - 1;
    const b = top !== null && i < top.length ? top.charCodeAt(i) : top === null ? LAST + 1 : FIRST - 1;
    if (a === b) {
      out += lo[i];
      continue;
    }
    const mid = Math.floor((a + b) / 2);
    if (mid > a && mid >= FIRST && mid <= LAST) return out + String.fromCharCode(mid);
    if (a >= FIRST) {
      // b is a + 1: keep lo's character, and anything above the rest of lo fits.
      out += lo[i];
      top = null;
      continue;
    }
    // lo has ended and top goes on with its lowest character: follow it.
    if (b !== FIRST) return null;
    out += '!';
  }
  return null;
}

/** The last place a unit and everything inside it take up: the greatest order among them. */
function lastWithin(state: LanguageState, unitId: string): string {
  const inside = new Set([unitId]);
  let last = state.units[unitId]!.order;
  for (let grew = true; grew;) {
    grew = false;
    for (const [id, u] of Object.entries(state.units)) {
      if (inside.has(id) || u.parentUnitId === null || !inside.has(u.parentUnitId)) continue;
      inside.add(id);
      if (u.order > last) last = u.order;
      grew = true;
    }
  }
  return last;
}

/** What a passage write answers: its id, and whether it was there already. */
export interface PassageMade { unitId: string; duplicate: boolean; events: AnyEvent[] }

/**
 * A new passage under a book (or chapter or folder), placed after a unit or
 * at the end of its parent: `v1.UnitAdded`, as a coordinator adds one by
 * hand. Its unit id has no template prefix, so no template hides it and it
 * has no verses (`reference` is null). The id comes from the token and the
 * Idempotency-Key, so a retry finds the passage made.
 */
export async function passageEvents(ctx: Context, input: PassageInput): Promise<PassageMade | Refusal> {
  const { grant, org, records, languageId } = ctx;
  if (!grant.scopes.includes('record')) return refuse(403, 'scope', 'This token was not given the "record" scope.');
  const can = languageAccess(grant, org, languageId);
  if (!can) return refuse(404, 'no_language', 'This token cannot open that language.');
  if (!privilegesFor(org, grant.profileId, languageId).has('manage_templates')) {
    return refuse(403, 'privilege', 'The account behind this token cannot change how this language\'s books are divided, which adding passages needs.');
  }
  const state: LanguageState = records.shared;
  const unitId = `api-${(await sha256Hex([grant.tokenId, languageId, input.key].join('\n'))).slice(0, 32)}`;
  const after = input.afterUnitId !== undefined ? state.units[input.afterUnitId] : undefined;
  if (input.afterUnitId !== undefined && !after) return refuse(404, 'no_unit', 'There is no unit with that afterUnitId in this language.');
  const parentUnitId = input.parentUnitId ?? after?.parentUnitId ?? null;
  const made = state.units[unitId];
  if (made) {
    return made.label === input.label && made.parentUnitId === parentUnitId
      ? { unitId, duplicate: true, events: [] }
      : refuse(409, 'idempotency_conflict', 'This Idempotency-Key already made another passage. Use a new key for a new passage.');
  }
  if (parentUnitId === null) return refuse(400, 'bad_request', 'afterUnitId is not inside a book: send parentUnitId too.');
  const parent = state.units[parentUnitId];
  if (!parent) return refuse(404, 'no_unit', 'There is no unit with that parentUnitId in this language.');
  if (after && after.parentUnitId !== parentUnitId) return refuse(400, 'bad_request', 'afterUnitId is not inside parentUnitId.');
  if (positionIn(records.passages, parentUnitId) >= 0) {
    return refuse(400, 'bad_request', 'parentUnitId is a passage, and a passage cannot hold another. Name the book that holds it.');
  }
  // After the unit named and everything it holds; at the end of the parent when none is named.
  const lo = lastWithin(state, input.afterUnitId ?? parentUnitId);
  let hi: string | null = null;
  for (const u of Object.values(state.units)) if (u.order > lo && (hi === null || u.order < hi)) hi = u.order;
  const order = orderBetween(lo, hi);
  if (order === null) return refuse(409, 'no_room', 'There is no place between those units. Name another afterUnitId.');
  const events = envelopes(ctx, [{
    id: `${unitId}:0`, type: 'v1.UnitAdded', payload: { unitId, parentUnitId, kind: 'passage', label: input.label, order }
  }]);
  return 'status' in events ? events : { unitId, duplicate: false, events };
}

// ---- notes and comments ---------------------------------------------------------------

export interface NoteInput {
  text?: string;
  /** A spoken note, as PUT …/voice-notes or PUT …/audio returned it. */
  voiceNote?: VoiceNote;
  /** The version it is about; the passage when left out (unless atMs is given: then the latest version). */
  takeId?: string;
  /** Where in that version, ms from its start. */
  atMs?: number;
  /** A verse it is about, "chapter:verse". */
  verse?: string;
  /** The note it answers (its noteId). */
  replyTo?: string;
  /** Who wrote it in the app, shown before the words. */
  authorName?: string;
  key: string;
}

export function parseNote(body: unknown, key: string): NoteInput | Refusal {
  const b = (body ?? {}) as Record<string, unknown>;
  for (const [k, max] of [['text', 4000], ['takeId', 200], ['verse', 20], ['replyTo', 300], ['authorName', 120]] as const) {
    if (b[k] !== undefined && !str(b[k], max)) return refuse(400, 'bad_request', `${k} must be non-empty text of at most ${max} characters.`);
  }
  if (b['verse'] !== undefined && !/^[1-9][0-9]{0,2}:[1-9][0-9]{0,2}$/.test(b['verse'] as string)) return refuse(400, 'bad_request', 'verse is "chapter:verse", such as "3:16".');
  if (b['atMs'] !== undefined && !(Number.isInteger(b['atMs']) && (b['atMs'] as number) >= 0)) return refuse(400, 'bad_request', 'atMs is a whole number of ms from the start of the version.');
  if (b['verse'] !== undefined && (b['takeId'] !== undefined || b['atMs'] !== undefined)) return refuse(400, 'bad_request', 'A note is about a verse, or a version (with atMs), not both.');
  const voice = b['voiceNote'] === undefined ? undefined : parseVoiceNotes([b['voiceNote']]);
  if (voice === null) return refuse(400, 'bad_request', 'voiceNote is what PUT …/voice-notes or PUT …/audio returned.');
  if (b['text'] === undefined && !voice) return refuse(400, 'bad_request', 'A note needs text, a voiceNote, or both.');
  const pick = (k: string) => (b[k] !== undefined ? { [k]: typeof b[k] === 'string' ? (b[k] as string).trim() : b[k] } : {});
  return { key, ...pick('text'), ...pick('takeId'), ...pick('atMs'), ...pick('verse'), ...pick('replyTo'), ...pick('authorName'), ...(voice ? { voiceNote: voice[0]! } : {}) } as NoteInput;
}

/** The part of a version playing `atMs` in, and how far into it as the app writes it ("m:ss", review.tsx noteMoment). */
function momentIn(state: LanguageState, cardHashes: readonly string[], atMs: number): { part: string; at: string } | null {
  let start = 0;
  for (const hash of cardHashes) {
    const length = recordedCard(state, hash)?.durationMs ?? 0;
    if (atMs < start + length || hash === cardHashes[cardHashes.length - 1]) {
      const s = Math.max(0, Math.round((atMs - start) / 1000));
      return { part: hash, at: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` };
    }
    start += length;
  }
  return null;
}

/** What a note, request or back translation write answers: its id, and whether it was there already. */
export interface Made { id: string; duplicate: boolean; events: AnyEvent[] }

/**
 * A comment from another app (core `addNote`): on the passage, a moment
 * in a version, or a verse, or an answer to a note, with words, a voice
 * note or both. Needs the review or record scope, and a person who may add
 * notes (translate, review or fill reference material). Its id comes from
 * the token, the passage and the Idempotency-Key.
 */
export async function noteEvents(ctx: Context, unitId: string, input: NoteInput): Promise<Made | Refusal> {
  const { grant, org, records, languageId } = ctx;
  if (!grant.scopes.includes('review') && !grant.scopes.includes('record')) return refuse(403, 'scope', 'Notes need the "review" or "record" scope.');
  if (!languageAccess(grant, org, languageId)) return refuse(404, 'no_language', 'This token cannot open that language.');
  const privs = privilegesFor(org, grant.profileId, languageId);
  if (!privs.has('translate') && !privs.has('review') && !privs.has('fill_reference')) {
    return refuse(403, 'privilege', 'The account behind this token cannot translate, review or fill reference material in this language, which adding notes needs.');
  }
  if (positionIn(records.passages, unitId) < 0) return refuse(404, 'no_passage', 'There is no passage with that id in this language.');
  const state = await records.view([unitId]);
  const idx = buildIndexes(state);
  if (!idx.passages.includes(unitId)) return refuse(404, 'no_passage', 'There is no passage with that id in this language.');
  const commandId = `api-note-${(await sha256Hex([grant.tokenId, unitId, input.key].join('\n'))).slice(0, 32)}`;
  const noteId = `note:${commandId}`;
  const name = input.authorName;
  const text = input.text !== undefined ? (name ? `${name}: ${input.text}` : input.text) : name ? `From ${name}` : undefined;
  const made = state.notes[noteId];
  if (made) {
    return made.unitId === unitId && made.text === text && made.blobHash === input.voiceNote?.hash
      ? { id: noteId, duplicate: true, events: [] }
      : refuse(409, 'idempotency_conflict', 'This Idempotency-Key already made another note. Use a new key for a new note.');
  }
  const s = derivePassage(state, unitId, idx);
  let anchor: NoteAnchor = { kind: 'passage' };
  if (input.verse) anchor = { kind: 'verse', verse: input.verse };
  else if (input.takeId !== undefined || input.atMs !== undefined) {
    const v = input.takeId !== undefined ? s.versions.find((x) => x.takeId === input.takeId) : canRead(grant, true) ? s.latest : undefined;
    if (!v) return refuse(404, 'no_version', input.takeId !== undefined ? 'That takeId is not a version of this passage.' : 'This passage has no version yet.');
    const moment = input.atMs !== undefined ? momentIn(state, v.cardHashes, input.atMs) : null;
    anchor = { kind: 'version', takeId: v.takeId, ...(moment ?? {}) };
  }
  if (input.replyTo !== undefined) {
    const to = state.notes[input.replyTo];
    if (!to || to.unitId !== unitId) return refuse(404, 'no_note', 'There is no note with that replyTo on this passage.');
    anchor = { ...anchor, replyTo: input.replyTo };
  }
  if (input.voiceNote && !(await newAudio(records, [input.voiceNote.hash], ctx.now))) {
    return refuse(400, 'bad_request', 'voiceNote must be one you just uploaded.');
  }
  const specs = commands(state, idx).addNote({
    commandId, unitId, anchor, ...(text !== undefined ? { text } : {}), ...(input.voiceNote ? { blobHash: input.voiceNote.hash } : {})
  });
  // A voice note's file is m4a unless the log says otherwise (blobs.ts voiceNoteOf).
  if (input.voiceNote?.format === 'wav' && state.audioFormats[input.voiceNote.hash]?.value !== 'wav') {
    specs.push({ id: `${commandId}:fmt`, type: 'v1.AudioFormatSet', payload: { hash: input.voiceNote.hash, format: 'wav' } });
  }
  const events = envelopes(ctx, specs);
  return 'status' in events ? events : { id: noteId, duplicate: false, events };
}

// ---- assignments ----------------------------------------------------------------------

export interface RequestInput {
  what: 'record' | 'review';
  /** For a review: a kind in the language's flow. */
  kindId?: string;
  /** A person in the language (GET …/people), or a review team; exactly one. */
  profileId?: string;
  teamId?: string;
  note?: string;
  key: string;
}

export function parseRequest(body: unknown, key: string): RequestInput | Refusal {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b['what'] !== 'record' && b['what'] !== 'review') return refuse(400, 'bad_request', 'what is "record" or "review".');
  for (const [k, max] of [['kindId', 100], ['profileId', 200], ['teamId', 200], ['note', 4000]] as const) {
    if (b[k] !== undefined && !str(b[k], max)) return refuse(400, 'bad_request', `${k} must be non-empty text of at most ${max} characters.`);
  }
  if ((b['profileId'] === undefined) === (b['teamId'] === undefined)) return refuse(400, 'bad_request', 'Ask one person (profileId) or one team (teamId).');
  if (b['what'] === 'review' && b['kindId'] === undefined) return refuse(400, 'bad_request', 'A review request names its kindId: a kind in the language\'s flow.');
  const pick = (k: string) => (b[k] !== undefined ? { [k]: (b[k] as string).trim() } : {});
  return { what: b['what'], key, ...pick('kindId'), ...pick('profileId'), ...pick('teamId'), ...pick('note') } as RequestInput;
}

/** May the token ask people for work here: the assign scope, and a person who sends work to reviewers or assigns it. */
export const mayAssign = (grant: Grant, privs: ReadonlySet<string>): boolean =>
  grant.scopes.includes('assign') && (privs.has('send_to_reviewers') || privs.has('assign_work'));

/**
 * An assignment from another app (core `ask`): someone in the language,
 * or a review team, asked to record the passage or review it for a kind.
 * Its id comes from the token, the passage and the Idempotency-Key.
 */
export async function requestEvents(ctx: Context, unitId: string, input: RequestInput): Promise<Made | Refusal> {
  const { grant, org, records, languageId } = ctx;
  if (!grant.scopes.includes('assign')) return refuse(403, 'scope', 'This token was not given the "assign" scope.');
  if (!languageAccess(grant, org, languageId)) return refuse(404, 'no_language', 'This token cannot open that language.');
  if (!mayAssign(grant, privilegesFor(org, grant.profileId, languageId))) {
    return refuse(403, 'privilege', 'The account behind this token cannot send work to reviewers or assign it in this language.');
  }
  if (positionIn(records.passages, unitId) < 0) return refuse(404, 'no_passage', 'There is no passage with that id in this language.');
  const state = await records.view([unitId]);
  const idx = buildIndexes(state);
  if (!idx.passages.includes(unitId)) return refuse(404, 'no_passage', 'There is no passage with that id in this language.');
  const commandId = `api-req-${(await sha256Hex([grant.tokenId, unitId, input.key].join('\n'))).slice(0, 32)}`;
  const requestId = `req:${commandId}`;
  const made = state.requests[requestId];
  if (made) {
    return made.unitId === unitId && made.what === input.what && made.profileId === input.profileId && made.teamId === input.teamId && made.kindId === input.kindId
      ? { id: requestId, duplicate: true, events: [] }
      : refuse(409, 'idempotency_conflict', 'This Idempotency-Key already made another request. Use a new key for a new request.');
  }
  if (input.profileId !== undefined && !(org.members[input.profileId] && mayViewLanguage(org, input.profileId, languageId))) {
    return refuse(404, 'no_person', 'There is nobody with that profileId in this language (GET …/people lists them).');
  }
  if (input.teamId !== undefined && !state.teams[input.teamId]) return refuse(404, 'no_team', 'There is no review team with that teamId in this language.');
  if (input.kindId !== undefined && (input.kindId === LISTENER_KIND || !reviewableKinds(state, unitId).has(input.kindId))) {
    return refuse(400, 'no_kind', 'kindId must be a kind in this language\'s flow.');
  }
  let specs: EventSpec[];
  try {
    specs = commands(state, idx).ask({
      commandId, unitId, what: input.what,
      ...(input.kindId !== undefined ? { kindId: input.kindId } : {}), ...(input.profileId !== undefined ? { profileId: input.profileId } : {}),
      ...(input.teamId !== undefined ? { teamId: input.teamId } : {}), ...(input.note !== undefined ? { note: input.note } : {})
    });
  } catch (e) {
    if (e instanceof CommandError) return refuse(400, 'bad_request', e.message);
    throw e;
  }
  const events = envelopes(ctx, specs);
  return 'status' in events ? events : { id: requestId, duplicate: false, events };
}

/** Who a token may ask for work in a language, and the review teams: GET …/people (names are added by http.ts). */
export interface PeopleOut {
  people: { profileId: string; name?: string; can: { translate: boolean; review: boolean } }[];
  teams: { teamId: string; name: string; kindId: string | null; members: string[] }[];
}

export function peopleIn(org: OrgState, state: LanguageState, languageId: string): PeopleOut {
  const people = Object.keys(org.members).filter((p) => mayViewLanguage(org, p, languageId)).sort().map((profileId) => {
    const privs = privilegesFor(org, profileId, languageId);
    return { profileId, can: { translate: privs.has('translate'), review: privs.has('review') } };
  });
  const teams = Object.entries(state.teams ?? {}).map(([teamId, t]) => ({
    teamId, name: t.name.value, kindId: t.kindId?.value ?? null,
    members: Object.entries(t.members).filter(([, m]) => m.value).map(([p]) => p).sort()
  })).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { people, teams };
}
