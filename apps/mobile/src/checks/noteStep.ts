// The step a screen is part of, for the notes written on it (decisions.md 110):
// `record` for the recorder and the study, a check's kind id for its review
// and back translation. Notes record it, so a step can show notes by where
// they were written. Outside any step (the passage page) it is undefined.
import { createContext } from 'react';

export const NoteStepContext = createContext<string | undefined>(undefined);
