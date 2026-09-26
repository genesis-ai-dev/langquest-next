import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { useEffect, useState } from 'react';
import { splitByRead, visibleRemote } from './inboxRead';
import { supabase } from './supabase';

export async function enableNotifications(): Promise<void> {
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('work', {
    name: 'Work updates', importance: Notifications.AndroidImportance.DEFAULT
  });
  const permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error('Notifications are off. Your inbox still works.');
  const token = (await Notifications.getExpoPushTokenAsync({
    projectId: '582d3757-4245-419a-9087-e269e3bf4c4d'
  })).data;
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
export interface RemoteNotification {
  id: string; seq: number; org_id: string; project_id: string;
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
    changed();
    if (!data || data.length < 100) break;
  }
  return cached.rows;
}
export async function cachedInbox(actorId: string): Promise<RemoteNotification[]> {
  return JSON.parse(await AsyncStorage.getItem(`inbox:${actorId}`) ?? '{"rows":[]}').rows;
}

/**
 * Inbox read state is per device (`inbox-read:{actor}`). One listener set
 * keeps the Inbox screen and the tab badge in step without a reload.
 */
const listeners = new Set<() => void>();
function changed() { for (const l of listeners) l(); }
export async function inboxRead(actorId: string): Promise<string[]> {
  return JSON.parse(await AsyncStorage.getItem(`inbox-read:${actorId}`) ?? '[]');
}
export async function markInboxRead(actorId: string, ids: string[]): Promise<void> {
  const next = [...new Set([...await inboxRead(actorId), ...ids])];
  await AsyncStorage.setItem(`inbox-read:${actorId}`, JSON.stringify(next));
  changed();
}
/** The read ids and cached server rows, refreshed whenever either changes. */
export function useInboxState(actorId: string): { read: string[]; remote: RemoteNotification[] } {
  const [value, setValue] = useState<{ read: string[]; remote: RemoteNotification[] }>({ read: [], remote: [] });
  useEffect(() => {
    let active = true;
    const load = () => { void Promise.all([inboxRead(actorId), cachedInbox(actorId)])
      .then(([read, remote]) => { if (active) setValue({ read, remote }); }).catch(() => {}); };
    listeners.add(load);
    load();
    return () => { active = false; listeners.delete(load); };
  }, [actorId]);
  return value;
}
/** Tab badge: unread derived items plus unread server rows the inbox shows. */
export function useInboxUnread(actorId: string, localIds: string[], orgId: string, projectId: string): number {
  const { read, remote } = useInboxState(actorId);
  const items = [...localIds.map((id) => ({ id })), ...visibleRemote(remote, orgId, projectId)];
  return splitByRead(items, read).unread.length;
}
