// The Checks list's Undo hears every save of a language's checks while the
// list is open (decision 134), a check's own page opened on top of it too:
// "Remove this check" asks first, and back on the list Undo puts it back.
import type { ChecksBefore } from './undo';

type Saved = (before: ChecksBefore, what: string) => void;
const lists = new Map<string, Saved>();

/** The open Checks list of a language hears its saves; returns the way to stop. */
export function hearChecksSaved(languageId: string, saved: Saved): () => void {
  lists.set(languageId, saved);
  return () => { if (lists.get(languageId) === saved) lists.delete(languageId); };
}

/** A save of a language's checks: the checks before it, for the list's Undo when it is open. */
export function checksSaved(languageId: string, before: ChecksBefore, what: string): void {
  lists.get(languageId)?.(before, what);
}
