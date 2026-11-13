/**
 * When Scan a code's camera may run (decisions.md 171): never behind a disguise's cover. A
 * phone that wears one locks it on going to the background and keeps the app mounted under
 * it, so a link opened then (an invite, or a Let someone in link with someone on the phone)
 * lands on this screen under the cover, and opening the camera there would light Android's
 * camera indicator, or show a permission prompt naming the real app, over the calculator.
 * Pure, so it is tested on its own (test/scanCamera.test.ts).
 */

/**
 * What the screen does on opening, as soon as it can: `start` the camera, `ask` for it, `no`
 * (it cannot be asked again), or `later`, which decides nothing yet: the permission is still
 * being read, a code is already held, it already decided, or the cover is on, so it waits
 * for the code and opens the camera only once the person can see the screen.
 */
export function cameraOnOpen(o: {
  decided: boolean;
  web: boolean;
  covered: boolean;
  permission: { granted: boolean; canAskAgain: boolean } | null;
  held: boolean;
  signinCode: boolean;
}): 'later' | 'start' | 'ask' | 'no' {
  if (o.decided || o.web || !o.permission || o.held || o.signinCode || o.covered) return 'later';
  if (o.permission.granted) return 'start';
  return o.permission.canAskAgain ? 'ask' : 'no';
}

/** The camera's view is drawn only while it is asked for, allowed, and nothing covers the app: coming back covered to an open scanner turns it off. */
export function cameraShows(scanning: boolean, granted: boolean, covered: boolean): boolean {
  return scanning && granted && !covered;
}
