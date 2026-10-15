import { unitAncestry } from '@langquest-next/core';
import { useEffect, useRef } from 'react';
import { indexesFor } from '../indexes';
import type { LanguageHandle } from '../useLanguage';
import { nearUnits } from './passagesInMemoryModel';

/**
 * Memory holds the record of the passage on screen, those next to it, and
 * the book and chapter it sits in (their source audio), so moving on is
 * instant; the rest of the language stays on the phone (decisions.md 107).
 * Asked again whenever the passage on screen changes, and once the
 * language has loaded.
 */
export function usePassagesInMemory(language: LanguageHandle, unitId: string | undefined): void {
  const stateRef = useRef(language.state);
  stateRef.current = language.state;
  const ready = language.state !== null;
  const { loadUnits } = language;
  useEffect(() => {
    const state = stateRef.current;
    if (!unitId || !state) return;
    loadUnits([...new Set([...nearUnits(indexesFor(state).passages, unitId), ...unitAncestry(state, unitId)])]);
  }, [unitId, ready, loadUnits]);
}
