import { DEFAULT_TRANSFER_BUDGET_BYTES, LanguageSession, TransferBudget, ensureDeviceId, type LanguageStatus, type SyncInspection } from '@langquest-next/sync';
import { CommandError, emptyLanguageState, type BlobRef, type EventPayloads, type EventSpec, type EventType, type LanguageState } from '@langquest-next/core';
import { getBlobStore, type BlobFile, type BlobStore } from './blobs';
import { downloadBlob, streamUrl, uploadBlob } from './server/blobTransport';
import { diagnostics, flushDiagnostics, timedTransfer, type TransferTimings } from './diagnostics';
import { getRecordingJournal } from './recordingJournal';
import { isRecording } from './useRecorder';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RateMeter } from './rate';
import { getStore } from './store';
import { trackSync } from './syncActivity';
import { onWake } from './wake';
import { serverTransport } from './server/sync';
import { stateCopier } from './publishedState';
import { t } from './i18n';

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
   * Events of this language the server refused one by one (a role changed,
   * say), kept on this device and listed on Sync. Never silently dropped
   * (PLAN.md invariant 1): My Work and Me say there are some.
   */
  refusedEvents: number;
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
const LIMITS = { minFreeBytes: 500 * 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 * 1024 };

/** One budget per device, shared by every language's workers. */
const transferBudget = new TransferBudget(DEFAULT_TRANSFER_BUDGET_BYTES);

const NOTHING_YET: LanguageStatus = {
  revision: 0, saving: false, pending: 0, refusedEvents: 0, lastSync: 'never', online: null, tooOld: false,
  refused: null, pulled: false, live: false, pendingUp: 0, pendingDown: 0, peakUp: 0, peakDown: 0,
  present: new Set(), keptUnits: new Set()
};

/**
 * The open language's stream for screens. The stream itself (its
 * SyncClient, transfers, scheduler and reclaim) is a `LanguageSession` in
 * packages/sync (decisions.md 104); this hook opens one with the phone's
 * store, files and transport, follows it into React state, and adds what is
 * the phone's own: playable URLs, transfer speeds, and finishing a
 * recording a crash interrupted. Screens read `state` and call `append`;
 * nothing else in the app touches events or sync.
 */
export function useLanguage(orgId: string, openId: string | null, actorId: string, membershipEpoch = 0): LanguageHandle {
  // Before the organization has a language there is no stream to sync: an
  // empty language, and every write a no-op.
  const languageId = openId ?? '';
  const sessionRef = useRef<LanguageSession | null>(null);
  const filesRef = useRef<BlobStore | null>(null);
  const [state, setState] = useState<LanguageState | null>(null);
  const [status, setStatus] = useState<LanguageStatus>(NOTHING_YET);
  // Bumped when a web recording's URL is ready (blobs.ts uriFor); only its re-render matters.
  const [, setUrlsReady] = useState(0);
  const upMeter = useRef(new RateMeter());
  const downMeter = useRef(new RateMeter());

  // Back on screen or back online: sync now rather than at the end of a backoff.
  useEffect(() => onWake(() => sessionRef.current?.wake()), []);

  // The organization stream changed someone's membership or a role: work
  // the server refused for want of one may be accepted now (NOT_MEMBER).
  useEffect(() => {
    if (membershipEpoch === 0) return;
    void sessionRef.current?.membershipChanged().catch(() => {});
  }, [membershipEpoch]);

  useEffect(() => {
    let cancelled = false;
    let opened: LanguageSession | null = null;
    const stops: (() => void)[] = [];
    // Another language opened (docs/decisions.md 37): nothing from the last
    // language may show under this one while it loads.
    setState(null);
    setStatus(NOTHING_YET);
    if (!openId) {
      setState(emptyLanguageState());
      setStatus({ ...NOTHING_YET, pulled: true });
      return;
    }
    (async () => {
      const store = await getStore();
      // One random id per install, persisted. Every device must differ or
      // clocks can tie and the fold becomes order-dependent.
      const deviceId = await ensureDeviceId(store, () => Crypto.randomUUID());
      const files = await getBlobStore();
      const where = { orgId, streamId: languageId };
      const session = await LanguageSession.open({
        orgId, languageId, actorId, deviceId, store, files,
        transport: serverTransport(),
        upload: (ref) => metered(upMeter.current, files, ref, 'up', where, (timings) => uploadBlob(orgId, languageId, ref, files, timings)),
        download: (ref) => metered(downMeter.current, files, ref, 'down', where, (timings) => downloadBlob(orgId, languageId, ref, files, timings)),
        budget: transferBudget,
        limits: LIMITS,
        // Recording comes first: transfers, and the whole-state clone a checkpoint takes, wait.
        isDeferred: isRecording,
        client: {
          // Hermes has no global crypto.randomUUID.
          newId: () => Crypto.randomUUID(),
          // A long catch-up shares the thread with taps and the meter.
          yieldBetweenPages: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
          diag: diagnostics
        },
        aroundSync: trackSync,
        onSettled: ({ blobsWanted }) => { void flushDiagnostics({ blobCacheBytes: files.totalBytes(), blobsWanted }).catch(() => {}); }
      });
      if (cancelled) { session.close(); return; }
      opened = session;
      sessionRef.current = session;
      filesRef.current = files;
      // The fold mutates in place, so copy the top level, but only when the
      // fold changed: identity is the revision (publishedState.ts).
      const copy = stateCopier();
      const publish = () => {
        const next = copy(session.state, session.status.revision);
        if (next) setState(next);
        setStatus(session.status);
      };
      stops.push(session.subscribe(publish));
      // Web: a recording's playable URL is read from the browser's files on first ask; draw again once it is.
      stops.push(files.onUrlReady(() => setUrlsReady((n) => n + 1)));
      session.start();
      publish();
      // Finish any save a crash or kill interrupted (recordingJournalCore.ts).
      // Idempotent by recordingId; runs after the workers so the upload
      // pass sees the recovered card.
      const resumed = await getRecordingJournal().resume({ orgId, languageId }, {
        blobExists: (hash, format) => files.exists({ hash, format }),
        ingest: async (uri, format, beforeMove) => {
          const { ref, size } = await files.ingest(uri, format, (ref, size) => beforeMove(ref.hash, size));
          return { hash: ref.hash, size };
        },
        hasRecording: (id) => !!session.state.recordings[id],
        append: async (e) => {
          await session.client.append('v1.RecordingAdded', {
            recordingId: e.id, unitId: e.target.unitId, kind: 'target',
            cards: [{ hash: e.hash, durationMs: e.durationMs, format: e.format }]
          });
        }
      }).catch(() => null);
      if (cancelled || !resumed?.resumed.length) return;
      await session.refresh();
      session.triggerUpload();
    })();
    return () => {
      cancelled = true;
      for (const stop of stops) stop();
      opened?.close();
      sessionRef.current = null;
      filesRef.current = null;
    };
  }, [orgId, languageId, openId, actorId]);

  const sync = useCallback(() => sessionRef.current?.sync() ?? Promise.resolve({ more: false }), []);

  const append = useCallback(
    async <T extends EventType>(type: T, payload: EventPayloads[T], parentEventId?: string) => {
      await sessionRef.current?.append(type, payload, parentEventId);
    },
    []
  );

  const appendMany = useCallback(
    async <T extends EventType>(items: { type: T; payload: EventPayloads[T] }[]) => {
      await sessionRef.current?.appendMany(items);
    },
    []
  );

  const run = useCallback(async (specs: EventSpec[]) => {
    const session = sessionRef.current;
    if (specs.length === 0) return;
    // Nothing to write into yet: say so, rather than skip it and let the screen
    // say it was saved (REC-035). ctx.act shows it as "Not saved: …".
    if (!session) throw new CommandError(t('translate.languageLoading'));
    await session.run(specs);
  }, []);

  const keepOffline = useCallback(async (unitId: string, keep: boolean) => {
    await sessionRef.current?.keepOffline(unitId, keep);
  }, []);

  const blobs = {
    pendingUp: status.pendingUp,
    pendingDown: status.pendingDown,
    uriFor: (ref: BlobFile) => filesRef.current?.uriFor(ref) ?? null,
    streamUri: (ref: BlobFile) => streamUrl(orgId, languageId, ref),
    store: filesRef.current,
    keptUnits: status.keptUnits,
    keepOffline,
    present: status.present,
    peakUp: status.peakUp,
    peakDown: status.peakDown,
    rates: () => ({ up: upMeter.current.perSecond(), down: downMeter.current.perSecond() }),
    unsent: () => sessionRef.current?.unsent() ?? []
  };
  const triggerUpload = useCallback(() => sessionRef.current?.triggerUpload(), []);
  const inspect = useCallback(() => sessionRef.current?.inspect() ?? Promise.resolve(null), []);
  const { pending, lastSync, online, tooOld, refused, refusedEvents, pulled, live, saving, revision } = status;

  return { orgId, languageId, state, pending, lastSync, online, tooOld, refused, refusedEvents, pulled, live, saving, revision, inspect, blobs, triggerUpload, append, appendMany, run, sync };
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
