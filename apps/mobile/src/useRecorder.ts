import type { BlobRef } from '@langquest-next/core';
import type { BlobFile } from './blobs';
import { AudioModule, RecordingPresets, useAudioRecorder } from 'expo-audio';
import { setSessionAudioMode, stopAudioPlayback } from './audioSession';
import * as Crypto from 'expo-crypto';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import MicrophoneEnergy, { type VADConfig } from '../modules/microphone-energy';
import { getBlobStore } from './blobs';
import { getRecordingJournal } from './recordingJournal';
import type { JournalTarget } from './recordingJournalCore';

export interface RecordedCard {
  /** Stable id chosen before any save step; the handler uses it as recordingId. */
  id: string;
  ref: { hash: string; format: 'wav' | 'm4a' };
  durationMs: number;
  size: number;
}
export type RecorderCardHandler = (card: RecordedCard) => void | Promise<void>;
interface PendingFile {
  id: string;
  uri: string;
  format: 'wav' | 'm4a';
  durationMs: number;
  card?: RecordedCard;
}
const BASE: VADConfig = {
  onsetMultiplier: 0.1, maxOnsetDuration: 250, rewindHalfPause: true,
  minSegmentDuration: 200, minActiveAudioDuration: 250
};

/** Recorders with the microphone open or a save in progress, app-wide. */
const activity = new Set<symbol>();
/** Transfers and checkpoints defer while this is true. */
export function isRecording(): boolean {
  return activity.size > 0;
}

/**
 * Serializes microphone startup, release and durable file delivery.
 * `target` names the passage a delivered card belongs to; with it, a save
 * interrupted at any stage is journaled and finished on the next launch
 * (see recordingJournalCore.ts). Without it the journal still protects the
 * file until the handler returns.
 */
export function useRecorder(onCard: RecorderCardHandler, target?: JournalTarget) {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY, directory: 'document'
  });
  const [vadOn, setVadOn] = useState(false);
  const [vadCapturing, setVadCapturing] = useState(false);
  const [manualOn, setManualOn] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(0);
  const [failureCount, setFailureCount] = useState(0);
  const [pauseDuration, setPauseDuration] = useState(1000);
  const [cutoff, setCutoffState] = useState(0.1);
  const mounted = useRef(true);
  const handler = useRef(onCard);
  handler.current = onCard;
  const targetRef = useRef(target);
  targetRef.current = target;
  const wanted = useRef(false);
  const active = useRef(false);
  const startedAt = useRef(0);
  const starting = useRef<Promise<void> | null>(null);
  const stopping = useRef<Promise<void> | null>(null);
  const vadActive = useRef(false);
  const vadStarting = useRef<Promise<void> | null>(null);
  const vadStopping = useRef<Promise<void> | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const failures = useRef<PendingFile[]>([]);
  const config = useRef({ threshold: 0.1, silenceDuration: 1000 });
  const fail = useCallback((e: unknown) => {
    if (mounted.current) setError(e instanceof Error ? e.message : String(e));
  }, []);
  const work = useCallback((delta: number) => {
    if (mounted.current) setWorking((n) => Math.max(0, n + delta));
  }, []);

  const deliver = useCallback((file: PendingFile) => {
    work(1);
    queue.current = queue.current.then(async () => {
      const journal = getRecordingJournal();
      const base = { id: file.id, uri: file.uri, format: file.format,
        durationMs: Math.round(file.durationMs), target: targetRef.current };
      try {
        if (!file.card) {
          const store = await getBlobStore();
          const previous = (await journal.all()).find((e) => e.id === file.id);
          if (previous?.hash && store.fileFor({ hash: previous.hash, format: file.format }).exists) {
            file.card = { id: file.id, ref: { hash: previous.hash, format: file.format },
              size: previous.size ?? store.fileFor({ hash: previous.hash, format: file.format }).size,
              durationMs: base.durationMs };
          } else {
            await journal.put(previous ?? { ...base, stage: 'recorded' });
            const { ref, size } = await store.ingest(file.uri, file.format, (ref, size) =>
              journal.put({ ...base, stage: 'recorded', hash: ref.hash, size }));
            file.card = { id: file.id, ref: { hash: ref.hash, format: file.format }, size, durationMs: base.durationMs };
          }
        }
        await journal.put({ ...base, stage: 'ingested',
          hash: file.card.ref.hash, size: file.card.size });
        await handler.current(file.card);
        await journal.remove(file.id);
      } catch (e) {
        failures.current.push(file);
        if (mounted.current) setFailureCount(failures.current.length);
        fail(e);
      } finally { work(-1); }
    });
    return queue.current;
  }, [fail, work]);

  const configure = useCallback(async () => {
    try { await MicrophoneEnergy.configureVAD({ ...BASE, ...config.current }); }
    catch (e) { fail(e); }
  }, [fail]);
  const setPause = useCallback(async (duration: number) => {
    config.current.silenceDuration = duration;
    setPauseDuration(duration);
    if (vadActive.current) await configure();
  }, [configure]);
  const setCutoff = useCallback(async (value: number) => {
    config.current.threshold = Math.max(0.04, Math.min(0.92, value));
    setCutoffState(config.current.threshold);
    if (vadActive.current) await configure();
  }, [configure]);

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
      try {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!wanted.current || !mounted.current) return;
        if (!permission.granted) throw new Error('Microphone permission is required.');
        await setSessionAudioMode({ allowsRecording: true, playsInSilentMode: true });
        if (!wanted.current || !mounted.current) return;
        await MicrophoneEnergy.startEnergyDetection();
        await recorder.prepareToRecordAsync();
        if (!wanted.current || !mounted.current) return;
        recorder.record();
        active.current = true;
        startedAt.current = Date.now();
        setManualOn(true);
      } catch (e) { wanted.current = false; fail(e); }
      finally {
        if (!active.current) {
          await MicrophoneEnergy.stopEnergyDetection().catch(fail);
          await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true }).catch(fail);
        }
        starting.current = null;
        work(-1);
      }
    })();
    starting.current = start;
    return start;
  }, [fail, recorder, work]);

  const manualUp = useCallback((): Promise<void> => {
    wanted.current = false;
    if (stopping.current) return stopping.current;
    const stop = (async () => {
      await starting.current;
      if (!active.current) return;
      work(1);
      try {
        const durationMs = Date.now() - startedAt.current;
        await recorder.stop();
        active.current = false;
        if (mounted.current) setManualOn(false);
        const uri = recorder.uri;
        await MicrophoneEnergy.stopEnergyDetection().catch(fail);
        await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true }).catch(fail);
        if (uri && durationMs >= 200) await deliver({ id: Crypto.randomUUID(), uri, format: 'm4a', durationMs });
      } catch (e) { fail(e); }
      finally { work(-1); }
    })();
    stopping.current = stop;
    void stop.finally(() => { stopping.current = null; });
    return stop;
  }, [deliver, fail, recorder, work]);

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
        await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true });
        if (mounted.current) { setVadOn(false); setVadCapturing(false); }
        await queue.current;
      } catch (e) { fail(e); }
      finally { work(-1); }
    })();
    vadStopping.current = stop;
    void stop.finally(() => { vadStopping.current = null; });
    return stop;
  }, [fail, work]);

  const toggleVad = useCallback((): Promise<void> => {
    if (vadActive.current || vadStarting.current) return stopVad();
    if (starting.current || stopping.current || active.current ||
        vadStopping.current || !mounted.current) return Promise.resolve();
    stopAudioPlayback();
    setError('');
    work(1);
    const start = (async () => {
      try {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!mounted.current) return;
        if (!permission.granted) throw new Error('Microphone permission is required.');
        await MicrophoneEnergy.configureVAD({ ...BASE, ...config.current });
        await setSessionAudioMode({ allowsRecording: true, playsInSilentMode: true });
        if (!mounted.current) return;
        await MicrophoneEnergy.startEnergyDetection();
        await MicrophoneEnergy.enableVAD();
        vadActive.current = true;
        if (mounted.current) setVadOn(true);
      } catch (e) {
        fail(e);
        await MicrophoneEnergy.stopEnergyDetection().catch(fail);
        await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true }).catch(fail);
      } finally { vadStarting.current = null; work(-1); }
    })();
    vadStarting.current = start;
    return start;
  }, [fail, stopVad, work]);

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
      MicrophoneEnergy.addListener('onError', (e) => fail(e.message)),
      MicrophoneEnergy.addListener('onSegmentStart', () => setVadCapturing(true)),
      MicrophoneEnergy.addListener('onSegmentComplete', (e) => {
        setVadCapturing(false);
        if (e.uri) void deliver({ id: Crypto.randomUUID(), uri: e.uri, format: 'wav', durationMs: e.duration });
      })
    ];
    const appState = AppState.addEventListener('change', (state) => {
      if (state !== 'active') { void manualUp(); void stopVad(); }
    });
    return () => {
      mounted.current = false;
      wanted.current = false;
      appState.remove();
      // Keep native listeners through the final segment emitted by stop.
      void Promise.all([manualUp(), stopVad()]).finally(() => {
        subscriptions.forEach((subscription) => subscription.remove());
      });
    };
  }, [deliver, fail, manualUp, stopVad]);

  return {
    vadOn, vadCapturing, manualOn, error, pauseDuration, cutoff,
    busy, failureCount, retryFailed,
    toggleVad, stopVad, setPause, setCutoff, manualDown, manualUp
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
