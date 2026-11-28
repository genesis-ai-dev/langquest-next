import type { EventStore } from './types';

const KEY = 'deviceId';

/**
 * The id being read or made for each store. On a fresh store several parts of
 * the app ask at once (sign-in's diagnostics delivery, the organization's sync,
 * nearby): each read found no id, made its own and wrote it, so one phone got
 * two install ids seconds apart, and the first went quiet at once (LAN-315).
 * The asks share one read now; once it settles, the next ask reads the store
 * again, so a failed write is tried again.
 */
const pending = new WeakMap<EventStore, Promise<string>>();

/**
 * The node id for this device's clocks. Generated once and persisted; every
 * device must differ or HLC tie-breaking collapses (PLAN.md section 7).
 */
export function ensureDeviceId(store: EventStore, newId: () => string): Promise<string> {
  let id = pending.get(store);
  if (!id) {
    id = readOrMake(store, newId);
    pending.set(store, id);
    const forget = () => { if (pending.get(store) === id) pending.delete(store); };
    id.then(forget, forget);
  }
  return id;
}

async function readOrMake(store: EventStore, newId: () => string): Promise<string> {
  const existing = await store.meta(KEY);
  if (existing) return existing;
  const id = newId();
  await store.setMeta(KEY, id);
  return id;
}
