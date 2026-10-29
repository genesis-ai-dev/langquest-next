/**
 * A language a guest tapped on Explore, kept on this device while they sign
 * in: once they are in, Find your organization opens asking that language's
 * organization, so nobody has to find it again by name (UI audit, finding
 * 33). It is for this sign-in only: an hour, then it is let go, so the next
 * person on a shared phone is never sent to ask someone else's organization.
 */
export interface HeldAsk { orgId: string; languageName: string; heldAt: number }

export const ASK_HOLD_MS = 60 * 60_000;

/** The held ask from what was saved, or null when there is none, it is torn, or its hour is over. */
export function parseHeldAsk(raw: string | null | undefined, now: number): HeldAsk | null {
  if (!raw) return null;
  try {
    const ask = JSON.parse(raw) as Partial<HeldAsk> | null;
    if (!ask || typeof ask.orgId !== 'string' || !ask.orgId || typeof ask.languageName !== 'string' || typeof ask.heldAt !== 'number') return null;
    return now - ask.heldAt < ASK_HOLD_MS && ask.heldAt <= now ? { orgId: ask.orgId, languageName: ask.languageName, heldAt: ask.heldAt } : null;
  } catch {
    return null;
  }
}
