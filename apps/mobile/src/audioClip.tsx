// Avatar U. Local and remote playback, paused before recording starts.
import { isStored, type BlobRef, type LanguageState } from '@langquest-next/core';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { LanguageHandle } from './useLanguage';
import { t } from './i18n';
import { IconBtn, txt } from './kit';
import { noteExpected, reportError } from './report';
import { C, target } from './theme';
import { registerPlayback, setSessionAudioMode, stopAudioPlayback } from './audioSession';

export function audioFormat(state: LanguageState, hash: string): BlobRef['format'] {
  for (const recording of Object.values(state.recordings)) {
    const card = recording.cards.find((c) => c.hash === hash);
    if (card) return card.format ?? 'wav';
  }
  // A voice note: m4a unless the log says otherwise (decisions.md 77).
  return state.audioFormats[hash]?.value ?? 'm4a';
}

// A player failure is a fault (native audio): it is reported and said without its message.
export function AudioClip(props: {
  language: LanguageHandle;
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
  const languageRef = useRef(props.language);
  languageRef.current = props.language;
  useEffect(() => props.language.blobs.store?.onChange(() => refresh((n) => n + 1)), [props.language.blobs.store]);
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
  const state = props.language.state;
  const here = !!props.uri || (!!state && props.hashes.length > 0 && props.hashes.every((hash) =>
    !!props.language.blobs.uriFor({ hash, format: audioFormat(state, hash) })));
  // Not on this phone (a passage outside the offline scope) but on the server: play it from there while connected.
  const streamable = !here && !!state && props.hashes.length > 0 && props.language.online !== false
    && props.hashes.every((hash) => isStored(state, hash));
  const available = here || streamable;

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
      const next = async (index: number) => {
        if (!wantsPlayback.current) return;
        player.current?.remove();
        player.current = null;
        if (index >= (props.uri ? 1 : props.hashes.length)) {
          wantsPlayback.current = false; setPlaying(false); return;
        }
        const hash = props.hashes[index]!;
        const language = languageRef.current;
        const ref = language.state ? { hash, format: audioFormat(language.state, hash) } : null;
        let uri = props.uri ?? (ref && language.blobs.uriFor(ref));
        if (!uri && ref && language.state && isStored(language.state, hash)) {
          try { uri = await language.blobs.streamUri(ref); }
          catch (err) {
            noteExpected('audio clip stream', err);
            if (generation.current === run) { wantsPlayback.current = false; setPlaying(false); setError(t('common.audioCouldNotLoad')); }
            return;
          }
          if (generation.current !== run || !wantsPlayback.current) return;
        }
        if (!uri) { wantsPlayback.current = false; setPlaying(false); setError(t('recording.player.notOnDeviceYet')); return; }
        try {
          const p = createAudioPlayer({ uri });
          player.current = p;
          p.addListener('playbackStatusUpdate', (status) => {
            if (player.current !== p) return;
            if (status.error) {
              wantsPlayback.current = false;
              p.remove(); player.current = null; setPlaying(false);
              setError(t('common.audioCouldNotLoad'));
              return;
            }
            if (status.didJustFinish && player.current === p) void next(index + 1);
          });
          p.play();
        } catch (err) {
          wantsPlayback.current = false;
          player.current?.remove(); player.current = null;
          setPlaying(false); setError(t('common.audioCouldNotPlay', { code: reportError('audio clip create player', err) }));
        }
      };
      await next(0);
    } catch (err) {
      if (generation.current === run) {
        wantsPlayback.current = false;
        player.current?.remove(); player.current = null;
        setPlaying(false); setError(t('common.audioCouldNotPlay', { code: reportError('audio clip play', err) }));
      }
    }
  }
  async function seek(delta: number) {
    const p = player.current;
    if (!p || props.disabled) return;
    try { await p.seekTo(Math.max(0, Math.min(p.duration, p.currentTime + delta))); }
    catch (err) { setError(t('common.audioCouldNotPlay', { code: reportError('audio clip seek', err) })); }
  }
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {props.seekControls ? <IconBtn name="restart" label={t('recording.player.rewindSource')} size={target.min}
          bg={C.light} color={C.primary} disabled={props.disabled || !available} onPress={() => void seek(-10)} /> : null}
        <IconBtn name={available ? playing ? 'pause' : 'play' : 'download'} size={target.primary} bg={C.light} color={C.primary}
          label={available ? playing ? t('recording.player.pausePlayback') : props.label ?? t('recording.player.playAudio') : t('recording.player.notOnDevice')}
          disabled={!available || props.disabled} onPress={() => void toggle()} />
        {props.seekControls ? <IconBtn name="skip" label={t('recording.player.forwardSource')} size={target.min}
          bg={C.light} color={C.primary} disabled={props.disabled || !available} onPress={() => void seek(10)} /> : null}
      </View>
      {error ? <Text accessibilityRole="alert" style={txt.error}>{error}</Text> : null}
    </View>
  );
}
