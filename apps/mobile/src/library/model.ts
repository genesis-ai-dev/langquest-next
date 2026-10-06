// Pure plans behind the library screens (docs/library.md): which org events
// an action writes and which languages need to move to a newer version. Kept
// free of React Native so it can be tested.
import {
  libraryItemView, subscriptionItemId, type EventPayloads, type LibraryItemState, type LibraryKind, type LanguageState
} from '@langquest-next/core';

/** One organization-stream write, in the order to apply it. */
export type LibraryOp = { [T in keyof EventPayloads]: { type: T; payload: EventPayloads[T] } }[
  'v1.LibraryItemDefined' | 'v1.LibraryVersionPublished' | 'v1.LibrarySharingSet' | 'v1.LibraryItemArchived' | 'v1.LibrarySubscribed' | 'v1.LibraryPinned'
];

/** An item another organization shares, as `library_shared_items` lists it. */
export interface SharedItem {
  org_id: string;
  org_name: string;
  item_id: string;
  kind: LibraryKind;
  name: string;
  description: string;
  subscribable: boolean;
  version_count: number;
  latest_hash: string;
  updated_hlc: string;
}

/** A fresh item id: readable, and never a '/' or '@' (unit and step ids are built from it). */
export function newItemId(name: string, random: string): string {
  const slug = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'item';
  return `${slug}.${random.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase()}`;
}

/**
 * Publish a document as a version of an item this organization controls:
 * the item's definition when it is new or renamed, then the version (unless
 * that exact document already is one).
 */
export function publishOps(
  library: Record<string, LibraryItemState>,
  c: { itemId: string; kind: LibraryKind; name: string; description: string; docHash: string; note?: string }
): LibraryOp[] {
  const it = libraryItemView(library, c.itemId);
  if (it?.source === 'subscription') throw new Error('This follows another organization; copy it to change it.');
  const ops: LibraryOp[] = [];
  if (!it || it.name !== c.name || it.description !== c.description) {
    ops.push({ type: 'v1.LibraryItemDefined', payload: { itemId: c.itemId, kind: c.kind, name: c.name, description: c.description } });
  }
  if (!it?.versions.some((v) => v.docHash === c.docHash)) {
    ops.push({ type: 'v1.LibraryVersionPublished', payload: { itemId: c.itemId, kind: c.kind, docHash: c.docHash, ...(c.note ? { note: c.note } : {}) } });
  }
  return ops;
}

/** Make another organization's item this organization's own, starting from one of its versions. */
export function copyOps(shared: SharedItem, itemId: string, docHash = shared.latest_hash): LibraryOp[] {
  return [
    {
      type: 'v1.LibraryItemDefined',
      payload: { itemId, kind: shared.kind, name: shared.name, description: shared.description, copiedFrom: { orgId: shared.org_id, orgName: shared.org_name, itemId: shared.item_id, docHash } }
    },
    { type: 'v1.LibraryVersionPublished', payload: { itemId, kind: shared.kind, docHash } }
  ];
}

/** Follow another organization's item, starting at its latest version. */
export function subscribeOps(shared: SharedItem, autoUpdate: boolean): { itemId: string; ops: LibraryOp[] } {
  const itemId = subscriptionItemId(shared.org_id, shared.item_id);
  return {
    itemId,
    ops: [
      {
        type: 'v1.LibrarySubscribed',
        payload: { itemId, kind: shared.kind, sourceOrgId: shared.org_id, sourceOrgName: shared.org_name, sourceItemId: shared.item_id, name: shared.name, autoUpdate, active: true }
      },
      { type: 'v1.LibraryPinned', payload: { itemId, kind: shared.kind, docHash: shared.latest_hash } }
    ]
  };
}

/** Change how a subscription follows, or stop following (its pinned version stays in use). */
export function followOps(library: Record<string, LibraryItemState>, itemId: string, change: { autoUpdate?: boolean; active?: boolean }): LibraryOp[] {
  const sub = library[itemId]?.subscription.value;
  const kind = library[itemId]?.kind.value;
  if (!sub || !kind) return [];
  return [{
    type: 'v1.LibrarySubscribed',
    payload: {
      itemId, kind, sourceOrgId: sub.sourceOrgId, sourceOrgName: sub.sourceOrgName, sourceItemId: sub.sourceItemId, name: sub.name,
      autoUpdate: change.autoUpdate ?? sub.autoUpdate, active: change.active ?? sub.active
    }
  }];
}

/** Something a language uses from the library that has since moved to another version. */
export interface Behind {
  kind: 'template' | 'flow';
  itemId: string;
  /** The version the item is at now. */
  docHash: string;
  books?: string[];
}

/**
 * The language's template or flow when it comes from a library item that is
 * now at another version (edited here, or a subscription took an update).
 * The app applies these for someone who may (docs/library.md, "Languages").
 */
export function behindLibrary(state: LanguageState, library: Record<string, LibraryItemState>): Behind[] {
  const out: Behind[] = [];
  const t = state.template?.value;
  if (t?.itemId && t.docHash) {
    const current = libraryItemView(library, t.itemId)?.current;
    if (current && current !== t.docHash) out.push({ kind: 'template', itemId: t.itemId, docHash: current, ...(t.books ? { books: t.books } : {}) });
  }
  const f = state.flow?.value;
  if (f?.itemId && f.docHash) {
    const current = libraryItemView(library, f.itemId)?.current;
    if (current && current !== f.docHash) out.push({ kind: 'flow', itemId: f.itemId, docHash: current });
  }
  return out;
}

/** Whether the language uses an item as its template or flow, for "used by" lines and the flow editor's warning (FLOW-3). */
export function usesItem(state: LanguageState | null, itemId: string): boolean {
  return !!state && (state.template?.value.itemId === itemId || state.flow?.value.itemId === itemId);
}

/** "Version 3 · copied from LangQuest", "Following LangQuest · updates automatically", for a line under a name. */
export function sourceLine(it: ReturnType<typeof libraryItemView>): string {
  if (!it) return '';
  const n = it.versions.length;
  if (it.source === 'subscription') {
    const from = it.subscription!.sourceOrgName;
    if (!it.subscription!.active) return `Stopped following ${from}`;
    return `Following ${from} · ${it.subscription!.autoUpdate ? 'updates automatically' : 'you take updates'}`;
  }
  const v = n ? `Version ${n}` : 'Not published yet';
  return it.source === 'copy' ? `${v} · copied from ${it.copiedFrom!.orgName}` : v;
}
