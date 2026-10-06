import type { EventEnvelope } from './events';
import type { Hlc } from './hlc';
import type { LibraryKind } from './libraryDocs';
import type { Register } from './state';

/**
 * An organization's library (docs/decisions.md 36): its content templates,
 * review flows, reference material and versifications, each an item with
 * published versions. It lives in the organization stream, which every device
 * pulls whole; the documents themselves are fetched by hash.
 *
 * An item is the organization's own (made here, or copied from another
 * organization and now controlled here) or a subscription to another
 * organization's item (not controlled here; it follows the owner's
 * versions, automatically or when someone here takes an update). An owner
 * decides per item whether other organizations may see and copy it, and
 * separately whether they may subscribe to it.
 *
 * Merge shapes are the usual ones: kind, first definition and each version
 * are grow-only with the earliest winning; names, sharing, archiving,
 * subscription settings and the pinned version are registers.
 */

export interface LibraryEvents {
  /** A new item. A copy says what it was copied from, and publishes that version as its own first one. */
  'v1.LibraryItemDefined': {
    itemId: string;
    kind: LibraryKind;
    name: string;
    description: string;
    copiedFrom?: { orgId: string; orgName: string; itemId: string; docHash: string };
  };
  /** A new version of an item this organization controls: the document it now is. */
  'v1.LibraryVersionPublished': { itemId: string; kind: LibraryKind; docHash: string; note?: string };
  /** Whether other organizations see it (and may copy it), and whether they may subscribe. */
  'v1.LibrarySharingSet': { itemId: string; kind: LibraryKind; shared: boolean; subscribable: boolean };
  /** Out of the lists; nothing that uses it changes. */
  'v1.LibraryItemArchived': { itemId: string; kind: LibraryKind; archived: boolean };
  /** Follow another organization's item. `active: false` stops following; the pinned version stays in use. */
  'v1.LibrarySubscribed': {
    itemId: string;
    kind: LibraryKind;
    sourceOrgId: string;
    /** The source organization's name when subscribing, so lists can say whom this follows offline. */
    sourceOrgName: string;
    sourceItemId: string;
    name: string;
    autoUpdate: boolean;
    active: boolean;
  };
  /** Which of the source's versions a subscription uses. The server writes it for automatic updates. */
  'v1.LibraryPinned': { itemId: string; kind: LibraryKind; docHash: string };
}

/** Language-stream events that tie a language to library versions. */
export interface LibraryWorkEvents {
  /**
   * A language uses a version of a library template. `unitPrefix` is what
   * its units' ids start with (`${unitPrefix}/${node}`), stable across the
   * item's versions; the selector also emits the units and hides the ones
   * the version no longer has. `books` (USFM codes) narrows a Bible template
   * to the books this language covers (a New Testament team on a whole-Bible
   * template); absent means all of them.
   */
  'v1.TemplateSelected': { itemId: string; docHash: string; unitPrefix: string; books?: string[] };
  /** A part of a language's template that its current version no longer has; hidden, never deleted (TPL-7). */
  'v1.UnitHidden': { unitId: string; hidden: boolean };
  /**
   * The flow a language uses. `flowId` is its steps' prefix: a library
   * flow's version (`libraryFlowId`, with the item, version and name), or
   * `custom` for steps edited by hand.
   */
  'v1.FlowSelected': { flowId: string; itemId?: string; docHash?: string; name?: string };
}

export interface LibraryVersion {
  docHash: string;
  hlc: Hlc;
  eventId: string;
  actorId: string;
  note?: string;
}

export interface LibraryItemState {
  kind: Register<LibraryKind>;
  name: Register<string>;
  description: Register<string>;
  /** Set once, by the earliest definition that carries it. */
  copiedFrom: Register<{ orgId: string; orgName: string; itemId: string; docHash: string } | null>;
  versions: Record<string, LibraryVersion>;
  sharing: Register<{ shared: boolean; subscribable: boolean }>;
  archived: Register<boolean>;
  subscription: Register<{ sourceOrgId: string; sourceOrgName: string; sourceItemId: string; name: string; autoUpdate: boolean; active: boolean } | null>;
  pinned: Register<string | null>;
}

const blank: Register<never> = { value: undefined as never, hlc: '', eventId: '' };

function newItem(): LibraryItemState {
  return {
    kind: blank,
    name: blank,
    description: blank,
    copiedFrom: { value: null, hlc: '', eventId: '' },
    versions: {},
    sharing: { value: { shared: false, subscribable: false }, hlc: '', eventId: '' },
    archived: { value: false, hlc: '', eventId: '' },
    subscription: { value: null, hlc: '', eventId: '' },
    pinned: { value: null, hlc: '', eventId: '' }
  };
}

const later = (current: Register<unknown>, e: EventEnvelope) =>
  current.hlc === '' || current.hlc < e.hlc || (current.hlc === e.hlc && current.eventId < e.id);
const earlier = (current: Register<unknown>, e: EventEnvelope) =>
  current.hlc === '' || e.hlc < current.hlc || (e.hlc === current.hlc && e.id < current.eventId);
const reg = <V>(value: V, e: EventEnvelope): Register<V> => ({ value, hlc: e.hlc, eventId: e.id });

export type LibraryEventType = keyof LibraryEvents;
export const LIBRARY_EVENT_TYPES: readonly LibraryEventType[] = [
  'v1.LibraryItemDefined', 'v1.LibraryVersionPublished', 'v1.LibrarySharingSet', 'v1.LibraryItemArchived',
  'v1.LibrarySubscribed', 'v1.LibraryPinned'
];

/** Fold one library event into the org's library. Order-independent and idempotent (the caller guards ids). */
export function applyLibraryEvent(library: Record<string, LibraryItemState>, e: EventEnvelope): void {
  const p = e.payload as LibraryEvents[LibraryEventType];
  const item = (library[p.itemId] ??= newItem());
  if (earlier(item.kind, e)) item.kind = reg(p.kind, e);
  switch (e.type as LibraryEventType) {
    case 'v1.LibraryItemDefined': {
      const d = p as LibraryEvents['v1.LibraryItemDefined'];
      if (later(item.name, e)) item.name = reg(d.name, e);
      if (later(item.description, e)) item.description = reg(d.description, e);
      if (d.copiedFrom && earlier(item.copiedFrom, e)) item.copiedFrom = reg({ ...d.copiedFrom }, e);
      break;
    }
    case 'v1.LibraryVersionPublished': {
      const d = p as LibraryEvents['v1.LibraryVersionPublished'];
      const prior = item.versions[d.docHash];
      if (!prior || e.hlc < prior.hlc || (e.hlc === prior.hlc && e.id < prior.eventId)) {
        item.versions[d.docHash] = { docHash: d.docHash, hlc: e.hlc, eventId: e.id, actorId: e.actorId, ...(d.note ? { note: d.note } : {}) };
      }
      break;
    }
    case 'v1.LibrarySharingSet': {
      const d = p as LibraryEvents['v1.LibrarySharingSet'];
      if (later(item.sharing, e)) item.sharing = reg({ shared: d.shared, subscribable: d.shared && d.subscribable }, e);
      break;
    }
    case 'v1.LibraryItemArchived':
      if (later(item.archived, e)) item.archived = reg((p as LibraryEvents['v1.LibraryItemArchived']).archived, e);
      break;
    case 'v1.LibrarySubscribed': {
      const d = p as LibraryEvents['v1.LibrarySubscribed'];
      if (later(item.subscription, e)) {
        item.subscription = reg({ sourceOrgId: d.sourceOrgId, sourceOrgName: d.sourceOrgName, sourceItemId: d.sourceItemId, name: d.name, autoUpdate: d.autoUpdate, active: d.active }, e);
      }
      break;
    }
    case 'v1.LibraryPinned':
      if (later(item.pinned, e)) item.pinned = reg((p as LibraryEvents['v1.LibraryPinned']).docHash, e);
      break;
  }
}

// ---- derivations ----------------------------------------------------------------

export interface LibraryItemView {
  itemId: string;
  kind: LibraryKind;
  name: string;
  description: string;
  /** own: made here · copy: copied and controlled here · subscription: follows another organization. */
  source: 'own' | 'copy' | 'subscription';
  copiedFrom: { orgId: string; orgName: string; itemId: string; docHash: string } | null;
  subscription: { sourceOrgId: string; sourceOrgName: string; sourceItemId: string; autoUpdate: boolean; active: boolean } | null;
  shared: boolean;
  subscribable: boolean;
  archived: boolean;
  /** Oldest first; `n` is the version number people see. */
  versions: (LibraryVersion & { n: number })[];
  /** The version in use: the latest published here, or the subscription's pinned one. Null before any. */
  current: string | null;
}

export function libraryItemView(library: Record<string, LibraryItemState>, itemId: string): LibraryItemView | null {
  const it = library[itemId];
  if (!it || it.kind.hlc === '') return null;
  const versions = Object.values(it.versions)
    .sort((a, b) => (a.hlc !== b.hlc ? (a.hlc < b.hlc ? -1 : 1) : a.eventId < b.eventId ? -1 : 1))
    .map((v, i) => ({ ...v, n: i + 1 }));
  const sub = it.subscription.value;
  const source = sub ? 'subscription' : it.copiedFrom.value ? 'copy' : 'own';
  return {
    itemId,
    kind: it.kind.value,
    name: sub && it.name.hlc === '' ? sub.name : it.name.value ?? itemId,
    description: it.description.value ?? '',
    source,
    copiedFrom: it.copiedFrom.value,
    subscription: sub ? { sourceOrgId: sub.sourceOrgId, sourceOrgName: sub.sourceOrgName, sourceItemId: sub.sourceItemId, autoUpdate: sub.autoUpdate, active: sub.active } : null,
    shared: source !== 'subscription' && it.sharing.value.shared,
    subscribable: source !== 'subscription' && it.sharing.value.subscribable,
    archived: it.archived.value,
    versions,
    current: sub ? it.pinned.value : versions[versions.length - 1]?.docHash ?? null
  };
}

/** Every item of a kind, archived ones last, then by name. */
export function libraryItems(library: Record<string, LibraryItemState>, kind?: LibraryKind): LibraryItemView[] {
  return Object.keys(library)
    .map((id) => libraryItemView(library, id))
    .filter((v): v is LibraryItemView => v !== null && (kind === undefined || v.kind === kind))
    .sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name) || (a.itemId < b.itemId ? -1 : 1));
}

/** The local item that follows another organization's item, deterministic so two devices subscribing agree. */
export function subscriptionItemId(sourceOrgId: string, sourceItemId: string): string {
  return `sub.${sourceOrgId}.${sourceItemId}`.replace(/[/@\s]/g, '-');
}

/** Item ids: letters, digits, '.', '_' and '-'; never '/' or '@', because unit and step ids are built from them. */
export const isItemId = (s: string) => /^[a-z0-9][a-z0-9._-]{0,120}$/i.test(s);
