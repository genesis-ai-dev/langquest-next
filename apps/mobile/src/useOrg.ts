import { SupabaseTransport, SyncClient, ensureDeviceId, type Materializer } from '@langquest-next/client';
import { applyOrgEvent, emptyOrgState, foldOrg, ORG_PARTITION, REDUCER_VERSION, type EventPayloads, type OrgEventType, type OrgState } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getStore } from './store';
import { supabase } from './supabase';

export interface OrgHandle {
  state: OrgState | null;
  pending: number;
  append: <T extends OrgEventType>(type: T, payload: EventPayloads[T]) => Promise<void>;
  sync: () => Promise<void>;
}

const ORG_MATERIALIZER: Materializer<OrgState> = {
  empty: emptyOrgState,
  apply: applyOrgEvent,
  fold: foldOrg,
  compact: (s) => {
    s.appliedEventIds = {};
  },
  version: REDUCER_VERSION
};

const SYNC_INTERVAL_MS = 15_000;

/**
 * The organization partition on this device (docs/flow-coverage-audit.md
 * 5.A): roles, memberships, catalog toggles, project list. Same sync
 * client as a project, different fold. Small enough to pull whole.
 */
export function useOrg(orgId: string, actorId: string): OrgHandle {
  const clientRef = useRef<SyncClient<OrgState> | null>(null);
  const [state, setState] = useState<OrgState | null>(null);
  const [pending, setPending] = useState(0);

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
      changed = r.pushed > 0 || r.pulled > 0 || r.rejected > 0;
    } catch {
      // Offline or refused: state is whatever the local log says. Honest and quiet.
    }
    if (changed) await refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await getStore();
      const deviceId = await ensureDeviceId(store, () => Crypto.randomUUID());
      const client = new SyncClient<OrgState>({
        materializer: ORG_MATERIALIZER,
        orgId,
        projectId: ORG_PARTITION,
        actorId,
        deviceId,
        store,
        transport: new SupabaseTransport(supabase),
        newId: () => Crypto.randomUUID()
      });
      await client.load();
      if (cancelled) return;
      clientRef.current = client;
      await refresh();
      await sync();
    })();
    const timer = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
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
    },
    [refresh]
  );

  return { state, pending, append, sync };
}
