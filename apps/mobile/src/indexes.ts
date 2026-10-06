import { buildIndexes, type Indexes, type LanguageState } from '@langquest-next/core';

/**
 * One `Indexes` per published state. useLanguage republishes a fresh
 * top-level object after every change, so the object's identity is the
 * revision: every screen and helper that renders against the same revision
 * shares one index build instead of each sorting the language's units
 * again. Never pass a state the fold is still mutating.
 */
const cache = new WeakMap<LanguageState, Indexes>();

export function indexesFor(state: LanguageState): Indexes {
  let idx = cache.get(state);
  if (!idx) {
    idx = buildIndexes(state);
    cache.set(state, idx);
  }
  return idx;
}
