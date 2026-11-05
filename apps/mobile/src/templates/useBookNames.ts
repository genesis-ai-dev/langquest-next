// The book names a language can use (decision 193), and using one.
import { followerItemId, selectBookNamesSpec } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useMemo, useState } from 'react';
import type { Ctx } from '../shell/ctx';
import { useLibrary, useLibraryDocs, useSharedItems } from '../library/useLibrary';
import { useLabels } from '../library/useLabels';
import { failureMessage } from '../diagnostics/report';
import { nameSets, type NameSet } from './bookNamesModel';

/** Every set of book names there is: the organization's own and the ones it follows, then what others share. */
export function useBookNameSets(ctx: Ctx) {
  const lib = useLibrary(ctx);
  const shared = useSharedItems('names', lib.orgId);
  const own = lib.items('names').filter((it) => it.current && !it.archived);
  const library = ctx.org.state?.library ?? {};
  // One followed here already is listed as the organization's.
  const others = shared.rows.filter((s) => s.latest_hash && !library[followerItemId(library, s.org_id, s.item_id)]);
  const docs = useLibraryDocs(lib.orgId, [...own.map((it) => it.current), ...others.map((s) => s.latest_hash)], { deps: false });
  const ownKey = own.map((it) => `${it.itemId}@${it.current}`).join();
  const othersKey = others.map((s) => `${s.org_id}/${s.item_id}@${s.latest_hash}`).join();
  const labels = useLabels();
  const sets = useMemo(() => nameSets(own.map((it) => ({ it, doc: docs.get(it.current) })), others.map((s) => ({ s, doc: docs.get(s.latest_hash) })), labels),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the keys say when the items change, docs.get when documents arrive
    [ownKey, othersKey, docs.get, labels]);
  return { lib, sets, loading: !shared.loaded };
}

/**
 * Use a set for the open language: another organization's is followed
 * first (automatic updates), or copied when its owner does not allow
 * following; then one event carries its names into the language.
 */
export function useUseBookNames(ctx: Ctx, lib: ReturnType<typeof useLibrary>, after: () => void) {
  const [busy, setBusy] = useState(false);
  async function use(set: NameSet, message: string) {
    if (busy || !ctx.session.can('manage_templates')) return;
    setBusy(true);
    try {
      const itemId = set.itemId ?? (set.shared!.subscribable ? await lib.subscribe(set.shared!, true) : await lib.copy(set.shared!));
      // ctx.act says "Not saved" and why itself; stay here to try again.
      try {
        await ctx.act([selectBookNamesSpec({ commandId: Crypto.randomUUID(), itemId, docHash: set.docHash, doc: set.doc })], message);
      } catch { return; }
      after();
    } catch (e) {
      ctx.toast(failureMessage('use book names', e), 'problem');
    } finally {
      setBusy(false);
    }
  }
  return { busy, use };
}
