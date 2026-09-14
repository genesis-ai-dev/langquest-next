import { SupabaseTransport, SyncClient } from '@langquest-next/client';
import type { EventPayloads, EventType, ProjectState } from '@langquest-next/core';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getStore } from './store';
import { supabase } from './supabase';

export interface ProjectHandle {
  state: ProjectState | null;
  pending: number;
  lastSync: string;
  /** null until the first sync attempt; false after an offline result. */
  online: boolean | null;
  append: <T extends EventType>(type: T, payload: EventPayloads[T], parentEventId?: string) => Promise<void>;
  sync: () => Promise<void>;
}

const SYNC_INTERVAL_MS = 15_000;

/**
 * Owns one SyncClient for one project on this device. Screens read `state`
 * and call `append`; nothing else in the app touches events or sync.
 */
export function useProject(orgId: string, projectId: string, actorId: string): ProjectHandle {
  const clientRef = useRef<SyncClient | null>(null);
  const [state, setState] = useState<ProjectState | null>(null);
  const [pending, setPending] = useState(0);
  const [lastSync, setLastSync] = useState('never');
  const [online, setOnline] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    const c = clientRef.current;
    if (!c) return;
    // The fold mutates in place; copy the top level so React sees a change.
    setState({ ...c.getState() });
    setPending(await c.pendingCount());
  }, []);

  const sync = useCallback(async () => {
    const c = clientRef.current;
    if (!c) return;
    try {
      const r = await c.sync();
      // sync() swallows OfflineError into an all-zero result while pending stays > 0.
      const stillQueued = (await c.pendingCount()) > 0 && r.pushed === 0 && r.rejected === 0;
      setOnline(!stillQueued);
      setLastSync(
        r.pushed === 0 && r.pulled === 0 && r.rejected === 0
          ? `up to date ${new Date().toLocaleTimeString()}`
          : `pushed ${r.pushed}, pulled ${r.pulled}, rejected ${r.rejected}`
      );
    } catch (err) {
      setOnline(false);
      setLastSync(`error: ${(err as Error).message}`);
    }
    await refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const store = await getStore();
      const client = new SyncClient({
        orgId,
        projectId,
        actorId,
        deviceId: 'mobile',
        store,
        transport: new SupabaseTransport(supabase),
        // Hermes has no global crypto.randomUUID.
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
  }, [orgId, projectId, actorId, refresh, sync]);

  const append = useCallback(
    async <T extends EventType>(type: T, payload: EventPayloads[T], parentEventId?: string) => {
      const c = clientRef.current;
      if (!c) return;
      await c.append(type, payload, parentEventId);
      await refresh();
    },
    [refresh]
  );

  return { state, pending, lastSync, online, append, sync };
}
