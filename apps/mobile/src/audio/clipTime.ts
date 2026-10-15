// How long clips are, and how a player shows the time (audio/clipPlayer.tsx, useClip.ts).
import { recordedDurationMs, type LanguageState } from '@langquest-next/core';
import { formatClock } from '../i18n/format';
import type { LanguageHandle } from '../sync/useLanguage';

/** "1:05" from seconds. */
export function clock(seconds: number): string {
  return formatClock(seconds * 1000);
}

/** The length of these cards together, in seconds (0 when unknown). */
export function clipSeconds(state: LanguageState | null | undefined, hashes: string[]): number {
  if (!state) return 0;
  let total = 0;
  for (const hash of hashes) total += recordedDurationMs(state, hash) / 1000;
  return total;
}

/** Each card's length in seconds, from the recording that holds it (0 when unknown). */
export function cardSeconds(language: LanguageHandle, hashes: string[]): number[] {
  const state = language.state;
  return hashes.map((hash) => (state ? recordedDurationMs(state, hash) / 1000 : 0));
}
