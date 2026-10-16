import { indexesOf, type Indexes, type LanguageState } from '@langquest-next/core';

/**
 * One `Indexes` per published state. useLanguage republishes a fresh
 * top-level copy after every change (`publishedCopy`); core's `indexesOf`
 * builds the indexes once per state and revision, so every screen and
 * helper that renders against the same copy shares one build, and the next
 * copy reuses it while no event since could change the units.
 */
export function indexesFor(state: LanguageState): Indexes {
  return indexesOf(state);
}
