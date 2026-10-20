// New language's draft (decisions.md 146, checks/languageDraftModel.ts): one at a
// time, held here while New language and the check pages it opens are up,
// and forgotten when the language is added or New language closes.
import type { EventSpec, LanguageState } from '@langquest-next/core';
import { foldDraft, newDraft, type LanguageDraft } from './languageDraftModel';

/** The draft and its fold, replaced together on every change (a screen's snapshot). */
export interface DraftSnapshot {
  draft: LanguageDraft;
  state: LanguageState;
  /** Counts changes, as a language's revision does. */
  revision: number;
}

let current: DraftSnapshot | null = null;
export const listeners = new Set<() => void>();

function put(next: LanguageDraft | null): void {
  current = next ? { draft: next, state: foldDraft(next), revision: (current?.revision ?? 0) + 1 } : null;
  for (const l of listeners) l();
}

export function getDraft(): DraftSnapshot | null {
  return current;
}

/** Start again from a flow's events (its checks copied, decision 91). */
export function startDraft(c: Parameters<typeof newDraft>[0]): void {
  put(newDraft(c));
}

/** A change made on one of the draft's pages: kept, as a ready language keeps it (decision 127). */
export function addToDraft(specs: readonly EventSpec[]): void {
  if (!current || specs.length === 0) return;
  put({ ...current.draft, specs: [...current.draft.specs, ...specs] });
}

/** Its name and reference languages follow New language's answers. */
export function setDraftAnswers(c: { name: string; reads: readonly string[] }): void {
  if (!current) return;
  const d = current.draft;
  if (d.name === c.name && d.reads.join('|') === c.reads.join('|')) return;
  put({ ...d, name: c.name, reads: [...c.reads] });
}

export function clearDraft(): void {
  if (current) put(null);
}
