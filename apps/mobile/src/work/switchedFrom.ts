/**
 * The language My Work's "New in ‹language›" row switched away from, so My
 * Work can offer the way back while the app stays in the language it
 * switched to (UI audit, finding 81). Kept in memory: My Work is drawn
 * afresh on each tab tap, and a restart forgets it as it forgets the screen.
 */
let last: { from: string; to: string } | null = null;

export const switchedFrom = {
  get: () => last,
  set: (from: string, to: string) => { last = { from, to }; },
  clear: () => { last = null; }
};
