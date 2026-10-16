// Playing a study's audio (study/ui.tsx).
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { registerPlayback, setSessionAudioMode, stopAudioPlayback } from '../audio/audioSession';
import { studyUri } from './studyFiles';
import { noteExpected } from '../diagnostics/report';

export interface StudyAudio {
  playing: boolean;
  time: number;
  duration: number;
  /** No file, or it could not load: a clock at reading pace stands in. */
  simulated: boolean;
  /** There was a file and it could not load. */
  failed: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (seconds: number) => void;
}

/**
 * Plays a real file when there is one (FIA's step and glossary audio) and
 * falls back to a simulated clock when there is none or it cannot load
 * (offline), so the screen behaves the same either way. The file is only
 * fetched on the first Play, to spare field data.
 */
export function useStudyAudio(address: string | undefined, estimate: number): StudyAudio {
  // The phone's copy when the passage is kept offline (studyFiles.ts), else the web.
  const url = studyUri(address);
  const player = useRef<AudioPlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(estimate);
  const [failed, setFailed] = useState(false);
  const simulated = !url || failed;
  const now = useRef({ time: 0, duration: estimate });
  now.current = { time, duration };
  // Where the simulated clock started from, so a seek while playing moves it.
  const base = useRef({ at: 0, from: 0 });

  useEffect(() => registerPlayback(() => { player.current?.pause(); setPlaying(false); }), []);
  useEffect(() => {
    setFailed(false);
    setPlaying(false);
    setTime(0);
    setDuration(estimate);
    return () => { player.current?.remove(); player.current = null; };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps -- a new source starts over; the estimate only matters until the file says its length

  useEffect(() => {
    if (!playing || !simulated) return;
    const tick = setInterval(() => {
      const end = now.current.duration;
      const at = Math.min(base.current.from + (Date.now() - base.current.at) / 1000, end);
      setTime(at);
      if (at >= end) setPlaying(false);
    }, 250);
    return () => clearInterval(tick);
  }, [playing, simulated]);

  /** The file could not load or play: the simulated clock carries on from `from`. */
  const fallBack = (from = now.current.time) => {
    player.current?.remove();
    player.current = null;
    base.current = { at: Date.now(), from };
    setFailed(true);
  };

  async function play() {
    stopAudioPlayback();
    if (simulated) {
      const from = now.current.time >= now.current.duration ? 0 : now.current.time;
      base.current = { at: Date.now(), from };
      setTime(from);
      setPlaying(true);
      return;
    }
    setPlaying(true);
    try {
      await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true });
      let p = player.current;
      if (!p) {
        const created = createAudioPlayer({ uri: url! }, { updateInterval: 250 });
        p = created;
        player.current = created;
        created.addListener('playbackStatusUpdate', (st) => {
          if (player.current !== created) return;
          if (st.error) { fallBack(); return; }
          if (st.duration > 0) setDuration(st.duration);
          if (st.isLoaded) setTime(st.currentTime);
          if (st.didJustFinish) setPlaying(false);
        });
        if (now.current.time > 0) await created.seekTo(now.current.time);
      } else if (p.duration > 0 && p.currentTime >= p.duration - 0.1) {
        await p.seekTo(0);
      }
      p.play();
    } catch (e) {
      // Offline or a bad file: expected in the field, and the bar says so.
      noteExpected('study audio: play', e);
      fallBack();
    }
  }
  function pause() {
    player.current?.pause();
    setPlaying(false);
  }
  function seek(seconds: number) {
    const v = Math.max(0, Math.min(seconds, now.current.duration));
    setTime(v);
    base.current = { at: Date.now(), from: v };
    if (player.current && !simulated) {
      player.current.seekTo(v).catch((e: unknown) => {
        // The player lost its place: keep the bar where it was moved to, on the stand-in clock.
        noteExpected('study audio: seek', e);
        fallBack(v);
      });
    }
  }
  return { playing, time, duration, simulated, failed, play: () => void play(), pause, toggle: () => (playing ? pause() : void play()), seek };
}
