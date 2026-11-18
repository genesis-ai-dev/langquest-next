/**
 * The app lock (decisions.md 253): someone who turns it on in More settings
 * draws their own sign-in pattern (decision 168) each time the app opens.
 * Who has it on, and who the lock stands in front of. Pure, so the tests
 * run it as the phone does.
 */

/** The people on this phone who have it on, by profile id. A torn write reads as nobody. */
export function parsePeople(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    return Array.isArray(list) ? list.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];
  } catch {
    return [];
  }
}

export function withPerson(people: readonly string[], actorId: string, on: boolean): string[] {
  const rest = people.filter((id) => id !== actorId);
  return on ? [...rest, actorId] : rest;
}

/**
 * The lock as the app holds it: who has it on, whether it stands, and who is
 * signed in (`undefined` until the app has read who it is).
 */
export interface AppLockState {
  people: string[];
  locked: boolean;
  actorId: string | null | undefined;
}

/** A fresh start stands locked; only someone who has it on ever sees it. */
export function startState(people: string[]): AppLockState {
  return { people, locked: true, actorId: undefined };
}

/**
 * Someone else is now signed in. The first answer, as the app starts, keeps
 * the fresh start's lock. A change after that is a sign-in or a sign-out
 * that just happened (a password, a pattern, a code), which already asked
 * whoever it is, so it does not ask again.
 */
export function withActor(s: AppLockState, actorId: string | null): AppLockState {
  if (s.actorId === actorId) return s;
  return { ...s, actorId, locked: s.actorId === undefined ? s.locked : false };
}

/** Whether the lock shows now: it stands, and whoever is signed in has it on. */
export function showsLock(s: AppLockState): boolean {
  return s.locked && typeof s.actorId === 'string' && s.people.includes(s.actorId);
}
