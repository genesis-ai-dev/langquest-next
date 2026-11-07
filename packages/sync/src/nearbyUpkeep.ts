import type { LanguageState, NearbyVector } from '@langquest-next/core';
import type { EventStore, LocalEvent, WriteBatch } from './types';

/**
 * What nearby sync does at the end of a sync, under the stream's turn, with the little
 * private state its `SyncClient` hands in.
 */

const LOG_PAGE = 500;

/** What nearby's steps need from their `SyncClient`. */
export interface NearbyHost {
  store: EventStore;
  orgId: string;
  streamId: string;
  actorId: string;
  deviceId: string;
  commit(batch: WriteBatch): Promise<void>;
  key(what: string, signer?: string): string;
  vector(): Promise<NearbyVector>;
  vectorMeta(vector: NearbyVector): Record<string, string>;
  number(key: string): Promise<number>;
  lang(): LanguageState;
}

/**
 * The end of a sync, on a phone holding any manifest. A batch goes when no row that is
 * pending, nearby or refused still speaks under it, since Try again can return a refused
 * row to `nearby`. Each signer's newest stays, so its floor travels on. This key's floor
 * is one below its lowest batch with a row pending or nearby, or its counter if none has.
 */
export async function settleBatches(up: NearbyHost): Promise<void> {
  const { store, orgId, streamId } = up;
  const batches = await store.batchKeys(orgId, streamId);
  if (batches.length === 0) return;
  const speaking = new Set<string>();
  const lowestOpen = new Map<string, number>();
  const see = (l: LocalEvent) => {
    if (!l.via || !('batch' in l.via)) return;
    speaking.add(`${l.via.key} ${l.via.batch}`);
    if (l.status === 'rejected') return;
    lowestOpen.set(l.via.key, Math.min(l.via.batch, lowestOpen.get(l.via.key) ?? Infinity));
  };
  for (const l of await store.rejected(orgId, streamId)) see(l);
  for (let after: string | null = null; ;) {
    const page: LocalEvent[] = await store.nearbyPage(orgId, streamId, after, LOG_PAGE);
    page.forEach(see);
    if (page.length < LOG_PAGE) break;
    after = page[page.length - 1]!.event.id;
  }
  for (let after: string | null = null; ;) {
    const page: LocalEvent[] = await store.pendingPage(orgId, streamId, after, LOG_PAGE);
    page.forEach(see);
    if (page.length < LOG_PAGE) break;
    after = page[page.length - 1]!.event.hlc;
  }
  const newest = new Map<string, number>();
  for (const { key, n } of batches) newest.set(key, Math.max(n, newest.get(key) ?? 0));
  const meta: Record<string, string> = {};
  for (const key of newest.keys()) {
    // Only a key this phone signs with has a counter. A teammate's floor is theirs to state.
    const counter = await up.number(up.key('nearbyCount', key));
    if (counter === 0) continue;
    const open = lowestOpen.get(key);
    const floor = open === undefined ? counter : open - 1;
    if (floor > await up.number(up.key('nearbyFloor', key))) meta[up.key('nearbyFloor', key)] = String(floor);
  }
  const gone = batches.filter(({ key, n }) => n !== newest.get(key) && !speaking.has(`${key} ${n}`)).map(({ key, n }) => ({ key, n }));
  await up.commit({ meta, dropBatches: { orgId, streamId, keys: gone } });
}
