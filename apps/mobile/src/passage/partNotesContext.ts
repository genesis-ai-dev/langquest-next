// What the parts being recorded have been told (decisions.md 149): a part's
// notes from the checks, and opening them. The recording workspace provides
// it (passage/PartNotes.tsx); a part row reads it (usePartNotes) and shows a
// mark when its part has notes. Elsewhere it is null and rows show nothing.
import type { PassageNote } from '@langquest-next/core';
import { createContext } from 'react';

export interface PartNotesValue {
  notes: (hash: string) => PassageNote[];
  open: (hash: string, label: string) => void;
}

export const PartNotesContext = createContext<PartNotesValue | null>(null);
