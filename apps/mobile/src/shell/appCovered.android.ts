import { disguiseState } from '../disguise/disguise';

/** Whether this phone wears a cover now, from the disguise's own state (useAppCovered.android.ts draws the same). */
export function wornNow(): boolean {
  return disguiseState().look !== null;
}
