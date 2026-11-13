import { cameraOnOpen, cameraShows } from '../src/invites/scanCameraModel';

/**
 * Scan a code's camera and a disguise (decisions.md 171). Why: a disguised phone locks its
 * cover on going to the background and keeps the app under it, so a link opened then landed on
 * this screen under the cover, which turned the camera on, or asked for it in a prompt naming
 * the real app, over the calculator (security review, 2026-11-10).
 */
describe('Scan a code\'s camera', () => {
  const open = { decided: false, web: false, covered: false, permission: { granted: true, canAskAgain: true }, held: false, signinCode: false };

  it('opens at once when nothing covers the app, asking first when it must', () => {
    expect(cameraOnOpen(open)).toBe('start');
    expect(cameraOnOpen({ ...open, permission: { granted: false, canAskAgain: true } })).toBe('ask');
    expect(cameraOnOpen({ ...open, permission: { granted: false, canAskAgain: false } })).toBe('no');
  });

  it('waits under a cover, neither opening nor asking, and decides once the code lifts it', () => {
    for (const permission of [{ granted: true, canAskAgain: true }, { granted: false, canAskAgain: true }]) {
      expect(cameraOnOpen({ ...open, covered: true, permission })).toBe('later');
    }
    expect(cameraOnOpen({ ...open, covered: false })).toBe('start');
  });

  it('decides nothing while the permission is read, a code is held, on the web, or once decided', () => {
    expect(cameraOnOpen({ ...open, permission: null })).toBe('later');
    expect(cameraOnOpen({ ...open, held: true })).toBe('later');
    expect(cameraOnOpen({ ...open, signinCode: true })).toBe('later');
    expect(cameraOnOpen({ ...open, web: true })).toBe('later');
    expect(cameraOnOpen({ ...open, decided: true })).toBe('later');
  });

  it('draws the camera only while asked for, allowed and uncovered, so coming back covered turns it off', () => {
    expect(cameraShows(true, true, false)).toBe(true);
    expect(cameraShows(true, true, true)).toBe(false);
    expect(cameraShows(true, false, false)).toBe(false);
    expect(cameraShows(false, true, false)).toBe(false);
  });
});
