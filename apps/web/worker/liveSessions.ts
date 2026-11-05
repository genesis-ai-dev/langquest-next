/**
 * Whether a token's session is still live. A verified access token stays
 * valid until it expires (an hour), even after its session was signed out:
 * "sign out my other phones" after a phone is lost (sign-in-code), or a
 * person deleted. So the Worker also asks whether the session is still
 * there, remembering the answer a short while per isolate so a phone's run
 * of blob requests asks once.
 *
 * When the question cannot be answered (the database is unreachable), the
 * token stands as verified: a hiccup must not sign everyone out.
 */
export function liveSessions(isLive: (sessionId: string) => Promise<boolean>, ttlMs = 30_000, now = () => Date.now()) {
  const known = new Map<string, { live: boolean; at: number }>();
  return async (sessionId: string): Promise<boolean> => {
    const hit = known.get(sessionId);
    if (hit && now() - hit.at < ttlMs) return hit.live;
    let live: boolean;
    try {
      live = await isLive(sessionId);
    } catch (e) {
      console.error('session check:', e);
      return true;
    }
    if (known.size > 10_000) known.clear();
    known.set(sessionId, { live, at: now() });
    return live;
  };
}
