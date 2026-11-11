// How a key term's recorded examples are grouped (decision 206). A term can
// be said more than one way, depending on context, and a language may be oral
// only, so a "way" is whatever the clips' `wayId` says, written or not. Clips
// with one wayId are repeats of one way. A written rendering the team made
// names its way and says its context; a written rendering with no clips yet is
// still offered, so it can be recorded.
import type { KeyTermView } from '@langquest-next/core';

export interface ExampleWay {
  wayId: string;
  /** The written rendering's text, or '' when the way has no written form. */
  rendering: string;
  context: string;
  examples: KeyTermView['audioRenderings'];
  /** The takes its clips were recorded during, each once, so the way can list its passages. */
  takeIds: string[];
}

/** A way the phone makes when the team adds one with no written form. */
export const newWayId = (uuid: string): string => `way:${uuid}`;

/**
 * The term's ways, in the order they were first recorded (written ones with no
 * clips after). `pending` are ways added on screen that have no clip yet. A
 * term with nothing at all gets one empty way, so there is always a place to record.
 */
export function exampleWays(term: Pick<KeyTermView, 'renderings' | 'audioRenderings'>, pending: readonly string[] = []): ExampleWay[] {
  const written = new Map(term.renderings.map((r) => [r.renderingId, r]));
  const ways = new Map<string, ExampleWay>();
  const way = (wayId: string): ExampleWay => {
    let w = ways.get(wayId);
    if (!w) {
      const r = written.get(wayId);
      w = { wayId, rendering: r?.rendering ?? '', context: r?.context ?? '', examples: [], takeIds: [] };
      ways.set(wayId, w);
    }
    return w;
  };
  for (const e of term.audioRenderings) {
    const w = way(e.wayId);
    w.examples.push(e);
    if (e.duringTakeId && !w.takeIds.includes(e.duringTakeId)) w.takeIds.push(e.duringTakeId);
  }
  for (const r of term.renderings) way(r.renderingId);
  for (const id of pending) way(id);
  if (ways.size === 0) way('way:first');
  return [...ways.values()];
}
