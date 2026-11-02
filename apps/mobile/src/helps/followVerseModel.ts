// Where the Bible pane scrolls to keep the verse being read in view
// (LAN-131), and whether a scroll by hand stops it. useFollowVerse.ts holds
// the refs and events; these are its rules.

/** A verse's top and bottom in the scrolled words, and the part of them on screen. */
export interface Box { top: number; bottom: number }
export interface Shown { y: number; h: number }

/** Room left above the verse scrolled to, so the one before it still shows. */
export const ABOVE = 48;

export function inView(b: Box | null, shown: Shown): boolean {
  return !!b && b.top >= shown.y && b.bottom <= shown.y + shown.h;
}

/** Where to scroll so the verse being read shows, or null when it already does (or nothing is known yet). */
export function followTo(b: Box | null, shown: Shown): number | null {
  if (!b || shown.h === 0 || inView(b, shown)) return null;
  return Math.max(0, b.top - ABOVE);
}

/** After the person scrolls: following stops, unless they brought the verse being read back into view. */
export function heldAfterScroll(b: Box | null, shown: Shown): boolean {
  return !inView(b, shown);
}
