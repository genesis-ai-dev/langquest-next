import AsyncStorage from '@react-native-async-storage/async-storage';
import { pushPermission, requestPushToken } from './push';
import * as server from '../server/notifications';

export async function enableNotifications(): Promise<void> {
  const token = await requestPushToken();
  const { error } = await server.registerPushToken(token);
  if (error) throw new Error(error.message);
  await AsyncStorage.setItem('push-token', token);
}
/** On when this phone's token is registered and the phone still allows them; blocked when only the phone's settings can turn them on. */
export async function notificationStanding(): Promise<{ on: boolean; blocked: boolean }> {
  const [token, permission] = await Promise.all([AsyncStorage.getItem('push-token'), pushPermission()]);
  return { on: !!token && permission === 'granted', blocked: permission === 'blocked' };
}
export async function unregisterNotifications(): Promise<void> {
  if (!await tryUnregisterNotifications()) throw new Error('Connect once to disconnect notifications before signing out.');
}
/**
 * Disconnect this phone's notifications if the server answers. False means
 * the token is still registered: offline, a phone hands the disconnect to the
 * courier instead of refusing to sign out (handOverPushToken, decision 87).
 */
export async function tryUnregisterNotifications(): Promise<boolean> {
  const token = await AsyncStorage.getItem('push-token');
  if (!token) return true;
  const { error } = await server.unregisterPushToken(token);
  if (error) return false;
  await AsyncStorage.removeItem('push-token');
  return true;
}
/**
 * Sign-out on a shared phone (handOver.ts): disconnect notifications now if
 * the server answers, else return the token so the hand-over disconnects
 * it as this person later. Either way the phone forgets it, so the next
 * person here starts without it.
 */
export async function handOverPushToken(): Promise<string | undefined> {
  const token = await AsyncStorage.getItem('push-token');
  if (!token) return undefined;
  const { error } = await server.unregisterPushToken(token);
  await AsyncStorage.removeItem('push-token');
  return error ? token : undefined;
}
/**
 * Back in from the lock before the courier disconnected this phone's
 * notifications (decisions.md 168): they still come here, so the phone
 * holds the token again for the next sign-out.
 */
export async function keepPushToken(token: string): Promise<void> {
  await AsyncStorage.setItem('push-token', token);
}
export interface RemoteNotification {
  id: string; seq: number; org_id: string; language_id: string | null;
  kind: string; title: string; task_id: string | null;
  /** The passage an update is about (server/projectionWorker.ts); null for an organization's rows. */
  unit_id?: string | null;
  active: boolean;
}
/**
 * The server deletes an Inbox row 30 days after it went inactive. A phone
 * learns a row went away from that inactive row, so a copy not refreshed
 * for 25 days starts over from the active rows instead.
 */
export const INBOX_COPY_MAX_AGE_MS = 25 * 24 * 60 * 60 * 1000;

/** Persist each cursor with its rows, so a restart cannot skip a page. */
export async function refreshInbox(actorId: string): Promise<RemoteNotification[]> {
  const key = `inbox:${actorId}`;
  const cached = JSON.parse(await AsyncStorage.getItem(key) ?? '{"cursor":0,"rows":[]}') as {
    cursor: number; rows: RemoteNotification[]; at?: number;
  };
  // A copy made before this field existed starts over once; nothing is lost, it is pulled again.
  if (Date.now() - (cached.at ?? 0) > INBOX_COPY_MAX_AGE_MS) { cached.cursor = 0; cached.rows = []; }
  const rows = new Map(cached.rows.map((row) => [row.id, row]));
  for (let page = 0; page < 10; page++) {
    const { data, error } = await server.notificationsAfter(actorId, cached.cursor, 100);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as RemoteNotification[]) {
      if (row.active) rows.set(row.id, row); else rows.delete(row.id);
      cached.cursor = Math.max(cached.cursor, row.seq);
    }
    cached.rows = [...rows.values()];
    cached.at = Date.now();
    await AsyncStorage.setItem(key, JSON.stringify(cached));
    if (!data || data.length < 100) break;
  }
  return cached.rows;
}
export async function cachedInbox(actorId: string): Promise<RemoteNotification[]> {
  return JSON.parse(await AsyncStorage.getItem(`inbox:${actorId}`) ?? '{"rows":[]}').rows;
}

/**
 * The Inbox row a tapped push is about, from this phone's copy of the Inbox,
 * else from the server: the push carries only the row's id, so nothing
 * about the work shows on the lock screen (server/pushDelivery.ts).
 * Null offline when the row has not been seen yet.
 */
export async function findNotification(actorId: string, id: string): Promise<RemoteNotification | null> {
  const saved = (await cachedInbox(actorId)).find((row) => row.id === id);
  if (saved) return saved;
  return (await refreshInbox(actorId)).find((row) => row.id === id) ?? null;
}
