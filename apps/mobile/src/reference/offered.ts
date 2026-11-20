// Which library items a passage's study guide may come from
// (docs/reference-material.md): what the organization or the language
// recommends, and what an admin linked to the passage, first; then the rest
// of the organization's own library. Never what other organizations merely
// share. A language's hide and a passage's hide take an item out. Pure.
import {
  libraryItems, linkedTo, passageLink, recommendedFor,
  type LibraryItemState, type LanguageState, type Register
} from '@langquest-next/core';
import { originOf } from './guideSets';

interface OfferedSource {
  /**
   * Names the guide in guide ids (notes and finished steps hang on them):
   * the item id, or for a followed item its owner's `<org>.<item>`, the key
   * it had when every shared item was offered, so progress keeps its place.
   */
  key: string;
  /** Its current version. */
  hash: string;
  /** The organization it follows or was copied from ('' when made here), which tells a guide set's members apart (guideSets.ts). */
  origin: string;
}

export interface Offered { recommended: OfferedSource[]; own: OfferedSource[] }

export function offeredGuideSources(
  library: Record<string, LibraryItemState>,
  orgRecs: Record<string, Register<boolean>> | undefined,
  state: LanguageState | null,
  unitId: string | null | undefined
): Offered {
  return guideOffer(library, orgRecs, state)(unitId);
}

/**
 * `offeredGuideSources` for many passages of one language: the library is
 * read once, not once for each passage (the offline prefetch asks for every
 * passage a person keeps, study/StudyPrefetch.tsx). Passages nobody linked
 * or hid anything on are offered the same, so they get the same answer, the
 * very same object: a caller that works something out from it can keep that
 * by the object. Read-only.
 */
export function guideOffer(
  library: Record<string, LibraryItemState>,
  orgRecs: Record<string, Register<boolean>> | undefined,
  state: LanguageState | null
): (unitId: string | null | undefined) => Offered {
  const items = libraryItems(library, 'material').filter((i) => i.current && !i.archived);
  const byId = new Map(items.map((i) => [i.itemId, i]));
  const recommended = [...recommendedFor(orgRecs, state).keys()].sort();
  const languageSay = state?.languageReferences ?? {};
  const src = (id: string) => {
    const it = byId.get(id)!;
    const sub = it.subscription;
    return { key: sub ? `${sub.sourceOrgId}.${sub.sourceItemId}` : id, hash: it.current!, origin: originOf(it) };
  };
  const offer = (unitId: string | null | undefined): Offered => {
    const hiddenHere = (id: string) => !!(state && unitId && passageLink(state, unitId, id) === false);
    const linked = state && unitId ? linkedTo(state, unitId) : [];
    const first = [...new Set([...linked, ...recommended])].filter((id) => byId.has(id) && !hiddenHere(id));
    const taken = new Set(first);
    const own = items.filter((i) => !taken.has(i.itemId) && languageSay[i.itemId]?.value !== 'hidden' && !hiddenHere(i.itemId));
    return { recommended: first.map(src), own: own.map((i) => src(i.itemId)) };
  };
  let plain: Offered | null = null;
  return (unitId) => {
    // An admin linked or hid something on this passage: its own answer.
    if (state && unitId && Object.keys(state.passageLinks[unitId] ?? {}).length > 0) return offer(unitId);
    return (plain ??= offer(null));
  };
}
