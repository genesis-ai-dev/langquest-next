/**
 * Give the app's group handed to Let someone in (docs/nearby-sync-plan.md 14.5, a new phone joins
 * with no third code): Give the app's Let them in leaves its session running instead of stopping
 * it, and Let someone in then hosts its link on that group and owns the session, stopping it when
 * it is done or left. Held once for the whole app, as installFileKept.ts holds the kept file; it
 * says only that a hand-over is under way, and native says whether the group still serves.
 */
let handed = false;

/** Give the app leaves its session running for Let someone in. */
export function handGiveOver(): void {
  handed = true;
}

/** Whether Give the app handed its session over and nobody has taken it yet. */
export function giveHandedOver(): boolean {
  return handed;
}

/** Let someone in takes the session over (it now stops it); true when there was one to take. */
export function takeGiveHandOver(): boolean {
  const was = handed;
  handed = false;
  return was;
}
