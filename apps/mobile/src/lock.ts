import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { savedSession } from './authState';
import {
  addressHash, afterMiss, newDataKey, openWrap, parseLocks, parseMisses, patternSecret, seal, unseal, waitLeft, withWrap,
  type Lock, type Random, type Sealed, type Wrap
} from './lockCore';
import { isPicture } from './lockPictures';
import { noteExpected } from './report';
import { SESSION_KEY, supabase } from './supabase';

/**
 * Signing out of a phone locks the person's sign-in on it, so they sign back
 * in with their password or a pattern, with no connection (decision 88;
 * lockCore.ts has the cryptography and what it guards against). Sign In
 * names nobody: each person with a pattern is a picture they chose, so a
 * phone that is taken shows how many signed out here, never who. A browser
 * forgets everything on sign-out instead (forgetBrowser.ts).
 */
export const LOCKS_ON_SIGN_OUT = Platform.OS !== 'web';

const LOCKS = 'locks';
const PHONE_SALT = 'lock-phone-salt';
const missesFor = (actorId: string) => `lock-misses:${actorId}`;
const RELEASE = 'push-release';
const keyFor = (actorId: string) => `lock-key:${actorId}`;
const sessionFor = (actorId: string) => `locked-session:${actorId}`;

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
  return parseLocks(await AsyncStorage.getItem(LOCKS));
}
async function writeLocks(list: Lock[]): Promise<void> {
  if (list.length > 0) await AsyncStorage.setItem(LOCKS, JSON.stringify(list));
  else await AsyncStorage.removeItem(LOCKS);
}
async function phoneSalt(): Promise<string> {
  const had = await AsyncStorage.getItem(PHONE_SALT);
  if (had) return had;
  const salt = newDataKey(random);
  await AsyncStorage.setItem(PHONE_SALT, salt);
  return salt;
}

/**
 * This person's data key, kept plain while they are signed in (their session
 * is plain then too). A new key makes their old wraps useless, so they go,
 * with any session sealed under the old key.
 */
async function dataKey(actorId: string): Promise<string> {
  const had = await AsyncStorage.getItem(keyFor(actorId));
  if (had) return had;
  const key = newDataKey(random);
  await AsyncStorage.setItem(keyFor(actorId), key);
  await AsyncStorage.removeItem(sessionFor(actorId));
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

/** After signing in or setting a password online: that password signs them back in here offline. */
export function rememberPassword(actorId: string, address: string, password: string): Promise<void> {
  if (!LOCKS_ON_SIGN_OUT) return Promise.resolve();
  return serial(() => addWrap(actorId, 'password', password, address)).catch((e: unknown) => noteExpected('remember password', e));
}

/** What this person can sign back in with on this phone. */
export async function lockKinds(actorId: string): Promise<Wrap['kind'][]> {
  await writes;
  // Wraps around an old key open nothing: only count them while the key they wrap is here.
  if (!await AsyncStorage.getItem(keyFor(actorId))) return [];
  return (await readLocks()).find((l) => l.actorId === actorId)?.wraps.map((w) => w.kind) ?? [];
}

export type PatternChoice = { kind: 'ok' } | { kind: 'pictureTaken' };

/**
 * Choose the picture and pattern this person signs back in with. Two people
 * on one phone never share a picture; they may share a pattern, since the
 * picture says whose lock to open.
 */
export function setLockPattern(actorId: string, dots: readonly number[], picture: number): Promise<PatternChoice> {
  return serial(async (): Promise<PatternChoice> => {
    if (!isPicture(picture) || (await readLocks()).some((l) => l.actorId !== actorId && l.picture === picture)) return { kind: 'pictureTaken' };
    await addWrap(actorId, 'pattern', patternSecret(dots));
    await writeLocks((await readLocks()).map((l) => (l.actorId === actorId ? { ...l, picture } : l)));
    return { kind: 'ok' };
  });
}

/** Pictures someone else on this phone already has, and this person's own, if any. */
export async function pictures(actorId: string): Promise<{ taken: number[]; mine: number | null }> {
  await writes;
  const list = await readLocks();
  const mine = list.find((l) => l.actorId === actorId)?.picture;
  return { taken: list.filter((l) => l.actorId !== actorId && isPicture(l.picture)).map((l) => l.picture!), mine: isPicture(mine) ? mine : null };
}

/**
 * Sign out of this phone, locked, asking the server nothing. The session is
 * sealed with the person's data key; only their password or pattern opens it
 * again. Their unsent work stays queued for when they sign back in.
 */
export async function lockAndSignOut(actorId: string, pushToken: string | null): Promise<void> {
  await supabase.auth.stopAutoRefresh();
  try {
    await serial(async () => {
      const lock = (await readLocks()).find((l) => l.actorId === actorId);
      const key = await AsyncStorage.getItem(keyFor(actorId));
      if (!lock?.wraps.length || !key) throw new Error('No password or pattern to lock with.');
      const raw = await AsyncStorage.getItem(SESSION_KEY);
      if (raw) await AsyncStorage.setItem(sessionFor(actorId), JSON.stringify(seal(key, raw, random)));
      await AsyncStorage.removeItem(keyFor(actorId));
      await AsyncStorage.removeItem(SESSION_KEY);
      // Their notifications stop when the phone is next online (releasePushTokens).
      if (pushToken) await AsyncStorage.setItem(RELEASE, JSON.stringify([...parseRelease(await AsyncStorage.getItem(RELEASE)).filter((r) => r.token !== pushToken), { token: pushToken, actorId }]));
    });
    // Nothing stored now: forgets the session in memory and tells the app, with no server call.
    await supabase.auth.signOut({ scope: 'local' });
  } finally {
    void supabase.auth.startAutoRefresh();
  }
}

export type Unlock = { kind: 'ok' } | { kind: 'none' } | { kind: 'wrong' } | { kind: 'wait'; ms: number };

const unlocked = new Set<(session: Session) => void>();
/** App hears here who signed back in from a lock: supabase-js has no event for a session put back by hand. */
export function onUnlocked(listener: (session: Session) => void): () => void {
  unlocked.add(listener);
  return () => { unlocked.delete(listener); };
}

/**
 * Sign back in from a lock: with a password (and the address typed with it),
 * or with the pattern of the person whose picture was tapped. `none` means no
 * lock on this phone fits, so the caller asks the server instead. Wrong
 * guesses count for that person's lock.
 */
export async function unlock(kind: Wrap['kind'], secret: string, who: { address?: string; actorId?: string }): Promise<Unlock> {
  const result = await serial(async (): Promise<{ out: Unlock; session?: Session }> => {
    const hashed = who.address ? addressHash(await phoneSalt(), who.address) : null;
    const lock = (await readLocks()).find((l) => l.wraps.some((w) => w.kind === kind)
      && (kind === 'pattern' ? l.actorId === who.actorId : !!l.address && l.address === hashed));
    if (!lock) return { out: { kind: 'none' } };
    const misses = parseMisses(await AsyncStorage.getItem(missesFor(lock.actorId)));
    const ms = waitLeft(misses, Date.now());
    if (ms > 0) return { out: { kind: 'wait', ms } };
    if (await AsyncStorage.getItem(SESSION_KEY) !== null) throw new Error('Someone is signed in on this phone.');
    const key = await openWrap(lock, kind, secret);
    const sealedRaw = key ? await AsyncStorage.getItem(sessionFor(lock.actorId)) : null;
    const raw = key && sealedRaw ? unseal(key, JSON.parse(sealedRaw) as Sealed) : null;
    const session = savedSession(raw);
    if (!key) {
      await AsyncStorage.setItem(missesFor(lock.actorId), JSON.stringify(afterMiss(misses, Date.now())));
      return { out: { kind: 'wrong' } };
    }
    // The key opened but nothing is sealed (signed in elsewhere since): nothing to come back to here.
    if (!raw || !session) return { out: { kind: 'none' } };
    await AsyncStorage.setItem(SESSION_KEY, raw);
    await AsyncStorage.setItem(keyFor(lock.actorId), key);
    await AsyncStorage.removeItem(sessionFor(lock.actorId));
    await AsyncStorage.removeItem(missesFor(lock.actorId));
    await keepPushToken(lock.actorId);
    return { out: { kind: 'ok' }, session };
  });
  if (result.session) for (const listener of unlocked) listener(result.session);
  return result.out;
}

/** People signed out of this phone who can come back with a pattern, as the pictures they chose. Sign In shows these. */
export async function patternPeople(): Promise<{ actorId: string; picture: number }[]> {
  await writes;
  const out: { actorId: string; picture: number }[] = [];
  for (const l of await readLocks()) {
    if (isPicture(l.picture) && l.wraps.some((w) => w.kind === 'pattern') && await AsyncStorage.getItem(sessionFor(l.actorId)) !== null) {
      out.push({ actorId: l.actorId, picture: l.picture });
    }
  }
  return out.sort((a, b) => a.picture - b.picture);
}

export function usePatternPeople(): { actorId: string; picture: number }[] {
  const [people, setPeople] = useState<{ actorId: string; picture: number }[]>([]);
  useEffect(() => {
    if (!LOCKS_ON_SIGN_OUT) return;
    let active = true;
    const read = () => { patternPeople().then((p) => { if (active) setPeople(p); }, (e: unknown) => noteExpected('pattern locks', e)); };
    read();
    changed.add(read);
    return () => { active = false; changed.delete(read); };
  }, []);
  return people;
}

/** Signing out for good (account deletion): nothing of this person's lock stays. */
export function forgetLock(actorId: string): Promise<void> {
  return serial(async () => {
    await AsyncStorage.multiRemove([keyFor(actorId), sessionFor(actorId), missesFor(actorId)]);
    await writeLocks((await readLocks()).filter((l) => l.actorId !== actorId));
  });
}

// ---- notifications of people signed out offline -------------------------------------------

interface Release { token: string; actorId: string }
function parseRelease(raw: string | null): Release[] {
  try {
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((r): r is Release => typeof r?.token === 'string' && typeof r?.actorId === 'string') : [];
  } catch {
    return [];
  }
}

/** Back in before the phone was online: their notifications were never stopped, so keep them. */
async function keepPushToken(actorId: string): Promise<void> {
  const list = parseRelease(await AsyncStorage.getItem(RELEASE));
  const mine = list.find((r) => r.actorId === actorId);
  if (!mine) return;
  await AsyncStorage.setItem('push-token', mine.token);
  const rest = list.filter((r) => r.actorId !== actorId);
  if (rest.length > 0) await AsyncStorage.setItem(RELEASE, JSON.stringify(rest));
  else await AsyncStorage.removeItem(RELEASE);
}

/**
 * Stop notifications to this phone for people who signed out offline. Their
 * sign-in is locked, so this asks as nobody: holding the device's token and
 * the person's id is enough to detach that one device (release_push_token).
 * Resolves to whether the server was out of reach.
 */
export async function releasePushTokens(): Promise<{ offline: boolean }> {
  const list = parseRelease(await AsyncStorage.getItem(RELEASE));
  if (list.length === 0) return { offline: false };
  let offline = false;
  const left: Release[] = [];
  for (const r of list) {
    const { error } = await supabase.rpc('release_push_token', { p_token: r.token, p_profile: r.actorId });
    if (error) { offline = true; left.push(r); }
  }
  await serial(async () => {
    // Keep entries added meanwhile; drop the ones released now.
    const now = parseRelease(await AsyncStorage.getItem(RELEASE)).filter((r) => left.some((l) => l.token === r.token && l.actorId === r.actorId) || !list.some((l) => l.token === r.token && l.actorId === r.actorId));
    if (now.length > 0) await AsyncStorage.setItem(RELEASE, JSON.stringify(now));
    else await AsyncStorage.removeItem(RELEASE);
  });
  return { offline };
}
