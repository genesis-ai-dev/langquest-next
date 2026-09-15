import { DOWNLOAD_DEFAULTS, SupabaseTransport, SyncClient, TransferWorker, UPLOAD_DEFAULTS, ensureDeviceId } from '@langquest-next/client';
import { defaultOfflineScope, deriveDownloadWork, deriveUploadWork, type BlobRef, type EventPayloads, type EventType, type ProjectState } from '@langquest-next/core';
import { getBlobStore, type BlobFile, type BlobStore } from './blobs';
import { downloadBlob, uploadBlob } from './blobTransport';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getStore } from './store';
import { supabase } from './supabase';

export interface ProjectHandle {
  orgId: string;
  projectId: string;
  state: ProjectState | null;
  pending: number;
  lastSync: string;
  /**
   * Did the server answer? null until the first sync attempt, false only
   * when it could not be reached. A refusal is an answer: see `refused`.
   */
  online: boolean | null;
  /** The server refuses this app version; work is kept locally until an upgrade. */
  tooOld: boolean;
  /**
   * The server answered and refused this actor for this partition (not a
   * member), with its reason. Syncing again will not clear it; only a
   * membership change or a different account will.
   */
  refused: string | null;
  /** Blob transfer state (PLAN.md section 14). Downloads follow `keptUnits` plus the actor's own work. */
  blobs: {
    pendingUp: number;
    pendingDown: number;
    uriFor: (ref: BlobFile) => string | null;
    store: BlobStore | null;
    keptUnits: ReadonlySet<string>;
    keepOffline: (unitId: string, keep: boolean) => Promise<void>;
  };
  /** Call after recording: clears upload backoff and starts a pass now. */
  triggerUpload: () => void;
  append: <T extends EventType>(type: T, payload: EventPayloads[T], parentEventId?: string) => Promise<void>;
  /** Many events, one store transaction: template instantiation, bulk assignment. */
  appendMany: <T extends EventType>(items: { type: T; payload: EventPayloads[T] }[]) => Promise<void>;
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
  const [tooOld, setTooOld] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [keptUnits, setKeptUnits] = useState<ReadonlySet<string>>(new Set());
  const keptRef = useRef<ReadonlySet<string>>(new Set());
  const keepKey = `keep:${orgId}/${projectId}`;
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
      setTooOld(r.tooOld);
      setRefused(r.refused);
      // Online is exactly "the server answered". A refusal is an answer, so a
      // device whose membership is missing is online and says so; it must not
      // be shown, or treated, as offline.
      const wasOnline = onlineRef.current;
      onlineRef.current = !r.offline;
      setOnline(!r.offline);
      // New confirmations may have arrived: re-derive. Reconnect: retry now.
      if (!r.offline && wasOnline === false) upRef.current?.trigger();
      else upRef.current?.nudge();
      downRef.current?.nudge();
      setLastSync(
        r.offline
          ? 'offline'
          : r.refused
            ? `refused: ${r.refused}`
            : r.pushed === 0 && r.pulled === 0 && r.rejected === 0
              ? `up to date ${new Date().toLocaleTimeString()}`
              : `pushed ${r.pushed}, pulled ${r.pulled}, rejected ${r.rejected}`
      );
    } catch (err) {
      // Not a transport failure: those come back as `offline` above. We do not
      // know whether the server is reachable, so leave the flag where it was
      // rather than claiming offline.
      pullingRef.current = false;
      setLastSync(`error: ${(err as Error).message}`);
    }
    await refresh();
  }, [refresh]);

  useEffect(() => {
    let cancelled = false;
    let cleanupBlobs = () => {};
    (async () => {
      const store = await getStore();
      // One random id per install, persisted. Every device must differ or
      // clocks can tie and the fold becomes order-dependent.
      const deviceId = await ensureDeviceId(store, () => Crypto.randomUUID());
      const kept = new Set<string>(JSON.parse((await store.meta(keepKey)) || '[]') as string[]);
      keptRef.current = kept;
      setKeptUnits(kept);
      const client = new SyncClient({
        orgId,
        projectId,
        actorId,
        deviceId,
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
        // Size from the confirmation versus the file here: a mismatch reopens the upload.
        work: () => deriveUploadWork(client.getState(), blobStore.snapshot(), blobStore.sizes()),
        transfer: (ref) => uploadBlob(orgId, projectId, ref, blobStore),
        onChange: setPendingUp
      });
      const down = new TransferWorker({
        ...DOWNLOAD_DEFAULTS,
        ...common,
        // Rule 10: by scope, never the whole project. Scope is the actor's
        // own units plus what they explicitly chose to keep offline.
        work: () => {
          const scope = defaultOfflineScope(client.getState(), actorId);
          for (const u of keptRef.current) scope.add(u);
          return deriveDownloadWork(client.getState(), blobStore.snapshot(), scope);
        },
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
  }, [orgId, projectId, actorId, refresh, sync, keepKey]);

  const append = useCallback(
    async <T extends EventType>(type: T, payload: EventPayloads[T], parentEventId?: string) => {
      const c = clientRef.current;
      if (!c) return;
      await c.append(type, payload, parentEventId);
      await refresh();
    },
    [refresh]
  );

  const appendMany = useCallback(
    async <T extends EventType>(items: { type: T; payload: EventPayloads[T] }[]) => {
      const c = clientRef.current;
      if (!c || items.length === 0) return;
      await c.appendMany(items);
      await refresh();
    },
    [refresh]
  );

  const keepOffline = useCallback(
    async (unitId: string, keep: boolean) => {
      const next = new Set(keptRef.current);
      if (keep) next.add(unitId);
      else next.delete(unitId);
      keptRef.current = next;
      setKeptUnits(next);
      const store = await getStore();
      await store.setMeta(keepKey, JSON.stringify([...next]));
      downRef.current?.nudge();
    },
    [keepKey]
  );

  const blobs = {
    pendingUp,
    pendingDown,
    uriFor: (ref: BlobFile) => storeRef.current?.uriFor(ref) ?? null,
    store: storeRef.current,
    keptUnits,
    keepOffline
  };
  const triggerUpload = useCallback(() => upRef.current?.trigger(), []);

  return { orgId, projectId, state, pending, lastSync, online, tooOld, refused, blobs, triggerUpload, append, appendMany, sync };
}
