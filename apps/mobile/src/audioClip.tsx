// Avatar U. Local and remote playback, paused before recording starts.
import type { BlobRef, ProjectState } from '@langquest-next/core';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { CloudDownload, Ellipsis, Pause, Play, RotateCcw, RotateCw } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { usePreferences } from './accountPreferences';
import { AudioEditor, type AudioEditTarget } from './audioEditor';
import { cardInfo, ShareAudioButton } from './audioExport';
import type { ProjectHandle } from './useProject';
import { ActionButton, text } from './ui';
import { registerPlayback, setSessionAudioMode, stopAudioPlayback } from './audioSession';

export function audioFormat(state: ProjectState, hash: string): BlobRef['format'] {
  for (const recording of Object.values(state.recordings)) {
    const card = recording.cards.find((c) => c.hash === hash);
    if (card) return card.format ?? 'wav';
  }
  for (const r of Object.values(state.obt.audio)) {
    const card = r.value.cards.find(c => c.hash === hash);
    if (card) return card.format ?? 'm4a';
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
  hideActions?: boolean;
  editTarget?: AudioEditTarget;
  startSeconds?: number;
  endSeconds?: number;
}) {
  const { locked } = usePreferences();
  const [editing, setEditing] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [, refresh] = useState(0);
  const player = useRef<AudioPlayer | null>(null);
  const generation = useRef(0);
  const wantsPlayback = useRef(false);
  const signature = `${props.uri ?? props.hashes.join(':')}:${props.startSeconds ?? 0}:${props.endSeconds ?? ''}`;
  const projectRef = useRef(props.project);
  projectRef.current = props.project;
  useEffect(() => { if (locked) stopAudioPlayback(); }, [locked]);
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
  const matchingTake = Object.entries(state?.takes ?? {}).filter(([, take]) =>
    !take.archived && take.cardHashes.join(':') === props.hashes.join(':'))
    .sort(([, a], [, b]) => b.hlc.localeCompare(a.hlc))[0];
  const metadata = matchingTake ? state?.takeMetadata[matchingTake[0]]?.value : undefined;
  const available = !!props.uri || (!!state && props.hashes.length > 0 && props.hashes.every((hash) =>
    !!props.project.blobs.uriFor({ hash, format: audioFormat(state, hash) })));

  const recognized = props.hashes.length > 0 && !props.uri && props.hashes.every(hash => {
    try { cardInfo(props.project, hash); return true; } catch { return false; }
  });
  function openEditor() {
    if (!props.disabled && !props.hideActions && recognized && available && !locked) {
      stopAudioPlayback(); setEditing(true);
    }
  }
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
      if (player.current?.isLoaded) {
        if (player.current.currentTime < (props.startSeconds ?? 0) ||
          (player.current.duration > 0 && player.current.currentTime >=
            (props.endSeconds ?? player.current.duration) - 0.1)) {
          await player.current.seekTo(props.startSeconds ?? 0, 0, 0);
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
          const p = createAudioPlayer({ uri }, { updateInterval: 100 });
          player.current = p;
          const playbackRun = generation.current;
          let initialized = false;
          const begin = () => {
            if (initialized || !p.isLoaded || player.current !== p ||
                generation.current !== playbackRun || !wantsPlayback.current) return;
            initialized = true;
            void p.seekTo(props.startSeconds ?? 0, 0, 0).then(() => {
              if (player.current === p && generation.current === playbackRun && wantsPlayback.current) p.play();
            }).catch(() => {
              if (player.current !== p) return;
              wantsPlayback.current = false; p.remove(); player.current = null;
              setPlaying(false); setError('Audio could not seek to this passage.');
            });
          };
          p.addListener('playbackStatusUpdate', (status) => {
            if (player.current !== p) return;
            if (status.error) {
              wantsPlayback.current = false;
              p.remove(); player.current = null; setPlaying(false);
              setError('Audio could not load. Check your connection and try again.');
              return;
            }
            begin();
            if (initialized && wantsPlayback.current &&
              (status.didJustFinish || (props.endSeconds !== undefined &&
                status.currentTime >= props.endSeconds))) {
              p.pause(); next(index + 1);
            }
          });
          begin();
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
    try { await p.seekTo(Math.max(props.startSeconds ?? 0,
      Math.min(props.endSeconds ?? p.duration, p.currentTime + delta)), 0, 0); }
    catch (err) { setError((err as Error).message); }
  }
  return (
    <Pressable onLongPress={openEditor} style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
      {props.seekControls ? <ActionButton icon={RotateCcw} variant="outline"
        accessibilityLabel="Rewind source 10 seconds" disabled={props.disabled || !available}
        onPress={() => void seek(-10)} /> : null}
      <ActionButton icon={available ? playing ? Pause : Play : CloudDownload}
        accessibilityLabel={available ? playing ? 'Pause playback' : props.label ?? 'Play audio' : 'Audio is not on this phone yet'}
        variant="outline" disabled={!available || props.disabled} onPress={() => void toggle()}
        onLongPress={recognized && !props.hideActions ? openEditor : undefined} />
      {props.seekControls ? <ActionButton icon={RotateCw} variant="outline"
        accessibilityLabel="Forward source 10 seconds" disabled={props.disabled || !available}
        onPress={() => void seek(10)} /> : null}
      {!props.hideActions && recognized ? <>
        {recognized ? <ActionButton icon={Ellipsis} variant="outline"
          accessibilityLabel={props.editTarget ? "Open recording editor" : "Open recording details"} disabled={props.disabled || !available}
          onPress={openEditor} /> : null}
        <ShareAudioButton project={props.project} hashes={props.hashes}
          name={metadata?.name ?? props.label} disabled={props.disabled || !available} />
      </> : null}
      </View>
      {metadata && !props.hideActions ? <Text style={text.small}>{metadata.name}</Text> : null}
      {!props.hideActions && props.hashes.length === 1 ? metadata?.milestones.map((milestone, index) => <View key={index} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <Text style={text.small}>Verse {milestone.verseStart}{milestone.verseEnd === milestone.verseStart ? '' : `–${milestone.verseEnd}`}</Text>
        <AudioClip project={props.project} hashes={props.hashes} hideActions
          label={`Play verse ${milestone.verseStart} to ${milestone.verseEnd}`}
          disabled={props.disabled} startSeconds={milestone.startMs / 1000}
          endSeconds={(milestone.endMs ?? metadata.milestones[index + 1]?.startMs) === undefined ? undefined : (milestone.endMs ?? metadata.milestones[index + 1]!.startMs) / 1000} />
      </View>) : null}
      {editing ? <AudioEditor project={props.project} hashes={props.hashes}
        label={props.label} target={props.editTarget} locked={locked} onClose={() => setEditing(false)} /> : null}
      {error ? <Text accessibilityRole="alert" style={text.muted}>{error}</Text> : null}
    </Pressable>
  );
}
