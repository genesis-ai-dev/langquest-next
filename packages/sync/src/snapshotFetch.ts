import type { LanguageState, Snapshot } from '@langquest-next/core';
import type { SnapshotMeta, Transport } from './types';

/**
 * Assemble a server snapshot from its pieces. `saved` lets a caller persist
 * pieces between calls so a dropped link resumes where it stopped: pieces
 * already in `saved` are not fetched again, and every new piece is handed
 * to `onChunk` before the snapshot is put together.
 *
 * `inFlight` pieces are requested at a time (decisions.md 18, amended
 * 2026-10-14). One at a time, a phone far from the server waited a round
 * trip per 256 KB piece, 152 of them for a Koro-sized language; with a few
 * on their way, the next piece is coming while the last is saved. A piece
 * that arrives is saved whatever happens to the others, so resuming after a
 * dropped link still fetches only what is missing.
 *
 * `meta` is the snapshot the caller already looked up, so the download is
 * one lookup, not two; without it this asks.
 */
export async function fetchSnapshot(
  transport: Pick<Transport, 'snapshotMeta' | 'snapshotChunk'>,
  orgId: string,
  streamId: string,
  reducerVersion: number,
  opts: {
    meta?: SnapshotMeta;
    saved?: ReadonlyMap<number, string>;
    onChunk?: (serverSeq: number, index: number, text: string) => Promise<void>;
    inFlight?: number;
  } = {}
): Promise<Snapshot | null> {
  const meta = opts.meta ?? (await transport.snapshotMeta(orgId, streamId, reducerVersion));
  if (!meta) return null;
  const pieces = new Array<string>(meta.chunks);
  let next = 0;
  // The snapshot rolled forward mid-fetch (the caller retries), or a piece failed: start no more.
  let stale = false;
  let failed = false;
  const fetchPieces = async (): Promise<void> => {
    while (!stale && !failed && next < meta.chunks) {
      const i = next++;
      const saved = opts.saved?.get(i);
      if (saved !== undefined) {
        pieces[i] = saved;
        continue;
      }
      try {
        const text = await transport.snapshotChunk(orgId, streamId, reducerVersion, meta.serverSeq, i);
        if (text === null) {
          stale = true;
          return;
        }
        await opts.onChunk?.(meta.serverSeq, i, text);
        pieces[i] = text;
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  // Settled, not raced: every piece already on its way is saved before this returns or throws.
  const runs = await Promise.allSettled(Array.from({ length: Math.max(1, opts.inFlight ?? 1) }, fetchPieces));
  const failure = runs.find((r): r is PromiseRejectedResult => r.status === 'rejected');
  if (failure) throw failure.reason;
  if (stale) return null;
  return { orgId, streamId, reducerVersion, serverSeq: meta.serverSeq, state: JSON.parse(pieces.join('')) as LanguageState };
}
