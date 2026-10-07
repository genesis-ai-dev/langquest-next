import type { AnyEvent } from './events';
import { REDUCER_VERSION, foldLanguage } from './reducer';
import type { LanguageState } from './state';

/**
 * A snapshot is the fold of a language's stream up to `serverSeq`, produced by a
 * specific reducer version. Cold start = snapshot + events after serverSeq.
 */
export interface Snapshot {
  orgId: string;
  streamId: string;
  reducerVersion: number;
  serverSeq: number;
  state: LanguageState;
}

export function takeSnapshot(
  orgId: string,
  streamId: string,
  confirmedEvents: AnyEvent[]
): Snapshot {
  const ordered = [...confirmedEvents].sort((a, b) => (a.serverSeq ?? 0) - (b.serverSeq ?? 0));
  const state = foldLanguage(ordered);
  // Everything at or below serverSeq is folded in; the id set is no longer
  // needed for those events, so compact it.
  state.appliedEventIds = {};
  const last = ordered[ordered.length - 1];
  return {
    orgId,
    streamId,
    reducerVersion: REDUCER_VERSION,
    serverSeq: last?.serverSeq ?? 0,
    state
  };
}

/** Resume from a snapshot: only events after its sequence are applied. */
export function resume(snapshot: Snapshot, tail: Iterable<AnyEvent>): LanguageState {
  if (snapshot.reducerVersion !== REDUCER_VERSION) {
    throw new Error(
      `Snapshot reducer version ${snapshot.reducerVersion} does not match ${REDUCER_VERSION}`
    );
  }
  const state = structuredClone(snapshot.state);
  const newer = [...tail].filter((e) => e.serverSeq === undefined || e.serverSeq > snapshot.serverSeq);
  return foldLanguage(newer, state);
}
