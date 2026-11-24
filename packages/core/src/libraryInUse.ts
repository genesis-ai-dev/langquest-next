import { libraryItems, libraryItemView, type LibraryItemView } from './library';
import { docHeadOf, isHash, mediaFileOf, type DocHead, type LibraryDoc, type LibraryFile } from './libraryDocs';
import type { OrgState } from './org';
import { recommendedFor } from './references';
import type { LanguageState } from './state';

/**
 * The library documents a language uses (docs/nearby-sync-plan.md 5.12, "Documents a language
 * uses"; Carl's answers 6 and 19): what a language's own events name and what is chosen for it,
 * not what it could reach. A starting copy carries these and no other, so a phone that holds a
 * chain cannot read another language's template through it. Since 2026-11-24 that is every
 * document of every format the language uses, publishers' included (FIA's guides and key words,
 * sources), since Carl confirmed the terms: a phone that joined offline does what its inviter's
 * does (docs/decisions/2026-11-24-a-starting-copy-carries-every-library-document-a-language-uses.md).
 */

/**
 * The formats a starting copy may carry: each one this build reads, decided one by one. A table
 * over `LibraryDoc`'s formats, so a format added to the union does not compile until someone
 * decides on it here, and any other string is refused at run time: it still fails closed.
 */
const STARTING_COPY_FORMAT_TABLE: Record<LibraryDoc['format'], true> = {
  'template@1': true, 'template@2': true, 'flow@1': true, 'material@1': true, 'versification@1': true, 'names@1': true,
  'study@1': true, 'study@2': true, 'collection@1': true, 'source@1': true, 'sourceBook@1': true, 'timing@1': true, 'labels@1': true
};

export const STARTING_COPY_FORMATS = Object.keys(STARTING_COPY_FORMAT_TABLE) as readonly LibraryDoc['format'][];

/** May a document of this format go in a starting copy? One this build reads (`STARTING_COPY_FORMAT_TABLE`). */
export function formatMayGoInStartingCopy(format: unknown): boolean {
  return typeof format === 'string' && Object.prototype.hasOwnProperty.call(STARTING_COPY_FORMAT_TABLE, format);
}

/** May this document go in a starting copy? Its format is one this build reads (`STARTING_COPY_FORMAT_TABLE`). */
export function mayGoInStartingCopy(doc: LibraryDoc | null | undefined): boolean {
  return typeof doc === 'object' && doc !== null && formatMayGoInStartingCopy(doc.format);
}

/**
 * The formats a library file may take between teammates' phones: audio and pictures. Never a film,
 * which is large and which phones show from its address, and never a name that is not media, so a
 * carried build's file can never be one (Carl, 2026-11-24).
 */
export const LIBRARY_FILE_FORMATS: ReadonlySet<string> = new Set(['m4a', 'mp3', 'ogg', 'aac', 'wav', 'jpg', 'png', 'webp', 'gif']);

/**
 * The files a library document names by hash that a phone reads as the app does, and that may go
 * between teammates' phones (docs/nearby-sync-plan.md 5.12, 2026-11-24): a team's guide's step and
 * word audio and the phone's copy of each picture, map and illustration (`study@2`), and a
 * key-word list's audio that has no address (`material@1`, as `useKeyWordAudio` reads it). Not a
 * film, not a file named only by its address (FIA's, which a later change carries), and not a
 * source's audio, which waits for its own change. Sorted by hash, with no repeats.
 */
export function libraryFilesOf(doc: LibraryDoc): LibraryFile[] {
  const out = new Map<string, LibraryFile>();
  const add = (f: LibraryFile | undefined) => {
    if (f && isHash(f.hash) && LIBRARY_FILE_FORMATS.has(f.format)) out.set(f.hash, f);
  };
  switch (doc.format) {
    case 'study@2':
      for (const s of doc.steps ?? []) add(mediaFileOf(s.audio, 'audio', true));
      for (const r of doc.resources ?? []) for (const m of r.media ?? []) if (m.kind !== 'video') add(mediaFileOf(m.file, 'image', true));
      for (const t of doc.terms ?? []) add(mediaFileOf(t.audio, 'audio', true));
      break;
    case 'material@1':
      for (const w of doc.terms ?? []) if (!w.audio?.url) add(mediaFileOf(w.audio, 'audio', false));
      break;
    default:
      break;
  }
  return [...out.values()].sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0));
}

/**
 * A document's head with the files it names (`libraryFilesOf`), as a phone's walk reads it: the
 * web, which passes nothing between phones, never carries this.
 */
export function nearbyDocHeadOf(doc: LibraryDoc): DocHead {
  let files: LibraryFile[];
  try {
    files = libraryFilesOf(doc);
  } catch {
    files = [];
  }
  return { ...docHeadOf(doc), files };
}

type OrgLibrary = Pick<OrgState, 'library' | 'recommendations'>;

const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/** The view of an item a language chose: the organization's own, a copy of a publisher's, or one it follows (2026-11-24). */
function chosen(org: OrgLibrary, itemId: string): LibraryItemView | null {
  if (!own(org.library, itemId)) return null;
  return libraryItemView(org.library, itemId);
}

/**
 * What a language's own state names, sorted, with no repeats, and only hashes: its template and
 * every template it has used, its flow, its book names; each item recommended to it and not
 * hidden, or linked to a passage, at its current version unless archived; and each item helping
 * on a check, at its current version, archived or not, as the screens that read them do.
 */
export function docsThisLanguageNames(org: OrgLibrary, state: LanguageState): string[] {
  const out = new Set<string>();
  const add = (h: unknown) => { if (isHash(h)) out.add(h); };
  add(state.template?.value.docHash);
  for (const h of Object.keys(state.templateHistory ?? {})) add(h);
  add(state.flow?.value.docHash);
  add(state.bookNamesFrom?.value.docHash);
  const picked = new Set(recommendedFor(org.recommendations, state).keys());
  for (const links of Object.values(state.passageLinks ?? {})) for (const [itemId, r] of Object.entries(links)) if (r.value === true) picked.add(itemId);
  for (const itemId of picked) {
    const view = chosen(org, itemId);
    if (view && !view.archived) add(view.current);
  }
  for (const helps of Object.values(state.checkHelps ?? {})) {
    for (const [key, r] of Object.entries(helps)) {
      if (r.value !== true || !key.startsWith('item:')) continue;
      add(chosen(org, key.slice(5))?.current);
    }
  }
  return [...out].sort();
}

/** The formats a study guide comes in: what the app shows from the rest of the organization's library. */
export const GUIDE_FORMATS: readonly LibraryDoc['format'][] = ['study@1', 'study@2', 'collection@1'];

/**
 * What the app offers a passage's study guide from beyond what the language chose
 * (apps/mobile/src/reference/offered.ts `guideOffer`): the current version of every material in
 * the organization's library, its own, copied or followed, not archived and not hidden by the
 * language. Only its guides count (`GUIDE_FORMATS`), since the app shows nothing else of these
 * (Carl, 2026-11-24: a phone that joined offline shows what its inviter's does). Sorted hashes,
 * less what `docsThisLanguageNames` already names.
 */
export function guidesThisLanguageOffers(org: OrgLibrary, state: LanguageState): string[] {
  const named = new Set(docsThisLanguageNames(org, state));
  const hidden = (itemId: string) => state.languageReferences?.[itemId]?.value === 'hidden';
  const out = new Set<string>();
  for (const view of libraryItems(org.library, 'material')) {
    if (view.archived || !isHash(view.current) || hidden(view.itemId) || named.has(view.current!)) continue;
    out.add(view.current!);
  }
  return [...out].sort();
}

const GUIDES: ReadonlySet<string> = new Set(GUIDE_FORMATS);

/**
 * The documents a starting copy for this language may carry: walked from
 * `docsThisLanguageNames`, then from `guidesThisLanguageOffers`, of which only guides are kept and
 * walked (a document of another format leaves the list, and is not walked). A hash `get` cannot
 * answer stays on the list, with nothing to walk, so a newcomer knows to ask for it. A document
 * `mayGoInStartingCopy` refuses, or one this build cannot read through, leaves the list and is not
 * walked. Any other stays, and what it refers to (a template's or a material's numbering, a
 * collection's guides) goes by the same rule. What the language names and what that refers to
 * come first, sorted, then the offered guides and theirs, sorted: a phone that can take only some
 * this time takes what the language chose first. The sender and the newcomer work out the same
 * list.
 */
export function docsThisLanguageUses(org: OrgLibrary, state: LanguageState, get: (hash: string) => DocHead | null | undefined): string[] {
  const seen = new Set<string>();
  const walk = (roots: readonly string[], keep: (head: DocHead) => boolean): string[] => {
    const out = new Set<string>();
    const root = new Set(roots);
    const queue = [...roots];
    while (queue.length > 0) {
      const hash = queue.pop()!;
      if (seen.has(hash)) continue;
      seen.add(hash);
      const head = get(hash);
      if (head === null || head === undefined) {
        out.add(hash);
        continue;
      }
      // A document this build cannot read through is left out, as a format it does not know is.
      if (!formatMayGoInStartingCopy(head.format) || head.refs === null || (root.has(hash) && !keep(head))) continue;
      out.add(hash);
      for (const r of head.refs) if (isHash(r) && !seen.has(r)) queue.push(r);
    }
    return [...out].sort();
  };
  // What the language chose, and what that refers to, first: a document it names counts whatever else offers it.
  const named = walk(docsThisLanguageNames(org, state), () => true);
  // Then the guides the app offers from the rest of the library: a guide counts, nothing else does, and what a guide refers to as ever.
  return [...named, ...walk(guidesThisLanguageOffers(org, state), (head) => GUIDES.has(head.format))];
}
