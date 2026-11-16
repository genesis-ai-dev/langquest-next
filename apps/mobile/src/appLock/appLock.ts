import Storage from 'expo-sqlite/kv-store';
import { Keyboard } from 'react-native';
import { noteExpected } from '../diagnostics/report';
import { checkPattern, lockAndSignOut, lockPictures, lockWays, setLockPattern, type Checked, type PatternChoice } from '../server/lock';
import { parsePeople, showsLock, startState, withActor, withPerson, type AppLockState } from './appLockModel';

/**
 * The app lock (decisions.md 200), as this phone holds it. Who has it on is
 * kept in the app's key-value store and read at once as the app starts, so
 * the lock stands before one frame of their work shows; the pattern is the
 * person's sign-in lock (server/lock.ts), so nothing new is kept and
 * nothing is sent. Phones only: the web takes AppLockGate.web.tsx and
 * AppLockRow.web.tsx, which import none of this.
 */

const PEOPLE_KEY = 'app-lock-people';

function readPeople(): string[] {
  try { return parsePeople(Storage.getItemSync(PEOPLE_KEY)); } catch { return []; }
}

let state: AppLockState = startState(readPeople());
const listeners = new Set<() => void>();
function set(next: AppLockState) {
  if (next === state) return;
  state = next;
  for (const l of listeners) l();
}

export function appLockState(): AppLockState {
  return state;
}

export function onAppLockChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Who is signed in now (null: nobody), as App reads it. */
export function setActor(actorId: string | null): void {
  set(withActor(state, actorId));
  if (actorId && state.people.includes(actorId)) void dropWithoutPattern(actorId);
}

/**
 * Their pattern went (they came back by a helper's code, and the key it
 * wrapped is gone): nothing could open the lock, so it is off. More
 * settings offers it again, with a new pattern.
 */
async function dropWithoutPattern(actorId: string): Promise<void> {
  try {
    if (!(await lockWays(actorId)).includes('pattern')) setOn(actorId, false);
  } catch (e) {
    noteExpected('app lock: ways', e);
  }
}

/**
 * The app went to the background: the lock stands at once, so the phone's
 * list of open apps shows it too, and coming back asks, however short the
 * time away (a share sheet and a permission prompt count, as decision 171's
 * disguise has it; Caleb, 2026-11-16).
 */
export function leftApp(): void {
  if (state.locked) return;
  set({ ...state, locked: true });
  if (showsLock(state)) Keyboard.dismiss();
}

/** On or off for this person; on takes effect the next time the app opens. */
export function setOn(actorId: string, on: boolean): void {
  const people = withPerson(state.people, actorId, on);
  if (people.length > 0) Storage.setItemSync(PEOPLE_KEY, JSON.stringify(people));
  else Storage.removeItemSync(PEOPLE_KEY);
  set({ ...state, people, locked: false });
}

/** Try a pattern on the signed-in person's lock; the right one lifts it. */
export async function tryPattern(dots: readonly number[]): Promise<Checked> {
  const actorId = state.actorId;
  if (!actorId) return { kind: 'none' };
  const result = await checkPattern(actorId, dots);
  if (result.kind === 'ok' && state.actorId === actorId) set({ ...state, locked: false });
  return result;
}

/** The picture this person finds themselves by on Sign In; the lock shows it over the dots. */
export async function ownPicture(actorId: string): Promise<number | null> {
  return (await lockPictures(actorId)).mine;
}

/** Their own pattern, drawn in More settings to turn the lock on or off. */
export function checkOwnPattern(actorId: string, dots: readonly number[]): Promise<Checked> {
  return checkPattern(actorId, dots);
}

/** A first pattern and picture, for someone who had none: Sign In takes them too (decision 168). */
export function choosePattern(actorId: string, dots: readonly number[], picture: number): Promise<PatternChoice> {
  return setLockPattern(actorId, dots, picture);
}

type SignOut = () => Promise<void>;
let signOutHere: SignOut | null = null;

/**
 * How Sign Out leaves this phone, from the open organization (it hands over
 * unsent work, decision 60). Until one is open, Forgot? locks the sign-in
 * and signs out with nothing handed over; the work stays for their return.
 */
export function setSignOutForLock(signOut: SignOut | null): void {
  signOutHere = signOut;
}

/** Forgot? signs out; Sign In then takes a password, or a helper's code online (decision 168). */
export async function signOutFromLock(): Promise<void> {
  const actorId = state.actorId;
  if (!actorId) return;
  await (signOutHere ?? (() => lockAndSignOut(actorId)))();
}
