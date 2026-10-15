// Recording and playback counts for field diagnostics (docs/diagnostics.md):
// the hourly `audio` tally, per language. Counts only; which passage, whose
// voice and what was said are never part of it (decisions.md 39).
import type { AudioCounter } from '@langquest-next/sync';
import { diagnostics } from '../diagnostics/diagnostics';

/** The language a take or a player belongs to; its stream is the language's own (decision 63). */
export interface AudioLanguage {
  orgId: string;
  languageId: string;
}

/**
 * Add to a counter on the open language's tally. Without a language (no
 * organization open yet, a recorder not tied to one) the count still goes
 * on a tally of its own, with no ids rather than made-up ones.
 */
export function countAudio(language: AudioLanguage | null | undefined, counter: AudioCounter, by = 1): void {
  const where = language?.orgId
    ? { orgId: language.orgId, ...(language.languageId ? { streamId: language.languageId } : {}) }
    : {};
  diagnostics.audio(where, counter, by);
}
