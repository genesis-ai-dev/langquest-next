// The step the notes written here belong to (checks/noteStep.ts).
import { useContext } from 'react';
import { NoteStepContext } from './noteStep';

export function useNoteStep(): string | undefined {
  return useContext(NoteStepContext);
}
