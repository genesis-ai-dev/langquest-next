import { libraryItemView, type LibraryItemView } from './library';
import { isHash, referencedDocs, type LibraryDoc } from './libraryDocs';
import type { OrgState } from './org';
import { recommendedFor } from './references';
import type { LanguageState } from './state';

/**
 * The library documents a language uses (docs/nearby-sync-plan.md 5.12, "Documents a language
 * uses"; Carl's answers 6 and 19): what a language's own events name and what is chosen for it,
 * not what it could reach. A starting copy carries these and no other, so a phone that holds a
 * chain cannot read another language's template or a publisher's document through it.
 */

/**
 * The formats a starting copy may carry. An allowlist, so it fails closed: a format added later
 * stays out until someone adds it here. Publishers' imports (`study@1`, `collection@1`), sources
 * (`source@1`, `sourceBook@1`, `timing@1`) and `study@2` wait for Carl's terms check (answer 19);
 * `labels@1` is named by no language.
 */
export const STARTING_COPY_FORMATS = ['template@1', 'template@2', 'flow@1', 'material@1', 'versification@1', 'names@1'] as const;

const FORMATS: ReadonlySet<string> = new Set(STARTING_COPY_FORMATS);

/**
 * May this document go in a starting copy? Its format is on the list, and a `material@1` says
 * neither `source` nor `pattern`, because FIA's key words are a `material@1` and a copy of a
 * publisher's material keeps those fields (`scripts/fia-terms.ts`, `libraryMaterialDoc`).
 */
export function mayGoInStartingCopy(doc: LibraryDoc | null | undefined): boolean {
  if (typeof doc !== 'object' || doc === null || typeof doc.format !== 'string' || !FORMATS.has(doc.format)) return false;
  if (doc.format === 'material@1') {
    const m = doc as unknown as Record<string, unknown>;
    return m['source'] === undefined && m['pattern'] === undefined;
  }
  return true;
}

type OrgLibrary = Pick<OrgState, 'library' | 'recommendations'>;

const own = (o: object, key: string) => Object.prototype.hasOwnProperty.call(o, key);

/** The view of an item a language chose, when it may count: a material only when it is this organization's own, never followed or copied. */
function chosen(org: OrgLibrary, itemId: string): LibraryItemView | null {
  if (!own(org.library, itemId)) return null;
  const view = libraryItemView(org.library, itemId);
  if (!view || (view.kind === 'material' && view.source !== 'own')) return null;
  return view;
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

/**
 * The documents a starting copy for this language may carry: walked from
 * `docsThisLanguageNames`. A hash `get` cannot answer stays on the list, with nothing to walk, so
 * a newcomer knows to ask for it. A document `mayGoInStartingCopy` refuses leaves the list and is
 * not walked. Any other stays, and what it refers to (a template's or a material's numbering)
 * goes by the same rule. Sorted. The sender and the newcomer work out the same list.
 */
export function docsThisLanguageUses(org: OrgLibrary, state: LanguageState, get: (hash: string) => LibraryDoc | null): string[] {
  const out = new Set<string>();
  const seen = new Set<string>();
  const queue = docsThisLanguageNames(org, state);
  while (queue.length > 0) {
    const hash = queue.pop()!;
    if (seen.has(hash)) continue;
    seen.add(hash);
    const doc = get(hash);
    if (doc === null || doc === undefined) {
      out.add(hash);
      continue;
    }
    if (!mayGoInStartingCopy(doc)) continue;
    let refs: string[];
    try {
      refs = referencedDocs(doc);
    } catch {
      // A document this build cannot read through is left out, as a format it does not know is.
      continue;
    }
    out.add(hash);
    for (const r of refs) if (isHash(r) && !seen.has(r)) queue.push(r);
  }
  return [...out].sort();
}
