import { createContext, useContext } from 'react';

/** Whether the session this subtree belongs to is read-only (decisions.md 158); the shell provides it from `session.readOnly`. */
export const ReadOnlyContext = createContext(false);

/** The recorder asks before it opens the microphone: nothing recorded could be kept. */
export function useReadOnly(): boolean {
  return useContext(ReadOnlyContext);
}
