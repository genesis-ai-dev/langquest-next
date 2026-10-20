// What a ready-made flow brings besides its checks (core FlowDoc `helps`
// and `shows`): the library items it links to each check, which the
// organization follows first when it does not have them yet, so the links
// name items it holds; and what each check shows (decisions 91, 130).
import { subscriptionItemId, type FlowDoc, type ShownWhat } from '@langquest-next/core';
import { useCallback } from 'react';
import type { Ctx } from '../shell/ctx';
import { useLibrary, useSharedItems } from '../library/useLibrary';
import type { FlowEntry } from '../admin/useChoices';
import { noteExpected } from '../diagnostics/report';

export interface FlowExtras {
  helps: { kindId: string; itemId: string }[];
  shows: { kindId: string; what: ShownWhat; shown: boolean }[];
}

/**
 * A function that readies a flow's helps for copying into a language: each
 * item as this organization has it (its own, or its follow of the flow's
 * organization's), following any it lacks. A help that cannot be had
 * (offline, or no longer shared) is left out; the checks still come.
 */
export function useFlowHelps(ctx: Ctx) {
  const lib = useLibrary(ctx);
  const shared = useSharedItems('material', lib.orgId);
  const { item, subscribe } = lib;
  return useCallback(async (e: FlowEntry): Promise<FlowExtras> => {
    const doc: FlowDoc = e.doc;
    const shows = (doc.shows ?? []).map((x) => ({ kindId: x.kindId, what: x.what as ShownWhat, shown: x.shown }));
    const from = e.c.source === 'shared' ? e.c.shared.org_id : e.c.item.subscription?.sourceOrgId ?? e.c.item.copiedFrom?.orgId;
    const helps: FlowExtras['helps'] = [];
    for (const h of doc.helps ?? []) {
      if (item(h.itemId)) { helps.push(h); continue; }
      if (!from) continue;
      const followed = subscriptionItemId(from, h.itemId);
      if (item(followed)) { helps.push({ kindId: h.kindId, itemId: followed }); continue; }
      const row = shared.rows.find((s) => s.org_id === from && s.item_id === h.itemId);
      if (!row) continue;
      try {
        helps.push({ kindId: h.kindId, itemId: await subscribe(row, true) });
      } catch (err) {
        noteExpected('flow helps: follow', err);
      }
    }
    return { helps, shows };
  }, [item, subscribe, shared.rows]);
}
