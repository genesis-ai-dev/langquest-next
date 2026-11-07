import { orgFeaturesOf, revokedSeqsOf } from './nearbyModel';

/**
 * Which of this person's organizations have nearby sync on, as `get_user_state` said this
 * run (docs/nearby-sync-plan.md 5.10, 5.12). `useGlobalViewer` already reads that call on
 * every `OrgWork` mount and on each token refresh, so it hands the answer here and
 * `useNearbyIdentity` reads it: someone in an organization that is off makes no new server
 * call. Not kept on the device: offline there is nothing new to read, and a phone keeps
 * what it holds until the server says otherwise.
 */

export interface NearbyFlag {
  /** Null until the server has said, or from a server before the field. */
  features: Record<string, string[]> | null;
  revokedSeqs: Record<string, number>;
  /** Moves with each answer, so a hook can run again on it. */
  revision: number;
}

const NONE: NearbyFlag = { features: null, revokedSeqs: {}, revision: 0 };
const known = new Map<string, NearbyFlag>();
const listeners = new Set<() => void>();

/** `get_user_state` answered for this person. */
export function heardUserState(actorId: string, userState: unknown): void {
  const before = known.get(actorId) ?? NONE;
  known.set(actorId, { features: orgFeaturesOf(userState), revokedSeqs: revokedSeqsOf(userState), revision: before.revision + 1 });
  for (const hear of listeners) hear();
}

export function nearbyFlag(actorId: string): NearbyFlag {
  return known.get(actorId) ?? NONE;
}

/** Be told when any answer comes. Returns the unsubscribe. */
export function onNearbyFlag(hear: () => void): () => void {
  listeners.add(hear);
  return () => { listeners.delete(hear); };
}
