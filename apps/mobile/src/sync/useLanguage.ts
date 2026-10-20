import { DEFAULT_TRANSFER_BUDGET_BYTES, LanguageSession, TransferBudget, classifyTransferFailure, ensureDeviceId, type LanguageStatus, type SyncInspection } from '@langquest-next/sync';
import {
  CommandError, emptyLanguageState, languageLines, updatesFor as coreUpdatesFor, type BlobRef, type EventPayloads, type EventSpec, type EventType,
  type LanguageState, type LostFilesView, type OfflineSummary, type PassageLines, type UnitOffline, type Update
} from '@langquest-next/core';
import { getBlobStore, type BlobFile, type BlobStore } from './blobs';
import { downloadBlob, streamUrl, uploadBlob } from '../server/blobTransport';
import { diagnostics, flushDiagnostics, registerDeviceProbe, timedTransfer, type TransferTimings } from '../diagnostics/diagnostics';
import { noteExpected, reportError } from '../diagnostics/report';
import { getRecordingJournal } from '../recording/recordingJournal';
import { cutWav, deleteRecorderFile } from '../audio/wavCut';
import { isRecording } from '../recording/recorderState';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RateMeter } from './rate';
import { getStore } from './store';
import { trackSync } from './syncActivity';
import { onWake } from './wake';
import { serverTransport } from '../server/sync';
import { stateCopier } from './publishedState';
import { NO_LANGUAGE_STATUS, StatusStore, type LanguageStatusStore, type LanguageSyncStatus } from './syncStatusStore';
import { t } from '../i18n';
import { appBuild } from '../diagnostics/appBuild';

export interface LanguageHandle {
  orgId: string;
  languageId: string;
  state: LanguageState | null;
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
  /** Fold revision, bumped on every local or pulled change. */
  revision: number;
  /** The local log as the sync screen shows it; null before load. */
  inspect: () => Promise<SyncInspection | null>;
  /**
   * What changes while syncing (pending, lastSync, transfer counts, the files
   * here) is not on this handle: it would redraw every screen on every tick.
   * Components that show it call `useSyncStatus()`; the app gives it this store.
   */
  syncStatus: LanguageStatusStore;
  blobs: {
    /** Bytes per second over the last ten seconds. */
    rates: () => { up: number; down: number };
    uriFor: (ref: BlobFile) => string | null;
    /** A link to play a file the server has, without keeping it here; rejects offline. */
    streamUri: (ref: BlobFile) => Promise<string>;
    store: BlobStore | null;
    keptUnits: ReadonlySet<string>;
    keepOffline: (unitId: string, keep: boolean) => Promise<void>;
    /** Recordings here the server has not confirmed: what a hand-over must still send (handOver.ts). */
    unsent: () => Promise<BlobRef[]>;
    /**
     * The passages kept offline and how much of each one's audio is here,
     * and the whole scope at a glance; null until first counted. Counted
     * from the phone's table after changes (decisions.md 143), so a screen
     * reads them without waiting.
     */
    keptOffline: ReadonlyMap<string, UnitOffline> | null;
    offlineSummary: OfflineSummary | null;
    /** The passages this person keeps offline by default (asked of them or worked in). */
    scope: ReadonlySet<string>;
    /** What these files a phone lost were (decisions.md 92). */
    lost: (hashes: readonly string[]) => Promise<LostFilesView>;
  };
  /**
   * Each passage's line: what lists of passages read (Map, Progress, My
   * Work, the Inbox badge), so none needs every passage's record in memory
   * (decisions.md 143). A new object whenever a line changed.
   */
  lines: PassageLines;
  /**
   * Hold these passages' records in memory: the one a screen shows and
   * those next to it (decisions.md 143). Others stay on the phone's disk.
   */
  loadUnits: (unitIds: readonly string[]) => void;
  /** Is this passage's whole record in memory, so a screen may read it from `state`? */
  isLoaded: (unitId: string) => boolean;
  /** The language with these passages' records read in from disk, for a screen that lists a few passages beyond those in memory. */
  withPassages: (unitIds: readonly string[]) => Promise<LanguageState | null>;
  /** The passages whose versions tied in this key term. */
  passagesLinkingTerm: (termId: string) => Promise<string[]>;
  /** The passage a take is in; null when it is nowhere. */
  passageOfTake: (takeId: string) => Promise<string | null>;
  /** What happened that concerns this person (core `updatesFor`), read from the passages that concern them. */
  updatesFor: (actorId: string) => Promise<Update[]>;
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

const NO_LINES: PassageLines = languageLines(emptyLanguageState());

const NOTHING_YET: LanguageStatus = {
  revision: 0, pending: 0, refusedEvents: 0, lastSync: 'never', online: null, tooOld: false,
  refused: null, pulled: false, live: false, pendingUp: 0, pendingDown: 0, peakUp: 0, peakDown: 0,
  present: new Set(), keptUnits: new Set(), keptOffline: null, offlineSummary: null, scope: new Set(), lines: NO_LINES
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
  // What changes rarely, as React state; what ticks goes to `syncStatus` (see LanguageHandle).
  const [status, setStatus] = useState<LanguageStatus>(NOTHING_YET);
  const syncStatus = useMemo<LanguageStatusStore>(() => new StatusStore<LanguageSyncStatus>(NO_LANGUAGE_STATUS), []);
  // The file store, once opened: `blobs.store` follows it.
  const [files, setFiles] = useState<BlobStore | null>(null);
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
    setFiles(null);
    syncStatus.set({ ...NO_LANGUAGE_STATUS });
    if (!openId) {
      const empty = emptyLanguageState();
      setState(empty);
      setStatus({ ...NOTHING_YET, pulled: true, lines: languageLines(empty) });
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
        // Recordings and file verdicts stay on the phone; memory holds the passages on screen (decisions.md 143).
        keepOnDisk: true,
        build: appBuild(),
        onSettled: ({ blobsWanted }) => { void flushDiagnostics({ blobCacheBytes: files.totalBytes(), blobsWanted }).catch(() => {}); }
      });
      if (cancelled) { session.close(); return; }
      opened = session;
      sessionRef.current = session;
      filesRef.current = files;
      setFiles(files);
      // The fold mutates in place, so copy the top level, but only when the
      // fold changed: identity is the revision (publishedState.ts).
      const copy = stateCopier();
      const publish = () => {
        const next = copy(session.state, session.status.revision);
        if (next) setState(next);
        const now = session.status;
        // Only a change in what is shown redraws the shell; the ticking part goes to its own store.
        setStatus((prev) => (slowSame(prev, now) ? prev : now));
        syncStatus.set({
          pending: now.pending, lastSync: now.lastSync, pendingUp: now.pendingUp, pendingDown: now.pendingDown,
          peakUp: now.peakUp, peakDown: now.peakDown, present: now.present
        });
      };
      stops.push(session.subscribe(publish));
      // Uploads waiting and how long, for the device record (diagnostics.ts); gone with the session.
      stops.push(registerDeviceProbe(`language:${orgId}/${languageId}`, () => session.probe()));
      // Web: a recording's playable URL is read from the browser's files on first ask; draw again once it is.
      stops.push(files.onUrlReady(() => setUrlsReady((n) => n + 1)));
      session.start();
      publish();
      // Finish any save a crash or kill interrupted (recordingJournalModel.ts).
      // Idempotent by recordingId; runs after the workers so the upload
      // pass sees the recovered card.
      const resumed = await getRecordingJournal().resume({ orgId, languageId }, {
        // A session part the app never got to leave is cut from its chunk as its box last stood (LAN-82).
        cut: cutWav,
        deleteChunk: (uri) => { try { deleteRecorderFile(uri); } catch (e) { noteExpected('recording recovery: delete chunk', e); } },
        blobExists: (hash, format) => files.exists({ hash, format }),
        ingest: async (uri, format, beforeMove) => {
          const { ref, size } = await files.ingest(uri, format, (ref, size) => beforeMove(ref.hash, size));
          return { hash: ref.hash, size };
        },
        hasRecording: (id) => session.hasRecording(id),
        append: async (e) => {
          await session.client.append('v1.RecordingAdded', {
            recordingId: e.id, unitId: e.target.unitId, kind: 'target',
            cards: [{ hash: e.hash, durationMs: e.durationMs, format: e.format }]
          });
        }
      }).catch((e: unknown) => { reportError('recording recovery', e); return null; });
      // An entry that failed stays in the journal for the next open. Count
      // each failure by its cause's fixed class (a full disk, a file gone),
      // never its text; how many wait is the journal's own probe.
      for (const f of resumed?.failed ?? []) {
        noteExpected('recording recovery entry', new Error('recovery failed'), recoveryCode(f.error));
      }
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
  }, [orgId, languageId, openId, actorId, syncStatus]);

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

  // Stable, so the lost-files alert asks again only when what was lost changes.
  const lost = useCallback(async (hashes: readonly string[]): Promise<LostFilesView> =>
    sessionRef.current ? sessionRef.current.lost(hashes) : { safe: 0, unsent: 0, unitIds: [] }, []);
  const loadUnits = useCallback((unitIds: readonly string[]) => { void sessionRef.current?.loadUnits(unitIds); }, []);
  // A language with no stream yet (none opened) is empty and whole.
  const isLoaded = useCallback((unitId: string) => sessionRef.current?.isLoaded(unitId) ?? !openId, [openId]);
  const withPassages = useCallback(async (unitIds: readonly string[]) => (sessionRef.current ? sessionRef.current.withPassages(unitIds) : null), []);
  const passagesLinkingTerm = useCallback(async (termId: string) => sessionRef.current?.passagesLinkingTerm(termId) ?? [], []);
  const passageOfTake = useCallback(async (takeId: string) => sessionRef.current?.passageOfTake(takeId) ?? null, []);
  const updatesFor = useCallback(async (who: string) => {
    const session = sessionRef.current;
    return session ? session.updatesFor(who) : coreUpdatesFor(emptyLanguageState(), who);
  }, []);
  const uriFor = useCallback((ref: BlobFile) => filesRef.current?.uriFor(ref) ?? null, []);
  const streamUri = useCallback((ref: BlobFile) => streamUrl(orgId, languageId, ref), [orgId, languageId]);
  const rates = useCallback(() => ({ up: upMeter.current.perSecond(), down: downMeter.current.perSecond() }), []);
  const unsent = useCallback(() => sessionRef.current?.unsent() ?? Promise.resolve([]), []);
  const { keptUnits, keptOffline, offlineSummary, scope } = status;
  // One object until something it shows changes. The offline counts come worked out from the phone's table (decisions.md 143).
  const blobs = useMemo(
    () => ({ uriFor, streamUri, store: files, keptUnits, keepOffline, rates, unsent, keptOffline, offlineSummary, scope, lost }),
    [uriFor, streamUri, files, keptUnits, keepOffline, rates, unsent, keptOffline, offlineSummary, scope, lost]
  );
  const triggerUpload = useCallback(() => sessionRef.current?.triggerUpload(), []);
  const inspect = useCallback(() => sessionRef.current?.inspect() ?? Promise.resolve(null), []);
  const { online, tooOld, refused, refusedEvents, pulled, live, revision } = status;

  const { lines } = status;
  // One object until something it shows changes, so `ctx` can be one too.
  return useMemo(
    () => ({
      orgId, languageId, state, online, tooOld, refused, refusedEvents, pulled, live, revision, inspect, syncStatus, blobs,
      lines, loadUnits, isLoaded, withPassages, passagesLinkingTerm, passageOfTake, updatesFor, triggerUpload, append, appendMany, run, sync
    }),
    [orgId, languageId, state, online, tooOld, refused, refusedEvents, pulled, live, revision, inspect, syncStatus, blobs,
      lines, loadUnits, isLoaded, withPassages, passagesLinkingTerm, passageOfTake, updatesFor, triggerUpload, append, appendMany, run, sync]
  );
}

/** Whether nothing that changes slowly differs between two statuses (the ticking fields are not compared). */
function slowSame(a: LanguageStatus, b: LanguageStatus): boolean {
  return a.revision === b.revision && a.refusedEvents === b.refusedEvents && a.online === b.online && a.tooOld === b.tooOld
    && a.refused === b.refused && a.pulled === b.pulled && a.live === b.live && a.keptUnits === b.keptUnits
    && a.keptOffline === b.keptOffline && a.offlineSummary === b.offlineSummary && a.scope === b.scope && a.lines === b.lines;
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

/** A failed recovery's cause as a fixed code: its take's file gone, a full disk, or a transfer's class. Never the text. */
function recoveryCode(error: string): string {
  if (/missing|gone|not found|no such file/i.test(error)) return 'missing';
  return classifyTransferFailure(new Error(error));
}
