import AsyncStorage from '@react-native-async-storage/async-storage';
import { SupabaseTransport, type PendingUpload } from '@langquest-next/sync';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { BlobStore } from '../sync/blobs';
import { timedTransfer } from '../diagnostics/diagnostics';
import { noteExpected } from '../diagnostics/report';
import { signingOutByChoice } from '../auth/signOutCause';
import { UploadError, uploadBlob } from './blobTransport';
import { SESSION_KEY, clientKeptAt, supabase } from './supabase';

/**
 * Sessions kept for people who signed out of a shared phone with work still
 * to go (decisions.md 60). Each lives under its own key, renews only when
 * used, and nothing on screen can use it; the courier (handOver.ts) sends
 * that person's work as them through these.
 */
const sessionKeyFor = (actorId: string) => `hand-over-session:${actorId}`;

const kept = new Map<string, SupabaseClient>();
function keptClient(actorId: string): SupabaseClient {
  let client = kept.get(actorId);
  if (!client) {
    client = clientKeptAt(sessionKeyFor(actorId));
    kept.set(actorId, client);
  }
  return client;
}

/** Whose kept session the account outbox may send as right now (server/account.ts). */
const sending = new Map<string, SupabaseClient>();
export function sendingAs(actorId: string): SupabaseClient | undefined {
  return sending.get(actorId);
}

/**
 * Move the signed-in session to a key of its own, with no server call, so
 * this works offline and the session stays good for the courier; then sign
 * out here. `keep` records the hand-over while the session is being moved.
 * Answers whether there was a session to keep.
 */
export function keepSessionAndSignOut(actorId: string, keep: () => Promise<void>): Promise<boolean> {
  return signingOutByChoice(async () => {
    let moved = false;
    await supabase.auth.stopAutoRefresh();
    try {
      const session = await AsyncStorage.getItem(SESSION_KEY);
      if (session) {
        await AsyncStorage.setItem(sessionKeyFor(actorId), session);
        await keep();
        await AsyncStorage.removeItem(SESSION_KEY);
        moved = true;
      }
      // Nothing is stored now, so this asks the server nothing: it forgets
      // the session here and tells the app.
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
    } finally {
      void supabase.auth.startAutoRefresh();
    }
    return moved;
  });
}

/**
 * The kept session, if it is still good. `unreachable`: supabase-js dropped
 * nothing, but could not renew it for want of a network; `gone`: the server
 * refused to renew it, so its work waits for that person's next sign-in.
 */
export async function keptSession(actorId: string): Promise<'ready' | 'unreachable' | 'gone'> {
  const { data } = await keptClient(actorId).auth.getSession();
  if (data.session) return 'ready';
  return await AsyncStorage.getItem(sessionKeyFor(actorId)) !== null ? 'unreachable' : 'gone';
}

/** What a delivery attempt does as this person (deliverHandOver in packages/sync). */
export function actAs(actorId: string, blobs: BlobStore) {
  const client = keptClient(actorId);
  sending.set(actorId, client);
  return {
    transport: new SupabaseTransport(client),
    unregisterPush: async (token: string) => !(await client.rpc('unregister_push_token', { p_token: token })).error,
    /** `refused`: they are no longer a member of that language, so trying again will not help. */
    upload: async (u: PendingUpload): Promise<'sent' | 'refused'> => {
      try {
        // Tallied with the other uploads, under its own source, so a stuck hand-over shows (docs/diagnostics.md).
        await timedTransfer('up', { orgId: u.orgId, streamId: u.languageId, src: 'handover' }, async (timings) => {
          await uploadBlob(u.orgId, u.languageId, u.ref, blobs, timings, client);
          return blobs.sizes().get(u.ref.hash) ?? 0;
        });
        return 'sent';
      } catch (e) {
        if (!(e instanceof UploadError && e.refused)) throw e;
        noteExpected('hand-over upload', e);
        return 'refused';
      }
    }
  };
}

/** Stop acting for this person. `endSession` signs the kept session out on the server too. */
export async function forgetKeptSession(actorId: string, endSession: boolean): Promise<void> {
  sending.delete(actorId);
  if (endSession) await keptClient(actorId).auth.signOut({ scope: 'local' }).catch(() => {});
  kept.delete(actorId);
  await AsyncStorage.removeItem(sessionKeyFor(actorId));
}
