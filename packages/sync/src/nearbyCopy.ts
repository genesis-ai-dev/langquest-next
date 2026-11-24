import { canonicalJson, docHeadOf, isHash, ORG_STREAM, validateDoc, type DocHead, type LanguageState, type LibraryDoc, type LibraryFile, type OrgState } from '@langquest-next/core';
import { bytesToHex, docsThisLanguageUses, formatMayGoInStartingCopy, mayGoInStartingCopy, newcomerOrgState, utf8Encode, type Sha256 } from '@langquest-next/core/nearby';
import type { FillRows } from './keptFill';
import type { Message } from './nearbyWire';
import { OfflineError, type KeptRecord, type StartingCopy } from './types';

/**
 * A starting copy between two phones (docs/nearby-sync-plan.md 14.1, 4): the sender's answers to
 * `copy-ask`, and the newcomer's asks and what it keeps. Every part is a text, paged by
 * character offsets in decimal, so a dropped link resumes from what came: a stream's state, a
 * passage's rows (by `[unitId, offset]`), the member names, each library document the language
 * uses, and which of those the sender holds (`held`, with `copy-library`). Any teammate also asks
 * another for the documents its language uses that it lacks (`takeLibraryDocs`, 2026-11-24): the
 * documents only, across versions. The sender takes the language from the checked chain, never from an ask, and
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
/**
 * The most library documents a newcomer keeps from one copy, by count and by characters
 * (2026-11-24). Every guide the language uses goes now, so a collection may name thousands; FIA's
 * English is about 1,500 documents and 65 MB. A hostile sender's forged collection naming more
 * stops here, and what is left is asked of the next teammate or at first contact.
 */
export const COPY_DOCS_MAX_COUNT = 5_000;
export const COPY_DOCS_MAX_CHARS = 128 * 1024 * 1024;
/** The most a `held` answer may be: 30,000 hashes, six times the documents a copy keeps. */
export const COPY_HELD_MAX_CHARS = 2 * 1024 * 1024;

/** The app's library documents, over `docStore.ts` (sync has no file store). */
export interface NearbyDocs {
  /** What the walk needs of a document held here (`docHeadOf`), or null. Never the whole document, which a walk over every guide would hold in memory. */
  head(hash: string): Promise<DocHead | null>;
  text(hash: string): Promise<string | null>;
  /** Keep a teammate's text as a fetched document: no outbox row, because this phone did not make it. Called only once it hashes to its name, validates and the allowlist takes it. */
  keep(hash: string, text: string): Promise<boolean>;
}

/** What `SyncClient` gives a sender, for one stream. */
export interface CopyStream {
  startingCopy(): Promise<StartingCopy | null>;
  startingCopyRows?(unitId: string): Promise<KeptRecord[] | null>;
  /** A language kept on disk: the links its passages' rows hold, which its checkpoint does not. */
  keptPassageLinks?(): Promise<LanguageState['passageLinks']>;
}

/**
 * A language's state with the links its passages keep on disk laid under those in memory, so the
 * sender and the newcomer work out the same list: a language kept on disk moves `passageLinks` to
 * rows (decisions.md 143), and a material linked to a passage would otherwise be on neither.
 */
function withKeptLinks(state: LanguageState, kept: LanguageState['passageLinks'] | undefined): LanguageState {
  if (!kept || Object.keys(kept).length === 0) return state;
  return { ...state, passageLinks: { ...kept, ...(state.passageLinks ?? {}) } };
}

/**
 * Any teammate's phone, for the library documents its language uses (`copy-library`): it serves
 * those it holds, and asks a teammate for those it lacks. Its own state as it stands, unconfirmed
 * work and all: documents are named by their hash, so only the list of what may go depends on it.
 */
export interface NearbyLibrary {
  /** The organization's state on this phone, or null before it has one. */
  org(): Pick<OrgState, 'library' | 'recommendations'> | null;
  language(): LanguageState;
  /** As `CopyStream.keptPassageLinks`, for a language kept on disk. */
  keptPassageLinks?(): Promise<LanguageState['passageLinks']>;
  docs: NearbyDocs;
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
 * The documents this language uses, by `docsThisLanguageUses` with what `docs.head` answers, until
 * the list stops growing, and the heads read on the way: null for a hash not held here.
 */
async function walkWithHeads(org: Pick<OrgState, 'library' | 'recommendations'>, state: LanguageState, docs: NearbyDocs): Promise<{ list: string[]; heads: Map<string, DocHead | null> }> {
  const heads = new Map<string, DocHead | null>();
  for (;;) {
    const list = docsThisLanguageUses(org, state, (h) => heads.get(h) ?? null);
    const fresh = list.filter((h) => !heads.has(h));
    if (fresh.length === 0) return { list, heads };
    for (const h of fresh) heads.set(h, await docs.head(h).catch(() => null));
  }
}

const NO_REASONS: ReadonlySet<string> = new Set<CopyNoReason>(['not-allowed', 'not-filled', 'not-here', 'versions']);
const isNo = (text: string | CopyNoReason): text is CopyNoReason => NO_REASONS.has(text);

/**
 * The `held` and `doc` parts for one session, from one scope: the starting copy's states, or a
 * teammate's own (`NearbyLibrary`). It works out the list once. A document's text is dropped once
 * its last part has gone, so a session that sends every guide holds one at a time.
 */
export class LibraryDocsSender {
  private listed: Promise<{ list: Set<string>; held: string[] }> | null = null;
  private readonly texts = new Map<string, Promise<string | CopyNoReason>>();

  constructor(private readonly docs: NearbyDocs | undefined, private readonly scope: () => Promise<{ org: Pick<OrgState, 'library' | 'recommendations'>; state: LanguageState } | null>) {}

  /** A teammate's own library: its state as it stands. */
  static of(library: NearbyLibrary): LibraryDocsSender {
    return new LibraryDocsSender(library.docs, async () => {
      const org = library.org();
      return org ? { org, state: withKeptLinks(library.language(), await library.keptPassageLinks?.()) } : null;
    });
  }

  private list(): Promise<{ list: Set<string>; held: string[] }> {
    return (this.listed ??= (async () => {
      const scope = await this.scope();
      if (!this.docs || !scope) return { list: new Set<string>(), held: [] };
      const { list, heads } = await walkWithHeads(scope.org, scope.state, this.docs);
      return { list: new Set(list), held: list.filter((h) => heads.get(h)).sort() };
    })());
  }

  async answer(ask: CopyAsk): Promise<Omit<CopyPart, 't'> | CopyNoReason> {
    const docs = this.docs;
    if (ask.part === 'held') {
      const key = 'held';
      let text = this.texts.get(key);
      if (!text) {
        text = this.list().then((l) => JSON.stringify(l.held)).catch((): CopyNoReason => 'not-here');
        this.texts.set(key, text);
      }
      const got = await text;
      if (isNo(got)) return got;
      const part = partOf(got, ask.after);
      return part ? { part: 'held', ...part } : 'not-allowed';
    }
    if (ask.part !== 'doc') return 'not-allowed';
    const hash = ask.hash;
    if (!hash || !docs || !(await this.list()).list.has(hash)) return 'not-allowed';
    const key = `doc:${hash}`;
    let text = this.texts.get(key);
    if (!text) {
      text = (async (): Promise<string | CopyNoReason> => {
        const head = await docs.head(hash);
        if (!head) return 'not-here';
        if (!formatMayGoInStartingCopy(head.format)) return 'not-allowed';
        return (await docs.text(hash)) ?? 'not-here';
      })().catch((): CopyNoReason => 'not-here');
      this.texts.set(key, text);
    }
    const got = await text;
    if (isNo(got)) {
      this.texts.delete(key);
      return got;
    }
    const part = partOf(got, ask.after);
    if (!part) return 'not-allowed';
    if (part.next === null) this.texts.delete(key);
    return { part: 'doc', ...part };
  }
}

/**
 * The library files this phone's language names, from the documents of its list that it holds
 * (`libraryFilesOf`, in each head), by hash: what a phone may serve and ask for as reference
 * files in step 7 (docs/nearby-sync-plan.md 5.12, 2026-11-24). Whether one is here, and is not a
 * recording, is the file store's to say.
 */
export async function libraryFilesNamed(library: NearbyLibrary): Promise<Map<string, LibraryFile>> {
  const out = new Map<string, LibraryFile>();
  const org = library.org();
  if (!org) return out;
  const { list, heads } = await walkWithHeads(org, withKeptLinks(library.language(), await library.keptPassageLinks?.()), library.docs);
  for (const h of list) for (const f of heads.get(h)?.files ?? []) if (!out.has(f.hash)) out.set(f.hash, f);
  return out;
}

/**
 * A sender's side for one session. It works out the documents this language uses once, and
 * holds each text it has built, so every part of one text comes from the same text.
 */
export class StartingCopySender {
  private readonly texts = new Map<string, Promise<string | CopyNoReason>>();
  private orgCopy: Promise<StartingCopy | null> | null = null;
  private languageCopy: Promise<StartingCopy | null> | null = null;
  /** The list of section 5.12 from the copy's own states, so the sender and the newcomer work out the same one. */
  private readonly library: LibraryDocsSender;

  constructor(private readonly source: NearbyCopySource, private readonly languageId: string) {
    this.library = new LibraryDocsSender(source.docs, async () => {
      const [org, language] = await Promise.all([this.org(), this.language()]);
      if (!org || !language) return null;
      return { org: org.state as OrgState, state: withKeptLinks(language.state as LanguageState, await this.source.language.keptPassageLinks?.()) };
    });
  }

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

  /** The answer to one ask. */
  async answer(ask: CopyAsk): Promise<Omit<CopyPart, 't'> | CopyNoReason> {
    const done = (text: string | CopyNoReason, part: string, stream?: string): Omit<CopyPart, 't'> | CopyNoReason => {
      if (isNo(text)) return text;
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
        if (isNo(text)) return text;
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
      case 'held':
      case 'doc':
        return this.library.answer(ask);
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
async function askText(asker: CopyAsker, ask: Omit<CopyAsk, 't' | 'after'>, max = COPY_TEXT_MAX_CHARS): Promise<string> {
  const parts: string[] = [];
  let at = 0;
  for (;;) {
    const got = await asker(at === 0 ? ask : { ...ask, after: String(at) });
    if (got.t === 'copy-no') throw new CopyRefused(got.reason);
    parts.push(got.body);
    at += got.body.length;
    if (got.next === null) return parts.join('');
    if (got.next !== String(at) || at > max) throw new CopyRefused('malformed');
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
    /** As `CopyStream.keptPassageLinks`, for a language kept on disk. */
    keptPassageLinks?(): Promise<LanguageState['passageLinks']>;
  };
  org: { holdsCopy(): Promise<boolean>; adoptStartingCopy(copy: StartingCopy): Promise<void>; state(): OrgState } | null;
  /** Seeds `profile-directory` with the names the copy's members go by. */
  names?(names: Record<string, string>): Promise<void>;
  docs?: NearbyDocs;
  sha256: Sha256;
  /** The documents one copy keeps at most: `COPY_DOCS_MAX_COUNT` and `COPY_DOCS_MAX_CHARS` unless given. */
  docLimits?: { count: number; chars: number };
}

/**
 * What a phone took of the documents its language uses from one teammate. `missing`: asked or
 * not held there, and not here after. `capped`: it stopped at a bound (`COPY_DOCS_MAX_COUNT`,
 * `COPY_DOCS_MAX_CHARS`, or a session's `budgetChars`), and the rest comes from the next session or
 * at first contact.
 */
export interface LibraryDocsTaken { kept: number; refused: number; missing: number; capped: boolean }

export interface StartingCopyTaken {
  /** Both streams hold a copy and every passage is filled in. */
  whole: boolean;
  filled: number;
  docs: LibraryDocsTaken;
}

/** How a phone asks one teammate for documents. */
export interface LibraryDocsAsk {
  /** The teammate answers `held` (`copy-library`): ask only for what it holds. Else each hash is asked, as an older phone needs. */
  held: boolean;
  /** Characters of documents this session takes at most, past which the rest waits for the next: the Bluetooth pipe's share. */
  budgetChars?: number;
  /** Runs this phone's own reading, which says nothing on the link (the session's stall clock waits). */
  local?<T>(work: () => Promise<T>): Promise<T>;
}

/**
 * The documents this language uses that this phone lacks, asked of one teammate and each kept as
 * it comes, what the language names first (`docsThisLanguageUses`' order). A document is kept only
 * if its text hashes to its name, is canonical, validates and its format may go
 * (`admitDoc`). Nothing is asked when nothing is lacking. A teammate that cannot answer one
 * document costs that document, never the session; a dropped link (`OfflineError`) throws.
 */
export async function takeLibraryDocs(
  asker: CopyAsker, library: NearbyLibrary, keep: { sha256: Sha256; limits?: { count: number; chars: number } }, how: LibraryDocsAsk
): Promise<LibraryDocsTaken> {
  const docs: LibraryDocsTaken = { kept: 0, refused: 0, missing: 0, capped: false };
  const org = library.org();
  if (!org) return docs;
  const limits = keep.limits ?? { count: COPY_DOCS_MAX_COUNT, chars: COPY_DOCS_MAX_CHARS };
  const local = how.local ?? (<T>(work: () => Promise<T>) => work());
  const here = new Map<string, DocHead | null>();
  const asked = new Set<string>();
  const skipped = new Set<string>();
  let there: Set<string> | null = null;
  let keptChars = 0;
  const links = await library.keptPassageLinks?.();
  // The list and what this phone holds of it, read until the list stops growing.
  const lacking = () => local(async () => {
    for (;;) {
      const list = docsThisLanguageUses(org, withKeptLinks(library.language(), links), (h) => here.get(h) ?? null);
      const fresh = list.filter((h) => !here.has(h));
      if (fresh.length === 0) return list.filter((h) => here.get(h) === null && !asked.has(h) && !skipped.has(h));
      for (const h of fresh) here.set(h, await library.docs.head(h).catch(() => null));
    }
  });
  walk: for (;;) {
    const wanted = await lacking();
    if (wanted.length === 0) break;
    if (how.held && there === null) {
      there = new Set();
      try {
        const raw = JSON.parse(await askText(asker, { part: 'held' }, COPY_HELD_MAX_CHARS)) as unknown;
        if (Array.isArray(raw)) for (const h of raw) if (isHash(h)) there.add(h);
      } catch (err) {
        if (err instanceof OfflineError) throw err;
        // A teammate that will not say what it holds gives nothing this time.
      }
    }
    for (const hash of wanted) {
      if (there !== null && !there.has(hash)) {
        skipped.add(hash);
        continue;
      }
      if (docs.kept >= limits.count || keptChars >= limits.chars || (how.budgetChars !== undefined && keptChars >= how.budgetChars)) {
        docs.capped = true;
        break walk;
      }
      asked.add(hash);
      let text: string;
      try {
        text = await askText(asker, { part: 'doc', hash });
      } catch (err) {
        if (err instanceof OfflineError) throw err;
        continue;
      }
      const doc = await admitDoc(hash, text, keep.sha256);
      if (!doc || !(await library.docs.keep(hash, text))) {
        docs.refused += 1;
        continue;
      }
      here.set(hash, docHeadOf(doc));
      docs.kept += 1;
      keptChars += text.length;
    }
  }
  docs.missing = [...asked, ...skipped].filter((h) => !here.get(h)).length - docs.refused;
  return docs;
}

/**
 * The newcomer's side: what is not here yet, asked for in order, each kept as it comes, so a
 * dropped link or another teammate goes on from where it stopped. The organization first, since
 * the language's documents are chosen from its library. Documents last (`takeLibraryDocs`).
 */
export async function takeStartingCopy(asker: CopyAsker, target: StartingCopyTarget, how: LibraryDocsAsk = { held: false }): Promise<StartingCopyTaken> {
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
  const docs = target.docs && org
    ? await takeLibraryDocs(asker, {
      org: () => org.state(), language: () => language.state(), docs: target.docs,
      ...(language.keptPassageLinks ? { keptPassageLinks: () => language.keptPassageLinks!() } : {})
    }, { sha256: target.sha256, ...(target.docLimits ? { limits: target.docLimits } : {}) }, how)
    : { kept: 0, refused: 0, missing: 0, capped: false };
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
