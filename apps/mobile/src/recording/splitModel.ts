// The recording screen's split (Caleb, LAN-23): the source on top, your
// recording below, both on screen at once. A divider between them is dragged
// to give either one more room and settles on one of three snaps; the choice
// is kept for the rest of the session. Pure, so the arithmetic is tested for
// small Android phones (about 640pt tall) without rendering anything.

/** The source's (top pane's) share of the room, smallest first. */
export const SNAPS = [0.35, 0.5, 0.65] as const;
export const DEFAULT_SPLIT = 0.5;

/** Room the divider takes from the panes; its touch target is 48pt, overlapping both panes. */
export const DIVIDER = 24;

/** The source: its label and about three lines of text. */
export const MIN_TOP = 120;
/** The recorder at rest: the list's label and one take (the buttons are in the footer). */
export const MIN_BOTTOM = 120;
/** The recorder while recording: the status line and the level meter. */
export const MIN_BOTTOM_RECORDING = 144;

export interface PaneHeights { top: number; bottom: number }

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * The two panes' heights in `available` points (the body less the
 * divider), with the top taking `fraction`. Each keeps its minimum; when
 * the body is too short for both (a keyboard up behind a sheet), they share
 * it in proportion to their minimums, so neither ever disappears.
 */
export function paneHeights(available: number, fraction: number, minBottom = MIN_BOTTOM, minTop = MIN_TOP): PaneHeights {
  const room = Math.max(0, Math.floor(available));
  if (room <= minTop + minBottom) {
    const top = Math.round(room * (minTop / (minTop + minBottom)));
    return { top, bottom: room - top };
  }
  const top = clamp(Math.round(room * clamp(fraction, 0, 1)), minTop, room - minBottom);
  return { top, bottom: room - top };
}

/** The share a drag of `dy` points from `start` gives the top pane. */
export function fractionAfterDrag(start: number, dy: number, available: number): number {
  if (available <= 0) return start;
  return clamp(start + dy / available, 0, 1);
}

/** The snap nearest a share, where a released drag settles. */
export function nearestSnap(fraction: number): number {
  let best: number = SNAPS[0];
  for (const s of SNAPS) if (Math.abs(s - fraction) < Math.abs(best - fraction)) best = s;
  return best;
}

/** The next snap up (more source) or down (more recorder), for a screen reader's adjust actions. */
export function stepSnap(fraction: number, direction: 1 | -1): number {
  const at = nearestSnap(fraction);
  const i = SNAPS.indexOf(at as (typeof SNAPS)[number]);
  return SNAPS[clamp(i + direction, 0, SNAPS.length - 1)]!;
}

/** The top pane's share as a screen reader says it: "Source 50%". */
export function splitValueText(heights: PaneHeights): string {
  const total = heights.top + heights.bottom;
  return `Source ${total > 0 ? Math.round((heights.top / total) * 100) : 50}%`;
}

const remembered = new Map<string, number>();

/** The split someone chose for this kind of screen earlier in the session. */
export function rememberedSplit(key: string): number {
  return remembered.get(key) ?? DEFAULT_SPLIT;
}

export function rememberSplit(key: string, fraction: number): void {
  remembered.set(key, nearestSnap(fraction));
}

// ---- the listen–speak–listen loop (LAN-23) ----------------------------------------

/**
 * Where a recording session stands. `listening`: the person pressed play
 * on the source while recording, so the microphone is paused; recording
 * resumes when the source pauses or ends. Derived from the recorder's own
 * state and one flag, so a recorder that stops by itself (the app went to
 * the background, an error) ends the session rather than leaving it stuck.
 */
export type LoopPhase = 'off' | 'recording' | 'listening';

export function loopPhase(vadOn: boolean, listening: boolean): LoopPhase {
  if (vadOn) return 'recording';
  return listening ? 'listening' : 'off';
}

/** What the recorder pane says (and a screen reader announces) in each phase. */
export function loopStatus(phase: LoopPhase, capturing: boolean, count: number, noun: string): string {
  const so = `${count} ${noun}${count === 1 ? '' : 's'} so far`;
  if (phase === 'listening') return `Paused while the source plays. ${so}`;
  if (phase === 'recording') return capturing ? 'Recording what you say' : `Listening for you. ${so}`;
  return so;
}
