import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { DurableOutbox, DeliveryError, type AccountAction } from './durableOutbox';
import { supabase } from './supabase';

/** Sessions kept for people signed out of this phone with work still to go (handOver.ts). */
const keptFor = new Map<string, SupabaseClient>();
export function sendAs(actorId: string, client: SupabaseClient | null) {
  if (client) keptFor.set(actorId, client);
  else keptFor.delete(actorId);
}

const outboxes = new Map<string, DurableOutbox>();
export function accountOutbox(actorId: string): DurableOutbox {
  let outbox = outboxes.get(actorId);
  if (!outbox) {
    outbox = new DurableOutbox(actorId, AsyncStorage, async (action) => {
      const { data } = await supabase.auth.getSession();
      const client = data.session?.user.id === actorId ? supabase : keptFor.get(actorId);
      if (!client) {
        throw new DeliveryError('Sign in again to send your saved changes.', true);
      }
      const p = action.payload;
      const { error } = action.kind === 'join_request'
        ? await client.rpc('create_join_request', {
          p_request_id: action.id, p_org: p.orgId, p_message: p.message
        })
        : action.kind === 'profile'
          ? await client.rpc('save_profile', { p_display_name: p.displayName })
          : action.kind === 'report'
            // Reports and blocks (decisions.md 48): rows on the server, never events.
            ? await client.rpc('report_content', {
              p_id: action.id, p_org: p.orgId, p_partition: p.partitionId, p_kind: p.kind,
              p_target: p.targetId, p_profile: p.profileId, p_reason: p.reason,
              p_details: p.details ?? null, p_unit: p.unitId ?? null, p_lane: p.laneId ?? null
            })
            : action.kind === 'block'
              ? await client.rpc('set_blocked', { p_profile: p.profileId, p_blocked: p.blocked })
              : await client.rpc('record_user_event', {
                p_id: action.id, p_type: p.type, p_payload: p.payload
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
export const TERMS_VERSION = '2026-09-30';
export type UserEventType = 'v1.TermsAccepted' | 'v1.VisionSeen' | 'v1.WalkthroughDone';
export async function recordUserEvent(actorId: string, type: UserEventType) {
  const payload = type === 'v1.TermsAccepted' ? { version: TERMS_VERSION } : {};
  await queueAccountAction(actorId, 'user_event', { type, payload },
    `${actorId}:${type}:${type === 'v1.TermsAccepted' ? TERMS_VERSION : '1'}`);
  if (type === 'v1.TermsAccepted') await AsyncStorage.setItem(`terms-version:${actorId}`, TERMS_VERSION);
}
export interface PublicPartition {
  org_id: string; partition_id: string; name: string;
  languages: string[]; translated_pct: number; updated_at: string;
  /** Absent from servers before the license migration, and from older caches. */
  license?: string;
}
export async function publicPartitions(): Promise<PublicPartition[]> {
  // `*` rather than a column list, so a server without the license column
  // (migration 20260929120000) still answers.
  const { data, error } = await supabase.from('public_partitions')
    .select('*')
    .order('name').limit(100);
  if (error) throw new Error(error.message);
  await AsyncStorage.setItem('public-partitions', JSON.stringify(data));
  return data as PublicPartition[];
}
export async function cachedPublicPartitions(): Promise<PublicPartition[]> {
  return JSON.parse(await AsyncStorage.getItem('public-partitions') ?? '[]');
}
