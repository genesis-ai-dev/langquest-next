// Moving a library item to another organization (decisions.md 175): finding
// the organization, offering the item, and the other side taking it or
// turning it down. The server moves the item's followers once the new
// organization's app has published it.
import { supabase } from './supabase';

/** Organizations an item may go to, by name: those that share, have a blue check, or list a language. */
export function moveTargets(orgId: string, query: string) {
  return supabase.rpc('library_move_targets', { p_org: orgId, p_query: query });
}

/** Offer an item to another organization: `{ ok, move }`, or `{ ok: false, reason }`. */
export function offerMove(orgId: string, itemId: string, toOrg: string) {
  return supabase.rpc('library_move_offer', { p_org: orgId, p_item: itemId, p_to_org: toOrg });
}

/** Offers to and from the organization that this person may act on, newest first. */
export function movesFor(orgId: string) {
  return supabase.rpc('library_moves_for', { p_org: orgId });
}

/** Take back an offer not taken yet: `withdrawn` or `not_open`. */
export function withdrawMove(orgId: string, moveId: string) {
  return supabase.rpc('library_move_withdraw', { p_org: orgId, p_move: moveId });
}

/** Turn an offer down: `declined` or `not_open`. */
export function declineMove(orgId: string, moveId: string) {
  return supabase.rpc('library_move_decline', { p_org: orgId, p_move: moveId });
}

/** Take an offer as `toItem` (new, or one of this organization's own): the versions to publish, or `{ reason }`. */
export function acceptMove(orgId: string, moveId: string, toItem: string) {
  return supabase.rpc('library_move_accept', { p_org: orgId, p_move: moveId, p_to_item: toItem });
}
