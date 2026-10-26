/**
 * Whether the server is answering, from what this device last heard
 * (decisions.md 166). The operating system's "connected" is not proof: a VPN
 * with no internet behind it, a hotspot's sign-in page or a SIM out of data
 * all leave it saying so. So the app counts what the server itself said:
 * a sync it answered, the live channel's heartbeat, or a check of its own
 * when neither has spoken for a while. The newest of these wins.
 */

/** Ask the server when it has said nothing for this long. */
export const CHECK_AFTER_MS = 20_000;
/** How long the server has to answer a check before the app says "Offline". */
export const CHECK_TIMEOUT_MS = 8_000;

export interface Reach {
  /** When the server last answered anything. */
  heardAt: number | null;
  /** When a check that went unanswered was asked, while nothing has answered since; null otherwise. */
  missedAt: number | null;
  /** When the last check ended, answered or not. */
  checkedAt: number | null;
}

export const NOTHING_HEARD: Reach = { heardAt: null, missedAt: null, checkedAt: null };

/** The server answered at `at`. An answer newer than an unanswered check clears it. */
export function heard(r: Reach, at: number): Reach {
  if (r.heardAt !== null && at <= r.heardAt) return r;
  return { ...r, heardAt: at, missedAt: r.missedAt !== null && at > r.missedAt ? null : r.missedAt };
}

/**
 * A check asked at `askedAt` ended at `endedAt`, answered or not. An
 * unanswered one counts only when nothing answered after it was asked:
 * the heartbeat or a sync that got through meanwhile is the newer word.
 */
export function checked(r: Reach, askedAt: number, endedAt: number, answered: boolean): Reach {
  if (answered) return { ...heard(r, endedAt), checkedAt: endedAt };
  const newerAnswer = r.heardAt !== null && r.heardAt > askedAt;
  return { ...r, checkedAt: endedAt, missedAt: newerAnswer ? r.missedAt : askedAt };
}

/** The server went quiet: a check went unanswered and nothing has answered since. */
export function isQuiet(r: Reach): boolean {
  return r.missedAt !== null;
}

/** When the next check is due: CHECK_AFTER_MS after the server last spoke or was last asked. Now when neither has happened. */
export function nextCheckAt(r: Reach): number {
  const last = Math.max(r.heardAt ?? -Infinity, r.checkedAt ?? -Infinity);
  return last === -Infinity ? 0 : last + CHECK_AFTER_MS;
}

/**
 * What screens are told. Offline at once when the operating system says
 * there is no network, or when the server stopped answering checks;
 * otherwise what the last sync found (null before the first).
 */
export function onlineNow(o: { osOffline: boolean; quiet: boolean; synced: boolean | null }): boolean | null {
  return o.osOffline || o.quiet ? false : o.synced;
}
