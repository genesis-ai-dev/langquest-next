import { SupabaseTransport, SyncClient, SyncScheduler, ensureDeviceId, type Materializer, type SyncInspection } from '@langquest-next/client';
import { applyOrgEvent, emptyOrgState, foldOrg, ORG_STREAM, REDUCER_VERSION, type EventPayloads, type OrgEventType, type OrgState } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getStore } from './store';
import { onWake } from './wake';
import { supabase } from './supabase';
import { diagnostics } from './diagnostics';

export interface OrgHandle {
  state: OrgState | null;
  pending: number;
  append: <T extends OrgEventType>(type: T, payload: EventPayloads[T]) => Promise<void>;
  sync: () => Promise<void>;
  live: boolean;
  inspect: () => Promise<SyncInspection | null>;
  /** Read up to date from the server at least once this session. */
  pulled: boolean;
  /** The first sync attempt has finished, reached or not: the local fold is as good as it will get offline. */
  settled: boolean;
  /**
   * Bumped when a pulled event changed a membership or a role. The open
   * language's client then re-queues work refused for want of one.
   */
  membershipEpoch: number;
}

export const ORG_MATERIALIZER: Materializer<OrgState> = {
  empty: emptyOrgState,
  apply: applyOrgEvent,
  fold: foldOrg,
  compact: (s) => {
    s.appliedEventIds = {};
  },
  version: REDUCER_VERSION
};

/**
 * The organization stream on this device (decision 63): roles,
 * memberships, languages, the library. Same sync client as a language,
 * different fold. Small enough to pull whole.
 */
export function useOrg(orgId: string, actorId: string): OrgHandle {
  const clientRef = useRef<SyncClient<OrgState> | null>(null);
  const [state, setState] = useState<OrgState | null>(null);
  const [pending, setPending] = useState(0);
  const [live, setLive] = useState(false);
  const [pulled, setPulled] = useState(false);
  const [settled, setSettled] = useState(false);
  const [membershipEpoch, setMembershipEpoch] = useState(0);
  const schedulerRef = useRef<SyncScheduler | null>(null);
  const onlineRef = useRef<boolean | null>(null);

  const refresh = useCallback(async () => {
    const c = clientRef.current;
    if (!c) return;
    setState({ ...c.getState() });
    // The count is a query; it must not hold the state update.
    void c.pendingCount().then(setPending).catch(() => {});
  }, []);

  const sync = useCallback(async () => {
    const c = clientRef.current;
    if (!c) return;
    let changed = true;
    try {
      const r = await c.sync();
      onlineRef.current = !r.offline;
      if (!r.offline && !r.refused && !r.more) setPulled(true);
      changed = r.pushed > 0 || r.pulled > 0 || r.rejected > 0;
    } catch {
      // Offline or refused: state is whatever the local log says. Honest and quiet.
    }
    if (changed) await refresh();
    setSettled(true);
  }, [refresh]);

  // Back on screen or back online: sync now rather than at the end of a backoff.
  useEffect(() => onWake(() => schedulerRef.current?.wake()), []);

  useEffect(() => {
    let cancelled = false;
    let unwatch = () => {};
    (async () => {
      const store = await getStore();
      const deviceId = await ensureDeviceId(store, () => Crypto.randomUUID());
      const transport = new SupabaseTransport(supabase);
      const client = new SyncClient<OrgState>({
        materializer: ORG_MATERIALIZER,
        orgId,
        streamId: ORG_STREAM,
        actorId,
        deviceId,
        store,
        transport,
        newId: () => Crypto.randomUUID(),
        diag: diagnostics,
        onMembershipChanged: () => setMembershipEpoch((n) => n + 1)
      });
      await client.load();
      if (cancelled) return;
      clientRef.current = client;
      const scheduler = new SyncScheduler({
        run: async () => { await sync(); return { offline: onlineRef.current === false }; }
      });
      schedulerRef.current = scheduler;
      unwatch = transport.watch(orgId, ORG_STREAM, {
        onPoke: () => scheduler.nudge(),
        onStatus: (connected) => { setLive(connected); scheduler.connection(connected); }
      });
      await refresh();
      scheduler.start();
    })();
    return () => {
      cancelled = true;
      unwatch();
      schedulerRef.current?.stop();
      schedulerRef.current = null;
      clientRef.current = null;
    };
  }, [orgId, actorId, refresh, sync]);

  const append = useCallback(
    async <T extends OrgEventType>(type: T, payload: EventPayloads[T]) => {
      const c = clientRef.current;
      if (!c) return;
      const written = c.append(type, payload);
      setState({ ...c.getState() });
      await written;
      await refresh();
      schedulerRef.current?.nudge();
    },
    [refresh]
  );

  const inspect = useCallback(() => clientRef.current?.inspect() ?? Promise.resolve(null), []);
  return { state, pending, append, sync, live, inspect, pulled, settled, membershipEpoch };
}
