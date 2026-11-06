// How a key term's recorded examples are grouped (decision 205). Each written
// rendering is one way the language says the term (maybe only in some
// contexts); its examples are repeats of that way. Examples that name no
// written rendering, or one that is gone, are the team's "other" way, so a
// recording is never hidden.
import type { KeyTermView } from '@langquest-next/core';

export interface ExampleGroup {
  /** The written rendering these examples repeat; null for the unwritten "other" way. */
  renderingId: string | null;
  rendering: string;
  context: string;
  examples: KeyTermView['audioRenderings'];
}

export function exampleGroups(term: Pick<KeyTermView, 'renderings' | 'audioRenderings'>): ExampleGroup[] {
  const known = new Set(term.renderings.map((r) => r.renderingId));
  const groups: ExampleGroup[] = term.renderings.map((r) => ({
    renderingId: r.renderingId, rendering: r.rendering, context: r.context,
    examples: term.audioRenderings.filter((e) => e.forRenderingId === r.renderingId)
  }));
  const other = term.audioRenderings.filter((e) => !e.forRenderingId || !known.has(e.forRenderingId));
  // The "other" way is offered when nothing is written, so a team can record before it writes, and whenever it holds clips.
  if (other.length > 0 || term.renderings.length === 0) groups.push({ renderingId: null, rendering: '', context: '', examples: other });
  return groups;
}
