// Avatar U. Replay chapter sources and passage references beside the recorder.
//
// The recording screen's top pane (LAN-23) plays the source while a take is
// being recorded, so its player takes the listen loop's hooks: playing first
// pauses the microphone, and stopping (pause, end, failure) lets it resume.
// It is AudioClip's player with those two hooks; AudioClip itself has no
// way to wait before switching the audio session to playback.
import {
  SOURCE_BIBLES, sourceAudioUrl, sourceBibleEnabled, sourceChapters
} from '@langquest-next/core';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { audioFormat } from './audioClip';
import { registerPlayback, setSessionAudioMode, stopAudioPlayback } from './audioSession';
import type { Ctx } from './ctx';
import { getReferenceSlides } from './passageResources';
import { Card, IconBtn, Ico, txt } from './kit';
import type { ListenHooks } from './recording/useListenLoop';
import { reportError } from './report';
import { C, space, target, TINT } from './theme';
import type { ProjectHandle } from './useProject';

export function PassageSourceAudio({ ctx, unitId, laneId, disabled, listen }: {
  ctx: Ctx; unitId: string; laneId: string; disabled: boolean; listen?: ListenHooks;
}) {
  const chapters = sourceChapters(unitId);
  const bibles = SOURCE_BIBLES.filter((b) => ctx.org.state &&
    sourceBibleEnabled(ctx.org.state, b.id, ctx.project.projectId));
  const references = ctx.project.state
    ? getReferenceSlides(ctx.project.state, laneId, unitId) : [];
  if (bibles.length === 0 && references.length === 0) return null;
  return <View style={{ gap: space.sm }}>
    {bibles.flatMap((bible) => chapters.map((chapter) =>
      <Card key={`${bible.id}:${chapter.book}:${chapter.chapter}`}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Ico name="listen" size={22} color={TINT.amberText} />
          <View style={{ flex: 1 }}>
            <Text style={txt.body}>{chapter.label} · {bible.code}</Text>
            <Text style={txt.xs}>Full chapter</Text>
          </View>
        </View>
        <SourcePlayer project={ctx.project} hashes={[]} disabled={disabled} {...(listen ? { listen } : {})}
          uri={sourceAudioUrl(bible, chapter,
            process.env.EXPO_PUBLIC_SOURCE_AUDIO_BASE_URL ??
              'https://pub-e5e8108b319c42069acd1ebf4fd0fb02.r2.dev')}
          label={`Play ${bible.name}, ${chapter.label}, full chapter`} />
      </Card>))}
    {references.map((item) => <Card key={item.id}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Ico name="listen" size={22} color={TINT.amberText} />
        <Text style={[txt.sm, { flex: 1 }]}>{item.label}</Text>
      </View>
      <SourcePlayer project={ctx.project} hashes={[item.hash]} {...(listen ? { listen } : {})}
        label={`Play ${item.label}`} disabled={disabled} />
    </Card>)}
  </View>;
}

function playbackFailed(where: string, err: unknown): string {
  return `Audio could not play (code ${reportError(where, err)}).`;
}

/**
 * Play/pause with ±10 seconds, for something to listen to while recording:
 * a source chapter, a reference recording, or (back translation) the version
 * being said back. With `listen`, playing waits for the microphone to pause,
 * and every way playback stops is reported so recording can resume.
 */
export function SourcePlayer(props: {
  project: ProjectHandle;
  hashes: string[];
  uri?: string;
  label: string;
  disabled?: boolean;
  listen?: ListenHooks;
}) {
  const [playing, setPlayingState] = useState(false);
  const [error, setError] = useState('');
  const [, refresh] = useState(0);
  const player = useRef<AudioPlayer | null>(null);
  const generation = useRef(0);
  const wants = useRef(false);
  const signature = props.uri ?? props.hashes.join(':');
  const projectRef = useRef(props.project);
  projectRef.current = props.project;
  const listenRef = useRef(props.listen);
  listenRef.current = props.listen;
  // Report only real changes, so a stop that was already stopped never resumes recording twice.
  const reported = useRef(false);
  const setPlaying = (on: boolean) => {
    setPlayingState(on);
    if (reported.current !== on) { reported.current = on; listenRef.current?.onPlaying(on); }
  };
  const self = useRef(false);
  const halt = () => {
    if (self.current) return;
    generation.current++;
    wants.current = false;
    player.current?.pause();
    setPlaying(false);
  };
  useEffect(() => props.project.blobs.store?.onChange(() => refresh((n) => n + 1)), [props.project.blobs.store]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => registerPlayback(halt), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (props.disabled) halt(); }, [props.disabled]);
  useEffect(() => {
    setPlayingState(false);
    setError('');
    return () => {
      generation.current++;
      wants.current = false;
      player.current?.remove();
      player.current = null;
    };
  }, [signature]);
  const state = props.project.state;
  const available = !!props.uri || (!!state && props.hashes.length > 0 && props.hashes.every((hash) =>
    !!props.project.blobs.uriFor({ hash, format: audioFormat(state, hash) })));

  async function toggle() {
    if (props.disabled) return;
    if (wants.current) { halt(); return; }
    const run = ++generation.current;
    wants.current = true;
    setPlaying(true);
    setError('');
    try {
      // The microphone first: nothing of the source may land in a take.
      await listenRef.current?.beforePlay();
      if (generation.current !== run) return;
      // Stop every other player, not this one.
      self.current = true;
      try { stopAudioPlayback(); } finally { self.current = false; }
      await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true });
      if (generation.current !== run) return;
      if (player.current) {
        if (player.current.duration > 0 && player.current.currentTime >= player.current.duration - 0.1) await player.current.seekTo(0);
        if (generation.current === run) player.current?.play();
        return;
      }
      const next = (index: number) => {
        if (!wants.current || generation.current !== run) return;
        player.current?.remove();
        player.current = null;
        if (index >= (props.uri ? 1 : props.hashes.length)) { wants.current = false; setPlaying(false); return; }
        const project = projectRef.current;
        const hash = props.hashes[index];
        const uri = props.uri ?? (hash && project.state ? project.blobs.uriFor({ hash, format: audioFormat(project.state, hash) }) : null);
        if (!uri) { wants.current = false; setPlaying(false); setError('Audio is not on this phone yet.'); return; }
        try {
          const p = createAudioPlayer({ uri });
          player.current = p;
          p.addListener('playbackStatusUpdate', (status) => {
            if (player.current !== p) return;
            if (status.error) {
              wants.current = false;
              p.remove(); player.current = null; setPlaying(false);
              setError('Audio could not load. Check your connection and try again.');
              return;
            }
            if (status.didJustFinish) next(index + 1);
          });
          p.play();
        } catch (err) {
          wants.current = false;
          player.current?.remove(); player.current = null;
          setPlaying(false); setError(playbackFailed('source player create', err));
        }
      };
      next(0);
    } catch (err) {
      if (generation.current === run) {
        wants.current = false;
        player.current?.remove(); player.current = null;
        setPlaying(false); setError(playbackFailed('source player play', err));
      }
    }
  }
  async function seek(delta: number) {
    const p = player.current;
    if (!p || props.disabled) return;
    try { await p.seekTo(Math.max(0, Math.min(p.duration, p.currentTime + delta))); }
    catch (err) { setError(playbackFailed('source player seek', err)); }
  }
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <IconBtn name="restart" label="Rewind source 10 seconds" size={target.min}
          bg={C.light} color={C.primary} disabled={props.disabled || !available} onPress={() => void seek(-10)} />
        <IconBtn name={available ? playing ? 'pause' : 'play' : 'download'} size={target.primary} bg={C.light} color={C.primary}
          label={available ? playing ? 'Pause playback' : props.label : 'Audio is not on this phone yet'}
          disabled={!available || props.disabled} onPress={() => void toggle()} />
        <IconBtn name="skip" label="Forward source 10 seconds" size={target.min}
          bg={C.light} color={C.primary} disabled={props.disabled || !available} onPress={() => void seek(10)} />
      </View>
      {error ? <Text accessibilityRole="alert" style={txt.error}>{error}</Text> : null}
    </View>
  );
}
