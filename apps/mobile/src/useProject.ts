import { DOWNLOAD_DEFAULTS, SupabaseTransport, SyncClient, TransferWorker, UPLOAD_DEFAULTS } from '@langquest-next/client';
import { deriveDownloadWork, deriveUploadWork, type BlobRef, type EventPayloads, type EventType, type ProjectState } from '@langquest-next/core';
import { getBlobStore, type BlobStore } from './blobs';
import { downloadBlob, uploadBlob } from './blobTransport';
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
  /** Blob transfer state (PLAN.md section 14). */
  blobs: { pendingUp: number; pendingDown: number; uriFor: (ref: BlobRef) => string | null; store: BlobStore | null };
  /** Call after recording: clears upload backoff and starts a pass now. */
  triggerUpload: () => void;
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
  const [pendingUp, setPendingUp] = useState(0);
  const [pendingDown, setPendingDown] = useState(0);
  const storeRef = useRef<BlobStore | null>(null);
  const upRef = useRef<TransferWorker | null>(null);
  const downRef = useRef<TransferWorker | null>(null);
  const onlineRef = useRef<boolean | null>(null);
  const pullingRef = useRef(false);

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
      pullingRef.current = true;
      const r = await c.sync();
      pullingRef.current = false;
      // sync() swallows OfflineError into an all-zero result while pending stays > 0.
      const stillQueued = (await c.pendingCount()) > 0 && r.pushed === 0 && r.rejected === 0;
      const wasOnline = onlineRef.current;
      onlineRef.current = !stillQueued;
      setOnline(!stillQueued);
      // New confirmations may have arrived: re-derive. Reconnect: retry now.
      if (!stillQueued && wasOnline === false) upRef.current?.trigger();
      else upRef.current?.nudge();
      downRef.current?.nudge();
      setLastSync(
        r.pushed === 0 && r.pulled === 0 && r.rejected === 0
          ? `up to date ${new Date().toLocaleTimeString()}`
          : `pushed ${r.pushed}, pulled ${r.pulled}, rejected ${r.rejected}`
      );
    } catch (err) {
      pullingRef.current = false;
      onlineRef.current = false;
      setOnline(false);
      setLastSync(`error: ${(err as Error).message}`);
    }
    await refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let cleanupBlobs = () => {};
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
      const blobStore = await getBlobStore();
      if (cancelled) return;
      clientRef.current = client;
      storeRef.current = blobStore;

      const common = {
        isOnline: () => onlineRef.current !== false,
        isPulling: () => pullingRef.current
      };
      const up = new TransferWorker({
        ...UPLOAD_DEFAULTS,
        ...common,
        work: () => deriveUploadWork(client.getState(), blobStore.snapshot()),
        transfer: (ref) => uploadBlob(orgId, projectId, ref, blobStore),
        onChange: setPendingUp
      });
      const down = new TransferWorker({
        ...DOWNLOAD_DEFAULTS,
        ...common,
        work: () => deriveDownloadWork(client.getState(), blobStore.snapshot()),
        transfer: (ref) => downloadBlob(orgId, projectId, ref, blobStore),
        onChange: setPendingDown
      });
      upRef.current = up;
      downRef.current = down;
      up.start();
      down.start();
      const unsub = blobStore.onChange(() => {
        up.nudge();
        down.nudge();
      });
      cleanupBlobs = () => {
        unsub();
        up.stop();
        down.stop();
      };

      await refresh();
      await sync();
    })();
    const timer = setInterval(() => void sync(), SYNC_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      cleanupBlobs();
      clientRef.current = null;
      upRef.current = null;
      downRef.current = null;
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

  const blobs = {
    pendingUp,
    pendingDown,
    uriFor: (ref: BlobRef) => storeRef.current?.uriFor(ref) ?? null,
    store: storeRef.current
  };
  const triggerUpload = useCallback(() => upRef.current?.trigger(), []);

  return { state, pending, lastSync, online, blobs, triggerUpload, append, sync };
}
