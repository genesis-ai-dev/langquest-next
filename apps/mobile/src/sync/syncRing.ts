/**
 * The header sync ring's motion, as a pure step function so it can be tested
 * without a clock. Three rules, from progress-indicator practice (NProgress's
 * trickle, iOS's latch-and-complete):
 *
 * - Forward only. What is shown never moves back: it latches the larger of the
 *   real fraction and a pseudo trickle that eases toward a cap and slows as it
 *   nears it, so a stalled upload still looks alive but never looks finished.
 * - Laps, lighter to heavier. A lap that has crept near its cap and still has
 *   work starts the next lap on top of it, drawn heavier. The finished lap stays
 *   as a full ring underneath, so the eye sees more weight, never a reset.
 * - Complete on leave. When the queue empties the ring runs out to full fast
 *   (whatever the lap), holds a moment, then fades back to the plain icon.
 */

export interface RingInput {
  /** Items (events plus files) still to move. */
  pending: number;
  /** Highest `pending` since the queue was last empty: the real denominator. */
  peak: number;
}

export interface RingState {
  phase: 'idle' | 'busy' | 'finishing' | 'done';
  /** 0..1 within the current lap. */
  shown: number;
  /** 0 for the first lap; each further lap is drawn heavier. */
  lap: number;
  /** Seconds in the current lap, or in the done hold. */
  t: number;
  /** The counter as drawn: falls toward `pending`, never rises past a new peak by steps. */
  count: number;
}

export const IDLE: RingState = { phase: 'idle', shown: 0, lap: 0, t: 0, count: 0 };

/** Where a lap's trickle levels off; real progress may still carry it to 1. */
export const CAP = 0.92;
/** Trickle time constant for the first lap; later laps are slower, so they feel heavier. */
const TAU = 1.4;
/** A lap this close to its cap, and this old, hands over to the next one. */
const LAP_AT = 0.86;
const LAP_MIN_S = 2.5;
export const MAX_LAP = 2;
/** Finishing runs the rest of the ring in about this long, regardless of lap. */
const FINISH_S = 0.22;
const HOLD_S = 0.6;
/** The counter closes this share of the gap each second (plus at least one step). */
const COUNT_RATE = 10;

export function stepRing(s: RingState, dtSeconds: number, input: RingInput): RingState {
  const dt = Math.max(0, Math.min(dtSeconds, 0.25));
  const busy = input.pending > 0;
  const count = approach(s.count, input.pending, dt);

  if (busy) {
    if (s.phase === 'idle' || s.phase === 'done') return { phase: 'busy', shown: 0.04, lap: 0, t: 0, count: Math.max(count, input.pending) };
    // New work arriving mid-finish keeps the lap; the ring just stops running out.
    const real = s.lap === 0 && input.peak > 0 ? (input.peak - input.pending) / input.peak : 0;
    const tau = TAU * (1 + s.lap);
    const trickled = s.shown + (CAP - s.shown) * (1 - Math.exp(-dt / tau));
    const shown = Math.min(1, Math.max(s.shown, trickled, Math.min(real, 0.99)));
    const t = s.t + dt;
    if (shown >= LAP_AT && t >= LAP_MIN_S && s.lap < MAX_LAP) return { phase: 'busy', shown: 0.02, lap: s.lap + 1, t: 0, count };
    return { phase: 'busy', shown, lap: s.lap, t, count };
  }

  if (s.phase === 'busy' || s.phase === 'finishing') {
    const shown = Math.min(1, s.shown + dt / FINISH_S);
    return shown >= 1 ? { ...s, phase: 'done', shown: 1, t: 0, count } : { ...s, phase: 'finishing', shown, count };
  }
  if (s.phase === 'done') {
    const t = s.t + dt;
    return t >= HOLD_S ? { ...IDLE } : { ...s, t, count };
  }
  return s.count === 0 ? s : { ...s, count };
}

function approach(from: number, to: number, dt: number): number {
  if (to >= from) return to;
  const step = Math.max(1, Math.ceil((from - to) * COUNT_RATE * dt));
  return Math.max(to, from - step);
}

/** Done fades out over the hold; everything else is fully drawn. */
export function ringOpacity(s: RingState): number {
  return s.phase === 'done' ? Math.max(0, 1 - s.t / HOLD_S) : s.phase === 'idle' ? 0 : 1;
}
