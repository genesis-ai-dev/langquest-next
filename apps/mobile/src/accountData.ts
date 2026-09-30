import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { DurableOutbox, DeliveryError, type AccountAction } from './durableOutbox';
import { supabase } from './supabase';

const outboxes = new Map<string, DurableOutbox>();
export function accountOutbox(actorId: string): DurableOutbox {
  let outbox = outboxes.get(actorId);
  if (!outbox) {
    outbox = new DurableOutbox(actorId, AsyncStorage, async (action) => {
      const { data } = await supabase.auth.getSession();
      if (data.session?.user.id !== actorId) {
        throw new DeliveryError('Sign in again to send your saved changes.', true);
      }
      const { error } = action.kind === 'join_request'
        ? await supabase.rpc('create_join_request', {
          p_request_id: action.id, p_org: action.payload.orgId,
          p_message: action.payload.message
        })
        : action.kind === 'profile'
          ? await supabase.rpc('save_profile', {
            p_display_name: action.payload.displayName
          })
          : await supabase.rpc('record_user_event', {
            p_id: action.id, p_type: action.payload.type,
            p_payload: action.payload.payload
          });
      if (error) {
        const permanent = ['22023', '42501', '23514'].includes(error.code);
        throw new DeliveryError(error.message, !permanent);
      }
    });
    outboxes.set(actorId, outbox);
  }
  return outbox;
}
export async function queueAccountAction(
  actorId: string, kind: AccountAction['kind'],
  payload: Record<string, unknown>, id = Crypto.randomUUID()
) {
  const outbox = accountOutbox(actorId);
  await outbox.enqueue({ id, kind, payload });
  return id;
}
export const TERMS_VERSION = '2026-09-17';
export type UserEventType = 'v1.TermsAccepted' | 'v1.VisionSeen' | 'v1.WalkthroughDone';
export async function recordUserEvent(actorId: string, type: UserEventType) {
  const payload = type === 'v1.TermsAccepted' ? { version: TERMS_VERSION } : {};
  await queueAccountAction(actorId, 'user_event', { type, payload },
    `${actorId}:${type}:${type === 'v1.TermsAccepted' ? TERMS_VERSION : '1'}`);
  if (type === 'v1.TermsAccepted') await AsyncStorage.setItem(`terms-version:${actorId}`, TERMS_VERSION);
}
export interface PublicProject {
  org_id: string; project_id: string; name: string;
  languages: string[]; translated_pct: number; updated_at: string;
  /** Absent from servers before the license migration, and from older caches. */
  license?: string;
}
export async function publicProjects(): Promise<PublicProject[]> {
  // `*` rather than a column list, so a server without the license column
  // (migration 20260929120000) still answers.
  const { data, error } = await supabase.from('public_projects')
    .select('*')
    .order('name').limit(100);
  if (error) throw new Error(error.message);
  await AsyncStorage.setItem('public-projects', JSON.stringify(data));
  return data as PublicProject[];
}
export async function cachedPublicProjects(): Promise<PublicProject[]> {
  return JSON.parse(await AsyncStorage.getItem('public-projects') ?? '[]');
}
