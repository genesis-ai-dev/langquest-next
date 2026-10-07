import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestPushToken } from './push';
import { supabase } from './supabase';

export async function enableNotifications(): Promise<void> {
  const token = await requestPushToken();
  const { error } = await supabase.rpc('register_push_token', { p_token: token });
  if (error) throw new Error(error.message);
  await AsyncStorage.setItem('push-token', token);
}
export async function unregisterNotifications(): Promise<void> {
  const token = await AsyncStorage.getItem('push-token');
  if (!token) return;
  const { error } = await supabase.rpc('unregister_push_token', { p_token: token });
  if (error) throw new Error('Connect once to disconnect notifications before signing out.');
  await AsyncStorage.removeItem('push-token');
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
  const { error } = await supabase.rpc('unregister_push_token', { p_token: token });
  await AsyncStorage.removeItem('push-token');
  return error ? token : undefined;
}
export interface RemoteNotification {
  id: string; seq: number; org_id: string; language_id: string | null;
  kind: string; title: string; task_id: string | null;
  active: boolean;
}
/** Persist each cursor with its rows, so a restart cannot skip a page. */
export async function refreshInbox(actorId: string): Promise<RemoteNotification[]> {
  const key = `inbox:${actorId}`;
  const cached = JSON.parse(await AsyncStorage.getItem(key) ?? '{"cursor":0,"rows":[]}') as {
    cursor: number; rows: RemoteNotification[];
  };
  const rows = new Map(cached.rows.map((row) => [row.id, row]));
  for (let page = 0; page < 10; page++) {
    const { data, error } = await supabase.from('notifications').select('*')
      .eq('profile_id', actorId).gt('seq', cached.cursor).order('seq').limit(100);
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as RemoteNotification[]) {
      if (row.active) rows.set(row.id, row); else rows.delete(row.id);
      cached.cursor = Math.max(cached.cursor, row.seq);
    }
    cached.rows = [...rows.values()];
    await AsyncStorage.setItem(key, JSON.stringify(cached));
    if (!data || data.length < 100) break;
  }
  return cached.rows;
}
export async function cachedInbox(actorId: string): Promise<RemoteNotification[]> {
  return JSON.parse(await AsyncStorage.getItem(`inbox:${actorId}`) ?? '{"rows":[]}').rows;
}
