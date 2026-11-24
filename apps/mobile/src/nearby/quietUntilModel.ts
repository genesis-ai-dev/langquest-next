/**
 * Until when this phone shares with each teammate while LangQuest is open, as far as it knows
 * (docs/nearby-sync-plan.md 15.8, Carl 2026-11-24): a line under each teammate in Sync and
 * offline's Teammates fold, so a team out of reach for weeks knows when to meet on Share nearby
 * before the mode stops taking someone. Pure; the facts come from the store
 * (`quietFactsOf`, nearbyCarry.native.ts) and the words are the fold's.
 *
 * Each phone takes the other while that one's certificate was signed within the window, or while
 * it met them on Share nearby on a day that began within it (`nearbyMet`). One Hello notes the same
 * day on both sides, so a pair lasts until the later of the day met plus the window and the older
 * of the two certificates plus the window. A teammate's certificate is the one their newest
 * holdings entry carries, so it is at least that recent: the date is never later than the truth.
 * A person with several phones gets the latest; one this phone knows nothing of gets no date.
 */

const DAY_MS = 86_400_000;

/** From three days before, the line asks the two to meet on Share nearby. */
export const QUIET_SOON_MS = 3 * DAY_MS;

export interface QuietFacts {
  /** The mode's window (`NEARBY_OPEN_FRESH_MS`). */
  windowMs: number;
  /** When this phone's own certificate for the organization was signed. */
  mySignedAt: number | null;
  /** Teammates' certificates as their holdings entries carry them. */
  theirs: readonly { profileId: string; signedAt: number }[];
  /** `nearbyMet`: the day this phone last met each teammate on Share nearby. */
  met: readonly { profileId: string; day: number }[];
}

/** Person to the moment the mode stops taking them, where this phone knows anything. */
export function quietUntilOf(f: QuietFacts): Map<string, number> {
  const out = new Map<string, number>();
  const later = (profileId: string, at: number) => out.set(profileId, Math.max(out.get(profileId) ?? at, at));
  if (f.mySignedAt !== null) for (const c of f.theirs) later(c.profileId, Math.min(f.mySignedAt, c.signedAt) + f.windowMs);
  for (const m of f.met) later(m.profileId, m.day * DAY_MS + f.windowMs);
  return out;
}

export type QuietLine = { t: 'until'; at: number } | { t: 'soon'; at: number } | { t: 'lapsed' };

/** The fold's line for one teammate: until when, a nudge from three days before, or stopped. None where nothing is known. */
export function quietLineOf(untilMs: number | undefined, nowMs: number): QuietLine | null {
  if (untilMs === undefined) return null;
  if (untilMs <= nowMs) return { t: 'lapsed' };
  return untilMs - nowMs <= QUIET_SOON_MS ? { t: 'soon', at: untilMs } : { t: 'until', at: untilMs };
}

/** Shown only where the mode may run here (`notesMetOf`) and the language is offline, the one time it runs. */
export function quietLinesShown(o: { notesMet: boolean; offline: boolean }): boolean {
  return o.notesMet && o.offline;
}
