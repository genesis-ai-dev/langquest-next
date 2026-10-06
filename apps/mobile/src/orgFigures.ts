import type { LanguageProgress, LanguageSummary } from '@langquest-next/core';

/**
 * A language's figures on an overview, and where they came from. A phone
 * folds only the languages it has open (decision 63); the dashboard's
 * server sums the rest (decision 44). The local fold wins for a language
 * this phone has: it is the reducer's own answer, fresher, and offline.
 */
export interface LanguageFigures {
  progress: LanguageProgress;
  /** null when folded here; otherwise when the server last caught up, ISO. */
  asOf: string | null;
}

export function languageFigures(
  languageIds: readonly string[],
  local: ReadonlyMap<string, LanguageProgress>,
  server: { rows: LanguageSummary[]; asOf: string } | null
): Map<string, LanguageFigures> {
  const fromServer = new Map((server?.rows ?? []).map((r) => [r.languageId, r.progress]));
  const out = new Map<string, LanguageFigures>();
  for (const languageId of languageIds) {
    const here = local.get(languageId);
    if (here) out.set(languageId, { progress: here, asOf: null });
    else {
      const there = fromServer.get(languageId);
      if (there) out.set(languageId, { progress: there, asOf: server!.asOf });
    }
  }
  return out;
}

/** The oldest server time among the figures shown, or null when every one was folded here. */
export function oldestAsOf(figures: Iterable<LanguageFigures>): string | null {
  let oldest: string | null = null;
  for (const f of figures) if (f.asOf && (!oldest || f.asOf < oldest)) oldest = f.asOf;
  return oldest;
}
