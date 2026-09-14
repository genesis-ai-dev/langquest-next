import type { AnyEvent } from './events';
import { REDUCER_VERSION, fold } from './reducer';
import type { ProjectState } from './state';

/**
 * A snapshot is the fold of a partition up to `serverSeq`, produced by a
 * specific reducer version. Cold start = snapshot + events after serverSeq.
 */
export interface Snapshot {
  orgId: string;
  projectId: string;
  reducerVersion: number;
  serverSeq: number;
  state: ProjectState;
}

export function takeSnapshot(
  orgId: string,
  projectId: string,
  confirmedEvents: AnyEvent[]
): Snapshot {
  const ordered = [...confirmedEvents].sort((a, b) => (a.serverSeq ?? 0) - (b.serverSeq ?? 0));
  const state = fold(ordered);
  // Everything at or below serverSeq is folded in; the id set is no longer
  // needed for those events, so compact it.
  state.appliedEventIds = {};
  const last = ordered[ordered.length - 1];
  return {
    orgId,
    projectId,
    reducerVersion: REDUCER_VERSION,
    serverSeq: last?.serverSeq ?? 0,
    state
  };
}

/** Resume from a snapshot: only events after its sequence are applied. */
export function resume(snapshot: Snapshot, tail: Iterable<AnyEvent>): ProjectState {
  if (snapshot.reducerVersion !== REDUCER_VERSION) {
    throw new Error(
      `Snapshot reducer version ${snapshot.reducerVersion} does not match ${REDUCER_VERSION}`
    );
  }
  const state = structuredClone(snapshot.state);
  const newer = [...tail].filter((e) => e.serverSeq === undefined || e.serverSeq > snapshot.serverSeq);
  return fold(newer, state);
}
