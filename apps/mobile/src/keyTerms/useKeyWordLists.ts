// The key-word lists the open language's team uses (decision 149): of FIA's
// lists, the language its team chose (`listsReaching`, as FIA's guides);
// any other list in the organization's library that the language has not
// hidden, as any guide or note reaches a team (reference/offered.ts).
// Each list is one document, kept whole on the phone, so its words show and
// search offline once it has come.
import type { VersificationDoc } from '@langquest-next/core';
import { useCallback, useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { useLibrary, useLibraryDocs } from '../library/useLibrary';
import { listsReaching, type KeyWordList } from './listsModel';

export function useKeyWordLists(ctx: Ctx): {
  lists: KeyWordList[];
  /** A list's numbering, for placing its words on a passage. */
  versificationOf: (hash: string) => VersificationDoc | null;
  /** Some of the organization's material has not come yet, so a list may still be on its way. */
  loading: boolean;
} {
  const lib = useLibrary(ctx);
  const state = ctx.language.state;
  const items = lib.items('material').filter((it) => it.current && !it.archived);
  const docs = useLibraryDocs(lib.orgId, items.map((it) => it.current), { deps: false });
  const recommendations = ctx.org.state?.recommendations;
  const lists = useMemo(() => listsReaching({ items: items.map((it) => ({ it, doc: docs.get(it.current) })), recommendations, state }),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- docs.get changes as documents arrive; items follows the org and the language
  [docs.get, items.map((it) => `${it.itemId}:${it.current}`).join(','), state, recommendations]);
  const v11n = useLibraryDocs(lib.orgId, [...new Set(lists.map((l) => l.versification))]);
  const loading = !docs.error && items.some((it) => !docs.get(it.current));
  // A new function only when a numbering arrives, so what is worked out from it is kept until then.
  const getV11n = v11n.get;
  const versificationOf = useCallback((hash: string) => getV11n<VersificationDoc>(hash), [getV11n]);
  return { lists, versificationOf, loading };
}
