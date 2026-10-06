import type { AnyEvent } from '@langquest-next/core';
import { SyncClient, type Materializer } from './syncClient';
import type { EventStore, Transport } from './types';

/** No fold at all: a courier only moves events (`deliverOnly`). */
const NO_FOLD: Materializer<null> = {
  empty: () => null,
  apply: () => null,
  fold: (_events: Iterable<AnyEvent>, initial: null) => initial,
  compact: () => {},
  version: 0
};

export interface Delivered {
  accepted: number;
  rejected: number;
  /** This person's events still queued afterwards (unreachable, or refused for their clock). */
  left: number;
}

/**
 * Send one person's queued events from a shared phone under that person's
 * own session, after they handed the phone on to someone else
 * (decisions.md 60). The server accepts an event only from its author, so
 * `transport` must be signed in as `actorId`. Every stream with their
 * pending events is pushed; nothing is folded or projected, because the
 * phone's own client owns that. A refused event is marked refused, as any
 * push does; one refused only for its clock stays queued for their next
 * session on this phone.
 */
export async function deliverQueued(o: {
  store: EventStore;
  transport: Transport;
  actorId: string;
  deviceId: string;
  pushBatchSize?: number;
}): Promise<Delivered> {
  let accepted = 0;
  let rejected = 0;
  let left = 0;
  for (const { orgId, streamId } of await o.store.pendingStreamsBy(o.actorId)) {
    const client = new SyncClient<null>({
      orgId, streamId, actorId: o.actorId, deviceId: o.deviceId, store: o.store, transport: o.transport,
      materializer: NO_FOLD, deliverOnly: true, ...(o.pushBatchSize ? { pushBatchSize: o.pushBatchSize } : {})
    });
    for (let before = -1; ;) {
      const r = await client.push();
      accepted += r.accepted;
      rejected += r.rejected;
      const now = await o.store.pendingCountBy(orgId, streamId, o.actorId);
      // Done, or stuck (a clock refusal leaves events queued): stop either way.
      if (!r.more || now === before) { left += now; break; }
      before = now;
    }
  }
  return { accepted, rejected, left };
}
