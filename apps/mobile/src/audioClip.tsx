// Avatar U. Local audio playback with explicit unavailable and error states.
import type { BlobRef, ProjectState } from '@langquest-next/core';
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { CloudDownload, Pause, Play } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { ProjectHandle } from './useProject';
import { ActionButton, text } from './ui';

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
}) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [, refresh] = useState(0);
  const player = useRef<AudioPlayer | null>(null);
  const generation = useRef(0);
  const signature = props.hashes.join(':');
  const projectRef = useRef(props.project);
  projectRef.current = props.project;
  useEffect(() => props.project.blobs.store?.onChange(() => refresh((n) => n + 1)), [props.project.blobs.store]);
  useEffect(() => {
    setPlaying(false);
    setError('');
    return () => {
      generation.current++;
      player.current?.remove();
      player.current = null;
    };
  }, [signature]);
  const state = props.project.state;
  const available = !!state && props.hashes.length > 0 && props.hashes.every((hash) =>
    !!props.project.blobs.uriFor({ hash, format: audioFormat(state, hash) }));

  async function toggle() {
    generation.current++;
    const run = generation.current;
    player.current?.remove();
    player.current = null;
    if (playing) { setPlaying(false); return; }
    setPlaying(true);
    setError('');
    try {
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (generation.current !== run) return;
      const next = (index: number) => {
        if (generation.current !== run) return;
        player.current?.remove();
        player.current = null;
        if (index >= props.hashes.length) { setPlaying(false); return; }
        const hash = props.hashes[index]!;
        const project = projectRef.current;
        const uri = project.state && project.blobs.uriFor({ hash, format: audioFormat(project.state, hash) });
        if (!uri) { setPlaying(false); setError('Audio is not on this phone yet.'); return; }
        try {
          const p = createAudioPlayer({ uri });
          player.current = p;
          p.addListener('playbackStatusUpdate', (status) => {
            if (status.didJustFinish && generation.current === run) next(index + 1);
          });
          p.play();
        } catch (err) { setPlaying(false); setError((err as Error).message); }
      };
      next(0);
    } catch (err) {
      if (generation.current === run) { setPlaying(false); setError((err as Error).message); }
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <ActionButton icon={available ? playing ? Pause : Play : CloudDownload}
        accessibilityLabel={available ? playing ? 'Stop playback' : props.label ?? 'Play audio' : 'Audio is not on this phone yet'}
        variant="outline" disabled={!available} onPress={() => void toggle()} />
      {error ? <Text accessibilityRole="alert" style={text.muted}>{error}</Text> : null}
    </View>
  );
}
