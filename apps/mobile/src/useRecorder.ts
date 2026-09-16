import type { BlobRef } from '@langquest-next/core';
import type { BlobFile } from './blobs';
import {
  AudioModule, RecordingPresets, setAudioModeAsync,
  useAudioRecorder, useAudioRecorderState
} from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import MicrophoneEnergy, { type VADConfig } from '../modules/microphone-energy';
import { getBlobStore } from './blobs';

export interface RecordedCard {
  ref: BlobFile;
  durationMs: number;
  size: number;
}
export type RecorderCardHandler = (card: RecordedCard) => void | Promise<void>;
interface PendingFile {
  uri: string;
  format: BlobRef['format'];
  durationMs: number;
  card?: RecordedCard;
}
const BASE: VADConfig = {
  onsetMultiplier: 0.1, maxOnsetDuration: 250, rewindHalfPause: true,
  minSegmentDuration: 200, minActiveAudioDuration: 250
};

/** Serializes microphone startup, release and durable file delivery. */
export function useRecorder(onCard: RecorderCardHandler) {
  const recorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY, directory: 'document'
  });
  const recorderState = useAudioRecorderState(recorder, 100);
  const [energy, setEnergy] = useState(0);
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
      try {
        if (!file.card) {
          const store = await getBlobStore();
          const { ref, size } = await store.ingest(file.uri, file.format);
          file.card = { ref, size, durationMs: Math.round(file.durationMs) };
        }
        await handler.current(file.card);
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
    setError('');
    work(1);
    const start = (async () => {
      try {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!wanted.current || !mounted.current) return;
        if (!permission.granted) throw new Error('Microphone permission is required.');
        await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
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
          await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(fail);
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
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(fail);
        if (uri && durationMs >= 200) await deliver({ uri, format: 'm4a', durationMs });
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
    setError('');
    work(1);
    const start = (async () => {
      try {
        const permission = await AudioModule.requestRecordingPermissionsAsync();
        if (!mounted.current) return;
        if (!permission.granted) throw new Error('Microphone permission is required.');
        await MicrophoneEnergy.configureVAD({ ...BASE, ...config.current });
        if (!mounted.current) return;
        await MicrophoneEnergy.startEnergyDetection();
        await MicrophoneEnergy.enableVAD();
        vadActive.current = true;
        if (mounted.current) setVadOn(true);
      } catch (e) {
        fail(e);
        await MicrophoneEnergy.stopEnergyDetection().catch(fail);
      } finally { vadStarting.current = null; work(-1); }
    })();
    vadStarting.current = start;
    return start;
  }, [fail, stopVad, work]);

  const retryFailed = useCallback(async () => {
    const files = failures.current.splice(0);
    setFailureCount(0);
    setError('');
    for (const file of files) await deliver(file);
  }, [deliver]);

  useEffect(() => {
    mounted.current = true;
    const subscriptions = [
      MicrophoneEnergy.addListener('onEnergyResult', (e) => setEnergy(e.energy)),
      MicrophoneEnergy.addListener('onError', (e) => fail(e.message)),
      MicrophoneEnergy.addListener('onSegmentStart', () => setVadCapturing(true)),
      MicrophoneEnergy.addListener('onSegmentComplete', (e) => {
        setVadCapturing(false);
        if (e.uri) void deliver({ uri: e.uri, format: 'wav', durationMs: e.duration });
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
    energy, vadOn, vadCapturing, manualOn, error, pauseDuration, cutoff,
    busy: working > 0, failureCount, retryFailed,
    metering: recorderState.metering,
    toggleVad, stopVad, setPause, setCutoff, manualDown, manualUp
  };
}
