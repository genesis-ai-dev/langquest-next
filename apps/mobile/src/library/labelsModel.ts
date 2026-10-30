// What other organizations' library items are called in the language the app
// shows (decision 194). LangQuest publishes its templates, numberings, flows
// and book names with English names, and one `labels` item per language
// ("Library names (Hindi)") says what each is called there. A shared item,
// or one this organization follows, shows that name; an item this
// organization made or copied keeps the name it was given here. Events and
// edits always carry the published name. Pure, so it is tested.
import type { LabelsDoc, LibraryDoc, LibraryItemView } from '@langquest-next/core';
import { sameLanguage } from '../reference/languageCodesModel';
import type { SharedItem } from './model';

export interface Label {
  name: string;
  description?: string;
}

/** By `${orgId}/${itemId}`: what that organization's item is called in one language. */
export type Labels = ReadonlyMap<string, Label>;

export const NO_LABELS: Labels = new Map();

const keyOf = (orgId: string, itemId: string) => `${orgId}/${itemId}`;
const isLabels = (doc: LibraryDoc | null | undefined): doc is LabelsDoc => doc?.format === 'labels@1';

/**
 * The names in `language` from the sets organizations share. A set names
 * only its own organization's items, so no one renames another's; two sets
 * of one organization in the same language, the first listed wins.
 */
export function labelsIn(sets: readonly { orgId: string; doc: LibraryDoc | null | undefined }[], language: string): Map<string, Label> {
  const out = new Map<string, Label>();
  for (const { orgId, doc } of sets) {
    if (!isLabels(doc) || !sameLanguage(doc.language, language)) continue;
    for (const it of doc.items) {
      const key = keyOf(orgId, it.itemId);
      if (!out.has(key)) out.set(key, it.description ? { name: it.name, description: it.description } : { name: it.name });
    }
  }
  return out;
}

/** Another organization's item, as it is shared. */
export function sharedLabel(labels: Labels, s: Pick<SharedItem, 'org_id' | 'item_id'>): Label | null {
  return labels.get(keyOf(s.org_id, s.item_id)) ?? null;
}

/** An item of this organization's library: one it follows reads as its source does; its own and its copies keep their names. */
export function itemLabel(labels: Labels, it: Pick<LibraryItemView, 'subscription'> | null | undefined): Label | null {
  const sub = it?.subscription;
  return sub ? labels.get(keyOf(sub.sourceOrgId, sub.sourceItemId)) ?? null : null;
}

/** The name of a shared item as the reader sees it. */
export const sharedName = (labels: Labels, s: SharedItem) => sharedLabel(labels, s)?.name ?? s.name;

/** The name of an item of this organization's library as the reader sees it. */
export const itemName = (labels: Labels, it: LibraryItemView) => itemLabel(labels, it)?.name ?? it.name;
