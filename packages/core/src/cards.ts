import type { Card } from './events';
import { stateRevision } from './reducer';
import type { CardCleanUp, LanguageState, Register } from './state';
import { cleanedFiles } from './blobs';

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
  /** A cleaned file's part as recorded, by the cleaned file (decisions.md 176). */
  cleanedFrom: Map<string, { unitId: string; hash: string }>;
}

const indexes = new WeakMap<LanguageState, { revision: number; index: CardIndex }>();

function cardIndex(state: LanguageState): CardIndex {
  const revision = stateRevision(state);
  const hit = indexes.get(state);
  if (hit && hit.revision === revision) return hit.index;
  const index: CardIndex = { first: new Map(), durationMs: new Map(), byUnit: new Map(), cleanedFrom: new Map() };
  for (const recording of Object.values(state.recordings)) {
    const list = index.byUnit.get(recording.unitId);
    if (list) list.push(recording); else index.byUnit.set(recording.unitId, [recording]);
    for (const card of recording.cards) {
      if (!index.first.has(card.hash)) index.first.set(card.hash, card);
      if (card.durationMs && !index.durationMs.has(card.hash)) index.durationMs.set(card.hash, card.durationMs);
    }
  }
  // A part's cleaned sound is a card of its own in the takes that hold it: as long as the part, in the format the note says.
  for (const [unitId, notes] of Object.entries(state.cardCleanUps ?? {})) {
    for (const file of cleanedFiles(notes)) {
      if (index.first.has(file.hash)) continue;
      const durationMs = index.durationMs.get(file.from) ?? 0;
      index.first.set(file.hash, { hash: file.hash, durationMs, format: file.format });
      if (durationMs) index.durationMs.set(file.hash, durationMs);
      index.cleanedFrom.set(file.hash, { unitId, hash: file.from });
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

/** Clean up's note on a part as recorded (decisions.md 176); null when there is none or Undo took it away. */
export function cleanUpOf(state: LanguageState, unitId: string, hash: string): Register<CardCleanUp> | null {
  const note = state.cardCleanUps?.[unitId]?.[hash];
  return note && note.value.use !== 'none' ? note : null;
}

/** For a part's cleaned sound, the part as recorded, whatever its note says now; null for any other file. */
export function cleanedFrom(state: LanguageState, hash: string): { unitId: string; hash: string } | null {
  return cardIndex(state).cleanedFrom.get(hash) ?? null;
}

/**
 * Whether Clean up may be offered for a part (decisions.md 176): never for
 * a part that is itself a cleaned sound, nor for one whose note says it was
 * cleaned. A part kept as recorded after a try may be tried again.
 */
export function mayCleanUp(state: LanguageState, unitId: string, hash: string): boolean {
  if (cardIndex(state).cleanedFrom.has(hash)) return false;
  return cleanUpOf(state, unitId, hash)?.value.use !== 'cleaned';
}

