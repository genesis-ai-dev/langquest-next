// When help mode measures the lit parts (helpMode.tsx). Every part's place
// is a call across the bridge, so the measuring is paced, not per frame:
// about ten rounds a second while something has just moved (a scroll, a
// screen drawing in, a layout), and a few a second while nothing has, to
// still notice a scroll that starts. Pure.

/** A round of measures at most this often while parts are moving. */
export const MEASURE_MOVING_MS = 100;
/** And this often once nothing has moved for MEASURE_SETTLE_MS. */
export const MEASURE_IDLE_MS = 300;
/** How long after the last move parts count as still moving. */
export const MEASURE_SETTLE_MS = 1000;

/** Whether a round of measures is due at `now` (ms): `lastRound` was the last, `lastMoved` the last time a part's place changed. */
export function measureDue(now: number, lastRound: number, lastMoved: number): boolean {
  const gap = now - lastMoved < MEASURE_SETTLE_MS ? MEASURE_MOVING_MS : MEASURE_IDLE_MS;
  return now - lastRound >= gap || now < lastRound;
}
