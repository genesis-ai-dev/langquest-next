import type { BlobRef } from '@langquest-next/core';
import { RecordingPresets, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import MicrophoneEnergy, { type VADConfig } from '../modules/microphone-energy';
import { getBlobStore } from './blobs';

/**
 * Two recorders, on purpose (as in LangQuest v2):
 *
 * - The native MicrophoneEnergy module taps raw PCM, emits energy for the
 *   waveform, runs the VAD state machine, and writes one WAV per card.
 * - expo-audio's recorder writes one m4a per hold-to-record take.
 *
 * expo-audio allows one recording at a time and gives no PCM access, so the
 * native tap is the second microphone session. In manual mode both sessions
 * are open: native for energy only, expo-audio for the file. In VAD mode the
 * native module does everything.
 *
 * Every finished file is ingested into the content-addressed store and
 * reported as a card; the caller appends the events.
 */
export interface RecordedCard {
  ref: BlobRef;
  durationMs: number;
  size: number;
}

const VAD_DEFAULTS: VADConfig = {
  threshold: 0.1,
  silenceDuration: 1000,
  onsetMultiplier: 0.1,
  maxOnsetDuration: 250,
  rewindHalfPause: true,
  minSegmentDuration: 200,
  minActiveAudioDuration: 250
};

export function useRecorder(onCard: (card: RecordedCard) => void) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 100);
  const [energy, setEnergy] = useState(0);
  const [vadOn, setVadOn] = useState(false);
  const [vadCapturing, setVadCapturing] = useState(false);
  const [manualOn, setManualOn] = useState(false);
  const [error, setError] = useState('');
  const onCardRef = useRef(onCard);
  onCardRef.current = onCard;
  const manualStart = useRef(0);

  // Native events. Listeners are attached once per mount.
  useEffect(() => {
    const subs = [
      MicrophoneEnergy.addListener('onEnergyResult', (r) => setEnergy(r.energy)),
      MicrophoneEnergy.addListener('onError', (e) => setError(e.message)),
      MicrophoneEnergy.addListener('onSegmentStart', () => setVadCapturing(true)),
      MicrophoneEnergy.addListener('onSegmentComplete', (p) => {
        setVadCapturing(false);
        if (!p.uri) return; // discarded transient
        void ingest(p.uri, 'wav', p.duration);
      })
    ];
    return () => subs.forEach((s) => s.remove());
  }, []);

  async function ingest(uri: string, format: BlobRef['format'], durationMs: number) {
    try {
      const store = await getBlobStore();
      const { ref, size } = await store.ingest(uri, format);
      onCardRef.current({ ref, durationMs: Math.max(0, Math.round(durationMs)), size });
    } catch (e) {
      setError((e as Error).message);
    }
  }

  /** Energy stream for the waveform; harmless if already running. */
  const startEnergy = useCallback(async () => {
    await MicrophoneEnergy.startEnergyDetection();
  }, []);

  const stopAll = useCallback(async () => {
    try {
      await MicrophoneEnergy.disableVAD();
      await MicrophoneEnergy.stopEnergyDetection();
    } catch {}
    setVadOn(false);
    setVadCapturing(false);
  }, []);

  const toggleVad = useCallback(async () => {
    if (vadOn) {
      await stopAll();
      return;
    }
    setError('');
    // Configure BEFORE starting detection and enabling (v2 lesson).
    await MicrophoneEnergy.configureVAD(VAD_DEFAULTS);
    await startEnergy();
    await MicrophoneEnergy.enableVAD();
    setVadOn(true);
  }, [vadOn, stopAll, startEnergy]);

  /** Hold-to-record: expo-audio owns the file; native gives energy. */
  const manualDown = useCallback(async () => {
    if (vadOn) return;
    setError('');
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await startEnergy();
      await recorder.prepareToRecordAsync();
      recorder.record();
      manualStart.current = Date.now();
      setManualOn(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [vadOn, recorder, startEnergy]);

  const manualUp = useCallback(async () => {
    if (!manualOn) return;
    setManualOn(false);
    try {
      await recorder.stop();
      await MicrophoneEnergy.stopEnergyDetection();
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      const uri = recorder.uri;
      const durationMs = Date.now() - manualStart.current;
      if (uri && durationMs >= 500) await ingest(uri, 'm4a', durationMs);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [manualOn, recorder]);

  useEffect(() => () => void stopAll(), [stopAll]);

  return {
    energy,
    vadOn,
    vadCapturing,
    manualOn,
    metering: recorderState.metering,
    error,
    toggleVad,
    manualDown,
    manualUp
  };
}
