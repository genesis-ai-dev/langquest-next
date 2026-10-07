import type { LanguageState, Snapshot } from '@langquest-next/core';
import type { Transport } from './types';

/**
 * Assemble a server snapshot from its pieces. `saved` lets a caller persist
 * pieces between calls so a dropped link resumes where it stopped: pieces
 * already in `saved` are not fetched again, and every new piece is handed
 * to `onChunk` before the next is requested.
 */
export async function fetchSnapshot(
  transport: Pick<Transport, 'snapshotMeta' | 'snapshotChunk'>,
  orgId: string,
  streamId: string,
  reducerVersion: number,
  opts: { saved?: ReadonlyMap<number, string>; onChunk?: (serverSeq: number, index: number, text: string) => Promise<void> } = {}
): Promise<Snapshot | null> {
  const meta = await transport.snapshotMeta(orgId, streamId, reducerVersion);
  if (!meta) return null;
  const pieces: string[] = [];
  for (let i = 0; i < meta.chunks; i++) {
    let text = opts.saved?.get(i);
    if (text === undefined) {
      const fetched = await transport.snapshotChunk(orgId, streamId, reducerVersion, meta.serverSeq, i);
      if (fetched === null) return null; // snapshot rolled forward mid-fetch; caller retries
      text = fetched;
      await opts.onChunk?.(meta.serverSeq, i, text);
    }
    pieces.push(text);
  }
  return { orgId, streamId, reducerVersion, serverSeq: meta.serverSeq, state: JSON.parse(pieces.join('')) as LanguageState };
}
