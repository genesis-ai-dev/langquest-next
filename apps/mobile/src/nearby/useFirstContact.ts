import type { FirstContactView } from '../session/firstContactModel';

const NONE: FirstContactView = { status: { kind: 'none' }, retry: () => {}, joinWithToken: async () => ({ kind: 'none' }) };

/**
 * First contact (docs/nearby-sync-plan.md 14.1, 6). Only an Android phone can hold a local person
 * (useFirstContact.android.ts), so here there is never anyone to bring to the server.
 */
export function useFirstContact(_o: { serverAs: string | null }): FirstContactView {
  return NONE;
}
