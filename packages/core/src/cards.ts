import type { Card } from './events';
import { stateRevision } from './reducer';
import type { LanguageState } from './state';

type Recording = LanguageState['recordings'][string];

/**
 * Recorded cards by their file, and recordings by passage, read once per
 * state and revision. Playing a clip looked each card's length and format
 * up by scanning every recording in the language, for every card, on every
 * draw: 37,000 recordings for Koro Miyan. Keyed like the passage indexes
 * (`recordIndexes`): the fold bumps a state's revision with every event it
 * applies, so a hit is never stale.
 */
interface CardIndex {
  /** The first card that holds each file, in the order recordings were added. */
  first: Map<string, Card>;
  /** Each file's length from the first card that gives one. */
  durationMs: Map<string, number>;
  byUnit: Map<string, Recording[]>;
}

const indexes = new WeakMap<LanguageState, { revision: number; index: CardIndex }>();

function cardIndex(state: LanguageState): CardIndex {
  const revision = stateRevision(state);
  const hit = indexes.get(state);
  if (hit && hit.revision === revision) return hit.index;
  const index: CardIndex = { first: new Map(), durationMs: new Map(), byUnit: new Map() };
  for (const recording of Object.values(state.recordings)) {
    const list = index.byUnit.get(recording.unitId);
    if (list) list.push(recording); else index.byUnit.set(recording.unitId, [recording]);
    for (const card of recording.cards) {
      if (!index.first.has(card.hash)) index.first.set(card.hash, card);
      if (card.durationMs && !index.durationMs.has(card.hash)) index.durationMs.set(card.hash, card.durationMs);
    }
  }
  indexes.set(state, { revision, index });
  return index;
}

/** The card that holds this file, from the first recording that has it; undefined for audio that is not a recording's (a voice note, reference audio). */
export function recordedCard(state: LanguageState, hash: string): Card | undefined {
  return cardIndex(state).first.get(hash);
}

/** How long this file plays, from the first recording that says; 0 when none does. */
export function recordedDurationMs(state: LanguageState, hash: string): number {
  return cardIndex(state).durationMs.get(hash) ?? 0;
}

/** A passage's recordings, in the order they were added. */
export function recordingsOf(state: LanguageState, unitId: string): readonly Recording[] {
  return cardIndex(state).byUnit.get(unitId) ?? [];
}
