import { SupabaseTransport, SyncClient, ensureDeviceId } from '@langquest-next/client';
import type { EventSpec } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { noteExpected } from './report';
import { getStore } from './store';
import { supabase } from './supabase';

/**
 * Write events into a partition this phone does not have open: a new
 * language's own partition (docs/decisions.md 37), started from the
 * organization before anyone opens it. The events go into this phone's log
 * like any others and are sent now if the phone is connected; otherwise the
 * language's own sync sends them when it is opened.
 */
export async function appendToPartition(c: { orgId: string; projectId: string; actorId: string; specs: EventSpec[] }): Promise<void> {
  const store = await getStore();
  const deviceId = await ensureDeviceId(store, () => Crypto.randomUUID());
  const client = new SyncClient({
    orgId: c.orgId,
    projectId: c.projectId,
    actorId: c.actorId,
    deviceId,
    store,
    transport: new SupabaseTransport(supabase),
    newId: () => Crypto.randomUUID()
  });
  await client.load();
  await client.appendMany(c.specs);
  // Best effort: offline is fine, the events are kept.
  await client.push().catch((e: unknown) => noteExpected('new partition push', e));
}
