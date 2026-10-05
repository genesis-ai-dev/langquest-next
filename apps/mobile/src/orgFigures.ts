import type { LaneSummary, LanguageProgress } from '@langquest-next/core';

/**
 * A language's figures on an overview, and where they came from. A phone
 * folds only the languages it has open (decisions.md 37); the dashboard's
 * server sums the rest (decision 44). The local fold wins for a language
 * this phone has: it is the reducer's own answer, fresher, and offline.
 */
export interface LaneFigures {
  progress: LanguageProgress;
  /** null when folded here; otherwise when the server last caught up, ISO. */
  asOf: string | null;
}

export function laneFigures(
  laneIds: readonly string[],
  local: ReadonlyMap<string, LanguageProgress>,
  server: { rows: LaneSummary[]; asOf: string } | null
): Map<string, LaneFigures> {
  const fromServer = new Map((server?.rows ?? []).map((r) => [r.laneId, r.progress]));
  const out = new Map<string, LaneFigures>();
  for (const laneId of laneIds) {
    const here = local.get(laneId);
    if (here) out.set(laneId, { progress: here, asOf: null });
    else {
      const there = fromServer.get(laneId);
      if (there) out.set(laneId, { progress: there, asOf: server!.asOf });
    }
  }
  return out;
}

/** The oldest server time among the figures shown, or null when every one was folded here. */
export function oldestAsOf(figures: Iterable<LaneFigures>): string | null {
  let oldest: string | null = null;
  for (const f of figures) if (f.asOf && (!oldest || f.asOf < oldest)) oldest = f.asOf;
  return oldest;
}
