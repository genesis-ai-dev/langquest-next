import type { BlobRef } from '@langquest-next/core';
import type { RecordingFile } from '../sync/blobs';
import { AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio';
import { holdMicrophone, setSessionAudioMode, stopAudioPlayback } from '../audio/audioSession';
import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import MicrophoneEnergy from '../../modules/microphone-energy';
import { preferredRecordingType } from '../audio/audioFormat';
import { getBlobStore } from '../sync/blobs';
import { t } from '../i18n';
import { getRecordingJournal, liveParts } from './recordingJournal';
import { RecordingSession } from './recordingSession';
import { liveKept, liveKeptCount, liveNext } from './livePartsModel';
import { cutWav, deleteRecorderFile } from '../audio/wavCut';
import { noteExpected } from '../diagnostics/report';
import { cachedHeardLevels, keepHeardLevels, loadHeardLevels } from '../mic/heardLevels';
import type { JournalTarget } from './recordingJournalModel';
import { storableRecording } from '../web/webAudio';
import { claimVad, MicrophoneRefused, recorderProblem, vadOwner, activity } from './recorderState';
import { recorderFaultCode, type RecorderFailure, type RecorderStage } from './recorderFaultModel';
import { countAudio, type AudioLanguage } from '../audio/audioTally';

const WEB = Platform.OS === 'web';
/** A browser records MP4 when it can (audioFormat.ts); otherwise the take is converted to WAV when it stops. */
const WEB_TYPE = WEB && typeof MediaRecorder !== 'undefined' ? preferredRecordingType((t) => MediaRecorder.isTypeSupported(t)) : undefined;

/**
 * Hold-to-record takes on a browser still go through expo-audio's
 * MediaRecorder (small MP4 where it can). A phone records them with the
 * microphone module, like voice-detected parts (decisions.md 106), so a phone
 * never has two recorders open and a take starts as soon as the microphone
 * does. The choice is fixed when the app loads, so the hook order never changes.
 */
function useBrowserTakeRecorder() {
  return useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY, directory: 'document',
    ...(WEB_TYPE ? { web: { mimeType: WEB_TYPE, bitsPerSecond: 128000 } } : {})
  });
}
const useTakeRecorder: () => ReturnType<typeof useAudioRecorder> | null = WEB ? useBrowserTakeRecorder : () => null;

/** A hold-to-record take starts with whatever the microphone heard since it opened, up to this. */
const TAKE_HEAD_START_MS = 500;
/** A hold-to-record take shorter than this was a tap, not speech: it is deleted unsaid. */
const SHORTEST_TAKE_MS = 200;
/**
 * Stop is tapped as the last word is said: the take runs on until the voice
 * falls back to the room, up to this long (LAN-82).
 */
const TAKE_TAIL_MAX_MS = 600;
let keepAwakeTags = 0;

export interface RecordedCard {
  /** Stable id chosen before any save step; the handler uses it as recordingId. */
  id: string;
  ref: RecordingFile;
  durationMs: number;
  size: number;
}
type RecorderCardHandler = (card: RecordedCard) => void | Promise<void>;
interface PendingFile {
  id: string;
  uri: string;
  format: BlobRef['format'];
  durationMs: number;
  card?: RecordedCard;
}

/**
 * The microphone permission prompt takes the app out of `active` (iOS goes
 * `inactive`, Android `background`), which would read as leaving the app and
 * stop the very recording being asked for. While one is open, that is ignored.
 */
let askingForMicrophone = 0;
async function askForMicrophone() {
  askingForMicrophone++;
  try { return await AudioModule.requestRecordingPermissionsAsync(); }
  finally { askingForMicrophone--; }
}

/** A finished file the phone may delete: a take too short to keep, or a WAV once its AAC copy is safe. */
function deleteQuietly(uri: string) {
  try { const f = new File(uri); if (f.exists) f.delete(); } catch (e) { noteExpected('recorder: delete', e, recorderFaultCode(e)); }
}

/**
 * Serializes microphone startup, release and durable file delivery.
 * `target` names the passage a delivered card belongs to; with it, a save
 * interrupted at any stage is journaled and finished on the next launch
 * (see recordingJournalModel.ts). Without it the journal still protects the
 * file until the handler returns. Takes and failures are counted for field
 * diagnostics under the target's language, else under `language` when the
 * screen has one open.
 */
export function useRecorder(onCard: RecorderCardHandler, target?: JournalTarget, language?: AudioLanguage | null) {
  const recorder = useTakeRecorder();
  const [vadOn, setVadOn] = useState(false);
  const [vadPaused, setVadPaused] = useState(false);
  const [vadCapturing, setVadCapturing] = useState(false);
  const [manualOn, setManualOn] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(0);
  const [failureCount, setFailureCount] = useState(0);
  const mounted = useRef(true);
  const self = useRef(Symbol('recorder')).current;
  const handler = useRef(onCard);
  handler.current = onCard;
  const targetRef = useRef(target);
  targetRef.current = target;
  const languageRef = useRef<AudioLanguage | null>(null);
  languageRef.current = target ? { orgId: target.orgId, languageId: target.languageId } : language ?? null;
  const wanted = useRef(false);
  const active = useRef(false);
  const startedAt = useRef(0);
  const starting = useRef<Promise<void> | null>(null);
  const stopping = useRef<Promise<void> | null>(null);
  const vadActive = useRef(false);
  const vadPausedRef = useRef(false);
  /** A phone's hold-to-record take is open in the microphone module: its file is not a voice-detected part. */
  const manualSegment = useRef(false);
  const vadStarting = useRef<Promise<void> | null>(null);
  const vadStopping = useRef<Promise<void> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const failures = useRef<PendingFile[]>([]);
  /** The voice's last level seen, for ending a tapped take once it falls back to the room. */
  const level = useRef(0);
  /**
   * The recording session open now (LAN-82): from the first tap of record
   * until it is left, through every stop and carry on. Its parts are boxes
   * on the waveform until then; leaving cuts each from its chunk as its box
   * stands, and only then are they saved (endSession).
   */
  const session = useRef<RecordingSession | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  /** Bumped when the session's parts change, so the screen redraws its count and the next part's number. */
  const [, setPartsSeen] = useState(0);
  const ending = useRef<Promise<void> | null>(null);
  const fail = useCallback((stage: RecorderStage, e: unknown, failed: RecorderFailure = null) => {
    const said = recorderProblem(stage, e, failed, languageRef.current);
    if (mounted.current) setError(said);
  }, []);
  const count = useCallback((counter: Parameters<typeof countAudio>[1], by = 1) => countAudio(languageRef.current, counter, by), []);
  const work = useCallback((delta: number) => {
    if (mounted.current) setWorking((n) => Math.max(0, n + delta));
  }, []);

  const deliver = useCallback((file: PendingFile) => {
    work(1);
    queue.current = queue.current.then(async () => {
      const journal = getRecordingJournal();
      const entry = () => ({ id: file.id, uri: file.uri, format: file.format,
        durationMs: Math.round(file.durationMs), target: targetRef.current });
      try {
        if (!file.card) {
          const store = await getBlobStore();
          const previous = (await journal.all()).find((e) => e.id === file.id);
          if (previous?.hash && store.exists({ hash: previous.hash, format: file.format })) {
            file.card = { id: file.id, ref: { hash: previous.hash, format: file.format },
              size: previous.size ?? store.storedSize({ hash: previous.hash, format: file.format }),
              durationMs: entry().durationMs };
          } else {
            let wavKept = false;
            await journal.put(previous ?? { ...entry(), stage: 'recorded' });
            // A phone keeps AAC, about a fifth of the WAV (decisions.md 106). The
            // journal names the AAC copy before the WAV goes, so a restart finds
            // one of them; if encoding fails, the WAV is kept as it is.
            if (!WEB && file.format === 'wav') {
              try {
                const wav = file.uri;
                file.uri = await MicrophoneEnergy.encodeAac(wav);
                file.format = 'm4a';
                await journal.put({ ...entry(), stage: 'recorded' });
                deleteQuietly(wav);
              } catch (e) {
                const code = recorderFaultCode(e) === 'nospace' ? 'nospace' : 'encode';
                noteExpected('recorder: aac', e, code);
                count('encodeFail');
                wavKept = true;
              }
            }
            const { ref, size } = await store.ingest(file.uri, file.format, (ref, size) =>
              journal.put({ ...entry(), stage: 'recorded', hash: ref.hash, size }));
            if (wavKept) count('wavKept');
            file.card = { id: file.id, ref, size, durationMs: entry().durationMs };
          }
        }
        await journal.put({ ...entry(), stage: 'ingested',
          hash: file.card.ref.hash, size: file.card.size });
        await handler.current(file.card);
        count('takes');
        count('takeMs', file.card.durationMs);
        await journal.remove(file.id);
      } catch (e) {
        failures.current.push(file);
        if (mounted.current) setFailureCount(failures.current.length);
        fail('save', e, 'saveFail');
      } finally { work(-1); }
    });
    return queue.current;
  }, [count, fail, work]);

  // Parts split by what the microphone hears, the room and the voice (LAN-82): nothing to set.
  // The device's last levels let a session's first words be judged before it has heard for itself.
  const vadConfig = useCallback(async () => {
    const heard = cachedHeardLevels() ?? await loadHeardLevels();
    return heard ? { heard } : {};
  }, []);

  /**
   * After stop is tapped: wait while the voice is still above the room, up to
   * TAKE_TAIL_MAX_MS, so a word said as the finger lands is kept whole.
   */
  const tail = useCallback(async () => {
    const heard = cachedHeardLevels();
    const quiet = 10 ** (((heard?.room ?? -50) + 6) / 20);
    const until = Date.now() + TAKE_TAIL_MAX_MS;
    while (Date.now() < until && level.current > quiet) await new Promise((r) => setTimeout(r, 50));
  }, []);

  const manualDown = useCallback((): Promise<void> => {
    if (starting.current || stopping.current || active.current ||
        vadActive.current || vadStarting.current || !mounted.current) {
      return Promise.resolve();
    }
    wanted.current = true;
    stopAudioPlayback();
    setError('');
    work(1);
    const start = (async () => {
      let stage: RecorderStage = 'start';
      try {
        const permission = await askForMicrophone();
        if (!wanted.current || !mounted.current) return;
        if (!permission.granted) throw new MicrophoneRefused();
        await setSessionAudioMode({ allowsRecording: true, playsInSilentMode: true });
        if (!wanted.current || !mounted.current) return;
        await MicrophoneEnergy.startEnergyDetection();
        stage = 'segment';
        if (recorder) {
          await recorder.prepareToRecordAsync();
          if (!wanted.current || !mounted.current) return;
          recorder.record();
        } else {
          // The take is the module's own segment: it starts with the open
          // microphone, with no second recorder to prepare (decisions.md 106).
          if (!wanted.current || !mounted.current) return;
          manualSegment.current = true;
          // Its file is this recorder's: no other recorder may take it for a part.
          claimVad(self);
          await MicrophoneEnergy.startSegment({ prerollMs: TAKE_HEAD_START_MS });
        }
        active.current = true;
        startedAt.current = Date.now();
        setManualOn(true);
      } catch (e) { wanted.current = false; fail(stage, e, 'startFail'); }
      finally {
        if (!active.current) {
          await MicrophoneEnergy.stopEnergyDetection().catch((e: unknown) => fail('stop', e));
          manualSegment.current = false;
          await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true }).catch((e: unknown) => fail('stop', e));
        }
        starting.current = null;
        work(-1);
      }
    })();
    starting.current = start;
    return start;
  }, [fail, recorder, self, work]);

  const manualUp = useCallback((): Promise<void> => {
    wanted.current = false;
    if (stopping.current) return stopping.current;
    const stop = (async () => {
      await starting.current;
      if (!active.current) return;
      work(1);
      let stage: RecorderStage = 'segment';
      let failed: RecorderFailure = 'stopFail';
      try {
        // The button shows stopped at once; the file runs on through the last word.
        if (mounted.current) setManualOn(false);
        await tail();
        const durationMs = Date.now() - startedAt.current;
        let uri: string | null;
        if (recorder) {
          await recorder.stop();
          uri = recorder.uri;
        } else {
          uri = await MicrophoneEnergy.stopSegment();
        }
        active.current = false;
        if (mounted.current) setManualOn(false);
        // Stopping waits for the module's last file to be complete on disk.
        await MicrophoneEnergy.stopEnergyDetection().catch((e: unknown) => fail('stop', e, 'stopFail'));
        manualSegment.current = false;
        await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true }).catch((e: unknown) => fail('stop', e));
        if (uri && durationMs >= SHORTEST_TAKE_MS) {
          stage = 'save';
          failed = 'saveFail';
          // A phone's take is the module's WAV, kept as AAC by deliver; a browser
          // records what it can, made playable everywhere first.
          const stored = WEB ? await storableRecording(uri) : { uri, format: 'wav' as const };
          await deliver({ id: Crypto.randomUUID(), ...stored, durationMs });
        } else if (uri) {
          count('tooShort');
          if (!WEB) deleteQuietly(uri);
        }
      } catch (e) { fail(stage, e, failed); }
      finally { work(-1); }
    })();
    stopping.current = stop;
    void stop.finally(() => { stopping.current = null; });
    return stop;
  }, [count, deliver, fail, recorder, tail, work]);

  const stopVad = useCallback((): Promise<void> => {
    if (vadStopping.current) return vadStopping.current;
    const stop = (async () => {
      await vadStarting.current;
      if (!vadActive.current) return;
      work(1);
      try {
        await MicrophoneEnergy.disableVAD();
        await MicrophoneEnergy.stopEnergyDetection();
        vadActive.current = false;
        vadPausedRef.current = false;
        holdMicrophone(false);
        await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true });
        if (mounted.current) { setVadOn(false); setVadPaused(false); setVadCapturing(false); }
        await queue.current;
      } catch (e) { fail('stop', e, 'stopFail'); }
      finally { work(-1); }
    })();
    vadStopping.current = stop;
    void stop.finally(() => { vadStopping.current = null; });
    return stop;
  }, [fail, work]);

  /**
   * The source is about to play: the detector stops (an open part is kept,
   * untrimmed) but the microphone stays open, so picking up again is instant
   * (decisions.md 106). What it hears meanwhile is never kept.
   */
  const pauseVad = useCallback(async (): Promise<void> => {
    await vadStarting.current;
    if (!vadActive.current || vadPausedRef.current || vadStopping.current) return;
    vadPausedRef.current = true;
    if (mounted.current) { setVadPaused(true); setVadCapturing(false); }
    try { await MicrophoneEnergy.disableVAD(); } catch (e) { fail('vad', e); }
  }, [fail]);

  /** The source stopped: listen for the next part straight away. */
  const resumeVad = useCallback(async (): Promise<void> => {
    if (!vadActive.current || !vadPausedRef.current || vadStopping.current) return;
    vadPausedRef.current = false;
    if (mounted.current) setVadPaused(false);
    session.current?.seam();
    try {
      await MicrophoneEnergy.configureVAD(await vadConfig());
      claimVad(self);
      await MicrophoneEnergy.enableVAD();
    } catch (e) { fail('vad', e); }
  }, [fail, self, vadConfig]);

  const toggleVad = useCallback((): Promise<void> => {
    if (vadActive.current || vadStarting.current) return stopVad();
    if (starting.current || stopping.current || active.current ||
        vadStopping.current || !mounted.current) return Promise.resolve();
    stopAudioPlayback();
    setError('');
    work(1);
    // The session carries on where it stopped; a new one starts with the first tap.
    if (session.current) session.current.seam();
    else {
      session.current = new RecordingSession(1, () => { if (mounted.current) setPartsSeen((n) => n + 1); });
      setSessionOpen(true);
    }
    const start = (async () => {
      let stage: RecorderStage = 'start';
      try {
        const permission = await askForMicrophone();
        if (!mounted.current) return;
        if (!permission.granted) throw new MicrophoneRefused();
        stage = 'configure';
        await MicrophoneEnergy.configureVAD(await vadConfig());
        stage = 'start';
        await setSessionAudioMode({ allowsRecording: true, playsInSilentMode: true });
        if (!mounted.current) return;
        await MicrophoneEnergy.startEnergyDetection();
        claimVad(self);
        stage = 'vad';
        await MicrophoneEnergy.enableVAD();
        vadActive.current = true;
        vadPausedRef.current = false;
        // Playback during the session leaves the microphone's mode alone (audioSession.ts).
        holdMicrophone(true);
        if (mounted.current) { setVadOn(true); setVadPaused(false); }
      } catch (e) {
        fail(stage, e, 'startFail');
        await MicrophoneEnergy.stopEnergyDetection().catch((err: unknown) => fail('stop', err));
        await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true }).catch((err: unknown) => fail('stop', err));
        // A session that never heard a part is nothing to leave.
        if (session.current && session.current.snapshot().parts.length === 0) { session.current = null; if (mounted.current) setSessionOpen(false); }
      } finally { vadStarting.current = null; work(-1); }
    })();
    vadStarting.current = start;
    return start;
  }, [fail, self, stopVad, vadConfig, work]);

  /** A part's box as it stands, written down so a crash before the session is left loses nothing said (phones, a passage's parts). */
  const notePart = useCallback((index: number) => {
    const p = session.current?.snapshot().parts[index];
    const target = targetRef.current;
    if (WEB || !target || !p?.id || !p.chunk || p.fromMs === undefined || p.toMs === undefined) return;
    liveParts.add(p.id);
    getRecordingJournal().put({ id: p.id, uri: p.chunk, format: 'wav', durationMs: Math.round(p.toMs - p.fromMs), stage: 'recorded', target, range: { fromMs: p.fromMs, toMs: p.toMs } })
      .catch((e: unknown) => noteExpected('recorder: journal part', e, recorderFaultCode(e)));
  }, []);

  /** The × on a part's box: it goes, its place and number stay for what is said next. */
  const dropPart = useCallback((index: number) => {
    const s = session.current;
    const id = s?.snapshot().parts[index]?.id;
    s?.drop(index);
    if (id) { liveParts.delete(id); getRecordingJournal().remove(id).catch((e: unknown) => noteExpected('recorder: journal drop', e)); }
  }, []);

  /**
   * Leave the session: recording stops, and each part not dropped is cut
   * from its chunk where its box is and saved, in order (Caleb, 2026-10-16:
   * the boxes as they stand when the session is left are the parts). The
   * chunks go once every part is cut; a part that cannot be cut stays in the
   * journal with its chunk, for the next launch.
   */
  const endSession = useCallback((): Promise<void> => {
    if (ending.current) return ending.current;
    const run = (async () => {
      await stopVad();
      const s = session.current;
      if (!s) return;
      session.current = null;
      if (mounted.current) setSessionOpen(false);
      work(1);
      try {
        const state = s.snapshot();
        const journal = getRecordingJournal();
        const cut: PendingFile[] = [];
        let failed = false;
        for (const k of liveKept(state)) {
          const id = k.id ?? Crypto.randomUUID();
          // A phone's chunk is its file; the web's is a blob once written.
          const from = k.uri ?? (WEB ? null : k.chunk);
          try {
            if (!from) throw new Error('the part\'s chunk was never written');
            const uri = await cutWav(from, k.fromMs, k.toMs);
            const durationMs = k.toMs - k.fromMs;
            const target = targetRef.current;
            if (!WEB && target) await journal.put({ id, uri, format: 'wav', durationMs: Math.round(durationMs), stage: 'recorded', target });
            liveParts.delete(id);
            cut.push({ id, uri, format: 'wav', durationMs });
          } catch (e) {
            failed = true;
            liveParts.delete(id);
            fail('save', e, 'saveFail');
          }
        }
        if (!failed) {
          for (const [chunk, c] of Object.entries(state.chunks)) {
            const uri = c.uri ?? (WEB ? null : chunk);
            if (uri) { try { deleteRecorderFile(uri); } catch (e) { noteExpected('recorder: delete chunk', e, recorderFaultCode(e)); } }
          }
        }
        for (const file of cut) void deliver(file);
        await queue.current;
      } finally { work(-1); }
    })();
    ending.current = run;
    void run.finally(() => { ending.current = null; });
    return run;
  }, [deliver, fail, stopVad, work]);

  const busy = working > 0;
  useEffect(() => {
    if (!(manualOn || vadOn || busy)) return;
    const token = Symbol('recorder');
    activity.add(token);
    return () => { activity.delete(token); };
  }, [manualOn, vadOn, busy]);

  const retryFailed = useCallback(async () => {
    const files = failures.current.splice(0);
    setFailureCount(0);
    setError('');
    for (const file of files) await deliver(file);
  }, [deliver]);

  useEffect(() => {
    mounted.current = true;
    const subscriptions = [
      // The module's own report, from its threads (a part's file that could not be written).
      // Every recorder hears it; only the one whose session it is counts it.
      MicrophoneEnergy.addListener('onError', (e) => fail('native', new Error(e.message), vadOwner === self ? 'native' : null)),
      MicrophoneEnergy.addListener('onSegmentStart', (e) => {
        if (vadOwner !== self) return;
        setVadCapturing(true);
        if (!manualSegment.current) session.current?.partStart(e.headMs);
      }),
      MicrophoneEnergy.addListener('onEnergyResult', (e) => {
        level.current = e.energy;
        if (vadOwner === self && !manualSegment.current) session.current?.frame(e.energy, e.quiet, e.timestamp);
      }),
      MicrophoneEnergy.addListener('onSegmentComplete', (e) => {
        if (e.heard) keepHeardLevels(e.heard);
        // A hold-to-record take is delivered by manualUp, not here.
        if (vadOwner !== self || manualSegment.current) return;
        setVadCapturing(false);
        const s = session.current;
        // A session's part is a box in its chunk until the session is left (endSession).
        if (e.chunk && e.fromMs !== undefined && e.toMs !== undefined) {
          s?.partEnd({ id: Crypto.randomUUID(), chunk: e.chunk, fromMs: e.fromMs, toMs: e.toMs });
          if (s) notePart(s.snapshot().parts.length - 1);
          return;
        }
        s?.partEnd(null);
        // An empty uri was a tap or a bump, not speech (splitter.ts): nothing said is lost, so nothing is said; it is still counted.
        if (!e.uri && vadActive.current && mounted.current) count('tooShort');
      }),
      MicrophoneEnergy.addListener('onChunkComplete', (e) => { if (vadOwner === self) session.current?.chunkDone(e.chunk, e.uri, e.duration); })
    ];
    // A phone stops recording when the app leaves the screen. A browser tab
    // keeps the microphone while another tab is in front, so the web stops
    // only when the page itself goes. The microphone permission prompt is
    // not leaving the screen.
    const stopAll = () => { void manualUp(); void stopVad(); };
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && !WEB && askingForMicrophone === 0) {
        // Once per recording cut short (iOS passes `inactive` on its way to `background`).
        if ((active.current && !stopping.current) || (vadActive.current && !vadStopping.current)) count('interrupted');
        stopAll();
      }
    });
    if (WEB) window.addEventListener('pagehide', stopAll);
    return () => {
      mounted.current = false;
      wanted.current = false;
      appState.remove();
      if (WEB) window.removeEventListener('pagehide', stopAll);
      // Keep native listeners through the final part and chunk emitted by stop; leaving the screen leaves the session.
      void Promise.all([manualUp(), endSession()]).finally(() => {
        subscriptions.forEach((subscription) => subscription.remove());
      });
    };
  }, [count, deliver, endSession, fail, manualUp, notePart, stopVad, self]);

  // Hands-free recording means nobody touches the screen: keep it on, as v2
  // did, or the phone's screen timeout sends the app away and ends the session.
  const microphoneOn = manualOn || vadOn;
  useEffect(() => {
    if (!microphoneOn) return;
    const tag = `recorder-${++keepAwakeTags}`;
    activateKeepAwakeAsync(tag).catch((e: unknown) => noteExpected('recorder: keep awake', e));
    return () => { deactivateKeepAwake(tag).catch((e: unknown) => noteExpected('recorder: keep awake', e)); };
  }, [microphoneOn]);

  // Web: closing the tab mid-take loses it (its audio lives in the page until it stops), so say so first.
  const recording = manualOn || vadOn || sessionOpen || working > 0;
  useEffect(() => {
    if (!WEB || !recording) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [recording]);

  const snap = session.current?.snapshot();
  return {
    vadOn, vadPaused, vadCapturing, manualOn, error,
    busy, failureCount, retryFailed,
    toggleVad, stopVad, pauseVad, resumeVad, manualDown, manualUp,
    /** A session is open: recording, or stopped with its parts still boxes to hear, move or drop. */
    sessionOpen,
    session: session.current,
    /** The number the next part of the session takes, and how many it keeps so far. */
    sessionNext: snap ? liveNext(snap) : null,
    sessionKept: snap ? liveKeptCount(snap) : 0,
    endSession, dropPart, notePart
  };
}

/**
 * Live meter history for one small component. The native energy stream
 * (about 20 events a second) lands here and nowhere else, so the screen
 * around the meter does not re-render per frame; `captured` is the only
 * input from outside and it changes rarely.
 */
export function useEnergyHistory(captured: boolean, bars = 60) {
  const [history, setHistory] = useState<{ energy: number; captured: boolean }[]>(
    () => Array.from({ length: bars }, () => ({ energy: 0, captured: false }))
  );
  const capturedRef = useRef(captured);
  capturedRef.current = captured;
  useEffect(() => {
    const sub = MicrophoneEnergy.addListener('onEnergyResult', (e) => {
      setHistory((h) => [...h.slice(1), { energy: e.energy, captured: capturedRef.current }]);
    });
    return () => sub.remove();
  }, []);
  return history;
}
