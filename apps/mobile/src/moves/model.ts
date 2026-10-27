// Moving a library item to another organization (decisions.md 174), as the
// library screens show it: where an item's move stands, the offers waiting
// for this organization, and what taking one writes here. Pure.
import { followerItemId, libraryItemView, type LibraryItemState, type LibraryKind } from '@langquest-next/core';
import type { LibraryOp } from '../library/model';

/** Where a move stands, worked out on the server from its times. */
export type MoveState = 'offered' | 'accepted' | 'moved' | 'declined' | 'withdrawn';

export interface LibraryMove {
  id: string;
  state: MoveState;
  kind: LibraryKind;
  fromOrg: string;
  fromOrgName: string;
  fromItem: string;
  name: string;
  toOrg: string;
  toOrgName: string;
  toItem: string | null;
  offeredAt: string;
  acceptedAt: string | null;
  movedAt: string | null;
  followers: number | null;
}

/** What taking an offer answers: the old item's name and versions to publish (none when it goes in place of one already here). */
export interface Taken {
  move: LibraryMove;
  replace: boolean;
  name: string;
  description: string;
  versions: { docHash: string; note: string | null }[];
}

/** The latest move of one of this organization's items: an open one, else the last (moved, declined, taken back). */
export function moveOfItem(moves: readonly LibraryMove[], orgId: string, itemId: string): LibraryMove | null {
  const mine = moves.filter((m) => m.fromOrg === orgId && m.fromItem === itemId);
  return mine.find((m) => m.state === 'offered' || m.state === 'accepted') ?? mine[0] ?? null;
}

/** Offers to this organization still to take or finish, of these kinds. */
export function offersFor(moves: readonly LibraryMove[], orgId: string, kinds: readonly LibraryKind[]): LibraryMove[] {
  return moves.filter((m) => m.toOrg === orgId && kinds.includes(m.kind) && (m.state === 'offered' || m.state === 'accepted'));
}

/** This organization's own items an offer can go in place of: same kind, made or copied here, not archived. */
export function placesFor(library: Record<string, LibraryItemState>, kind: LibraryKind) {
  return Object.keys(library)
    .map((id) => libraryItemView(library, id))
    .filter((v) => v !== null && v.kind === kind && v.source !== 'subscription' && !v.archived && v.current !== null)
    .map((v) => v!)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What taking an offer writes here, in order. A new item starts as the old
 * one did (its name, description and every version, oldest first); one
 * already here keeps its own. Either way it is shared for following, which
 * is when the server moves the followers. If this organization followed the
 * old item, it stops, and that item leaves the lists (archived; a language
 * using it keeps it): the item is its own now.
 */
export function takeOps(library: Record<string, LibraryItemState>, taken: Taken): LibraryOp[] {
  const { move } = taken;
  const itemId = move.toItem!;
  const kind = move.kind;
  const ops: LibraryOp[] = [];
  if (!taken.replace) {
    const it = libraryItemView(library, itemId);
    if (!it) ops.push({ type: 'v1.LibraryItemDefined', payload: { itemId, kind, name: taken.name, description: taken.description } });
    for (const v of taken.versions) {
      if (it?.versions.some((x) => x.docHash === v.docHash)) continue;
      ops.push({ type: 'v1.LibraryVersionPublished', payload: { itemId, kind, docHash: v.docHash, ...(v.note ? { note: v.note } : {}) } });
    }
  }
  const here = libraryItemView(library, itemId);
  if (!(here?.shared && here.subscribable)) {
    ops.push({ type: 'v1.LibrarySharingSet', payload: { itemId, kind, shared: true, subscribable: true } });
  }
  const followed = followerItemId(library, move.fromOrg, move.fromItem);
  const sub = library[followed]?.subscription.value;
  if (sub?.active && library[followed]?.kind.value) {
    ops.push({
      type: 'v1.LibrarySubscribed',
      payload: { itemId: followed, kind: library[followed]!.kind.value, sourceOrgId: sub.sourceOrgId, sourceOrgName: sub.sourceOrgName, sourceItemId: sub.sourceItemId, name: sub.name, autoUpdate: sub.autoUpdate, active: false }
    });
    ops.push({ type: 'v1.LibraryItemArchived', payload: { itemId: followed, kind: library[followed]!.kind.value, archived: true } });
  }
  return ops;
}
