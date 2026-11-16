/**
 * Does this person, or with no one signed in anyone on this phone, hold a join pass (docs/
 * nearby-sync-plan.md 14.1, 1)? New password then warns that newcomers let in from a lost phone
 * will be refused (14.3). Only an Android phone holds passes (useHoldsPasses.android.ts).
 */
export function useHoldsPasses(_actorId: string | null): boolean {
  return false;
}
