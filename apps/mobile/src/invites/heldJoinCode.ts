import type { JoinCode } from './inviteCode';

/**
 * The Let someone in code a newcomer last scanned (docs/nearby-sync-plan.md 14.1, 3), held for
 * the screen that joins the inviter's group and asks to be let in. In memory only: a code nobody
 * used dies at two minutes on the inviter's phone, and its secret is no use to keep. Taken once,
 * so one scan starts one join.
 */
let held: { code: JoinCode; at: number } | null = null;
const listeners = new Set<() => void>();

export function holdJoinCode(code: JoinCode, now = Date.now()): void {
  held = { code, at: now };
  for (const listener of listeners) listener();
}

/** The code held and when it was scanned, without taking it. */
export function heldJoinCode(): { code: JoinCode; at: number } | null {
  return held;
}

/** The code held, taken: the next call answers null until another is scanned. */
export function takeJoinCode(): { code: JoinCode; at: number } | null {
  const out = held;
  held = null;
  return out;
}

/** Be told when a code is scanned. Returns the unsubscribe. */
export function onJoinCode(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
