// Avatar U. Local and remote playback, paused before recording starts.
import type { BlobRef, ProjectState } from '@langquest-next/core';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { CloudDownload, Pause, Play, RotateCcw, RotateCw } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { ProjectHandle } from './useProject';
import { ActionButton, text } from './ui';
import { registerPlayback, setSessionAudioMode, stopAudioPlayback } from './audioSession';

export function audioFormat(state: ProjectState, hash: string): BlobRef['format'] {
  for (const recording of Object.values(state.recordings)) {
    const card = recording.cards.find((c) => c.hash === hash);
    if (card) return card.format ?? 'wav';
  }
  return 'm4a';
}

export function AudioClip(props: {
  project: ProjectHandle;
  hashes: string[];
  label?: string;
  uri?: string;
  disabled?: boolean;
  seekControls?: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [, refresh] = useState(0);
  const player = useRef<AudioPlayer | null>(null);
  const generation = useRef(0);
  const wantsPlayback = useRef(false);
  const signature = props.uri ?? props.hashes.join(':');
  const projectRef = useRef(props.project);
  projectRef.current = props.project;
  useEffect(() => props.project.blobs.store?.onChange(() => refresh((n) => n + 1)), [props.project.blobs.store]);
  useEffect(() => registerPlayback(() => {
    generation.current++;
    wantsPlayback.current = false;
    player.current?.pause();
    setPlaying(false);
  }), []);
  useEffect(() => {
    if (props.disabled) {
      generation.current++;
      wantsPlayback.current = false;
      player.current?.pause();
      setPlaying(false);
    }
  }, [props.disabled]);
  useEffect(() => {
    setPlaying(false);
    setError('');
    return () => {
      generation.current++;
      wantsPlayback.current = false;
      player.current?.remove();
      player.current = null;
    };
  }, [signature]);
  const state = props.project.state;
  const available = !!props.uri || (!!state && props.hashes.length > 0 && props.hashes.every((hash) =>
    !!props.project.blobs.uriFor({ hash, format: audioFormat(state, hash) })));

  async function toggle() {
    if (props.disabled) return;
    if (wantsPlayback.current) {
      generation.current++; wantsPlayback.current = false;
      player.current?.pause(); setPlaying(false); return;
    }
    stopAudioPlayback();
    const run = generation.current;
    wantsPlayback.current = true;
    setPlaying(true);
    setError('');
    try {
      await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true });
      if (generation.current !== run) return;
      if (player.current) {
        if (player.current.duration > 0 &&
            player.current.currentTime >= player.current.duration - 0.1) {
          await player.current.seekTo(0);
        }
        if (generation.current === run) player.current?.play();
        return;
      }
      const next = (index: number) => {
        if (!wantsPlayback.current) return;
        player.current?.remove();
        player.current = null;
        if (index >= (props.uri ? 1 : props.hashes.length)) {
          wantsPlayback.current = false; setPlaying(false); return;
        }
        const hash = props.hashes[index]!;
        const project = projectRef.current;
        const uri = props.uri ?? (project.state && project.blobs.uriFor({ hash, format: audioFormat(project.state, hash) }));
        if (!uri) { wantsPlayback.current = false; setPlaying(false); setError('Audio is not on this phone yet.'); return; }
        try {
          const p = createAudioPlayer({ uri });
          player.current = p;
          p.addListener('playbackStatusUpdate', (status) => {
            if (player.current !== p) return;
            if (status.error) {
              wantsPlayback.current = false;
              p.remove(); player.current = null; setPlaying(false);
              setError('Audio could not load. Check your connection and try again.');
              return;
            }
            if (status.didJustFinish && player.current === p) next(index + 1);
          });
          p.play();
        } catch (err) {
          wantsPlayback.current = false;
          player.current?.remove(); player.current = null;
          setPlaying(false); setError((err as Error).message);
        }
      };
      next(0);
    } catch (err) {
      if (generation.current === run) {
        wantsPlayback.current = false;
        player.current?.remove(); player.current = null;
        setPlaying(false); setError((err as Error).message);
      }
    }
  }
  async function seek(delta: number) {
    const p = player.current;
    if (!p || props.disabled) return;
    try { await p.seekTo(Math.max(0, Math.min(p.duration, p.currentTime + delta))); }
    catch (err) { setError((err as Error).message); }
  }
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
      {props.seekControls ? <ActionButton icon={RotateCcw} variant="outline"
        accessibilityLabel="Rewind source 10 seconds" disabled={props.disabled || !available}
        onPress={() => void seek(-10)} /> : null}
      <ActionButton icon={available ? playing ? Pause : Play : CloudDownload}
        accessibilityLabel={available ? playing ? 'Pause playback' : props.label ?? 'Play audio' : 'Audio is not on this phone yet'}
        variant="outline" disabled={!available || props.disabled} onPress={() => void toggle()} />
      {props.seekControls ? <ActionButton icon={RotateCw} variant="outline"
        accessibilityLabel="Forward source 10 seconds" disabled={props.disabled || !available}
        onPress={() => void seek(10)} /> : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={text.muted}>{error}</Text> : null}
    </View>
  );
}
