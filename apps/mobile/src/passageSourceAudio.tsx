// Recordings beside the recorder: the team's own source audio and the
// recordings in reference material (passageResources.ts). Bible text and
// audio are the source reader's (sources/SourceReader.tsx).
//
// The recording screen's top pane (LAN-23) plays these while a take is
// being recorded, so its player takes the listen loop's hooks: playing first
// pauses the microphone, and stopping (pause, end, failure) lets it resume.
// It is AudioClip's player with those two hooks; AudioClip itself has no
// way to wait before switching the audio session to playback.
import { isStored } from '@langquest-next/core';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Text } from './text';
import { audioFormat } from './audioClip';
import { registerPlayback, setSessionAudioMode, stopAudioPlayback } from './audioSession';
import type { Ctx } from './ctx';
import { t } from './i18n';
import { getReferenceSlides } from './passageResources';
import { Card, IconBtn, Ico, txt } from './kit';
import type { ListenHooks } from './recording/useListenLoop';
import { noteExpected, reportError } from './report';
import { C, space, target, TINT } from './theme';
import type { LanguageHandle } from './useLanguage';

/** The passage's reference recordings, each with its own player; nothing when there are none. */
export function ReferenceRecordings({ ctx, unitId, disabled, listen, onPlay }: {
  ctx: Ctx; unitId: string; disabled: boolean; listen?: ListenHooks; onPlay?: (id: string) => void;
}) {
  const references = ctx.language.state
    ? getReferenceSlides(ctx.language.state, unitId) : [];
  if (references.length === 0) return null;
  return <View style={{ gap: space.sm }}>
    {references.map((item) => <Card key={item.id}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Ico name="listen" size={22} color={TINT.amberText} />
        <Text style={[txt.sm, { flex: 1 }]}>{item.label}</Text>
      </View>
      <SourcePlayer language={ctx.language} hashes={[item.hash]} {...(listen ? { listen } : {})}
        label={t('sources.recordings.play', { name: item.label })} disabled={disabled} {...(onPlay ? { onPlay: () => onPlay(item.id) } : {})} />
    </Card>)}
  </View>;
}

function playbackFailed(where: string, err: unknown): string {
  return t('common.audioCouldNotPlay', { code: reportError(where, err) });
}

/**
 * Play/pause with ±10 seconds, for something to listen to while recording:
 * a source chapter, a reference recording, or (back translation) the version
 * being said back. With `listen`, playing waits for the microphone to pause,
 * and every way playback stops is reported so recording can resume.
 */
export function SourcePlayer(props: {
  language: LanguageHandle;
  hashes: string[];
  uri?: string;
  label: string;
  disabled?: boolean;
  listen?: ListenHooks;
  /** Called when it starts playing (the record of what was used). */
  onPlay?: () => void;
}) {
  const [playing, setPlayingState] = useState(false);
  const [error, setError] = useState('');
  const [, refresh] = useState(0);
  const player = useRef<AudioPlayer | null>(null);
  const generation = useRef(0);
  const wants = useRef(false);
  const signature = props.uri ?? props.hashes.join(':');
  const languageRef = useRef(props.language);
  languageRef.current = props.language;
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
  useEffect(() => props.language.blobs.store?.onChange(() => refresh((n) => n + 1)), [props.language.blobs.store]);
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
  const state = props.language.state;
  const here = !!props.uri || (!!state && props.hashes.length > 0 && props.hashes.every((hash) =>
    !!props.language.blobs.uriFor({ hash, format: audioFormat(state, hash) })));
  // As AudioClip: what the server has plays from there while connected.
  const available = here || (!!state && props.hashes.length > 0 && props.language.online !== false
    && props.hashes.every((hash) => isStored(state, hash)));

  async function toggle() {
    if (props.disabled) return;
    if (wants.current) { halt(); return; }
    const run = ++generation.current;
    wants.current = true;
    setPlaying(true);
    setError('');
    props.onPlay?.();
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
      const next = async (index: number) => {
        if (!wants.current || generation.current !== run) return;
        player.current?.remove();
        player.current = null;
        if (index >= (props.uri ? 1 : props.hashes.length)) { wants.current = false; setPlaying(false); return; }
        const language = languageRef.current;
        const hash = props.hashes[index];
        const ref = hash && language.state ? { hash, format: audioFormat(language.state, hash) } : null;
        let uri = props.uri ?? (ref ? language.blobs.uriFor(ref) : null);
        if (!uri && ref && language.state && isStored(language.state, ref.hash)) {
          try { uri = await language.blobs.streamUri(ref); }
          catch (err) {
            noteExpected('source player stream', err);
            if (generation.current === run) { wants.current = false; setPlaying(false); setError(t('common.audioCouldNotLoad')); }
            return;
          }
          if (!wants.current || generation.current !== run) return;
        }
        if (!uri) { wants.current = false; setPlaying(false); setError(t('sources.recordings.notHere')); return; }
        try {
          const p = createAudioPlayer({ uri });
          player.current = p;
          p.addListener('playbackStatusUpdate', (status) => {
            if (player.current !== p) return;
            if (status.error) {
              wants.current = false;
              p.remove(); player.current = null; setPlaying(false);
              setError(t('common.audioCouldNotLoad'));
              return;
            }
            if (status.didJustFinish) void next(index + 1);
          });
          p.play();
        } catch (err) {
          wants.current = false;
          player.current?.remove(); player.current = null;
          setPlaying(false); setError(playbackFailed('source player create', err)); // i18n-ignore: log label
        }
      };
      await next(0);
    } catch (err) {
      if (generation.current === run) {
        wants.current = false;
        player.current?.remove(); player.current = null;
        setPlaying(false); setError(playbackFailed('source player play', err)); // i18n-ignore: log label
      }
    }
  }
  async function seek(delta: number) {
    const p = player.current;
    if (!p || props.disabled) return;
    try { await p.seekTo(Math.max(0, Math.min(p.duration, p.currentTime + delta))); }
    catch (err) { setError(playbackFailed('source player seek', err)); } // i18n-ignore: log label
  }
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <IconBtn name="restart" label={t('sources.recordings.rewind')} size={target.min}
          bg={C.light} color={C.primary} disabled={props.disabled || !available} onPress={() => void seek(-10)} />
        <IconBtn name={available ? playing ? 'pause' : 'play' : 'download'} size={target.primary} bg={C.light} color={C.primary}
          label={available ? playing ? t('sources.recordings.pause') : props.label : t('sources.recordings.notHereLabel')}
          disabled={!available || props.disabled} onPress={() => void toggle()} />
        <IconBtn name="skip" label={t('sources.recordings.forward')} size={target.min}
          bg={C.light} color={C.primary} disabled={props.disabled || !available} onPress={() => void seek(10)} />
      </View>
      {error ? <Text accessibilityRole="alert" style={txt.error}>{error}</Text> : null}
    </View>
  );
}
