// The key-word lists the open language's team uses (decision 149): the
// organization's lists (FIA's key words, or its own) that the language has
// not hidden, as any guide or note in the library reaches a team
// (reference/offered.ts). Choosing a set's language hides its others
// (`chooseSetLanguage`), so a team that chose French FIA sees French words.
// Each list is one document, kept whole on the phone, so its words show and
// search offline once it has come.
import type { VersificationDoc } from '@langquest-next/core';
import { useCallback, useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { useLibrary, useLibraryDocs } from '../library/useLibrary';
import { keyWordList, type KeyWordList } from './listsModel';

export function useKeyWordLists(ctx: Ctx): {
  lists: KeyWordList[];
  /** A list's numbering, for placing its words on a passage. */
  versificationOf: (hash: string) => VersificationDoc | null;
  /** Some of the organization's material has not come yet, so a list may still be on its way. */
  loading: boolean;
} {
  const lib = useLibrary(ctx);
  const state = ctx.language.state;
  const items = lib.items('material').filter((it) => it.current && !it.archived && state?.languageReferences[it.itemId]?.value !== 'hidden');
  const docs = useLibraryDocs(lib.orgId, items.map((it) => it.current), { deps: false });
  const lists = useMemo(() => items
    .map((it) => keyWordList(it.itemId, it.name, docs.get(it.current)))
    .filter((x): x is KeyWordList => x !== null),
  // eslint-disable-next-line react-hooks/exhaustive-deps -- docs.get changes as documents arrive; items follows the org and the language
  [docs.get, items.map((it) => `${it.itemId}:${it.current}`).join(','), state]);
  const v11n = useLibraryDocs(lib.orgId, [...new Set(lists.map((l) => l.versification))]);
  const loading = !docs.error && items.some((it) => !docs.get(it.current));
  // A new function only when a numbering arrives, so what is worked out from it is kept until then.
  const getV11n = v11n.get;
  const versificationOf = useCallback((hash: string) => getV11n<VersificationDoc>(hash), [getV11n]);
  return { lists, versificationOf, loading };
}
