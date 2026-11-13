import type { Ctx } from '../shell/ctx';
import type { NearbyOrigin } from './nearbyHistoryModel';

const NONE = (): NearbyOrigin | null => null;

/**
 * Which of a record's History entries came from a teammate's phone and are still not confirmed
 * here (docs/nearby-sync-plan.md 5.8). Only Android holds such rows (useNearbyHistory.android.ts);
 * here none ever is, and this bundle reads nothing for it.
 */
export function useNearbyHistory(_ctx: Ctx): (by: string, hlc: string) => NearbyOrigin | null {
  return NONE;
}
