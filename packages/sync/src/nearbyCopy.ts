import { canonicalJson, docHeadOf, isHash, ORG_STREAM, validateDoc, type DocHead, type LanguageState, type LibraryDoc, type LibraryFile, type OrgState } from '@langquest-next/core';
import { bytesToHex, docsThisLanguageUses, formatMayGoInStartingCopy, labelKeysOf, mayGoInStartingCopy, newcomerOrgState, olderVersionsOf, utf8Encode, type Sha256 } from '@langquest-next/core/nearby';
import type { FillRows } from './keptFill';
import type { Message } from './nearbyWire';
import { OfflineError, type KeptRecord, type StartingCopy } from './types';

/**
 * A starting copy between two phones (docs/nearby-sync-plan.md 14.1, 4): the sender's answers to
 * `copy-ask`, and the newcomer's asks and what it keeps. Every part is a text, paged by
 * character offsets in decimal, so a dropped link resumes from what came: a stream's state, a
 * passage's rows (by `[unitId, offset]`), the member names, each library document the language
 * uses, and which of those the sender holds (`held`, with `copy-library`), and what its library's
 * items are called in a language (`labels`, with `copy-labels`, review item 13). Any teammate also asks
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
/** The most a `names` answer may be, and one name: tens of thousands of people, each as long as a profile lets a name be. */
export const COPY_NAMES_MAX_CHARS = 4 * 1024 * 1024;
const COPY_NAME_MAX_CHARS = 256;
/**
 * The most a `labels` answer may be, and the names it may hold (review item 13): a language's
 * library is a few thousand items at most, each named in a line or two.
 */
export const COPY_LABELS_MAX_CHARS = 2 * 1024 * 1024;
export const COPY_LABELS_MAX_COUNT = 5_000;
const LABEL_KEY_MAX_CHARS = 512;
const LABEL_NAME_MAX_CHARS = 256;
const LABEL_DESCRIPTION_MAX_CHARS = 4_000;

/**
 * The most one document's text may be, as the server's own limit (`library_put_document`, 4 MB):
 * a teammate's longer text is refused once that much has come (security review, 2026-11-24).
 */
export const COPY_DOC_MAX_CHARS = 4 * 1024 * 1024;
/** A sender keeps at most this many texts it is part-way through sending, so a peer that asks only first parts pins little. */
const TEXTS_HELD = 4;
/**
 * Over the Bluetooth pipe, past this many lacking documents a phone asks a teammate which it holds (`held`, up to
 * `COPY_HELD_MAX_CHARS`); at this many or fewer it asks each, which costs a short `no` for each the teammate lacks
 * (review P4).
 */
export const HELD_WORTH_ASKING = 16;
/** Documents asked at once over a link that moves files (review P5): fewer than a sender holds texts (`TEXTS_HELD`). */
export const DOCS_AT_ONCE = 3;

/** What another organization's library item is called in one language (decision 195), as the app keeps it. */
export interface NearbyLabel {
  name: string;
  description?: string;
}

/**
 * The names this phone keeps for library items in the language the app shows (`library-labels:<lang>`,
 * decision 195), between teammates (2026-11-24, review item 13): a phone that joined offline, or one
 * that never got online in its language, sees its team's guides and templates under the names the
 * inviter's phone shows, until the server's own read replaces them.
 */
export interface NearbyLabels {
  /** The language the app shows, whose names this phone keeps; null for one that needs none (English), which asks for none. */
  lang(): Promise<string | null>;
  /** What this phone keeps in a language, by `${orgId}/${itemId}`. */
  kept(lang: string): Promise<ReadonlyMap<string, NearbyLabel>>;
  /** What it keeps there came whole from the server, whose word no teammate's improves: then nothing is asked. */
  fromServer(lang: string): Promise<boolean>;
  /** Keep a teammate's names for keys this phone has none for; what it has stays. */
  keep(lang: string, labels: ReadonlyMap<string, NearbyLabel>): Promise<void>;
  /** A read or keep of names that threw: the app notes it in its diagnostics. The names are left for another session. */
  failed?(err: unknown): void;
}

/**
 * The most a `shared` answer may be, and the rows it may hold (review item 9): the Bibles other
 * organizations share in a team's languages are a handful, and each row is a line.
 */
export const COPY_SHARED_MAX_CHARS = 512 * 1024;
export const COPY_SHARED_MAX_COUNT = 200;
const SHARED_FIELD_MAX_CHARS = 256;
const SHARED_DESCRIPTION_MAX_CHARS = 1_000;

/** One row of what another organization shares (`shared_library_items`), as the app keeps it (`library-shared:material`). */
export interface NearbySharedRow {
  org_id: string;
  org_name: string;
  item_id: string;
  kind: string;
  name: string;
  description: string;
  subscribable: boolean;
  version_count: number;
  latest_hash: string;
  updated_hlc: string;
}

/**
 * The Bibles other organizations share that this team reads (2026-11-24, review item 9): a team
 * whose language recommends no Bible of its own reads these, from the list this phone keeps of
 * what others share. A teammate's rows are kept only while this phone has no list from the
 * server, and the documents they name travel as the language's own do.
 */
export interface NearbyShared {
  /** The shared Bibles this language reads, by document hash: those in the team's languages, and any not held here to tell. */
  hashes(): Promise<readonly string[]>;
  /** The rows behind them, for a teammate. */
  rows(): Promise<readonly NearbySharedRow[]>;
  /** What this phone keeps came from the server, whose word no teammate's improves: then nothing is asked. */
  fromServer(): Promise<boolean>;
  /** Keep a teammate's rows where this phone has none for that item; what it has stays. */
  keep(rows: readonly NearbySharedRow[]): Promise<void>;
  /** A read or keep that threw: the app notes it in its diagnostics, and the rows are left for another session. */
  failed?(err: unknown): void;
}

/** The shared Bibles' hashes a walk adds (`docsThisLanguageUses`' `shared`); none when the phone keeps no list or it cannot be read. */
async function sharedHashesOf(shared: NearbyShared | undefined): Promise<readonly string[]> {
  if (!shared) return [];
  try {
    return (await shared.hashes()).filter(isHash).slice(0, COPY_SHARED_MAX_COUNT);
  } catch (err) {
    shared.failed?.(err);
    return [];
  }
}

const sharedText = (rows: readonly NearbySharedRow[]): string => {
  const out: NearbySharedRow[] = [];
  let chars = 2;
  for (const row of rows) {
    const size = JSON.stringify(row).length + 1;
    if (out.length >= COPY_SHARED_MAX_COUNT || chars + size > COPY_SHARED_MAX_CHARS) break;
    out.push(row);
    chars += size;
  }
  return JSON.stringify(out);
};

/** A teammate's `shared` answer: only rows of the form the app keeps, of material, naming a document by hash, within bounds. Anything else is dropped. */
export function parseShared(text: string): NearbySharedRow[] {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return []; }
  if (!Array.isArray(raw)) return [];
  const field = (v: unknown, max = SHARED_FIELD_MAX_CHARS): v is string => typeof v === 'string' && v.length <= max;
  const out: NearbySharedRow[] = [];
  for (const r of raw.slice(0, COPY_SHARED_MAX_COUNT) as unknown[]) {
    if (!isObject(r)) continue;
    const { org_id, org_name, item_id, kind, name, description, subscribable, version_count, latest_hash, updated_hlc } = r;
    if (!field(org_id) || !org_id || !field(org_name) || !field(item_id) || !item_id || kind !== 'material' || !field(name)
      || !field(description, SHARED_DESCRIPTION_MAX_CHARS) || typeof subscribable !== 'boolean' || !Number.isInteger(version_count)
      || !isHash(latest_hash) || !field(updated_hlc)) continue;
    out.push({ org_id, org_name, item_id, kind, name, description, subscribable, version_count: version_count as number, latest_hash, updated_hlc });
  }
  return out;
}

/**
 * Ask a teammate for the rows of the Bibles other organizations share that this team reads, and keep
 * them (`copy-shared`, 2026-11-24, review item 9), before the documents, so the list the documents
 * are asked from names them. Nothing is asked when this phone's list came from the server. Answers
 * how many rows came. A dropped link throws; any other failure, this phone's own store's among
 * them, answers 0 and is told to `shared.failed`.
 */
export async function takeShared(asker: CopyAsker, shared: NearbyShared): Promise<number> {
  try {
    if (await shared.fromServer()) return 0;
    const got = parseShared(await askText(asker, { part: 'shared' }, COPY_SHARED_MAX_CHARS));
    if (got.length > 0) await shared.keep(got);
    return got.length;
  } catch (err) {
    if (err instanceof OfflineError) throw err;
    try { shared.failed?.(err); } catch { /* the rows wait for another session */ }
    return 0;
  }
}

/** The app's library documents, over `docStore.ts` (sync has no file store). */
export interface NearbyDocs {
  /** What the walk needs of a document held here (`docHeadOf`), or null. Never the whole document, which a walk over every guide would hold in memory. */
  head(hash: string): Promise<DocHead | null>;
  text(hash: string): Promise<string | null>;
  /** Keep a teammate's text as a fetched document: no outbox row, because this phone did not make it. Called only once it hashes to its name, validates and the allowlist takes it. */
  keep(hash: string, text: string): Promise<boolean>;
  /**
   * The documents this build cannot read (2026-11-24, review item 28): each came from a teammate
   * whole, its text hashing to its name and in canonical form, but in a format this build does not
   * know or does not take. Remembered until the app updates, so no session asks for them again.
   */
  unreadable?(): Promise<ReadonlySet<string>>;
  noteUnreadable?(hash: string): Promise<void>;
  /** A text's SHA-256 in hex by the phone's own native hash, faster than JavaScript's for a long document (review P6). Absent, `sha256` is used. */
  hashText?(text: string): Promise<string>;
}

/** What `SyncClient` gives a sender, for one stream. */
export interface CopyStream {
  startingCopy(): Promise<StartingCopy | null>;
  startingCopyRows?(unitId: string): Promise<KeptRecord[] | null>;
  /** As `startingCopyRows`, with the seq of the checkpoint the rows belong to, read together (2026-11-24, review item 4). */
  startingCopyRowsAt?(unitId: string): Promise<{ serverSeq: number; rows: KeptRecord[] } | null>;
  /** A language kept on disk: the links its passages' rows hold, which its checkpoint does not. */
  keptPassageLinks?(): Promise<LanguageState['passageLinks']>;
  /**
   * Who this phone carries signed work of in this language (its batches' authors): people let in
   * offline among them, whom the organization's members do not list yet, so the copy's names may
   * name them too (2026-11-24, review item 12).
   */
  nearbyAuthors?(): Promise<ReadonlySet<string>>;
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
  /** The phone wears a cover (decision 171): it takes only the documents its language itself names, never the rest of the library's guides. */
  worn?(): boolean;
  /** The names its library items go by in the app's language (`copy-labels`, review item 13): served to a teammate and asked of one. */
  labels?: NearbyLabels;
  /** The Bibles other organizations share that the team reads (`copy-shared`, review item 9): on the list, served and asked of a teammate. */
  shared?: NearbyShared;
}

/**
 * The documents a language's list once named on this phone (`NearbyKeep.listedDocs`, 2026-11-24, review item 17): a
 * sender serves them as well as its list, so a teammate whose organization data is behind still gets the version of
 * a guide its own data names, which this phone's newer data no longer lists.
 */
export interface NearbyListedDocs {
  before(): Promise<readonly string[]>;
  note(list: readonly string[]): Promise<void>;
}

/** Everything a sender reads from: the language's client, the organization's, member names and documents. */
export interface NearbyCopySource {
  language: CopyStream;
  org?: CopyStream | null;
  /**
   * What `profile-directory` holds, with the names checked chains gave people let in offline under
   * it (`chain-names:`): names by profile id, filtered here to the copy's members and the people
   * whose work the language carries (`nearbyAuthors`, 2026-11-24, review item 12).
   */
  names?(): Promise<Record<string, string>>;
  docs?: NearbyDocs;
  /** The names the language's library items go by in the newcomer's language, from what this phone keeps (`copy-labels`, review item 13). */
  labels?: NearbyLabels;
  /** The Bibles other organizations share that the team reads, and their rows (`copy-shared`, review item 9). */
  shared?: NearbyShared;
}

/**
 * The longest prefix of `text` from `start` whose JSON string takes at most `budget` bytes of
 * UTF-8, never splitting a surrogate pair. Answers the end offset.
 */
export function sliceEnd(text: string, start: number, budget = COPY_PART_BODY_BYTES): number {
  // No character costs more than 6 bytes in a JSON string: when the rest fits even so, it is not walked (review P6).
  if (2 + (text.length - start) * 6 <= budget) return text.length;
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
async function walkWithHeads(
  org: Pick<OrgState, 'library' | 'recommendations'>, state: LanguageState, docs: NearbyDocs, shared: readonly string[] = []
): Promise<{ list: string[]; heads: Map<string, DocHead | null> }> {
  const heads = new Map<string, DocHead | null>();
  for (;;) {
    const list = docsThisLanguageUses(org, state, (h) => heads.get(h) ?? null, { shared });
    const fresh = list.filter((h) => !heads.has(h));
    if (fresh.length === 0) return { list, heads };
    for (const h of fresh) heads.set(h, await docs.head(h).catch(() => null));
  }
}

/** The names kept for these keys, as a `labels` answer: sorted by key, within `COPY_LABELS_MAX_CHARS`, the rest left out. */
function labelsText(kept: ReadonlyMap<string, NearbyLabel>, keys: readonly string[]): string {
  const out: [string, NearbyLabel][] = [];
  let chars = 2;
  for (const key of keys) {
    const label = kept.get(key);
    if (!label || typeof label.name !== 'string') continue;
    const entry: [string, NearbyLabel] = [key, label.description ? { name: label.name, description: label.description } : { name: label.name }];
    const size = JSON.stringify(entry).length + 1;
    if (out.length >= COPY_LABELS_MAX_COUNT || chars + size > COPY_LABELS_MAX_CHARS) break;
    out.push(entry);
    chars += size;
  }
  return JSON.stringify(out);
}

/** A teammate's `labels` answer: only entries of the form a phone keeps, for keys `wanted` takes, within bounds. Anything else is dropped. */
export function parseLabels(text: string, wanted: (key: string) => boolean): Map<string, NearbyLabel> {
  const out = new Map<string, NearbyLabel>();
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return out; }
  if (!Array.isArray(raw)) return out;
  for (const entry of raw.slice(0, COPY_LABELS_MAX_COUNT) as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !isObject(entry[1])) continue;
    const [key, label] = entry as [string, Record<string, unknown>];
    const { name, description } = label;
    if (key.length > LABEL_KEY_MAX_CHARS || !wanted(key) || out.has(key)) continue;
    if (typeof name !== 'string' || name.trim() === '' || name.length > LABEL_NAME_MAX_CHARS) continue;
    if (description !== undefined && (typeof description !== 'string' || description.length > LABEL_DESCRIPTION_MAX_CHARS)) continue;
    out.set(key, typeof description === 'string' && description !== '' ? { name, description } : { name });
  }
  return out;
}

/**
 * The names this phone's library items go by in the app's language, asked of a teammate that serves
 * them (`copy-labels`, 2026-11-24, review item 13), each kept only where this phone has none: none
 * is asked when the app needs none (English), when what it keeps came from the server, or when no
 * item of `wanted` lacks one. Answers how many it kept. A drop throws, as any ask does; any other
 * failure, this phone's own store's among them, answers 0 and is told to `labels.failed`.
 */
export async function takeLabels(asker: CopyAsker, labels: NearbyLabels, wanted: readonly string[] | (() => Promise<readonly string[]>)): Promise<number> {
  try {
    return await labelsFrom(asker, labels, wanted);
  } catch (err) {
    if (err instanceof OfflineError) throw err;
    // Names are a nice-to-have (the review of item 13's fix): a store that cannot read or keep them gives none this
    // time, as the names step does, and the session's documents, Have and events, or the copy's documents, go on.
    try {
      labels.failed?.(err);
    } catch {
      // Noting is best effort.
    }
    return 0;
  }
}

async function labelsFrom(asker: CopyAsker, labels: NearbyLabels, wanted: readonly string[] | (() => Promise<readonly string[]>)): Promise<number> {
  const lang = await labels.lang();
  if (!lang || await labels.fromServer(lang)) return 0;
  // Worked out only now: a phone in English, or whose names came from the server, walks nothing for them.
  const keys = typeof wanted === 'function' ? await wanted() : wanted;
  if (keys.length === 0) return 0;
  const kept = await labels.kept(lang);
  const lacking = new Set(keys.filter((k) => !kept.has(k)));
  if (lacking.size === 0) return 0;
  let text: string;
  try {
    text = await askText(asker, { part: 'labels', lang }, COPY_LABELS_MAX_CHARS);
  } catch (err) {
    if (err instanceof OfflineError) throw err;
    // A teammate that cannot answer gives none this time.
    return 0;
  }
  const got = parseLabels(text, (key) => lacking.has(key));
  if (got.size > 0) await labels.keep(lang, got);
  return got.size;
}

const NO_REASONS: ReadonlySet<string> = new Set<CopyNoReason>(['not-allowed', 'not-filled', 'not-here', 'versions']);
const isNo = (text: string | CopyNoReason): text is CopyNoReason => NO_REASONS.has(text);

/**
 * The `held` and `doc` parts for one session, from one scope: the starting copy's states, or a
 * teammate's own (`NearbyLibrary`). It works out the list once. A document's text is dropped once
 * its last part has gone, so a session that sends every guide holds one at a time.
 */
export class LibraryDocsSender {
  private listed: Promise<{ list: Set<string>; servable: Set<string>; held: string[]; org: Pick<OrgState, 'library'> | null }> | null = null;
  private readonly texts = new Map<string, Promise<string | CopyNoReason>>();

  constructor(
    private readonly docs: NearbyDocs | undefined,
    private readonly scope: () => Promise<{ org: Pick<OrgState, 'library' | 'recommendations'>; state: LanguageState } | null>,
    private readonly labels?: NearbyLabels,
    private readonly before?: NearbyListedDocs,
    private readonly shared?: NearbyShared
  ) {}

  /** A teammate's own library: its state as it stands. */
  static of(library: NearbyLibrary, before?: NearbyListedDocs): LibraryDocsSender {
    return new LibraryDocsSender(library.docs, async () => {
      const org = library.org();
      return org ? { org, state: withKeptLinks(library.language(), await library.keptPassageLinks?.()) } : null;
    }, library.labels, before, library.shared);
  }

  /**
   * The list, and what may be served: the list, with the older versions of its items (`olderVersionsOf`) and what this
   * language's earlier lists named here (`NearbyListedDocs`), so a teammate whose organization data is behind gets the
   * version its own data names (2026-11-24, review item 17). Never another language's: both are this language's own.
   */
  private list(): Promise<{ list: Set<string>; servable: Set<string>; held: string[]; org: Pick<OrgState, 'library'> | null }> {
    return (this.listed ??= (async () => {
      const scope = await this.scope();
      if (!scope) return { list: new Set<string>(), servable: new Set<string>(), held: [], org: null };
      // With no documents here the list is what the language names, nothing walked: the names its items go by still go.
      const shared = await sharedHashesOf(this.shared);
      if (!this.docs) {
        const named = new Set(docsThisLanguageUses(scope.org, scope.state, () => null, { shared }));
        return { list: named, servable: named, held: [], org: scope.org };
      }
      const docs = this.docs;
      const { list, heads } = await walkWithHeads(scope.org, scope.state, docs, shared);
      const before = await this.before?.before().catch(() => []) ?? [];
      await this.before?.note(list).catch(() => undefined);
      const on = new Set(list);
      const older = [...new Set([...olderVersionsOf(scope.org, list), ...before])].filter((h) => !on.has(h));
      for (const h of older) if (!heads.has(h)) heads.set(h, await docs.head(h).catch(() => null));
      // An older version this build cannot read through stays out, as it would off the list.
      const olderHeld = older.filter((h) => { const head = heads.get(h); return !!head && formatMayGoInStartingCopy(head.format); });
      const servable = new Set([...list, ...olderHeld]);
      return { list: on, servable, held: [...servable].filter((h) => heads.get(h)).sort(), org: scope.org };
    })());
  }

  async answer(ask: CopyAsk): Promise<Omit<CopyPart, 't'> | CopyNoReason> {
    const docs = this.docs;
    if (ask.part === 'shared') {
      const shared = this.shared;
      if (!shared) return 'not-allowed';
      const key = 'shared';
      let text = this.texts.get(key);
      if (!text) {
        // Only the rows of Bibles this team reads (`NearbyShared.rows`), within bounds.
        text = shared.rows().then(sharedText).catch((): CopyNoReason => 'not-here');
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
      return { part: 'shared', ...part };
    }
    if (ask.part === 'labels') {
      const labels = this.labels;
      const lang = ask.lang;
      if (!labels || !lang) return 'not-allowed';
      const key = `labels:${lang}`;
      let text = this.texts.get(key);
      if (!text) {
        // One language's names at a time (the review of item 13's fix): a teammate naming many languages in turn holds
        // no more, and each is read again if asked again, as a document's text is.
        for (const k of [...this.texts.keys()]) if (k.startsWith('labels:')) this.texts.delete(k);
        // Only the names of items this language uses (`labelKeysOf`): what the phone keeps for its other languages stays here.
        text = this.list().then(async (l): Promise<string | CopyNoReason> => {
          if (!l.org) return 'not-here';
          return labelsText(await labels.kept(lang), labelKeysOf(l.org, l.list));
        }).catch((): CopyNoReason => 'not-here');
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
      return { part: 'labels', ...part };
    }
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
    if (!hash || !docs || !(await this.list()).servable.has(hash)) return 'not-allowed';
    const key = `doc:${hash}`;
    let text = this.texts.get(key);
    if (!text) {
      // A peer that asks only first parts must not pin every long text: the oldest goes, and is read again if asked.
      const docKeys = [...this.texts.keys()].filter((k) => k.startsWith('doc:'));
      for (const k of docKeys.slice(0, Math.max(0, docKeys.length - TEXTS_HELD + 1))) this.texts.delete(k);
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
 * The documents a phone's own language uses, as `takeLibraryDocs` works them out (`docsThisLanguageUses`, with the
 * guides the app offers unless the phone wears a cover): a hash not held here stays on the list, with nothing walked.
 */
export async function docsListOf(library: NearbyLibrary): Promise<string[]> {
  return (await docsWalkOf(library)).list;
}

async function docsWalkOf(library: NearbyLibrary): Promise<{ list: string[]; heads: Map<string, DocHead | null> }> {
  const org = library.org();
  const heads = new Map<string, DocHead | null>();
  if (!org) return { list: [], heads };
  const state = withKeptLinks(library.language(), await library.keptPassageLinks?.());
  const shared = await sharedHashesOf(library.shared);
  for (;;) {
    const list = docsThisLanguageUses(org, state, (h) => heads.get(h) ?? null, { offered: library.worn?.() !== true, shared });
    const fresh = list.filter((h) => !heads.has(h));
    if (fresh.length === 0) return { list, heads };
    for (const h of fresh) heads.set(h, await library.docs.head(h).catch(() => null));
  }
}

/**
 * The documents a phone's own language uses that it does not hold, less those this build cannot read: what a session
 * works out again once its events are in, since they may name a template, flow or material no ask before them covered
 * (2026-11-24, review item 15).
 */
export async function docsLackingOf(library: NearbyLibrary): Promise<string[]> {
  const { list, heads } = await docsWalkOf(library);
  const unreadable = await library.docs.unreadable?.().catch(() => null) ?? new Set<string>();
  return list.filter((h) => heads.get(h) === null && !unreadable.has(h));
}

/**
 * The library files this phone's language names, from the documents of its list that it holds
 * (`libraryFilesOf`, in each head), by hash: what a phone may serve and ask for as reference
 * files in step 7 (docs/nearby-sync-plan.md 5.12, 2026-11-24). Whether one is here, and is not a
 * recording, is the file store's to say.
 */
export async function libraryFilesNamed(library: NearbyLibrary): Promise<{ files: Map<string, LibraryFile>; links: string[] }> {
  const files = new Map<string, LibraryFile>();
  const links = new Set<string>();
  const org = library.org();
  if (!org) return { files, links: [] };
  const { list, heads } = await walkWithHeads(org, withKeptLinks(library.language(), await library.keptPassageLinks?.()), library.docs, await sharedHashesOf(library.shared));
  for (const h of list) {
    const head = heads.get(h);
    for (const f of head?.files ?? []) if (!files.has(f.hash)) files.set(f.hash, f);
    for (const url of head?.links ?? []) links.add(url);
  }
  return { files, links: [...links].sort() };
}

/**
 * A sender's side for one session. It works out the documents this language uses once, and
 * holds each text it has built, so every part of one text comes from the same text.
 */
export class StartingCopySender {
  private readonly texts = new Map<string, Promise<string | CopyNoReason>>();
  /** The seq of the checkpoint each passage's rows text was read from, which every part of it says (review item 4). */
  private readonly rowsSeq = new Map<string, number>();
  private orgCopy: Promise<StartingCopy | null> | null = null;
  private languageCopy: Promise<StartingCopy | null> | null = null;
  /** The list of section 5.12 from the copy's own states, so the sender and the newcomer work out the same one. */
  private readonly library: LibraryDocsSender;

  constructor(private readonly source: NearbyCopySource, private readonly languageId: string, before?: NearbyListedDocs) {
    this.library = new LibraryDocsSender(source.docs, async () => {
      const [org, language] = await Promise.all([this.org(), this.language()]);
      if (!org || !language) return null;
      return { org: org.state as OrgState, state: withKeptLinks(language.state as LanguageState, await this.source.language.keptPassageLinks?.()) };
    }, source.labels, before, source.shared);
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
      // At most a few passages' rows at once (review P8): a newcomer asks one passage after another, and one that asks only
      // first parts pins little. A passage's rows asked again are read again.
      if (key.startsWith('rows:')) {
        const rows = [...this.texts.keys()].filter((k) => k.startsWith('rows:'));
        for (const k of rows.slice(0, Math.max(0, rows.length - TEXTS_HELD + 1))) this.texts.delete(k);
      }
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
        const stream = this.source.language;
        if (ask.stream !== this.languageId || !key || (!stream.startingCopyRowsAt && !stream.startingCopyRows)) return 'not-allowed';
        const [unitId, offset] = key;
        const text = await this.text(`rows:${unitId}`, async () => {
          // The rows with the seq of the checkpoint they belong to (2026-11-24, review item 4), so a newcomer that took its
          // copy from another phone, or from this one at another checkpoint, takes none of them into it.
          const at = stream.startingCopyRowsAt
            ? await stream.startingCopyRowsAt(unitId)
            : await (async () => {
              const rows = await stream.startingCopyRows!(unitId);
              const copy = rows ? await this.language() : null;
              return rows && copy ? { serverSeq: copy.serverSeq, rows } : null;
            })();
          if (!at) return 'not-filled';
          this.rowsSeq.set(unitId, at.serverSeq);
          return JSON.stringify(at.rows.map((r): WireRow => [r.kind, r.id, r.ref, r.json]));
        });
        if (isNo(text)) {
          this.texts.delete(`rows:${unitId}`);
          return text;
        }
        const got = partOf(text, String(offset));
        const seq = this.rowsSeq.get(unitId);
        if (!got || seq === undefined) return 'not-allowed';
        // Its last part gone, the passage's text goes too, as a document's does (review P8): 100,000 rows were 50 MB held for the session.
        if (got.next === null) this.texts.delete(`rows:${unitId}`);
        return { part: 'rows', stream: this.languageId, body: got.body, next: got.next === null ? null : JSON.stringify([unitId, Number(got.next)]), seq };
      }
      case 'names': {
        const text = await this.text('names', async () => {
          const org = await this.org();
          if (!org || !this.source.names) return 'not-here';
          const members = (org.state as OrgState).members;
          const [all, authors] = await Promise.all([this.source.names(), this.source.language.nearbyAuthors?.() ?? Promise.resolve(new Set<string>())]);
          // Only the people of this cut and those whose work the language carries: the directory holds every organization the
          // sender is in, and join requests, and chain names come from every organization it shares nearby in.
          const out: Record<string, string> = {};
          for (const [id, name] of Object.entries(all)) {
            if (typeof name !== 'string' || name.length > COPY_NAME_MAX_CHARS) continue;
            if (Object.prototype.hasOwnProperty.call(members, id) || authors.has(id)) out[id] = name;
          }
          const json = JSON.stringify(out);
          return json.length > COPY_NAMES_MAX_CHARS ? 'not-here' : json;
        });
        return done(text, 'names');
      }
      case 'held':
      case 'doc':
      case 'labels':
      case 'shared':
        return this.library.answer(ask);
      default:
        return 'not-allowed';
    }
  }
}

// ---- the newcomer's side ------------------------------------------------------------

/** One ask over the link and its answer. Rejects with `OfflineError` when the link goes. */
export type CopyAsker = (ask: Omit<CopyAsk, 't'>) => Promise<CopyPart | CopyNo>;

/**
 * Refused by the sender, for this reason: the newcomer asks another teammate. `moved`: the
 * sender's checkpoint changed during the session in which this phone took its copy from it, so
 * its rows belong to another copy (2026-11-24, review item 4).
 */
export class CopyRefused extends Error {
  override name = 'CopyRefused';
  constructor(readonly reason: CopyNoReason | 'malformed' | 'moved') {
    super(reason);
  }
}

/**
 * A passage's rows came from a checkpoint other than the one this phone's copy came from, or from
 * a phone that does not say which (2026-11-24, review item 4): a teammate whose checkpoint is older
 * would fill passages with its older rows, and claims start above the copy, so that gap would
 * never close. The fill stops here, and the copy is taken whole from this teammate instead.
 */
export class OtherCheckpoint extends Error {
  override name = 'OtherCheckpoint';
  constructor(readonly said: number | null, readonly copy: number) {
    super(`rows from ${said ?? 'an unsaid checkpoint'}, copy from ${copy}`);
  }
}

/** A whole text, part by part, from offset 0. */
async function askText(asker: CopyAsker, ask: Omit<CopyAsk, 't' | 'after'>, max = COPY_TEXT_MAX_CHARS, first?: Promise<CopyPart | CopyNo>): Promise<string> {
  const parts: string[] = [];
  let at = 0;
  for (;;) {
    // The first part may have been asked ahead of its turn (review P5); the rest only once it is this text's turn.
    const got = at === 0 && first ? await first : await asker(at === 0 ? ask : { ...ask, after: String(at) });
    if (got.t === 'copy-no') throw new CopyRefused(got.reason);
    at += got.body.length;
    // Past its bound, the last part included: nothing more is joined.
    if (at > max) throw new CopyRefused('malformed');
    parts.push(got.body);
    if (got.next === null) return parts.join('');
    if (got.next !== String(at)) throw new CopyRefused('malformed');
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
 *
 * Every part says the seq of the sender's checkpoint (2026-11-24, review item 4), and the fill
 * takes rows only of the checkpoint its copy came from (`minSeq`, the fill's base): another seq
 * throws `OtherCheckpoint`. So does a part that says none (a sender from before then), unless
 * `sameSender`: the copy was taken from this sender in this session. A teammate that cannot give
 * the rows (`copy-no`, a fill of its own unfinished) refuses the copy (`CopyRefused`): the session
 * goes on, and another teammate finishes it.
 */
/**
 * A page of a newcomer's fill over the link holds up to this many passages, so they are kept in one commit, and this many
 * are asked at once, fewer than a sender holds texts (`TEXTS_HELD`), so none is read twice (review P5): a language of
 * 2,000 passages was 2,000 round trips and 2,000 commits one after another while the language was locked.
 */
const ROWS_PASSAGES_PER_PAGE = 16;
const ROWS_AT_ONCE = 3;

export function rowsOverLink(asker: CopyAsker, streamId: string, sameSender = false): FillRows {
  const passage = async (unitId: string, minSeq: number): Promise<KeptRecord[]> => {
    const parts: string[] = [];
    let offset = 0;
    for (;;) {
      const got = await asker({ part: 'rows', stream: streamId, after: JSON.stringify([unitId, offset]) });
      if (got.t === 'copy-no') throw new CopyRefused(got.reason);
      if (got.seq === undefined ? !sameSender : got.seq !== minSeq) throw new OtherCheckpoint(got.seq ?? null, minSeq);
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
    return rows;
  };
  // A failure after some of a page came: that page is kept, and the next call meets the failure (`passage` below).
  let pending: { err: unknown } | null = null;
  return async (_orgId, _streamId, _version, minSeq, unitIds, after) => {
    if (pending) {
      const { err } = pending;
      pending = null;
      throw err;
    }
    const units = [...unitIds].sort();
    const found = after ? units.indexOf(after.unitId) : 0;
    const start = found < 0 ? 0 : found;
    const page = units.slice(start, start + ROWS_PASSAGES_PER_PAGE);
    if (page.length === 0) return { serverSeq: minSeq, rows: [], next: null };
    // A few passages' asks out at once, kept in the page's order. Every ask is answered or has failed before the page
    // returns, so nothing of this page is still coming when the next step reads the link.
    const out: (KeptRecord[] | null)[] = page.map(() => null);
    let failure: { err: unknown } | null = null;
    let i = 0;
    const worker = async () => {
      for (let k = i++; k < page.length && failure === null; k = i++) {
        try { out[k] = await passage(page[k]!, minSeq); } catch (err) { failure ??= { err }; }
      }
    };
    await Promise.all(Array.from({ length: Math.min(ROWS_AT_ONCE, page.length) }, worker));
    // What came in order before a failure is a page of its own, kept as it was when passages came one at a time; the
    // failure ends the fill at the next call, as it did then.
    const whole = out.findIndex((rows) => rows === null);
    const upTo = whole < 0 ? page.length : whole;
    if (failure && upTo === 0) throw (failure as { err: unknown }).err;
    if (failure) pending = failure;
    const following = upTo < page.length ? page[upTo] : units[start + page.length];
    return { serverSeq: minSeq, rows: out.slice(0, upTo).flatMap((rows) => rows ?? []), next: following === undefined ? null : { unitId: following, kind: '', id: '' } };
  };
}

/** What a newcomer's phone takes a copy into. */
export interface StartingCopyTarget {
  languageId: string;
  language: {
    holdsCopy(): Promise<boolean>;
    adoptStartingCopy(copy: StartingCopy): Promise<void>;
    fillFromCopy?(rows: FillRows): Promise<{ filled: number; filling: boolean }>;
    /**
     * Drop the copy held, so this teammate's whole copy takes its place: its checkpoint is not the
     * one the copy came from (`OtherCheckpoint`, 2026-11-24, review item 4). Without it, the
     * teammate's rows are refused and another teammate finishes the copy.
     */
    dropCopy?(): Promise<void>;
    keptOnDisk: boolean;
    state(): LanguageState;
    /** As `CopyStream.keptPassageLinks`, for a language kept on disk. */
    keptPassageLinks?(): Promise<LanguageState['passageLinks']>;
  };
  /**
   * Whether a copy is still wanted, asked after each Hello (2026-11-24, review items 6 and 26): a
   * room on Share nearby or while LangQuest is open passes a target whenever its person's copy may
   * be missing, short or lost, and asks nobody once it is whole. Left out, always.
   */
  wanted?(): Promise<boolean>;
  org: { holdsCopy(): Promise<boolean>; adoptStartingCopy(copy: StartingCopy): Promise<void>; state(): OrgState } | null;
  /** Seeds `profile-directory` with the names the copy's members go by. */
  names?(names: Record<string, string>): Promise<void>;
  docs?: NearbyDocs;
  /** Where the names the language's library items go by in the app's language are kept (review item 13). */
  labels?: NearbyLabels;
  /** Where the rows of the Bibles other organizations share are kept (review item 9). */
  shared?: NearbyShared;
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
export interface LibraryDocsTaken {
  kept: number; refused: number; missing: number; capped: boolean;
  /**
   * Documents that came whole but this build cannot read (2026-11-24, review item 28): skipped and
   * remembered until the app updates, never counted as refused. Absent when none.
   */
  unreadable?: number;
  /**
   * A starting copy only: the link went while names or documents came, after the copy was whole
   * (2026-11-24, review item 3). The copy stands; what did not come is asked of the next teammate.
   */
  cut?: true;
  /** Names of library items in the app's language kept from the teammate (`takeLabels`, review item 13); absent when none. */
  labels?: number;
  /** Rows of the Bibles other organizations share kept from the teammate (`takeShared`, review item 9); absent when none. */
  shared?: number;
}

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
  /** A dropped link ends the documents with `cut`, keeping the count of what came, rather than throwing (after a whole copy, review item 3). */
  cutOnDrop?: boolean;
  /** The teammate serves the names library items go by (`copy-labels`, review item 13): ask them as well. */
  labels?: boolean;
  /** The teammate serves the rows of the Bibles other organizations share (`copy-shared`, review item 9): ask them first. */
  shared?: boolean;
  /**
   * Every hash the walk found on the language's list, held here or not, added as it is found: what a session compares
   * against once its events are in, to tell whether they named a document no ask covered (2026-11-24, review item 15).
   */
  seen?: Set<string>;
}

/**
 * The documents this language uses that this phone lacks, asked of one teammate and each kept as
 * it comes, what the language names first (`docsThisLanguageUses`' order). A document is kept only
 * if its text hashes to its name, is canonical, validates and its format may go
 * (`admitDoc`). Nothing is asked when nothing is lacking. A teammate that cannot answer one
 * document costs that document, never the session; a dropped link (`OfflineError`) throws. Every
 * character that comes counts against the bounds, kept or not, each text is at most
 * `COPY_DOC_MAX_CHARS`, and a teammate whose text does not check, or runs past its bound, is asked
 * nothing more this time (security review, 2026-11-24). A text that does check, hashing to its
 * name and in canonical form, but that this build cannot read (a format a newer build added) is
 * no forgery: it is skipped, remembered until the app updates (`NearbyDocs.unreadable`), and the
 * rest are still taken (2026-11-24, review item 28).
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
  // Documents this build cannot read: never asked for again until the app updates.
  const unreadable = new Set(await local(async () => [...(await library.docs.unreadable?.().catch(() => null) ?? [])]));
  let gotUnreadable = 0;
  let there: Set<string> | null = null;
  let came = 0;
  /** The first parts of documents asked ahead of their turn (review P5). */
  const ahead = new Map<string, Promise<CopyPart | CopyNo>>();
  const offered = library.worn?.() !== true;
  const links = await library.keptPassageLinks?.();
  const shared = await local(() => sharedHashesOf(library.shared));
  // The list and what this phone holds of it, read until the list stops growing.
  const lacking = () => local(async () => {
    for (;;) {
      const list = docsThisLanguageUses(org, withKeptLinks(library.language(), links), (h) => here.get(h) ?? null, { offered, shared });
      for (const h of list) how.seen?.add(h);
      const fresh = list.filter((h) => !here.has(h));
      if (fresh.length === 0) return list.filter((h) => here.get(h) === null && !asked.has(h) && !skipped.has(h) && !unreadable.has(h));
      for (const h of fresh) here.set(h, await library.docs.head(h).catch(() => null));
    }
  });
  try {
    walk: for (;;) {
      const wanted = await lacking();
      if (wanted.length === 0) break;
      // What the teammate holds. Over the Bluetooth pipe (`budgetChars`) only when this phone lacks enough for the list to be
      // worth it: a few are asked one by one, so a phone that lacks a handful no teammate holds is not sent the whole list
      // every session (review P4).
      if (how.held && there === null && (how.budgetChars === undefined || wanted.length > HELD_WORTH_ASKING)) {
        there = new Set();
        try {
          const heldText = await askText(asker, { part: 'held' }, COPY_HELD_MAX_CHARS);
          // The list counts against what the session may take, as the documents do (review P4).
          came += heldText.length;
          const raw = JSON.parse(heldText) as unknown;
          if (Array.isArray(raw)) for (const h of raw) if (isHash(h)) there.add(h);
        } catch (err) {
          if (err instanceof OfflineError) throw err;
          // A teammate that will not say what it holds gives nothing this time.
        }
      }
      const asking = wanted.filter((h) => there === null || there.has(h));
      for (const hash of wanted) {
        if (there !== null && !there.has(hash)) {
          skipped.add(hash);
          continue;
        }
        const room = Math.min(limits.chars, how.budgetChars ?? Infinity) - came;
        if (docs.kept >= limits.count || room <= 0) {
          docs.capped = true;
          break walk;
        }
        asked.add(hash);
        let text: string;
        // At most one text's bound, and never past what the session may still take. Over the pipe, after the session's
        // first document only what is left of its share (review P4): every session still takes one, so a large one comes
        // in time, and now that documents follow the events it holds none of them up.
        const share = how.budgetChars === undefined || docs.kept + docs.refused + gotUnreadable === 0 ? Infinity : how.budgetChars - came;
        const early = ahead.get(hash);
        ahead.delete(hash);
        const max = Math.min(COPY_DOC_MAX_CHARS, limits.chars - came, share);
        // This one first, so asks go out in the list's order.
        const coming = askText(asker, { part: 'doc', hash }, max, early);
        coming.catch(() => undefined);
        // Over a link that moves files, the first parts of the next few are asked now too (review P5): FIA's 1,525 English
        // guides were as many round trips one after another. The rest of each is asked only in its turn, so a teammate
        // whose text does not check is asked no more than those first parts besides.
        if (how.budgetChars === undefined) {
          const at = asking.indexOf(hash);
          for (const next of asking.slice(at + 1, at + DOCS_AT_ONCE)) {
            if (ahead.has(next) || asked.has(next) || docs.kept + ahead.size + 1 >= limits.count) continue;
            const promise = asker({ part: 'doc', hash: next });
            promise.catch(() => undefined);
            ahead.set(next, promise);
          }
        }
        try {
          text = await coming;
        } catch (err) {
          if (err instanceof OfflineError) throw err;
          // Larger than what is left of the pipe's share: it waits for the next session, where it may come first.
          if (err instanceof CopyRefused && err.reason === 'malformed' && max === share && share < COPY_DOC_MAX_CHARS) {
            came += max;
            docs.capped = true;
            break walk;
          }
          // Past its bound, or out of order: counted as refused, and nothing more is asked of this teammate.
          if (err instanceof CopyRefused && err.reason === 'malformed') {
            came += max;
            docs.refused += 1;
            break walk;
          }
          continue;
        }
        came += text.length;
        const doc = await admitDoc(hash, text, keep.sha256, library.docs.hashText?.bind(library.docs));
        if (doc === 'unreadable') {
          // Whole and genuine, in a format this build cannot read: skipped, remembered until the app updates, and the rest go on.
          unreadable.add(hash);
          gotUnreadable += 1;
          await local(async () => { await library.docs.noteUnreadable?.(hash).catch(() => undefined); });
          continue;
        }
        if (!doc || !(await library.docs.keep(hash, text))) {
          // A text that does not check: this teammate is asked nothing more this time.
          docs.refused += 1;
          break walk;
        }
        here.set(hash, docHeadOf(doc));
        docs.kept += 1;
      }
    }
  } catch (err) {
    // After a whole copy, a drop ends the documents with what came (review item 3).
    if (!(err instanceof OfflineError) || !how.cutOnDrop) throw err;
    docs.cut = true;
  } finally {
    // Nothing asked ahead is still coming when the session reads the link for its next step; what it brings is not kept.
    await Promise.allSettled([...ahead.values()]);
  }
  docs.missing = [...asked, ...skipped].filter((h) => !here.get(h) && !unreadable.has(h)).length - docs.refused;
  if (gotUnreadable > 0) docs.unreadable = gotUnreadable;
  return docs;
}

/**
 * A fill that a teammate at another checkpoint stopped (`OtherCheckpoint`), taken again from that
 * teammate (2026-11-24, review item 4). Its state is asked for and read before anything is
 * dropped: the ask may take many parts on Bluetooth, and a link that goes during it leaves the
 * part-filled copy, and every passage it filled, as they were. Only then are the drop and the
 * adoption done, both on this phone. A teammate whose checkpoint moved between its rows and its
 * state, or during the fill that follows, refuses the copy (`CopyRefused` `moved`), so the session
 * goes on and another teammate finishes it. A teammate from before seqs on rows (`said` null) whose
 * state is at the copy's own checkpoint holds the same copy: the fill goes on from it, nothing
 * dropped, as from the teammate the copy was taken from in the same session.
 */
async function fillAgain(stopped: OtherCheckpoint, how: {
  ask(): Promise<StartingCopy>;
  drop(): Promise<void>;
  adopt(copy: StartingCopy): Promise<void>;
  /** The fill over the link, taking rows that say no seq when `unsaid`. */
  fill(unsaid: boolean): Promise<{ filled: number; filling: boolean }>;
}): Promise<{ filled: number; filling: boolean }> {
  const copy = await how.ask();
  if (stopped.said !== null && copy.serverSeq !== stopped.said) throw new CopyRefused('moved');
  if (stopped.said !== null || copy.serverSeq !== stopped.copy) {
    await how.drop();
    await how.adopt(copy);
  }
  try {
    return await how.fill(true);
  } catch (err) {
    if (err instanceof OtherCheckpoint) throw new CopyRefused('moved');
    throw err;
  }
}

/**
 * The newcomer's side: what is not here yet, asked for in order, each kept as it comes, so a
 * dropped link or another teammate goes on from where it stopped. The organization first, since
 * the language's documents are chosen from its library. Documents last (`takeLibraryDocs`).
 *
 * A fill resumes only from a teammate whose checkpoint is the one the copy came from (2026-11-24,
 * review item 4): from any other, this teammate's whole copy is asked for and then takes the
 * language copy's place (`OtherCheckpoint`, `fillAgain`), or, with no way to drop it, the copy is
 * refused here. Every way it fails short of a dropped link is a `CopyRefused`, which the session
 * goes on from.
 *
 * Whether the copy is whole is known once the passages are filled, before names and documents,
 * which are the longest part (2026-11-24, review item 3): `onWhole` hears it then, with what was
 * taken so far, so the person can be set though the link goes during them. A drop in names or
 * documents after a whole copy is no failed copy: it answers with `docs.cut`.
 */
export async function takeStartingCopy(
  asker: CopyAsker, target: StartingCopyTarget, how: LibraryDocsAsk = { held: false }, onWhole?: (taken: StartingCopyTaken) => Promise<void>
): Promise<StartingCopyTaken> {
  const { language, org, languageId } = target;
  if (org && !(await org.holdsCopy())) {
    const copy = parseStartingCopy(await askText(asker, { part: 'state', stream: ORG_STREAM }), false);
    if (!copy) throw new CopyRefused('malformed');
    await org.adoptStartingCopy(copy);
  }
  const askLanguage = async (): Promise<StartingCopy> => {
    const copy = parseStartingCopy(await askText(asker, { part: 'state', stream: languageId }), language.keptOnDisk);
    if (!copy) throw new CopyRefused('malformed');
    return copy;
  };
  // Taken from this teammate in this session: its rows belong to the same copy even when it does not say so.
  let sameSender = false;
  if (!(await language.holdsCopy())) {
    await language.adoptStartingCopy(await askLanguage());
    sameSender = true;
  }
  let filling = false;
  let filled = 0;
  if (language.fillFromCopy) {
    const fill = language.fillFromCopy.bind(language);
    let f: { filled: number; filling: boolean };
    try {
      f = await fill(rowsOverLink(asker, languageId, sameSender));
    } catch (err) {
      if (!(err instanceof OtherCheckpoint)) throw err;
      // Its checkpoint moved during this very session, or there is no way to drop the copy: another teammate finishes it.
      if (sameSender || !language.dropCopy) throw new CopyRefused(sameSender ? 'moved' : 'not-filled');
      f = await fillAgain(err, {
        ask: askLanguage, drop: language.dropCopy.bind(language), adopt: language.adoptStartingCopy.bind(language), fill: (more) => fill(rowsOverLink(asker, languageId, more))
      });
    }
    filled = f.filled;
    filling = f.filling;
  }
  const whole = (!org || await org.holdsCopy()) && await language.holdsCopy() && !filling;
  const none: LibraryDocsTaken = { kept: 0, refused: 0, missing: 0, capped: false };
  if (whole) await onWhole?.({ whole, filled, docs: none });
  let cut = false;
  if (target.names) {
    try {
      const raw = JSON.parse(await askText(asker, { part: 'names' }, COPY_NAMES_MAX_CHARS)) as unknown;
      if (isObject(raw)) {
        const names: Record<string, string> = {};
        for (const [id, name] of Object.entries(raw)) if (typeof name === 'string' && name.length <= COPY_NAME_MAX_CHARS && id.length <= COPY_NAME_MAX_CHARS) names[id] = name;
        await target.names(names);
      }
    } catch (err) {
      if (!(err instanceof OfflineError)) {
        // No names: teammates show as "someone" until first contact.
      } else if (whole) cut = true;
      else throw err;
    }
  }
  // The names library items go by in the newcomer's language: whatever the organization follows, as the sender filters them to this language's.
  let labelsKept = 0;
  if (!cut && how.labels && target.labels && org) {
    try {
      labelsKept = await takeLabels(asker, target.labels, labelKeysOf(org.state()));
    } catch (err) {
      if (!(err instanceof OfflineError) || !whole) throw err;
      cut = true;
    }
  }
  // The rows of the Bibles other organizations share that the team reads, before the documents, so their list names them (review item 9).
  let sharedKept = 0;
  if (!cut && how.shared && target.shared) {
    try {
      sharedKept = await takeShared(asker, target.shared);
    } catch (err) {
      if (!(err instanceof OfflineError) || !whole) throw err;
      cut = true;
    }
  }
  const taken = !cut && target.docs && org
    ? await takeLibraryDocs(asker, {
      org: () => org.state(), language: () => language.state(), docs: target.docs,
      ...(language.keptPassageLinks ? { keptPassageLinks: () => language.keptPassageLinks!() } : {}),
      ...(target.shared ? { shared: target.shared } : {})
    }, { sha256: target.sha256, ...(target.docLimits ? { limits: target.docLimits } : {}) }, { ...how, cutOnDrop: whole })
    : none;
  const docs = { ...taken, ...(labelsKept > 0 ? { labels: labelsKept } : {}), ...(sharedKept > 0 ? { shared: sharedKept } : {}) };
  // What came before the drop is kept; the rest is asked of the next teammate, or at first contact.
  return { whole, filled, docs: cut ? { ...docs, cut: true } : docs };
}

/**
 * A teammate's text as a document, only if it hashes to its name, is the canonical text, validates
 * and may go in a copy. Null for a forgery: a wrong hash, or a text that is not JSON in canonical
 * form, which no document named by its hash can be. `unreadable` for a text that hashes to its
 * name and is in canonical form, but that this build cannot read or take (2026-11-24, review item
 * 28): a format a newer build added, as labels@1 was. That is the document the name says, so it is
 * no forgery, only not for this build.
 */
export async function admitDoc(hash: string, text: string, sha256: Sha256, hashText?: (text: string) => Promise<string>): Promise<LibraryDoc | 'unreadable' | null> {
  if (!isHash(hash)) return null;
  const got = hashText ? (await hashText(text)).toLowerCase() : bytesToHex(await sha256(utf8Encode(text)));
  if (got !== hash) return null;
  let doc: unknown;
  try { doc = JSON.parse(text); } catch { return null; }
  let canonical: string;
  try { canonical = canonicalJson(doc); } catch { return null; }
  if (canonical !== text) return null;
  if (validateDoc(doc) !== null) return 'unreadable';
  return mayGoInStartingCopy(doc as LibraryDoc) ? (doc as LibraryDoc) : 'unreadable';
}
