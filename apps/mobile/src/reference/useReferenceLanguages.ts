// Other languages' reference material (reference/ReferenceLanguagePage.tsx).
import { subscriptionItemId, type LibraryDoc } from '@langquest-next/core';
import { useMemo } from 'react';
import type { Ctx } from '../shell/ctx';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { guideSets, originOf, setKeyOf } from './guideSets';
import { languageChoices } from './languageChoices';

/**
 * What the organization has and others share, as guide sets and the
 * languages to choose from; `keep` are listed even when nothing is in them.
 */
export function useReferenceLanguages(ctx: Ctx, keep: readonly string[]) {
  const lib = useLibrary(ctx);
  const shared = useSharedItems('material', lib.orgId);
  const own = lib.items('material').filter((it) => it.current && !it.archived);
  const others = shared.rows.filter((s) => s.latest_hash && !ctx.org.state?.library[subscriptionItemId(s.org_id, s.item_id)]);
  const docs = useLibraryDocs(lib.orgId, [...own.map((it) => it.current), ...others.map((s) => s.latest_hash)], { deps: false });
  const keepKey = keep.join(',');
  const sets = guideSets(own.map((it) => ({ it, doc: docs.get(it.current) })), others.map((s) => ({ s, doc: docs.get(s.latest_hash) })));
  const setKeys = new Set(sets.map((s) => s.key));
  const rest: (LibraryDoc | null)[] = [
    ...own.map((it) => docs.get(it.current)).filter((d, i) => !setKeys.has(setKeyOf(originOf(own[i]!), d) ?? '')),
    ...others.map((s) => docs.get(s.latest_hash)).filter((d, i) => !setKeys.has(setKeyOf(others[i]!.org_id, d) ?? ''))
  ];
  const signature = [sets.map((s) => `${s.key}:${s.members.length}`).join(), rest.length, keepKey].join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the signature says when they change
  const choices = useMemo(() => languageChoices(sets, rest, keep), [signature]);
  return { sets, choices, loading: !shared.loaded };
}
