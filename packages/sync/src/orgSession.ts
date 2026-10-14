import {
  applyOrgEvent, emptyOrgState, foldOrg, ORG_STREAM, REDUCER_VERSION,
  type EventPayloads, type OrgEventType, type OrgState
} from '@langquest-next/core';
import { SyncClient, type Materializer, type SyncClientOptions, type SyncResult } from './syncClient';
import { SyncScheduler } from './syncScheduler';
import type { EventStore, SyncInspection, Transport } from './types';

/** The organization stream's fold: roles, memberships, languages, the library. */
export const ORG_MATERIALIZER: Materializer<OrgState> = {
  empty: emptyOrgState,
  apply: applyOrgEvent,
  fold: foldOrg,
  compact: (s) => {
    s.appliedEventIds = {};
  },
  version: REDUCER_VERSION
};

export interface OrgStatus {
  pending: number;
  /** The realtime channel is up. */
  live: boolean;
  /** Read up to date from the server at least once this session. */
  pulled: boolean;
  /** The first sync attempt has finished, reached or not: the local fold is as good as it will get offline. */
  settled: boolean;
  /** Bumped when a pulled event changed a membership or a role (the open language re-queues refused work). */
  membershipEpoch: number;
}

export interface OrgSessionOptions {
  orgId: string;
  actorId: string;
  deviceId: string;
  store: EventStore;
  transport: Transport;
  /** Passed to the SyncClient. */
  client?: Pick<SyncClientOptions<OrgState>, 'newId' | 'diag' | 'clock' | 'now'>;
  /** Wraps every `client.sync()`, for a test-state probe. */
  aroundSync?: (run: () => Promise<SyncResult>) => Promise<SyncResult>;
}

/**
 * The organization stream on this device (decisions.md 63, 103): the same
 * sync client as a language, a different fold, small enough to pull whole,
 * with its scheduler and realtime watch. `open` loads it, `start` begins
 * syncing, `close` stops.
 */
export class OrgSession {
  private readonly listeners = new Set<(what: 'state' | 'status') => void>();
  private readonly scheduler: SyncScheduler;
  private readonly stops: (() => void)[] = [];
  private online: boolean | null = null;
  private current: OrgStatus = { pending: 0, live: false, pulled: false, settled: false, membershipEpoch: 0 };
  private closed = false;

  static async open(o: OrgSessionOptions): Promise<OrgSession> {
    let session: OrgSession | null = null;
    const client = new SyncClient<OrgState>({
      ...o.client,
      materializer: ORG_MATERIALIZER,
      orgId: o.orgId,
      streamId: ORG_STREAM,
      actorId: o.actorId,
      deviceId: o.deviceId,
      store: o.store,
      transport: o.transport,
      onMembershipChanged: () => session?.set({ membershipEpoch: session.current.membershipEpoch + 1 })
    });
    await client.load();
    session = new OrgSession(o, client);
    return session;
  }

  private constructor(private readonly o: OrgSessionOptions, readonly client: SyncClient<OrgState>) {
    this.scheduler = new SyncScheduler({
      run: async () => { await this.sync(); return { offline: this.online === false }; }
    });
  }

  start(): void {
    const unwatch = this.o.transport.watch?.(this.o.orgId, ORG_STREAM, {
      onPoke: () => this.scheduler.nudge(),
      onStatus: (connected) => { this.set({ live: connected }); this.scheduler.connection(connected); }
    });
    if (unwatch) this.stops.push(unwatch);
    void this.counts();
    this.scheduler.start();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const stop of this.stops.splice(0)) stop();
    this.scheduler.stop();
    this.listeners.clear();
  }

  /** The live fold, changed in place. */
  get state(): OrgState {
    return this.client.getState();
  }

  get status(): OrgStatus {
    return this.current;
  }

  /** Be told after a change to the fold (`state`) or only to `status`. */
  subscribe(listener: (what: 'state' | 'status') => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  wake(): void {
    this.scheduler.wake();
  }

  async sync(): Promise<void> {
    let changed = true;
    try {
      const r = await (this.o.aroundSync ? this.o.aroundSync(() => this.client.sync()) : this.client.sync());
      this.online = !r.offline;
      if (!r.offline && !r.refused && !r.more) this.set({ pulled: true });
      changed = r.pushed > 0 || r.pulled > 0 || r.rejected > 0;
    } catch {
      // Offline or refused: state is whatever the local log says. Honest and quiet.
    }
    if (changed) await this.counts();
    this.set({ settled: true });
  }

  async append<T extends OrgEventType>(type: T, payload: EventPayloads[T]): Promise<void> {
    const written = this.client.append(type, payload);
    // The fold changed in memory already: show it before the disk write lands.
    this.changed();
    await written;
    await this.counts();
    this.scheduler.nudge();
  }

  inspect(): Promise<SyncInspection> {
    return this.client.inspect();
  }

  private async counts(): Promise<void> {
    this.changed();
    void this.client.pendingCount().then((pending) => this.set({ pending })).catch(() => {});
  }

  /** The fold changed: subscribers read `state` again. */
  private changed(what: 'state' | 'status' = 'state'): void {
    if (this.closed) return;
    for (const l of this.listeners) l(what);
  }

  private set(change: Partial<OrgStatus>): void {
    if (this.closed) return;
    const differs = (Object.keys(change) as (keyof OrgStatus)[]).some((k) => this.current[k] !== change[k]);
    if (!differs) return;
    this.current = { ...this.current, ...change };
    this.changed('status');
  }
}
