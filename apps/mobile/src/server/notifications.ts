import { supabase } from './supabase';

export function registerPushToken(token: string) {
  return supabase.rpc('register_push_token', { p_token: token });
}

export function unregisterPushToken(token: string) {
  return supabase.rpc('unregister_push_token', { p_token: token });
}

/** This person's Inbox rows after `cursor`, a page at a time. */
export function notificationsAfter(profileId: string, cursor: number, limit: number) {
  return supabase.from('notifications').select('*').eq('profile_id', profileId).gt('seq', cursor).order('seq').limit(limit);
}
