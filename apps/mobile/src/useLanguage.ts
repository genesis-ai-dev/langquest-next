import { DEFAULT_TRANSFER_BUDGET_BYTES, DOWNLOAD_DEFAULTS, SupabaseTransport, SyncClient, TransferBudget, TransferWorker, UPLOAD_DEFAULTS, ensureDeviceId, SyncScheduler, type SyncInspection } from '@langquest-next/client';
import { audioFormatsFor, defaultOfflineScope, emptyLanguageState, deriveDownloadWork, deriveUploadWork, evictableBlobs, type BlobRef, type EventPayloads, type EventSpec, type EventType, type LanguageState } from '@langquest-next/core';
import { getBlobStore, type BlobFile, type BlobStore } from './blobs';
import { downloadBlob, streamUrl, uploadBlob } from './blobTransport';
import { diagnostics, flushDiagnostics, timedTransfer, type TransferTimings } from './diagnostics';
import { getRecordingJournal } from './recordingJournal';
import { isRecording } from './useRecorder';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RateMeter } from './rate';
import { getStore } from './store';
import { onWake } from './wake';
import { supabase } from './supabase';

export interface LanguageHandle {
  orgId: string;
  languageId: string;
  state: LanguageState | null;
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
   * The server answered and refused this actor for this language (not a
   * member), with its reason. Syncing again will not clear it; only a
   * membership change or a different account will.
   */
  refused: string | null;
  /**
   * This session has read the language up to date from the server at least
   * once. Writes that must not race what others already wrote (starting a
   * language) wait for it.
   */
  pulled: boolean;
  /** Blob transfer state (PLAN.md section 14). Downloads follow `keptUnits` plus the actor's own work. */
  /** The realtime channel is up: appends elsewhere reach this phone in seconds. */
  live: boolean;
  /**
   * A local write is queued or in flight: what the screen shows is in
   * memory but not yet on disk. False means everything shown is saved
   * locally (it may still be pending upload: see `pending`).
   */
  saving: boolean;
  /** Fold revision, bumped on every local or pulled change. */
  revision: number;
  /** The local log as the sync screen shows it; null before load. */
  inspect: () => Promise<SyncInspection | null>;
  blobs: {
    pendingUp: number;
    pendingDown: number;
    /** Highest pending count since the queue was last empty: the bar's denominator. */
    peakUp: number;
    peakDown: number;
    /** Bytes per second over the last ten seconds. */
    rates: () => { up: number; down: number };
    uriFor: (ref: BlobFile) => string | null;
    /** A link to play a file the server has, without keeping it here; rejects offline. */
    streamUri: (ref: BlobFile) => Promise<string>;
    store: BlobStore | null;
    keptUnits: ReadonlySet<string>;
    keepOffline: (unitId: string, keep: boolean) => Promise<void>;
    /** Audio files on this phone now; a new set whenever one arrives or is reclaimed. */
    present: ReadonlySet<string>;
    /** Recordings here the server has not confirmed: what a hand-over must still send (handOver.ts). */
    unsent: () => BlobRef[];
  };
  /** Call after recording: clears upload backoff and starts a pass now. */
  triggerUpload: () => void;
  append: <T extends EventType>(type: T, payload: EventPayloads[T], parentEventId?: string) => Promise<void>;
  /** Many events, one store transaction: template instantiation, bulk assignment. */
  appendMany: <T extends EventType>(items: { type: T; payload: EventPayloads[T] }[]) => Promise<void>;
  /**
   * Apply a command's events (core `commands()`), one store transaction,
   * with the command's stable ids. Screens describe the operation; core
   * decides the events.
   */
  run: (specs: EventSpec[]) => Promise<void>;
  /** One bounded sync slice. Resolves to whether work remains. */
  sync: () => Promise<{ more: boolean }>;
}

/** Keep this much free for recording, and cap the cache; evict only what the server can give back. */
const MIN_FREE_BYTES = 500 * 1024 * 1024;
const MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024;

/** One budget per device, shared by every language's workers. */
const transferBudget = new TransferBudget(DEFAULT_TRANSFER_BUDGET_BYTES);

/**
 * Owns one SyncClient for one language stream on this device. Screens read `state`
 * and call `append`; nothing else in the app touches events or sync.
 */
export function useLanguage(orgId: string, openId: string | null, actorId: string, membershipEpoch = 0): LanguageHandle {
  // Before the organization has a language there is no stream to sync: an
  // empty language, and every write a no-op.
  const languageId = openId ?? '';
  const clientRef = useRef<SyncClient | null>(null);
  const [state, setState] = useState<LanguageState | null>(null);
  const [pending, setPending] = useState(0);
  const [lastSync, setLastSync] = useState('never');
  const [online, setOnline] = useState<boolean | null>(null);
  // Bumped when a web recording's URL is ready (blobs.ts uriFor); only its re-render matters.
  const [, setUrlsReady] = useState(0);
  const [tooOld, setTooOld] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [pulled, setPulled] = useState(false);
  const [keptUnits, setKeptUnits] = useState<ReadonlySet<string>>(new Set());
  const keptRef = useRef<ReadonlySet<string>>(new Set());
  const keepKey = `keep:${orgId}/${languageId}`;
  const [present, setPresent] = useState<ReadonlySet<string>>(new Set());
  const [pendingUp, setPendingUp] = useState(0);
  const [pendingDown, setPendingDown] = useState(0);
  const [peakUp, setPeakUp] = useState(0);
  const [peakDown, setPeakDown] = useState(0);
  const [live, setLive] = useState(false);
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const schedulerRef = useRef<SyncScheduler | null>(null);
  const upMeter = useRef(new RateMeter());
  const downMeter = useRef(new RateMeter());
  const storeRef = useRef<BlobStore | null>(null);
  const upRef = useRef<TransferWorker | null>(null);
  const downRef = useRef<TransferWorker | null>(null);
  const onlineRef = useRef<boolean | null>(null);
  const pullingRef = useRef(false);
  const pendingUpRef = useRef(0);
  const pendingDownRef = useRef(0);

  const refresh = useCallback(async () => {
    const c = clientRef.current;
    if (!c) return;
    // The fold mutates in place; copy the top level so React sees a change.
    setState({ ...c.getState() });
    // The count is a query; it must not hold the state update.
    void c.pendingCount().then(setPending).catch(() => {});
  }, []);

  const sync = useCallback(async (): Promise<{ more: boolean }> => {
    const c = clientRef.current;
    if (!c) return { more: false };
    let changed = true;
    let more = false;
    try {
      pullingRef.current = true;
      const r = await c.sync();
      pullingRef.current = false;
      more = r.more;
      changed = r.pushed > 0 || r.pulled > 0 || r.rejected > 0;
      setTooOld(r.tooOld);
      setRefused(r.refused);
      if (!r.offline && !r.refused && !r.more) setPulled(true);
      // Diagnostics go only after this phone's own work: outbox empty, uploads idle.
      if (!r.offline && !r.more && pendingUpRef.current === 0) {
        void c.pendingCount()
          .then((n) => (n === 0 ? flushDiagnostics({ blobCacheBytes: storeRef.current?.totalBytes(), blobsWanted: pendingDownRef.current }) : undefined))
          .catch(() => {});
      }
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
              ? 'up to date'
              : `pushed ${r.pushed}, pulled ${r.pulled}, rejected ${r.rejected}`
      );
    } catch (err) {
      // Not a transport failure: those come back as `offline` above. We do not
      // know whether the server is reachable, so leave the flag where it was
      // rather than claiming offline.
      pullingRef.current = false;
      setLastSync(`error: ${(err as Error).message}`);
    }
    if (changed) await refresh();
    return { more };
  }, [refresh]);

  // Back on screen or back online: sync now rather than at the end of a backoff.
  useEffect(() => onWake(() => schedulerRef.current?.wake()), []);

  // The organization stream changed someone's membership or a role: work
  // the server refused for want of one may be accepted now (NOT_MEMBER).
  useEffect(() => {
    if (membershipEpoch === 0) return;
    const c = clientRef.current;
    if (!c) return;
    void c.retryRejected(['NOT_MEMBER', 'NOT_ALLOWED']).then((n) => {
      if (n > 0) schedulerRef.current?.nudge();
    }).catch(() => {});
  }, [membershipEpoch]);

  useEffect(() => {
    let cancelled = false;
    let cleanupBlobs = () => {};
    // Another language opened (docs/decisions.md 37): nothing from the last
    // language may show under this one while it loads.
    setState(null);
    setPulled(false);
    setOnline(null);
    onlineRef.current = null;
    if (!openId) {
      setState(emptyLanguageState());
      setPulled(true);
      return;
    }
    (async () => {
      const store = await getStore();
      // One random id per install, persisted. Every device must differ or
      // clocks can tie and the fold becomes order-dependent.
      const deviceId = await ensureDeviceId(store, () => Crypto.randomUUID());
      const kept = new Set<string>(JSON.parse((await store.meta(keepKey)) || '[]') as string[]);
      keptRef.current = kept;
      setKeptUnits(kept);
      const transport = new SupabaseTransport(supabase);
      const client = new SyncClient({
        orgId,
        streamId: languageId,
        actorId,
        deviceId,
        store,
        transport,
        // Hermes has no global crypto.randomUUID.
        newId: () => Crypto.randomUUID(),
        // A long catch-up shares the thread with taps and the meter, and the
        // whole-state clone a checkpoint takes waits until recording is over.
        yieldBetweenPages: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
        deferCheckpoint: isRecording,
        diag: diagnostics
      });
      await client.load();
      const blobStore = await getBlobStore();
      if (cancelled) return;
      clientRef.current = client;
      storeRef.current = blobStore;
      // The client publishes after every fold change and every commit; the
      // screen follows that, not the call sites. The fold mutates in place,
      // so copy the top level: identity is the revision.
      const unsubscribe = client.subscribe((s) => {
        setState({ ...s.state });
        setSaving(s.saving > 0);
        setRevision(s.revision);
      });

      const common = {
        isOnline: () => onlineRef.current !== false,
        isPulling: () => pullingRef.current,
        // Recording and local saves come first; transfers wait.
        isDeferred: isRecording,
        budget: transferBudget,
        // Upload size from disk; download size from the server's confirmation.
        sizeOf: (ref: BlobRef) => blobStore.sizeOf(ref.hash) ?? client.getState().blobs[ref.hash]?.size
      };
      const scopeNow = () => {
        const scope = defaultOfflineScope(client.getState(), actorId);
        for (const u of keptRef.current) scope.add(u);
        return scope;
      };
      // Storage pressure must never reach the recorder: after any change to
      // what is on disk, give back out-of-scope files the server still has.
      const reclaim = () => {
        try {
          blobStore.reclaim(
            evictableBlobs(client.getState(), blobStore.snapshot(), scopeNow(), blobStore.sizes()),
            { minFreeBytes: MIN_FREE_BYTES, maxTotalBytes: MAX_CACHE_BYTES }
          );
        } catch { /* disk queries can fail on some devices; try again next change */ }
      };
      const up = new TransferWorker({
        ...UPLOAD_DEFAULTS,
        ...common,
        // Size from the confirmation versus the file here: a mismatch reopens the upload.
        work: () => deriveUploadWork(client.getState(), blobStore.snapshot(), blobStore.sizes()),
        transfer: (ref) => metered(upMeter.current, blobStore, ref, 'up', { orgId, streamId: languageId }, (t) => uploadBlob(orgId, languageId, ref, blobStore, t)),
        onChange: (n) => { pendingUpRef.current = n; setPendingUp(n); setPeakUp((p) => (n === 0 ? 0 : Math.max(p, n))); }
      });
      const down = new TransferWorker({
        ...DOWNLOAD_DEFAULTS,
        ...common,
        // Rule 10: by scope, never the whole language. Scope is the actor's
        // own units plus what they explicitly chose to keep offline.
        work: () => deriveDownloadWork(client.getState(), blobStore.snapshot(), scopeNow()),
        transfer: (ref) => metered(downMeter.current, blobStore, ref, 'down', { orgId, streamId: languageId }, (t) => downloadBlob(orgId, languageId, ref, blobStore, t)),
        onChange: (n) => { pendingDownRef.current = n; setPendingDown(n); setPeakDown((p) => (n === 0 ? 0 : Math.max(p, n))); }
      });
      upRef.current = up;
      downRef.current = down;
      up.start();
      down.start();
      const unsub = blobStore.onChange(() => {
        up.nudge();
        down.nudge();
      });
      reclaim();
      const unsubReclaim = blobStore.onChange(reclaim);
      // What is on this phone, for the offline marks on passages and in Settings.
      setPresent(blobStore.snapshot());
      const unsubPresent = blobStore.onChange(() => setPresent(blobStore.snapshot()));
      // Web: a recording's playable URL is read from the browser's files on first ask; draw again once it is.
      const unsubUrls = blobStore.onUrlReady(() => setUrlsReady((n) => n + 1));
      // Sync on a poke from the server, after a local append, and on a
      // fallback poll that backs off while offline (SyncScheduler).
      const scheduler = new SyncScheduler({
        run: async () => { const { more } = await sync(); return { offline: onlineRef.current === false, more }; }
      });
      schedulerRef.current = scheduler;
      const unwatch = transport.watch(orgId, languageId, {
        onPoke: () => scheduler.nudge(),
        onStatus: (connected) => { setLive(connected); scheduler.connection(connected); }
      });
      cleanupBlobs = () => {
        unsubscribe();
        unsub();
        unsubReclaim();
        unsubPresent();
        unsubUrls();
        up.stop();
        down.stop();
        unwatch();
        scheduler.stop();
        schedulerRef.current = null;
      };

      await refresh();
      scheduler.start();
      // Finish any save a crash or kill interrupted (recordingJournalCore.ts).
      // Idempotent by recordingId; runs after the workers so the upload
      // pass sees the recovered card.
      const resumed = await getRecordingJournal().resume({ orgId, languageId }, {
        blobExists: (hash, format) => blobStore.exists({ hash, format }),
        ingest: async (uri, format, beforeMove) => {
          const { ref, size } = await blobStore.ingest(uri, format, (ref, size) => beforeMove(ref.hash, size));
          return { hash: ref.hash, size };
        },
        hasRecording: (id) => !!client.getState().recordings[id],
        append: async (e) => {
          await client.append('v1.RecordingAdded', {
            recordingId: e.id, unitId: e.target.unitId, kind: 'target',
            cards: [{ hash: e.hash, durationMs: e.durationMs, format: e.format }]
          });
        }
      }).catch(() => null);
      if (cancelled || !resumed?.resumed.length) return;
      await refresh();
      up.trigger();
    })();
    return () => {
      cancelled = true;
      cleanupBlobs();
      clientRef.current = null;
      upRef.current = null;
      downRef.current = null;
    };
  }, [orgId, languageId, openId, actorId, refresh, sync, keepKey]);

  // A voice note this device stored as WAV (a browser without MP4) goes
  // with an event saying so, ahead of the event that names it (decisions.md 71).
  const formatsFor = useCallback((items: readonly { type: EventType; payload: unknown }[]) => {
    const store = storeRef.current;
    const c = clientRef.current;
    return store && c ? audioFormatsFor(c.getState(), items, (hash) => store.formatOf(hash)) : [];
  }, []);

  const append = useCallback(
    async <T extends EventType>(type: T, payload: EventPayloads[T], parentEventId?: string) => {
      const c = clientRef.current;
      if (!c) return;
      const formats = formatsFor([{ type, payload }]);
      if (formats.length) await c.appendMany(formats);
      await c.append(type, payload, parentEventId);
      await refresh();
      schedulerRef.current?.nudge();
    },
    [refresh, formatsFor]
  );

  const appendMany = useCallback(
    async <T extends EventType>(items: { type: T; payload: EventPayloads[T] }[]) => {
      const c = clientRef.current;
      if (!c || items.length === 0) return;
      await c.appendMany<EventType>([...formatsFor(items), ...items]);
      await refresh();
      schedulerRef.current?.nudge();
    },
    [refresh, formatsFor]
  );

  const run = useCallback(
    async (specs: EventSpec[]) => {
      const c = clientRef.current;
      if (!c || specs.length === 0) return;
      await c.appendMany<EventType>([...formatsFor(specs), ...specs]);
      await refresh();
      schedulerRef.current?.nudge();
    },
    [refresh, formatsFor]
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
    streamUri: (ref: BlobFile) => streamUrl(orgId, languageId, ref),
    store: storeRef.current,
    keptUnits,
    keepOffline,
    present,
    peakUp,
    peakDown,
    rates: () => ({ up: upMeter.current.perSecond(), down: downMeter.current.perSecond() }),
    unsent: () => {
      const c = clientRef.current;
      const store = storeRef.current;
      return c && store ? deriveUploadWork(c.getState(), store.snapshot(), store.sizes()) : [];
    }
  };
  const triggerUpload = useCallback(() => upRef.current?.trigger(), []);
  const inspect = useCallback(() => clientRef.current?.inspect() ?? Promise.resolve(null), []);

  return { orgId, languageId, state, pending, lastSync, online, tooOld, refused, pulled, live, saving, revision, inspect, blobs, triggerUpload, append, appendMany, run, sync };
}

/** Time one transfer, credit its bytes to the meter once it succeeds, and tally it for diagnostics either way. */
async function metered(
  meter: RateMeter,
  store: BlobStore,
  ref: BlobRef,
  dir: 'up' | 'down',
  where: { orgId: string; streamId: string },
  run: (timings: TransferTimings) => Promise<void>
): Promise<void> {
  await timedTransfer(dir, where, async (timings) => {
    await run(timings);
    const bytes = store.sizes().get(ref.hash) ?? 0;
    meter.add(bytes);
    return bytes;
  });
}
