import type { EventStore } from './types';

const KEY = 'deviceId';

/**
 * The node id for this device's clocks. Generated once and persisted; every
 * device must differ or HLC tie-breaking collapses (PLAN.md section 7).
 */
export async function ensureDeviceId(store: EventStore, newId: () => string): Promise<string> {
  const existing = await store.meta(KEY);
  if (existing) return existing;
  const id = newId();
  await store.setMeta(KEY, id);
  return id;
}
