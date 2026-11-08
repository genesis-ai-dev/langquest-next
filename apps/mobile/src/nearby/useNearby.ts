import type { Ctx } from '../shell/ctx';
import type { NearbyHandle, NearbyWhyNot } from './nearbyRunModel';

/**
 * Share nearby's hook (docs/nearby-sync-plan.md 5.8). Only Android shares nearby until phase 5
 * (useNearby.android.ts); here nothing runs, nothing is offered, and every action does nothing,
 * so the web and iPhone bundles carry no radio, no nearby entry and no cover code.
 */

const NOTHING = (): void => undefined;
const NOTHING_LATER = async (): Promise<void> => undefined;

const NOT_HERE: NearbyHandle = {
  view: {
    offered: false, whyNot: 'not-in-build', radiosOff: [], permissions: { state: 'none', step: { t: 'ready' } }, worn: false, needsPress: false,
    running: false, stopped: null, level: false, teammates: [], sessions: [], current: null, holding: 0, farAhead: [], clockOff: false,
    newerAppNeeded: false, findError: null, hold: true
  },
  actions: { press: NOTHING, lookAgain: NOTHING, tap: NOTHING, warned: NOTHING, askPermissions: NOTHING_LATER, openSettings: NOTHING_LATER, setHold: NOTHING_LATER }
};

const NOT_OFFERED = { offered: false, whyNot: 'not-in-build' as NearbyWhyNot | null };

export function useNearby(_ctx: Ctx): NearbyHandle {
  return NOT_HERE;
}

/** For the Sync screen's row: whether to show Share nearby, and why it is disabled. Never here. */
export function useNearbyOffered(_ctx: Ctx): { offered: boolean; whyNot: NearbyWhyNot | null } {
  return NOT_OFFERED;
}
