import AsyncStorage from '@react-native-async-storage/async-storage';
import { afterAttempt, deliverHandOver, ensureDeviceId, parseHandOvers, withHandOver, withoutFinished, type EventStore, type HandOver, type PendingUpload } from '@langquest-next/sync';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { accountOutbox } from '../account/accountData';
import { getBlobStore, type BlobStore } from './blobs';
import { handOverPushToken } from '../notifications/notifications';
import { noteExpected } from '../diagnostics/report';
import { getStore } from './store';
import { actAs, forgetKeptSession, keepSessionAndSignOut, keptSession } from '../server/handOver';
export { useHandOvers } from './useHandOvers';

/**
 * Shared phones (decisions.md 60): signing out with work still to send
 * hands that work to a courier, which sends it as its author the next time
 * the phone is online, whoever is signed in by then. A browser forgets
 * everything on sign-out instead (forgetBrowser.ts), so the web keeps the
 * old rule: sign out once it has synced.
 */
export const HANDS_OVER = Platform.OS !== 'web';

const LIST_KEY = 'hand-overs';

let writes: Promise<unknown> = Promise.resolve();
export const added = new Set<() => void>();
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
  await keepSessionAndSignOut(actorId, () =>
    change((list) => withHandOver(list, { actorId, uploads, ...(pushToken ? { pushToken } : {}), savedAt: new Date().toISOString() })));
  for (const listener of added) listener();
}

/** Stop acting for this person. `endSession` signs the kept session out on the server too. */
async function forget(actorId: string, endSession: boolean): Promise<void> {
  await forgetKeptSession(actorId, endSession);
  await change((list) => list.filter((h) => h.actorId !== actorId));
}

/** One person's work, sent as them. Resolves to whether the server was out of reach. */
async function sendFor(h: HandOver, store: EventStore, deviceId: string, blobs: BlobStore): Promise<boolean> {
  const session = await keptSession(h.actorId);
  // supabase-js drops a session the server refused to renew; one it could
  // not renew for want of a network stays.
  if (session === 'unreachable') return true;
  if (session === 'gone') { await forget(h.actorId, false); return false; }
  const { attempt, offline } = await deliverHandOver(h, {
    ...actAs(h.actorId, blobs),
    store,
    deviceId,
    outbox: accountOutbox(h.actorId),
    hasFile: (ref) => blobs.exists(ref),
    note: noteExpected
  });
  const next = afterAttempt(h, attempt);
  if (next.kind === 'done') await forget(h.actorId, true);
  else if (next.kind === 'drop') await forget(h.actorId, false);
  // Read again: a sign-out since this began may have named more recordings.
  else await change((list) => list.map((x) => (x.actorId === h.actorId ? withoutFinished(x, attempt.finished, attempt.unregistered) : x)));
  return offline;
}

export async function sendAll(signedInAs: string | null): Promise<{ offline: boolean }> {
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

