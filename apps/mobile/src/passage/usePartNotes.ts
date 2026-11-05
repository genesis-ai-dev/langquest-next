// A part's notes from the checks, where a screen provides them (passage/partNotesContext.ts).
import { useContext } from 'react';
import { PartNotesContext, type PartNotesValue } from './partNotesContext';

export function usePartNotes(): PartNotesValue | null {
  return useContext(PartNotesContext);
}
