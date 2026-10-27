import { subscriptionItemId } from '@langquest-next/core';
import type { Ctx } from '../shell/ctx';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import type { GuideSet } from '../reference/guideSets';
import { newLanguageOffers } from './newLanguageOffersModel';

/**
 * What a new language's team can be given from the start, in the languages
 * chosen for its reference material (decisions 84, 130, 146). The rules are
 * in newLanguageOffersModel.ts.
 */
export function useNewLanguageOffers(ctx: Ctx, readsAll: readonly string[], sets: readonly GuideSet[]) {
  const lib = useLibrary(ctx);
  const shared = useSharedItems('material', lib.orgId);
  const own = lib.items('material').filter((it) => it.current && !it.archived);
  const others = shared.rows.filter((s) => s.latest_hash && !ctx.org.state?.library[subscriptionItemId(s.org_id, s.item_id)]);
  const docs = useLibraryDocs(lib.orgId, [...own.map((it) => it.current), ...others.map((s) => s.latest_hash)], { deps: false });
  const may = ctx.session.can('manage_reference');
  const offers = newLanguageOffers({ own, others, doc: (hash) => docs.get(hash), sets, readsAll });
  return { items: may ? offers.items : [], suggested: offers.suggested, may, loading: !shared.loaded };
}
