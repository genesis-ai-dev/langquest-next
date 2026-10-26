import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { savedSession } from '../auth/authState';
import {
  addressHash, afterMiss, isPicture, lockFor, newDataKey, openWrap, parseLocks, parseMisses, patternSecret, seal, takenPictures, unseal,
  waitLeft, withWrap, type Lock, type Random, type Wrap
} from '../auth/lockModel';
import { signingOutByChoice } from '../auth/signOutCause';
import { noteExpected } from '../diagnostics/report';
import { secureStorage } from './secureStorage';
import { SESSION_KEY, supabase } from './supabase';

/**
 * Signing out of a phone locks the person's sign-in on it, so they sign back
 * in with their password or a pattern, with no connection (decisions.md 167;
 * lockModel.ts has the cryptography and what it guards against). Sign In
 * names nobody: each person with a pattern is a picture they chose, so a
 * phone that is taken shows how many signed out here, never who. A browser
 * forgets everything on sign-out instead (forgetBrowser.ts).
 *
 * The locks, each person's data key and their sealed session live in the
 * Keychain or Keystore with the session itself (secureStorage.ts); only the
 * count of wrong guesses and the phone's salt are plain.
 */
export const LOCKS_ON_SIGN_OUT = Platform.OS !== 'web';

const LOCKS = 'locks';
const PHONE_SALT = 'lock-phone-salt';
const keyFor = (actorId: string) => `lock-key:${actorId}`;
const sessionFor = (actorId: string) => `locked-session:${actorId}`;
const missesFor = (actorId: string) => `lock-misses:${actorId}`;

const random: Random = (n) => Crypto.getRandomBytes(n);

let writes: Promise<unknown> = Promise.resolve();
const changed = new Set<() => void>();
/** One change to the locks at a time; listeners hear about it after. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = writes.then(fn);
  writes = next.catch(() => {});
  return next.finally(() => { for (const l of changed) l(); });
}
async function readLocks(): Promise<Lock[]> {
  return parseLocks(await secureStorage.getItem(LOCKS));
}
async function writeLocks(list: Lock[]): Promise<void> {
  if (list.length > 0) await secureStorage.setItem(LOCKS, JSON.stringify(list));
  else await secureStorage.removeItem(LOCKS);
}
async function phoneSalt(): Promise<string> {
  const had = await AsyncStorage.getItem(PHONE_SALT);
  if (had) return had;
  const salt = newDataKey(random);
  await AsyncStorage.setItem(PHONE_SALT, salt);
  return salt;
}

/** Be told when anyone's lock changes. Returns the unsubscribe. */
export function onLocksChanged(listener: () => void): () => void {
  changed.add(listener);
  return () => { changed.delete(listener); };
}

/**
 * This person's data key, kept in the clear (in the Keychain or Keystore)
 * while they are signed in, as their session is. A new key makes their old
 * wraps and anything sealed under the old key useless, so those go.
 */
async function dataKey(actorId: string): Promise<string> {
  const had = await secureStorage.getItem(keyFor(actorId));
  if (had) return had;
  const key = newDataKey(random);
  await secureStorage.setItem(keyFor(actorId), key);
  await secureStorage.removeItem(sessionFor(actorId));
  await writeLocks((await readLocks()).map((l) => (l.actorId === actorId ? { ...l, wraps: [] } : l)));
  return key;
}

async function addWrap(actorId: string, kind: Wrap['kind'], secret: string, address?: string): Promise<void> {
  const key = await dataKey(actorId);
  const list = await readLocks();
  const lock = list.find((l) => l.actorId === actorId) ?? { actorId, wraps: [] };
  const next = await withWrap({ ...lock, ...(address ? { address: addressHash(await phoneSalt(), address) } : {}) }, kind, secret, key, random);
  await writeLocks([...list.filter((l) => l.actorId !== actorId), next]);
}

/**
 * After signing in or setting a password online: that password signs them
 * back in here offline. The same password as before opens the key they had,
 * so a pattern they chose with it still works.
 */
export function rememberPassword(actorId: string, address: string, password: string): Promise<void> {
  if (!LOCKS_ON_SIGN_OUT) return Promise.resolve();
  return serial(async () => {
    if (!await secureStorage.getItem(keyFor(actorId))) {
      const lock = (await readLocks()).find((l) => l.actorId === actorId);
      const before = lock ? await openWrap(lock, 'password', password) : null;
      if (before) await secureStorage.setItem(keyFor(actorId), before);
    }
    await addWrap(actorId, 'password', password, address);
  }).catch((e: unknown) => noteExpected('remember password', e));
}

/**
 * Signed in on this phone by any way but the lock (a password, a code, an
 * invite): a session sealed for them earlier is not theirs to come back to
 * any more, so it goes. Their key and wraps stay.
 */
export function signedInHere(actorId: string): Promise<void> {
  if (!LOCKS_ON_SIGN_OUT) return Promise.resolve();
  return serial(async () => {
    if (await secureStorage.getItem(sessionFor(actorId)) !== null) await secureStorage.removeItem(sessionFor(actorId));
  }).catch((e: unknown) => noteExpected('lock: signed in', e));
}

/** What this person can sign back in with on this phone; empty when they must choose a pattern first. */
export async function lockWays(actorId: string): Promise<Wrap['kind'][]> {
  if (!LOCKS_ON_SIGN_OUT) return [];
  await writes;
  // Wraps around an old key open nothing: they count only while the key they wrap is here.
  if (!await secureStorage.getItem(keyFor(actorId))) return [];
  return (await readLocks()).find((l) => l.actorId === actorId)?.wraps.map((w) => w.kind) ?? [];
}

/** Pictures someone else on this phone already has, and this person's own, if any. */
export async function lockPictures(actorId: string): Promise<{ taken: number[]; mine: number | null }> {
  await writes;
  const list = await readLocks();
  const mine = list.find((l) => l.actorId === actorId)?.picture;
  return { taken: takenPictures(list, actorId), mine: isPicture(mine) ? mine : null };
}

export type PatternChoice = { kind: 'ok' } | { kind: 'pictureTaken' };

/**
 * Choose the picture and pattern this person signs back in with. Two people
 * on one phone never share a picture; they may share a pattern, since the
 * picture says whose lock to open.
 */
export function setLockPattern(actorId: string, dots: readonly number[], picture: number): Promise<PatternChoice> {
  return serial(async (): Promise<PatternChoice> => {
    if (!isPicture(picture) || takenPictures(await readLocks(), actorId).includes(picture)) return { kind: 'pictureTaken' };
    await addWrap(actorId, 'pattern', patternSecret(dots));
    await writeLocks((await readLocks()).map((l) => (l.actorId === actorId ? { ...l, picture } : l)));
    return { kind: 'ok' };
  });
}

/** Seal a session under the person's key; throws when they have nothing to come back with. */
async function sealUnderKey(actorId: string, raw: string): Promise<void> {
  const key = await secureStorage.getItem(keyFor(actorId));
  const lock = (await readLocks()).find((l) => l.actorId === actorId);
  if (!key || !lock?.wraps.length) throw new Error('No password or pattern to lock with.');
  await secureStorage.setItem(sessionFor(actorId), JSON.stringify(seal(key, raw, random)));
}

/**
 * Sign out of this phone, locked, asking the server nothing: the session is
 * sealed with the person's key and only their password or pattern opens it
 * again. Nothing queued goes anywhere; it is still here when they are back.
 */
export function lockAndSignOut(actorId: string): Promise<void> {
  return signingOutByChoice(async () => {
    await supabase.auth.stopAutoRefresh();
    try {
      await serial(async () => {
        const raw = await secureStorage.getItem(SESSION_KEY);
        if (raw) await sealUnderKey(actorId, raw);
        await secureStorage.removeItem(keyFor(actorId));
        await secureStorage.removeItem(SESSION_KEY);
      });
      // Nothing stored now: this forgets the session in memory and tells the app, with no server call.
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
    } finally {
      void supabase.auth.startAutoRefresh();
    }
  });
}

/**
 * The session a hand-over keeps for the courier (decisions.md 60) is sealed
 * too, so its owner can come back with it. The key stays in the clear while
 * the courier holds the session in the clear anyway; when the courier is
 * done, `keepLockedAfterHandOver` seals its last copy and drops the key.
 */
export function sealHandedOver(actorId: string, raw: string): Promise<void> {
  if (!LOCKS_ON_SIGN_OUT) return Promise.resolve();
  return serial(async () => {
    // Sign Out asks for a way back first; without one the hand-over goes on as before.
    if (await secureStorage.getItem(keyFor(actorId)) === null) return;
    await sealUnderKey(actorId, raw);
  });
}

/**
 * The courier sent everything (decisions.md 60). With a lock here the
 * session stays good, sealed in its latest form, so its owner can still
 * come back to this phone offline; without one, the caller ends it.
 */
export function keepLockedAfterHandOver(actorId: string, raw: string | null): Promise<boolean> {
  if (!LOCKS_ON_SIGN_OUT) return Promise.resolve(false);
  return serial(async () => {
    if (!raw || await secureStorage.getItem(sessionFor(actorId)) === null) return false;
    await sealUnderKey(actorId, raw);
    await secureStorage.removeItem(keyFor(actorId));
    return true;
  }).catch((e: unknown) => { noteExpected('lock: hand-over done', e); return false; });
}

/** The server ended the session a hand-over kept: no lock can bring it back, so the lock's copy goes with it. */
export function dropLockedSession(actorId: string): Promise<void> {
  if (!LOCKS_ON_SIGN_OUT) return Promise.resolve();
  return serial(async () => {
    await secureStorage.removeItem(sessionFor(actorId));
    await secureStorage.removeItem(keyFor(actorId));
  }).catch((e: unknown) => noteExpected('lock: session gone', e));
}

export type Opened = { kind: 'ok'; actorId: string; key: string } | { kind: 'none' } | { kind: 'wrong' } | { kind: 'wait'; ms: number };

/**
 * Try a password (with the address typed beside it) or the pattern of the
 * person whose picture was tapped. `none`: no lock here fits, or nothing is
 * sealed to come back to, so the caller asks the server instead. Wrong
 * guesses count for that person's lock alone.
 */
export function openLock(kind: Wrap['kind'], secret: string, who: { address?: string; actorId?: string }): Promise<Opened> {
  if (!LOCKS_ON_SIGN_OUT) return Promise.resolve({ kind: 'none' });
  return serial(async (): Promise<Opened> => {
    const hashed = who.address ? addressHash(await phoneSalt(), who.address) : null;
    const lock = lockFor(await readLocks(), kind, { ...(who.actorId ? { actorId: who.actorId } : {}), addressHash: hashed });
    if (!lock || await secureStorage.getItem(sessionFor(lock.actorId)) === null) return { kind: 'none' };
    const misses = parseMisses(await AsyncStorage.getItem(missesFor(lock.actorId)));
    const ms = waitLeft(misses, Date.now());
    if (ms > 0) return { kind: 'wait', ms };
    const key = await openWrap(lock, kind, secret);
    if (!key) {
      await AsyncStorage.setItem(missesFor(lock.actorId), JSON.stringify(afterMiss(misses, Date.now())));
      return { kind: 'wrong' };
    }
    return { kind: 'ok', actorId: lock.actorId, key };
  });
}

const unlocked = new Set<(session: Session) => void>();
/** App hears here who signed back in from a lock: supabase-js has no event for a session put back by hand. */
export function onUnlocked(listener: (session: Session) => void): () => void {
  unlocked.add(listener);
  return () => { unlocked.delete(listener); };
}

/**
 * Put the person's session back where supabase-js keeps it: `kept`, the
 * hand-over's copy when the courier still held one (it is the newest), else
 * the one sealed at sign-out. Answers whether there was one to put back.
 */
export async function restoreSession(actorId: string, key: string, kept: string | null): Promise<boolean> {
  const session = await serial(async () => {
    if (await secureStorage.getItem(SESSION_KEY) !== null) throw new Error('Someone is signed in on this phone.');
    const raw = savedSession(kept) ? kept : unseal(key, await secureStorage.getItem(sessionFor(actorId)));
    const back = savedSession(raw);
    if (!raw || !back) return null;
    await secureStorage.setItem(SESSION_KEY, raw);
    await secureStorage.setItem(keyFor(actorId), key);
    await secureStorage.removeItem(sessionFor(actorId));
    await AsyncStorage.removeItem(missesFor(actorId));
    return back;
  });
  if (!session) return false;
  for (const listener of unlocked) listener(session);
  return true;
}

/** People signed out of this phone who can come back with a pattern, as the pictures they chose. Sign In shows these. */
export async function patternPeople(): Promise<{ actorId: string; picture: number }[]> {
  if (!LOCKS_ON_SIGN_OUT) return [];
  await writes;
  const out: { actorId: string; picture: number }[] = [];
  for (const l of await readLocks()) {
    if (isPicture(l.picture) && l.wraps.some((w) => w.kind === 'pattern') && await secureStorage.getItem(sessionFor(l.actorId)) !== null) {
      out.push({ actorId: l.actorId, picture: l.picture });
    }
  }
  return out.sort((a, b) => a.picture - b.picture);
}

/** Deleting the account: nothing of this person's lock stays. */
export function forgetLock(actorId: string): Promise<void> {
  if (!LOCKS_ON_SIGN_OUT) return Promise.resolve();
  return serial(async () => {
    await secureStorage.removeItem(keyFor(actorId));
    await secureStorage.removeItem(sessionFor(actorId));
    await AsyncStorage.removeItem(missesFor(actorId));
    await writeLocks((await readLocks()).filter((l) => l.actorId !== actorId));
  });
}
