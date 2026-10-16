// The saved mark's states (SavedMark.tsx, decision 111), shared by the hooks
// that drive it (useSaveStatus.ts, drafts/useDraft.ts).

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

/** Long enough to see the spinner turn into the check. */
export const MIN_SPIN_MS = 600;
