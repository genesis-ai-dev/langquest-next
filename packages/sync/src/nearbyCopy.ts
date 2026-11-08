import { canonicalJson, isHash, ORG_STREAM, validateDoc, type LanguageState, type LibraryDoc, type OrgState } from '@langquest-next/core';
import { bytesToHex, docsThisLanguageUses, mayGoInStartingCopy, newcomerOrgState, utf8Encode, type Sha256 } from '@langquest-next/core/nearby';
import type { FillRows } from './keptFill';
import type { Message } from './nearbyWire';
import { OfflineError, type KeptRecord, type StartingCopy } from './types';

/**
 * A starting copy between two phones (docs/nearby-sync-plan.md 14.1, 4): the sender's answers to
 * `copy-ask`, and the newcomer's asks and what it keeps. Every part is a text, paged by
 * character offsets in decimal, so a dropped link resumes from what came: a stream's state, a
 * passage's rows (by `[unitId, offset]`), the member names, and each library document the
 * language uses. The sender takes the language from the checked chain, never from an ask, and
 * answers `copy-no` `not-allowed` for anything else. A copy is only ever a stand-in, which the
 * server's first download replaces; what is checked here is what keeps a newcomer's phone
 * whole and keeps other languages and other organizations off the link.
 */

type CopyAsk = Extract<Message, { t: 'copy-ask' }>;
type CopyPart = Extract<Message, { t: 'copy-part' }>;
type CopyNo = Extract<Message, { t: 'copy-no' }>;
export type CopyNoReason = CopyNo['reason'];

/** Encoded bytes a part's body may take inside its message, under `NEARBY_MESSAGE_MAX` with room for the rest. */
export const COPY_PART_BODY_BYTES = 900 * 1024;
/** The most a newcomer joins from one text: a hostile sender cannot fill its memory. */
export const COPY_TEXT_MAX_CHARS = 256 * 1024 * 1024;

/** The app's library documents, over `docStore.ts` (sync has no file store). */
export interface NearbyDocs {
  read(hash: string): Promise<LibraryDoc | null>;
  text(hash: string): Promise<string | null>;
  /** Keep a teammate's text as a fetched document: no outbox row, because this phone did not make it. Called only once it hashes to its name, validates and the allowlist takes it. */
  keep(hash: string, text: string): Promise<boolean>;
}

/** What `SyncClient` gives a sender, for one stream. */
export interface CopyStream {
  startingCopy(): Promise<StartingCopy | null>;
  startingCopyRows?(unitId: string): Promise<KeptRecord[] | null>;
}

/** Everything a sender reads from: the language's client, the organization's, member names and documents. */
export interface NearbyCopySource {
  language: CopyStream;
  org?: CopyStream | null;
  /** What `profile-directory` holds: names by profile id, filtered here to the copy's members. */
  names?(): Promise<Record<string, string>>;
  docs?: NearbyDocs;
}

/**
 * The longest prefix of `text` from `start` whose JSON string takes at most `budget` bytes of
 * UTF-8, never splitting a surrogate pair. Answers the end offset.
 */
export function sliceEnd(text: string, start: number, budget = COPY_PART_BODY_BYTES): number {
  let cost = 2;
  let i = start;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    const pair = c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff;
    const step = pair ? 4 : c === 0x22 || c === 0x5c ? 2 : c < 0x20 ? 6 : c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdfff ? 6 : 3;
    if (cost + step > budget) break;
    cost += step;
    i += pair ? 2 : 1;
  }
  return i;
}

const offsetOf = (after: string | undefined): number | null => {
  if (after === undefined) return 0;
  return /^(0|[1-9][0-9]{0,15})$/.test(after) ? Number(after) : null;
};

/** A text's part from `after`: the body and where the next begins. */
function partOf(text: string, after: string | undefined): { body: string; next: string | null } | null {
  const at = offsetOf(after);
  if (at === null || at > text.length) return null;
  const end = sliceEnd(text, at);
  if (end === at && at < text.length) return null;
  return { body: text.slice(at, end), next: end < text.length ? String(end) : null };
}

const rowsKey = (after: string | undefined): [string, number] | null => {
  if (after === undefined) return null;
  try {
    const v = JSON.parse(after) as unknown;
    return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string' && typeof v[1] === 'number' && Number.isSafeInteger(v[1]) && v[1] >= 0 ? [v[0], v[1]] : null;
  } catch {
    return null;
  }
};

/** One row on the wire: everything but its passage, which the ask names. */
type WireRow = [kind: string, id: string, ref: string, json: string];

/**
 * A sender's side for one session. It works out the documents this language uses once, and
 * holds each text it has built, so every part of one text comes from the same text.
 */
export class StartingCopySender {
  private readonly texts = new Map<string, Promise<string | CopyNoReason>>();
  private allowed: Promise<Set<string>> | null = null;
  private orgCopy: Promise<StartingCopy | null> | null = null;
  private languageCopy: Promise<StartingCopy | null> | null = null;

  constructor(private readonly source: NearbyCopySource, private readonly languageId: string) {}

  private language(): Promise<StartingCopy | null> {
    return (this.languageCopy ??= this.source.language.startingCopy());
  }

  /** The organization as a copy carries it: `newcomerOrgState` of the confirmed fold, for this language. */
  private org(): Promise<StartingCopy | null> {
    return (this.orgCopy ??= (async () => {
      const copy = await this.source.org?.startingCopy();
      return copy ? { serverSeq: copy.serverSeq, state: newcomerOrgState(copy.state as OrgState, this.languageId) } : null;
    })());
  }

  private text(key: string, build: () => Promise<string | CopyNoReason>): Promise<string | CopyNoReason> {
    let held = this.texts.get(key);
    if (!held) {
      held = build().catch((): CopyNoReason => 'not-here');
      this.texts.set(key, held);
    }
    return held;
  }

  /** The list of section 5.12, worked out with what `read` has returned until it stops growing. */
  private docsAllowed(): Promise<Set<string>> {
    return (this.allowed ??= (async () => {
      const docs = this.source.docs;
      const [org, language] = await Promise.all([this.org(), this.language()]);
      if (!docs || !org || !language) return new Set<string>();
      const read = new Map<string, LibraryDoc | null>();
      for (;;) {
        const list = docsThisLanguageUses(org.state as OrgState, language.state as LanguageState, (h) => read.get(h) ?? null);
        const fresh = list.filter((h) => !read.has(h));
        if (fresh.length === 0) return new Set(list);
        for (const h of fresh) read.set(h, await docs.read(h).catch(() => null));
      }
    })());
  }

  /** The answer to one ask. */
  async answer(ask: CopyAsk): Promise<Omit<CopyPart, 't'> | CopyNoReason> {
    const done = (text: string | CopyNoReason, part: string, stream?: string): Omit<CopyPart, 't'> | CopyNoReason => {
      if (text === 'not-allowed' || text === 'not-filled' || text === 'not-here' || text === 'versions') return text;
      const got = partOf(text, ask.after);
      return got ? { part, ...(stream !== undefined ? { stream } : {}), ...got } : 'not-allowed';
    };
    switch (ask.part) {
      case 'state': {
        const stream = ask.stream;
        if (stream !== this.languageId && stream !== ORG_STREAM) return 'not-allowed';
        const text = await this.text(`state:${stream}`, async () => {
          const copy = stream === ORG_STREAM ? await this.org() : await this.language();
          return copy ? JSON.stringify(copy) : stream === ORG_STREAM ? 'not-here' : 'not-filled';
        });
        return done(text, 'state', stream);
      }
      case 'rows': {
        const key = rowsKey(ask.after);
        if (ask.stream !== this.languageId || !key || !this.source.language.startingCopyRows) return 'not-allowed';
        const [unitId, offset] = key;
        const text = await this.text(`rows:${unitId}`, async () => {
          const rows = await this.source.language.startingCopyRows!(unitId);
          return rows ? JSON.stringify(rows.map((r): WireRow => [r.kind, r.id, r.ref, r.json])) : 'not-filled';
        });
        if (text === 'not-filled' || text === 'not-here' || text === 'not-allowed' || text === 'versions') return text;
        const got = partOf(text, String(offset));
        if (!got) return 'not-allowed';
        return { part: 'rows', stream: this.languageId, body: got.body, next: got.next === null ? null : JSON.stringify([unitId, Number(got.next)]) };
      }
      case 'names': {
        const text = await this.text('names', async () => {
          const org = await this.org();
          if (!org || !this.source.names) return 'not-here';
          const members = (org.state as OrgState).members;
          const all = await this.source.names();
          // Only the people of this cut: the directory holds every organization the sender is in, and join requests.
          const out: Record<string, string> = {};
          for (const [id, name] of Object.entries(all)) if (Object.prototype.hasOwnProperty.call(members, id) && typeof name === 'string') out[id] = name;
          return JSON.stringify(out);
        });
        return done(text, 'names');
      }
      case 'doc': {
        const hash = ask.hash;
        const docs = this.source.docs;
        if (!hash || !docs || !(await this.docsAllowed()).has(hash)) return 'not-allowed';
        const text = await this.text(`doc:${hash}`, async () => {
          const doc = await docs.read(hash);
          if (!doc) return 'not-here';
          if (!mayGoInStartingCopy(doc)) return 'not-allowed';
          return (await docs.text(hash)) ?? 'not-here';
        });
        return done(text, 'doc');
      }
      default:
        return 'not-allowed';
    }
  }
}

// ---- the newcomer's side ------------------------------------------------------------

/** One ask over the link and its answer. Rejects with `OfflineError` when the link goes. */
export type CopyAsker = (ask: Omit<CopyAsk, 't'>) => Promise<CopyPart | CopyNo>;

/** Refused by the sender, for this reason: the newcomer asks another teammate. */
export class CopyRefused extends Error {
  override name = 'CopyRefused';
  constructor(readonly reason: CopyNoReason | 'malformed') {
    super(reason);
  }
}

/** A whole text, part by part, from offset 0. */
async function askText(asker: CopyAsker, ask: Omit<CopyAsk, 't' | 'after'>): Promise<string> {
  const parts: string[] = [];
  let at = 0;
  for (;;) {
    const got = await asker(at === 0 ? ask : { ...ask, after: String(at) });
    if (got.t === 'copy-no') throw new CopyRefused(got.reason);
    parts.push(got.body);
    at += got.body.length;
    if (got.next === null) return parts.join('');
    if (got.next !== String(at) || at > COPY_TEXT_MAX_CHARS) throw new CopyRefused('malformed');
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isSeq = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;

/** A copy off the wire, or null. Only its form is checked: what it says is a stand-in the server replaces. */
export function parseStartingCopy(text: string, kept: boolean): StartingCopy | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!isObject(raw) || !isSeq(raw['serverSeq']) || !isObject(raw['state'])) return null;
  if (!kept) return raw['kept'] === undefined ? { serverSeq: raw['serverSeq'], state: raw['state'] } : null;
  const k = raw['kept'];
  if (!isObject(k) || !Array.isArray(k['lines']) || !Array.isArray(k['units'])) return null;
  const lines = k['lines'] as unknown[];
  const units = k['units'] as unknown[];
  if (!lines.every((l) => isObject(l) && typeof l['unitId'] === 'string')) return null;
  if (!units.every((u) => isObject(u) && typeof u['unitId'] === 'string' && isSeq(u['rows']))) return null;
  return {
    serverSeq: raw['serverSeq'], state: raw['state'],
    kept: { lines: lines as { unitId: string }[], units: (units as { unitId: string; rows: number }[]).map((u) => ({ unitId: u.unitId, rows: u.rows })) }
  };
}

/**
 * The fill's row source over a link (`FillRows`): one passage an ask, its rows as one text in
 * parts. Never null, so a link that drops is an `OfflineError` and never a gone cut, which would
 * drop the language. Each row is filed under the passage asked for, whatever the sender said.
 */
export function rowsOverLink(asker: CopyAsker, streamId: string): FillRows {
  return async (_orgId, _streamId, _version, minSeq, unitIds, after) => {
    const units = [...unitIds].sort();
    const at = after ? units.indexOf(after.unitId) : 0;
    const unitId = units[at < 0 ? 0 : at];
    if (unitId === undefined) return { serverSeq: minSeq, rows: [], next: null };
    const parts: string[] = [];
    let offset = 0;
    for (;;) {
      const got = await asker({ part: 'rows', stream: streamId, after: JSON.stringify([unitId, offset]) });
      // A teammate that cannot give these rows is a link that gives nothing more: the fill asks again later.
      if (got.t === 'copy-no') throw new OfflineError(`copy-no ${got.reason}`);
      parts.push(got.body);
      offset += got.body.length;
      if (got.next === null) break;
      if (got.next !== JSON.stringify([unitId, offset]) || offset > COPY_TEXT_MAX_CHARS) throw new OfflineError('rows out of order');
    }
    let raw: unknown;
    try { raw = JSON.parse(parts.join('')); } catch { raw = []; }
    const rows: KeptRecord[] = [];
    for (const r of Array.isArray(raw) ? raw : []) {
      if (!Array.isArray(r) || r.length !== 4 || !r.every((x) => typeof x === 'string')) continue;
      try { JSON.parse(r[3] as string); } catch { continue; }
      rows.push({ kind: r[0] as string, id: r[1] as string, unitId, ref: r[2] as string, json: r[3] as string });
    }
    const following = units[(at < 0 ? 0 : at) + 1];
    return { serverSeq: minSeq, rows, next: following === undefined ? null : { unitId: following, kind: '', id: '' } };
  };
}

/** What a newcomer's phone takes a copy into. */
export interface StartingCopyTarget {
  languageId: string;
  language: {
    holdsCopy(): Promise<boolean>;
    adoptStartingCopy(copy: StartingCopy): Promise<void>;
    fillFromCopy?(rows: FillRows): Promise<{ filled: number; filling: boolean }>;
    keptOnDisk: boolean;
    state(): LanguageState;
  };
  org: { holdsCopy(): Promise<boolean>; adoptStartingCopy(copy: StartingCopy): Promise<void>; state(): OrgState } | null;
  /** Seeds `profile-directory` with the names the copy's members go by. */
  names?(names: Record<string, string>): Promise<void>;
  docs?: NearbyDocs;
  sha256: Sha256;
}

export interface StartingCopyTaken {
  /** Both streams hold a copy and every passage is filled in. */
  whole: boolean;
  filled: number;
  docs: { kept: number; refused: number; missing: number };
}

/**
 * The newcomer's side: what is not here yet, asked for in order, each kept as it comes, so a
 * dropped link or another teammate goes on from where it stopped. The organization first, since
 * the language's documents are chosen from its library. A document is kept only if its text
 * hashes to its name, is canonical, validates and the allowlist takes it.
 */
export async function takeStartingCopy(asker: CopyAsker, target: StartingCopyTarget): Promise<StartingCopyTaken> {
  const { language, org, languageId } = target;
  if (org && !(await org.holdsCopy())) {
    const copy = parseStartingCopy(await askText(asker, { part: 'state', stream: ORG_STREAM }), false);
    if (!copy) throw new CopyRefused('malformed');
    await org.adoptStartingCopy(copy);
  }
  if (!(await language.holdsCopy())) {
    const copy = parseStartingCopy(await askText(asker, { part: 'state', stream: languageId }), language.keptOnDisk);
    if (!copy) throw new CopyRefused('malformed');
    await language.adoptStartingCopy(copy);
  }
  let filling = false;
  let filled = 0;
  if (language.fillFromCopy) {
    const f = await language.fillFromCopy(rowsOverLink(asker, languageId));
    filled = f.filled;
    filling = f.filling;
  }
  if (target.names) {
    try {
      const raw = JSON.parse(await askText(asker, { part: 'names' })) as unknown;
      if (isObject(raw)) {
        const names: Record<string, string> = {};
        for (const [id, name] of Object.entries(raw)) if (typeof name === 'string') names[id] = name;
        await target.names(names);
      }
    } catch (err) {
      if (err instanceof OfflineError) throw err;
      // No names: teammates show as "someone" until first contact.
    }
  }
  const docs = { kept: 0, refused: 0, missing: 0 };
  if (target.docs && org) {
    const local = target.docs;
    const here = new Map<string, LibraryDoc | null>();
    const asked = new Set<string>();
    for (;;) {
      const list = docsThisLanguageUses(org.state(), language.state(), (h) => here.get(h) ?? null);
      const fresh = list.filter((h) => !here.has(h) && !asked.has(h));
      if (fresh.length === 0) break;
      for (const hash of fresh) {
        const held = await local.read(hash).catch(() => null);
        if (held) { here.set(hash, held); continue; }
        asked.add(hash);
        let text: string;
        try {
          text = await askText(asker, { part: 'doc', hash });
        } catch (err) {
          if (err instanceof OfflineError) throw err;
          continue;
        }
        const doc = await admitDoc(hash, text, target.sha256);
        if (!doc || !(await local.keep(hash, text))) { docs.refused += 1; continue; }
        here.set(hash, doc);
        docs.kept += 1;
      }
    }
    docs.missing = asked.size - docs.kept - docs.refused;
  }
  const whole = (!org || await org.holdsCopy()) && await language.holdsCopy() && !filling;
  return { whole, filled, docs };
}

/** A teammate's text as a document, only if it hashes to its name, is the canonical text, validates and may go in a copy. */
export async function admitDoc(hash: string, text: string, sha256: Sha256): Promise<LibraryDoc | null> {
  if (!isHash(hash) || bytesToHex(await sha256(utf8Encode(text))) !== hash) return null;
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return null; }
  if (validateDoc(doc) !== null || canonicalJson(doc) !== text) return null;
  return mayGoInStartingCopy(doc as LibraryDoc) ? (doc as LibraryDoc) : null;
}
