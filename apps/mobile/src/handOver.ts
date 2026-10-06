import AsyncStorage from '@react-native-async-storage/async-storage';
import { SupabaseTransport, SyncScheduler, deliverQueued, ensureDeviceId, type EventStore } from '@langquest-next/client';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { accountOutbox, sendAs } from './accountData';
import { getBlobStore, type BlobStore } from './blobs';
import { UploadError, uploadBlob } from './blobTransport';
import { afterAttempt, parseHandOvers, withHandOver, withoutFinished, type HandOver, type PendingUpload } from './handOverCore';
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
function change(fn: (list: HandOver[]) => HandOver[]): Promise<void> {
  const next = writes.then(async () => {
    const list = fn(parseHandOvers(await AsyncStorage.getItem(LIST_KEY)));
    if (list.length > 0) await AsyncStorage.setItem(LIST_KEY, JSON.stringify(list));
    else await AsyncStorage.removeItem(LIST_KEY);
  });
  writes = next.catch(() => {});
  return next;
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
export async function signOutHandingOver(actorId: string, uploads: PendingUpload[]): Promise<void> {
  const pushToken = await handOverPushToken();
  await supabase.auth.stopAutoRefresh();
  try {
    const session = await AsyncStorage.getItem(SESSION_KEY);
    if (session) {
      await AsyncStorage.setItem(sessionKeyFor(actorId), session);
      await change((list) => withHandOver(list, { actorId, uploads, ...(pushToken ? { pushToken } : {}), savedAt: new Date().toISOString() }));
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
    eventsLeft = (await store.pendingPartitionsBy(h.actorId)).length;
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
      await uploadBlob(u.orgId, u.partitionId, u.ref, blobs, {}, client);
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
    // Back in as themselves: their own session sends it from here.
    if (h.actorId === signedInAs) { await forget(h.actorId, true); continue; }
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
