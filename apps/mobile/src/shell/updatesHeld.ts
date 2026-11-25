/**
 * Over-the-air updates and a teammate's starting copy (updatesHeld.native.ts, 2026-11-24, review
 * item 26). A browser takes no over-the-air update and holds no starting copy, so here nothing is
 * looked for and nothing is held, and the web bundle carries none of the phone's reads.
 */

export async function startingCopyHere(): Promise<boolean> {
  return false;
}

export async function lookForUpdate(): Promise<void> {}

export async function lookAtStart(): Promise<void> {}
