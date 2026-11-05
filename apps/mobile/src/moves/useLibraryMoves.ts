// Moving library items between organizations (decisions.md 175), for the
// library screens: the moves this person may act on (asked again every 15
// seconds while one taken here waits for the server), and offering, taking
// back, turning down and taking an item.
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useState } from 'react';
import { noteExpected } from '../diagnostics/report';
import { newItemId } from '../library/model';
import { acceptMove, declineMove, movesFor, moveTargets, offerMove, withdrawMove } from '../server/libraryMoves';
import type { Ctx } from '../shell/ctx';
import { takeOps, type LibraryMove, type Taken } from './model';

const POLL_MS = 15_000;

export type OfferAnswer = 'offered' | 'no_item' | 'not_allowed' | 'no_org' | 'open' | 'offline';
export type TakeAnswer = 'taken' | 'not_open' | 'not_allowed' | 'bad_item' | 'offline';

export function useLibraryMoves(ctx: Ctx, canManage: boolean) {
  const orgId = ctx.language.orgId;
  const [moves, setMoves] = useState<LibraryMove[]>([]);
  const [offline, setOffline] = useState(false);

  const load = useCallback(async () => {
    if (!canManage || !orgId) return;
    const { data, error } = await movesFor(orgId);
    if (error) { noteExpected('library moves', error); setOffline(true); return; }
    setMoves((data ?? []) as LibraryMove[]);
    setOffline(false);
  }, [orgId, canManage]);

  useEffect(() => { void load(); }, [load]);
  const waiting = moves.some((m) => m.state === 'accepted' || m.state === 'offered');
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [waiting, load]);

  async function search(query: string): Promise<{ org_id: string; name: string }[] | null> {
    const { data, error } = await moveTargets(orgId, query);
    if (error) { noteExpected('move targets', error); return null; }
    return (data ?? []) as { org_id: string; name: string }[];
  }

  async function offer(itemId: string, toOrg: string): Promise<OfferAnswer> {
    const { data, error } = await offerMove(orgId, itemId, toOrg);
    if (error) { noteExpected('move offer', error); return 'offline'; }
    await load();
    const answer = data as { ok: boolean; reason?: OfferAnswer };
    return answer.ok ? 'offered' : answer.reason ?? 'offline';
  }

  async function withdraw(moveId: string): Promise<boolean> {
    const { error } = await withdrawMove(orgId, moveId);
    if (error) { noteExpected('move withdraw', error); return false; }
    await load();
    return true;
  }

  async function decline(moveId: string): Promise<boolean> {
    const { error } = await declineMove(orgId, moveId);
    if (error) { noteExpected('move decline', error); return false; }
    await load();
    return true;
  }

  /**
   * Take an offer: as a new item (`into` absent) or in place of one of this
   * organization's own. The server gives this organization the versions,
   * then they are published here and shared for following; the server moves
   * the followers when that arrives.
   */
  async function take(move: LibraryMove, into?: string): Promise<TakeAnswer> {
    const toItem = move.toItem ?? into ?? newItemId(move.name, Crypto.randomUUID());
    const { data, error } = await acceptMove(orgId, move.id, toItem);
    if (error) { noteExpected('move accept', error); return 'offline'; }
    const answer = data as Partial<Taken> & { reason?: TakeAnswer };
    if (!answer.move) { await load(); return answer.reason ?? 'not_open'; }
    for (const op of takeOps(ctx.org.state?.library ?? {}, answer as Taken)) await ctx.org.append(op.type, op.payload as never);
    await load();
    return 'taken';
  }

  return { moves, offline, refresh: load, search, offer, withdraw, decline, take };
}
