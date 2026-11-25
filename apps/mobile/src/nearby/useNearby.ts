import type { Ctx } from '../shell/ctx';
import type { NearbyHandle, NearbyWhyNot } from './nearbyRunModel';

/**
 * Share nearby's hook (docs/nearby-sync-plan.md 5.8). Only a phone shares nearby
 * (useNearby.native.ts, for Android and iPhones); on the web nothing runs, nothing is offered, and
 * every action does nothing, so the web bundle carries no radio, no nearby entry and no cover code.
 */

const NOTHING = (): void => undefined;
const NOTHING_LATER = async (): Promise<void> => undefined;

const NOT_HERE: NearbyHandle = {
  view: {
    offered: false, iphone: false, tapCoversAll: false, whyNot: 'not-in-build', radiosOff: [], permissions: { state: 'none', step: { t: 'ready' } }, worn: false, needsPress: false,
    running: false, stopped: null, level: false, teammates: [], sessions: [], current: null, holding: 0, farAhead: [], clockOff: false,
    newerAppNeeded: false, findError: null, hold: true, whileOpen: null,
    carry: { everything: true, missing: 0, coming: 0, elsewhere: [], noRoom: false, notAllRecordings: false, pulledUnshared: false, olderFromServer: false, farAhead: [], teammates: [] },
    copyNeed: null, copyHeld: false
  },
  actions: { press: NOTHING, lookAgain: NOTHING, tap: NOTHING, warned: NOTHING, askPermissions: NOTHING_LATER, openSettings: NOTHING_LATER, setHold: NOTHING_LATER, setWhileOpen: NOTHING_LATER }
};

const NOT_OFFERED = { offered: false, whyNot: 'not-in-build' as NearbyWhyNot | null };

export function useNearby(_ctx: Ctx): NearbyHandle {
  return NOT_HERE;
}

/** For the Sync screen's row: whether to show Share nearby, and why it is disabled. Never here. */
export function useNearbyOffered(_ctx: Ctx): { offered: boolean; whyNot: NearbyWhyNot | null } {
  return NOT_OFFERED;
}
