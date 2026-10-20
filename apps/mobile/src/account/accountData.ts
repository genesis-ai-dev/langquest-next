import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { DurableOutbox, type AccountAction } from '@langquest-next/sync';
import * as server from '../server/account';
import { noteOutboxFailure } from '../auth/authDiag';
import { RpcError } from '../auth/authOutcome';
import { dropShot, readShot } from '../feedback/feedbackShots';
import { dropVoice, voiceForServer } from '../feedback/voiceBytes';
import type { VoiceRef } from '../feedback/feedbackModel';

/**
 * One queued change to the server. Feedback carries its screenshot and voice
 * note, kept on the phone beside it until it has gone (decisions.md 145).
 */
async function deliver(actorId: string, action: AccountAction): Promise<void> {
  if (action.kind !== 'feedback') return server.deliverAccountAction(actorId, action);
  const shot = action.payload['shot'] === true ? await readShot(action.id) : null;
  const voiceRef = (action.payload['voice'] ?? null) as VoiceRef | null;
  const voice = voiceRef ? await voiceForServer(voiceRef) : null;
  await server.deliverAccountAction(actorId, action, { screenshot: shot, voice });
  if (shot) await dropShot(action.id);
  if (voiceRef) await dropVoice(voiceRef);
}

const outboxes = new Map<string, DurableOutbox>();
export function accountOutbox(actorId: string): DurableOutbox {
  let outbox = outboxes.get(actorId);
  if (!outbox) {
    // A change that keeps failing is told to diagnostics by its kind and code, never its contents.
    outbox = new DurableOutbox(actorId, AsyncStorage, (action) => deliver(actorId, action), { onFailure: noteOutboxFailure });
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
type UserEventType = 'v1.TermsAccepted' | 'v1.VisionSeen' | 'v1.WalkthroughDone';
export async function recordUserEvent(actorId: string, type: UserEventType) {
  const payload = type === 'v1.TermsAccepted' ? { version: TERMS_VERSION } : {};
  await queueAccountAction(actorId, 'user_event', { type, payload },
    `${actorId}:${type}:${type === 'v1.TermsAccepted' ? TERMS_VERSION : '1'}`);
  if (type === 'v1.TermsAccepted') await AsyncStorage.setItem(`terms-version:${actorId}`, TERMS_VERSION);
}
/** A language listed on Explore (`public_languages`, written by the projection worker). */
export interface PublicLanguage {
  org_id: string; language_id: string; name: string; code: string;
  translated_pct: number; updated_at: string; license: string;
}
export async function publicLanguages(): Promise<PublicLanguage[]> {
  const { data, error } = await server.publicLanguages();
  if (error) throw new RpcError(error);
  await AsyncStorage.setItem('public-languages', JSON.stringify(data));
  return data as PublicLanguage[];
}
export async function cachedPublicLanguages(): Promise<PublicLanguage[]> {
  return JSON.parse(await AsyncStorage.getItem('public-languages') ?? '[]');
}
/** An organization Request Access offers: one listing a language on Explore (`listed_organizations`, decisions.md 66). */
export interface ListedOrganization {
  org_id: string; name: string; languages: string[];
}
export async function listedOrganizations(): Promise<ListedOrganization[]> {
  const { data, error } = await server.listedOrganizations();
  if (error) throw new RpcError(error);
  await AsyncStorage.setItem('listed-organizations', JSON.stringify(data));
  return data as ListedOrganization[];
}
/**
 * Every listed organization whose name, or a language it lists, holds `query`,
 * searched on the server: the list above is only the first 500 by name.
 */
export async function searchListedOrganizations(query: string): Promise<ListedOrganization[]> {
  const { data, error } = await server.searchListedOrganizations(query);
  if (error) throw new RpcError(error);
  return data as ListedOrganization[];
}
export async function cachedListedOrganizations(): Promise<ListedOrganization[]> {
  return JSON.parse(await AsyncStorage.getItem('listed-organizations') ?? '[]');
}
