// Which library items a passage's study guide may come from
// (docs/reference-material.md): what the organization or the language
// recommends, and what an admin linked to the passage, first; then the rest
// of the organization's own library. Never what other organizations merely
// share. A language's hide and a passage's hide take an item out. Pure.
import {
  libraryItems, linkedTo, passageLink, recommendedFor,
  type LibraryItemState, type LanguageState, type Register
} from '@langquest-next/core';

export interface OfferedSource {
  /**
   * Names the guide in guide ids (notes and finished steps hang on them):
   * the item id, or for a followed item its owner's `<org>.<item>`, the key
   * it had when every shared item was offered, so progress keeps its place.
   */
  key: string;
  /** Its current version. */
  hash: string;
}

export function offeredGuideSources(
  library: Record<string, LibraryItemState>,
  orgRecs: Record<string, Register<boolean>> | undefined,
  state: LanguageState | null,
  unitId: string | null | undefined
): { recommended: OfferedSource[]; own: OfferedSource[] } {
  const items = libraryItems(library, 'material').filter((i) => i.current && !i.archived);
  const byId = new Map(items.map((i) => [i.itemId, i]));
  const rec = recommendedFor(orgRecs, state);
  const languageSay = state?.languageReferences ?? {};
  const hiddenHere = (id: string) => !!(state && unitId && passageLink(state, unitId, id) === false);
  const linked = state && unitId ? linkedTo(state, unitId) : [];
  const first = [...new Set([...linked, ...[...rec.keys()].sort()])].filter((id) => byId.has(id) && !hiddenHere(id));
  const taken = new Set(first);
  const own = items.filter((i) => !taken.has(i.itemId) && languageSay[i.itemId]?.value !== 'hidden' && !hiddenHere(i.itemId));
  const src = (id: string) => {
    const it = byId.get(id)!;
    const sub = it.subscription;
    return { key: sub ? `${sub.sourceOrgId}.${sub.sourceItemId}` : id, hash: it.current! };
  };
  return { recommended: first.map(src), own: own.map((i) => src(i.itemId)) };
}
