import { buildIndexes, type Indexes, type ProjectState } from '@langquest-next/core';

/**
 * One `Indexes` per published state. useProject republishes a fresh
 * top-level object after every change, so the object's identity is the
 * revision: every screen and helper that renders against the same revision
 * shares one index build instead of each sorting the project's units and
 * takes again. Never pass a state the fold is still mutating.
 */
const cache = new WeakMap<ProjectState, Indexes>();

export function indexesFor(state: ProjectState): Indexes {
  let idx = cache.get(state);
  if (!idx) {
    idx = buildIndexes(state);
    cache.set(state, idx);
  }
  return idx;
}
