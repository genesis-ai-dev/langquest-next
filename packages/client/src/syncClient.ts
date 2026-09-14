import {
  applyEvent,
  emptyState,
  type AnyEvent,
  type EventPayloads,
  type EventType,
  type ProjectState,
  HlcClock
} from '@langquest-next/core';
import type { EventStore, LocalEvent, Transport } from './types';
import { OfflineError } from './types';

export interface SyncClientOptions {
  orgId: string;
  projectId: string;
  actorId: string;
  deviceId: string;
  store: EventStore;
  transport: Transport;
  clock?: HlcClock;
  newId?: () => string;
  pullPageSize?: number;
}

/**
 * One partition (project) on one device.
 *
 * - `append` writes to the local log and folds immediately (PLAN.md section 3:
 *   clients materialize alone; no waiting for a projection).
 * - `push` sends pending events; rejected ones stay in the log marked
 *   rejected (invariant 1) and are removed from the fold.
 * - `pull` pages the partition tail and folds it. Because events commute,
 *   applying remote events after local pending ones needs no rebase.
 */
export class SyncClient {
  private state: ProjectState = emptyState();
  private loaded = false;
  private readonly clock: HlcClock;
  private readonly newId: () => string;
  private readonly pullPageSize: number;

  constructor(private readonly opts: SyncClientOptions) {
    this.clock = opts.clock ?? new HlcClock(opts.deviceId);
    this.newId = opts.newId ?? (() => crypto.randomUUID());
    this.pullPageSize = opts.pullPageSize ?? 500;
  }

  /** Rebuild the fold from the local log. Called once, and after a rejection. */
  async load(): Promise<ProjectState> {
    const state = emptyState();
    for (const local of await this.opts.store.all(this.opts.orgId, this.opts.projectId)) {
      applyEvent(state, local.event);
    }
    this.state = state;
    this.loaded = true;
    return state;
  }

  getState(): ProjectState {
    if (!this.loaded) throw new Error('call load() first');
    return this.state;
  }

  /** Record an intent. Durable locally and visible in state before this resolves. */
  async append<T extends EventType>(
    type: T,
    payload: EventPayloads[T],
    parentEventId?: string
  ): Promise<AnyEvent> {
    if (!this.loaded) throw new Error('call load() first');
    const event = {
      id: this.newId(),
      type,
      orgId: this.opts.orgId,
      projectId: this.opts.projectId,
      actorId: this.opts.actorId,
      deviceId: this.opts.deviceId,
      hlc: this.clock.next(),
      payload,
      ...(parentEventId ? { parentEventId } : {})
    } as AnyEvent;
    await this.opts.store.put({ event, status: 'pending' });
    applyEvent(this.state, event);
    return event;
  }

  /** Push pending events. Returns how many were rejected. */
  async push(): Promise<{ accepted: number; rejected: number }> {
    // Only this actor's events. A shared device may hold another user's
    // queued events; pushing them under this session would be rejected
    // (actorId must match the caller) and wrongly marked as refused.
    const pending = (await this.opts.store.pending(this.opts.orgId, this.opts.projectId)).filter(
      (p) => p.event.actorId === this.opts.actorId
    );
    if (pending.length === 0) return { accepted: 0, rejected: 0 };

    const results = await this.opts.transport.append(pending.map((p) => p.event));
    let accepted = 0;
    let rejected = 0;
    for (const r of results) {
      const local = pending.find((p) => p.event.id === r.id);
      if (!local) continue;
      if (r.accepted) {
        accepted += 1;
        await this.opts.store.put({
          event: { ...local.event, serverSeq: r.serverSeq ?? undefined } as AnyEvent,
          status: 'confirmed'
        });
      } else {
        rejected += 1;
        await this.opts.store.put({
          event: local.event,
          status: 'rejected',
          rejectReason: r.reason ?? 'rejected'
        });
      }
    }
    // A rejection means the fold contains something the server refused.
    // Refold from the log; the rejected event is excluded by `all()`.
    if (rejected > 0) await this.load();
    return { accepted, rejected };
  }

  /** Pull the partition tail and fold it. Returns number of new events. */
  async pull(): Promise<number> {
    let after = await this.opts.store.cursor(this.opts.orgId, this.opts.projectId);
    let total = 0;
    for (;;) {
      const page = await this.opts.transport.pull(
        this.opts.orgId,
        this.opts.projectId,
        after,
        this.pullPageSize
      );
      for (const event of page) {
        const seq = event.serverSeq;
        if (seq === undefined) continue;
        const existing = await this.opts.store.get(event.id);
        if (!existing || existing.status !== 'confirmed') {
          await this.opts.store.put({ event, status: 'confirmed' });
        }
        this.clock.receive(event.hlc);
        applyEvent(this.state, event);
        after = Math.max(after, seq);
        total += 1;
      }
      await this.opts.store.setCursor(this.opts.orgId, this.opts.projectId, after);
      if (page.length < this.pullPageSize) break;
    }
    return total;
  }

  /** Push then pull. Offline errors leave everything queued. */
  async sync(): Promise<{ pushed: number; rejected: number; pulled: number }> {
    try {
      const { accepted, rejected } = await this.push();
      const pulled = await this.pull();
      return { pushed: accepted, rejected, pulled };
    } catch (err) {
      if (err instanceof OfflineError) return { pushed: 0, rejected: 0, pulled: 0 };
      throw err;
    }
  }

  async pendingCount(): Promise<number> {
    return (await this.opts.store.pending(this.opts.orgId, this.opts.projectId)).length;
  }
}
