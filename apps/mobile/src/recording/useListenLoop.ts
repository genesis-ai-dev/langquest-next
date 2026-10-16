// Listen, speak, listen (LAN-23): while a take is recording, playing the
// source pauses the voice detector, and when the source pauses or ends the
// recording picks up again by itself. The source never plays into a take:
// the detector is off (its open part delivered) before the player starts.
// The microphone itself stays open through playback (decisions.md 106), so
// picking up again is instant and the first words after the source are kept;
// what it hears while the source plays is never kept.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { stopAudioPlayback } from '../audio/audioSession';
import { useScreenShowing } from '../helpMode/useHelpMode';
import type { useRecorder } from './useRecorder';
import { loopPhase, type LoopPhase } from './splitModel';

type Recorder = ReturnType<typeof useRecorder>;

export interface ListenHooks {
  /** Called before the source plays; resolves once the microphone is paused. */
  beforePlay: () => Promise<void>;
  /** The source started or stopped playing (paused, ended, failed, or stopped by something else). */
  onPlaying: (playing: boolean) => void;
}

export function useListenLoop(rec: Recorder) {
  const [listening, setListeningState] = useState(false);
  const listeningRef = useRef(false);
  const setListening = (on: boolean) => { listeningRef.current = on; setListeningState(on); };
  const recRef = useRef(rec);
  recRef.current = rec;
  const pausing = useRef<Promise<void> | null>(null);
  const resuming = useRef(false);

  const beforePlay = useCallback(async () => {
    const r = recRef.current;
    if (!r.vadOn) return;
    setListening(true);
    const pause = r.pauseVad();
    pausing.current = pause;
    try { await pause; } finally { if (pausing.current === pause) pausing.current = null; }
  }, []);

  const resume = useCallback(async () => {
    if (!listeningRef.current || resuming.current) return;
    resuming.current = true;
    try {
      await pausing.current;
      if (!listeningRef.current) return;
      setListening(false);
      await recRef.current.resumeVad();
    } finally { resuming.current = false; }
  }, []);

  const onPlaying = useCallback((playing: boolean) => {
    if (!playing) void resume();
  }, [resume]);

  /** "Resume now" while the source plays: stopping playback resumes through onPlaying. */
  const resumeNow = useCallback(() => {
    stopAudioPlayback();
    void resume();
  }, [resume]);

  /**
   * The record button: start a session, stop recording (the session stays
   * open, its parts to hear, move or drop), or carry on recording in it.
   */
  const toggle = useCallback(async () => {
    if (listeningRef.current) { setListening(false); await recRef.current.stopVad(); return; }
    await recRef.current.toggleVad();
  }, []);

  /** Done: leave the session, keeping its parts as their boxes stand. */
  const finish = useCallback(async () => {
    setListening(false);
    await recRef.current.endSession();
  }, []);

  /** Stop recording, for the question before a session is thrown away. */
  const stop = useCallback(async () => {
    setListening(false);
    await recRef.current.stopVad();
  }, []);

  /** Throw the session away: nothing said in it is kept. */
  const discard = useCallback(async () => {
    setListening(false);
    await recRef.current.discardSession();
  }, []);

  // Leaving the screen stops the source (App.tsx) and leaves the session; don't keep the microphone open behind another screen.
  const showing = useScreenShowing();
  useEffect(() => {
    if (showing) return;
    if (listeningRef.current) setListening(false);
    if (recRef.current.sessionOpen) void recRef.current.endSession();
  }, [showing]);

  // Never pick the microphone up again in the background (the recorder stops itself there).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active' && listeningRef.current) setListening(false); });
    return () => sub.remove();
  }, []);

  const phase: LoopPhase = loopPhase(rec.vadOn, listening, rec.sessionOpen);
  const hooks = useMemo<ListenHooks>(() => ({ beforePlay, onPlaying }), [beforePlay, onPlaying]);
  return { phase, hooks, toggle, finish, stop, discard, resumeNow };
}
