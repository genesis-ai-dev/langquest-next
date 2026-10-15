// New language's "I'll choose the checks" (decisions.md 91): the checks a
// language will start with, edited on the Checks screen before the language
// exists. One draft at a time, held here between the two screens and
// forgotten when the language is made or New language closes.
import type { KindDef } from '@langquest-next/core';
import type { CheckRow } from './model';
export { useChecksDraft } from './useChecksDraft';

export interface ChecksDraft {
  kinds: KindDef[];
  rows: CheckRow[];
}

export let draft: ChecksDraft | null = null;
export const listeners = new Set<() => void>();

export function setChecksDraft(next: ChecksDraft | null): void {
  draft = next;
  for (const l of listeners) l();
}

export function getChecksDraft(): ChecksDraft | null {
  return draft;
}

