import AsyncStorage from '@react-native-async-storage/async-storage';
import { SupabaseTransport, SyncScheduler, deliverQueued, ensureDeviceId, type EventStore } from '@langquest-next/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { accountOutbox, sendAs } from './accountData';
import { getBlobStore, type BlobStore } from './blobs';
import { UploadError, uploadBlob } from './blobTransport';
import type { Session } from '@supabase/supabase-js';
import { savedSession } from './authState';
import { afterAttempt, checkCode, codeText, parseHandOvers, withHandOver, withoutFinished, type HandOver, type Parked, type PendingUpload } from './handOverCore';
import { handOverPushToken } from './notifications';
import { noteExpected } from './report';
import { getStore } from './store';
import { SESSION_KEY, clientKeptAt, supabase } from './supabase';
import { onWake } from './wake';

/**
 * Shared phones (decisions.md 60): signing out with work still to send
 * hands that work to a courier, which sends it as its author the next time
 * the phone is online, whoever is signed in by then. A browser forgets
 * everything on sign-out instead (forgetBrowser.ts), so the web keeps the
 * old rule: sign out once it has synced.
 */
export const HANDS_OVER = Platform.OS !== 'web';

const LIST_KEY = 'hand-overs';
const sessionKeyFor = (actorId: string) => `hand-over-session:${actorId}`;

let writes: Promise<unknown> = Promise.resolve();
const added = new Set<() => void>();
const changed = new Set<() => void>();
function change(fn: (list: HandOver[]) => HandOver[]): Promise<void> {
  return locked(async () => {
    const list = fn(parseHandOvers(await AsyncStorage.getItem(LIST_KEY)));
    if (list.length > 0) await AsyncStorage.setItem(LIST_KEY, JSON.stringify(list));
    else await AsyncStorage.removeItem(LIST_KEY);
  });
}
/** One change to the hand-overs at a time; whoever is listening hears about it after. */
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const next = writes.then(fn);
  writes = next.catch(() => {});
  return next.finally(() => { for (const listener of changed) listener(); });
}
async function handOvers(): Promise<HandOver[]> {
  await writes;
  return parseHandOvers(await AsyncStorage.getItem(LIST_KEY));
}

/**
 * Sign out, leaving this person's unsent work to go as them. Their session
 * moves to its own key with no server call, so this works offline and the
 * session stays good for the courier; the app then shows the signed-out
 * screen as after any sign-out.
 */
export async function signOutHandingOver(actorId: string, uploads: PendingUpload[], parked?: Parked): Promise<void> {
  const pushToken = await handOverPushToken();
  await supabase.auth.stopAutoRefresh();
  try {
    const session = await AsyncStorage.getItem(SESSION_KEY);
    if (session) {
      await AsyncStorage.setItem(sessionKeyFor(actorId), session);
      await change((list) => withHandOver(list, { actorId, uploads, ...(pushToken ? { pushToken } : {}), savedAt: new Date().toISOString(), ...(parked ? { parked } : {}) }));
      await AsyncStorage.removeItem(SESSION_KEY);
    }
    // Nothing is stored now, so this asks the server nothing: it forgets
    // the session here and tells the app.
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) throw error;
  } finally {
    void supabase.auth.startAutoRefresh();
  }
  for (const listener of added) listener();
}

const kept = new Map<string, SupabaseClient>();
function keptClient(actorId: string): SupabaseClient {
  let client = kept.get(actorId);
  if (!client) {
    client = clientKeptAt(sessionKeyFor(actorId));
    kept.set(actorId, client);
  }
  return client;
}

/** Stop acting for this person. `endSession` signs the kept session out on the server too. */
async function forget(actorId: string, endSession: boolean): Promise<void> {
  sendAs(actorId, null);
  if (endSession) await keptClient(actorId).auth.signOut({ scope: 'local' }).catch(() => {});
  kept.delete(actorId);
  await AsyncStorage.removeItem(sessionKeyFor(actorId));
  await change((list) => list.filter((h) => h.actorId !== actorId));
}

/** One person's work, sent as them. Resolves to whether the server was out of reach. */
async function sendFor(h: HandOver, store: EventStore, deviceId: string, blobs: BlobStore): Promise<boolean> {
  const client = keptClient(h.actorId);
  const { data } = await client.auth.getSession();
  if (!data.session) {
    // supabase-js drops a session the server refused to renew; one it could
    // not renew for want of a network stays.
    if (await AsyncStorage.getItem(sessionKeyFor(h.actorId)) !== null) return true;
    await forget(h.actorId, false);
    return false;
  }
  sendAs(h.actorId, client);
  let offline = false;
  let eventsLeft = 0;
  try {
    eventsLeft = (await deliverQueued({ store, transport: new SupabaseTransport(client), actorId: h.actorId, deviceId })).left;
  } catch (e) {
    offline = true;
    eventsLeft = (await store.pendingStreamsBy(h.actorId)).length;
    noteExpected('hand-over events', e);
  }
  let unregistered = false;
  if (h.pushToken) {
    const { error } = await client.rpc('unregister_push_token', { p_token: h.pushToken });
    if (error) offline = true;
    else unregistered = true;
  }
  const outbox = accountOutbox(h.actorId);
  if (!await outbox.flush()) offline = true;
  const accountLeft = (await outbox.list()).filter((a) => a.status === 'queued').length;
  const finished: string[] = [];
  for (const u of h.uploads) {
    if (offline) break;
    // Still unconfirmed, so nothing evicts it; gone only if the app's data was cleared.
    if (!blobs.exists(u.ref)) { finished.push(u.ref.hash); continue; }
    try {
      await uploadBlob(u.orgId, u.languageId, u.ref, blobs, {}, client);
      finished.push(u.ref.hash);
    } catch (e) {
      // Refused (no longer a member of that language): the file stays on the phone.
      if (e instanceof UploadError && e.refused) finished.push(u.ref.hash);
      else offline = true;
      noteExpected('hand-over upload', e);
    }
  }
  const next = afterAttempt(h, { sessionGone: false, eventsLeft, accountLeft, finished, unregistered });
  if (next.kind === 'done') await forget(h.actorId, true);
  else if (next.kind === 'drop') await forget(h.actorId, false);
  // Read again: a sign-out since this began may have named more recordings.
  else await change((list) => list.map((x) => (x.actorId === h.actorId ? withoutFinished(x, finished, unregistered) : x)));
  return offline;
}

async function sendAll(signedInAs: string | null): Promise<{ offline: boolean }> {
  const list = await handOvers();
  if (list.length === 0) return { offline: false };
  const store = await getStore();
  const deviceId = await ensureDeviceId(store, () => Crypto.randomUUID());
  const blobs = await getBlobStore();
  let offline = false;
  for (const h of list) {
    // Back in as themselves: their own session sends it from here. A kept copy of the very
    // session they are using now (a switch back that stopped halfway) must not end it.
    if (h.actorId === signedInAs) { await forget(h.actorId, !await sameSession(sessionKeyFor(h.actorId), SESSION_KEY)); continue; }
    try {
      if (await sendFor(h, store, deviceId, blobs)) offline = true;
    } catch (e) {
      offline = true;
      noteExpected('hand-over', e);
    }
  }
  return { offline };
}

/**
 * Runs for the whole app, signed in or not: sends what people signed out
 * of this phone left unsent, as them. Tries when someone hands over, when
 * the app comes back to the screen, and on a slow poll that backs off while
 * the phone is offline.
 */
export function useHandOvers(signedInAs: string | null | undefined): void {
  useEffect(() => {
    if (!HANDS_OVER || signedInAs === undefined) return;
    const scheduler = new SyncScheduler({ run: () => sendAll(signedInAs), pollMs: 10 * 60_000 });
    const nudge = () => scheduler.nudge();
    added.add(nudge);
    const unwake = onWake(() => scheduler.wake());
    scheduler.start();
    return () => { added.delete(nudge); unwake(); scheduler.stop(); };
  }, [signedInAs]);
}

async function sameSession(a: string, b: string): Promise<boolean> {
  const [x, y] = [savedSession(await AsyncStorage.getItem(a)), savedSession(await AsyncStorage.getItem(b))];
  return !!x && !!y && x.refresh_token === y.refresh_token;
}

// ---- Switch person (decision 88) -------------------------------------------------------------

const codeKey = (actorId: string) => `switch-code:${actorId}`;

async function sha256(text: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, text);
}

/** Whether this person has a code on this phone to come back with. */
export async function hasSwitchCode(actorId: string): Promise<boolean> {
  return (await AsyncStorage.getItem(codeKey(actorId))) !== null;
}

/** Save the code this person will come back with; only its salted hash is kept, on this phone. */
export async function setSwitchCode(actorId: string, code: string): Promise<void> {
  const salt = Crypto.randomUUID();
  await AsyncStorage.setItem(codeKey(actorId), JSON.stringify({ salt, codeHash: await sha256(codeText(salt, actorId, code)) }));
}

/** Signing out takes the person off this phone, code and all. */
export async function forgetSwitchCode(actorId: string): Promise<void> {
  await AsyncStorage.removeItem(codeKey(actorId));
}

/**
 * Step aside on a shared phone: like signing out with work to hand over
 * (decision 60), but the session stays after the work has gone, for this
 * person to come back with their code. Works offline.
 */
export async function switchPerson(actorId: string, name: string, uploads: PendingUpload[]): Promise<void> {
  const raw = await AsyncStorage.getItem(codeKey(actorId));
  const saved = raw ? (JSON.parse(raw) as { salt: string; codeHash: string }) : null;
  if (!saved) throw new Error('No code to come back with.');
  await signOutHandingOver(actorId, uploads, { name, salt: saved.salt, codeHash: saved.codeHash, misses: 0 });
}

export interface ParkedPerson { actorId: string; name: string }

/** People who switched away on this phone and can come back with their code. */
export async function parkedPeople(): Promise<ParkedPerson[]> {
  const out: ParkedPerson[] = [];
  for (const h of await handOvers()) {
    if (h.parked && (await AsyncStorage.getItem(sessionKeyFor(h.actorId))) !== null) out.push({ actorId: h.actorId, name: h.parked.name });
  }
  return out;
}

/** The people the Sign In screen offers to come back, kept current as people switch. */
export function useParkedPeople(): ParkedPerson[] {
  const [people, setPeople] = useState<ParkedPerson[]>([]);
  useEffect(() => {
    if (!HANDS_OVER) return;
    let active = true;
    const read = () => { parkedPeople().then((p) => { if (active) setPeople(p); }, (e: unknown) => noteExpected('people on this phone', e)); };
    read();
    const off = onHandOversChanged(read);
    return () => { active = false; off(); };
  }, []);
  return people;
}

/** Hear when the hand-overs change, such as someone switching away or coming back. */
export function onHandOversChanged(listener: () => void): () => void {
  changed.add(listener);
  return () => { changed.delete(listener); };
}

const takenBack = new Set<(session: Session) => void>();
/** App hears here who came back with their code: supabase-js has no event for a session put back by hand. */
export function onTakenBack(listener: (session: Session) => void): () => void {
  takenBack.add(listener);
  return () => { takenBack.delete(listener); };
}

export type TakeBack = { kind: 'ok' } | { kind: 'wrong' } | { kind: 'wait'; ms: number } | { kind: 'gone' };

/**
 * Come back with your code: the session moves back where supabase-js keeps
 * it, with no server call, and App opens the app as you. Someone else must
 * have switched away or signed out first; the Sign In screen is the only
 * place that asks.
 */
export async function takeBack(actorId: string, code: string): Promise<TakeBack> {
  const result = await locked(async (): Promise<{ out: TakeBack; session?: Session }> => {
    const list = parseHandOvers(await AsyncStorage.getItem(LIST_KEY));
    const h = list.find((x) => x.actorId === actorId);
    if (!h?.parked) return { out: { kind: 'gone' } };
    const check = await checkCode(h.parked, actorId, code, sha256, Date.now());
    if (check.kind === 'wait') return { out: check };
    if (check.kind === 'wrong') {
      await AsyncStorage.setItem(LIST_KEY, JSON.stringify(list.map((x) => (x.actorId === actorId ? { ...x, parked: check.parked } : x))));
      return { out: { kind: 'wrong' } };
    }
    const raw = await AsyncStorage.getItem(sessionKeyFor(actorId));
    const session = savedSession(raw);
    const rest = list.filter((x) => x.actorId !== actorId);
    if (!raw || !session) {
      // The server ended it while they were away: they sign in again.
      await AsyncStorage.removeItem(sessionKeyFor(actorId));
      await setList(rest);
      return { out: { kind: 'gone' } };
    }
    if (await AsyncStorage.getItem(SESSION_KEY) !== null) throw new Error('Someone is signed in on this phone.');
    await AsyncStorage.setItem(SESSION_KEY, raw);
    await AsyncStorage.removeItem(sessionKeyFor(actorId));
    await setList(rest);
    return { out: { kind: 'ok' }, session };
  });
  if (result.session) {
    sendAs(actorId, null);
    kept.delete(actorId);
    for (const listener of takenBack) listener(result.session);
  }
  return result.out;
}

async function setList(list: HandOver[]): Promise<void> {
  if (list.length > 0) await AsyncStorage.setItem(LIST_KEY, JSON.stringify(list));
  else await AsyncStorage.removeItem(LIST_KEY);
}
