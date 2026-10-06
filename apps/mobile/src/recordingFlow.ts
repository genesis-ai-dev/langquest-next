import type { PartitionState } from '@langquest-next/core';

/** Recover durable, uncomposed recordings after navigating away or restarting. */
export function pendingPassageCards(
  state: PartitionState, unitId: string, laneId: string, actorId: string
) {
  const composed = new Set(Object.values(state.takes).flatMap((t) => t.cardHashes));
  return Object.values(state.recordings)
    .filter((r) => r.unitId === unitId && r.laneId === laneId &&
      r.actorId === actorId && r.kind === 'target')
    .sort((a, b) => a.hlc.localeCompare(b.hlc))
    .flatMap((r) => r.cards)
    .filter((c) => !composed.has(c.hash));
}
