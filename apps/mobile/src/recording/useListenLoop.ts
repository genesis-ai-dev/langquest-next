// Listen, speak, listen (LAN-23): while a take is recording, playing the
// source pauses the microphone, and when the source pauses or ends the
// recording picks up again by itself. The source never plays into a take,
// and the audio session is only ever in one mode at a time: the recorder is
// fully stopped (its last part delivered) before the player switches the
// session to playback, and restarted only once playback has stopped.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { stopAudioPlayback } from '../audioSession';
import { useScreenShowing } from '../helpContext';
import type { useRecorder } from '../useRecorder';
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
    const stop = r.stopVad();
    pausing.current = stop;
    try { await stop; } finally { if (pausing.current === stop) pausing.current = null; }
  }, []);

  const resume = useCallback(async () => {
    if (!listeningRef.current || resuming.current) return;
    resuming.current = true;
    try {
      await pausing.current;
      if (!listeningRef.current) return;
      setListening(false);
      if (!recRef.current.vadOn) await recRef.current.toggleVad();
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

  /** The record button: start a session, or end it whichever phase it is in. */
  const toggle = useCallback(async () => {
    if (listeningRef.current) { setListening(false); return; }
    await recRef.current.toggleVad();
  }, []);

  // Leaving the screen stops the source (App.tsx); don't pick the microphone up again behind another screen.
  const showing = useScreenShowing();
  useEffect(() => { if (!showing && listeningRef.current) setListening(false); }, [showing]);

  // Never pick the microphone up again in the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active' && listeningRef.current) setListening(false); });
    return () => sub.remove();
  }, []);

  const phase: LoopPhase = loopPhase(rec.vadOn, listening);
  const hooks = useMemo<ListenHooks>(() => ({ beforePlay, onPlaying }), [beforePlay, onPlaying]);
  return { phase, hooks, toggle, resumeNow };
}
