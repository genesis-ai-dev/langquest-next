// The simple screens' small players (a part, a voice note, a version in
// Earlier, "Your word"): the clip player of clipPlayer.tsx without its card,
// so each screen draws the control the design shows. It plays a passage's
// cards one after another as one recording, or one file by `uri`, follows
// audioSession.ts (starting one player stops every other), and streams a
// card that is on the server but not on this device while online.
import { isStored } from '@langquest-next/core';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState } from 'react';
import { audioFormat } from '../audioClip';
import { registerPlayback, setSessionAudioMode, stopAudioPlayback } from '../audioSession';
import { t } from '../i18n';
import { noteExpected, reportError } from '../report';
import type { LanguageHandle } from '../useLanguage';

/** Each card's length in seconds, from the recording that holds it (0 when unknown). */
export function cardSeconds(language: LanguageHandle, hashes: string[]): number[] {
  const state = language.state;
  return hashes.map((hash) => {
    if (!state) return 0;
    for (const r of Object.values(state.recordings)) {
      const card = r.cards.find((c) => c.hash === hash);
      if (card?.durationMs) return card.durationMs / 1000;
    }
    return 0;
  });
}

export interface Clip {
  playing: boolean;
  /** On this device, or on the server while online. */
  available: boolean;
  error: string;
  /** Seconds into the whole recording, and its length (0 when unknown). */
  elapsed: number;
  total: number;
  toggle: () => void;
  stop: () => void;
  seekTo: (seconds: number) => void;
  back10: () => void;
}

export function useClip(language: LanguageHandle, hashes: string[], opts?: { uri?: string; onPlaying?: (on: boolean) => void; disabled?: boolean }): Clip {
  const uriProp = opts?.uri;
  const [playing, setPlayingState] = useState(false);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [at, setAt] = useState(0);
  const [clipLength, setClipLength] = useState(0);
  const [, refresh] = useState(0);
  const player = useRef<AudioPlayer | null>(null);
  const generation = useRef(0);
  const wants = useRef(false);
  const indexRef = useRef(0);
  const signature = uriProp ?? hashes.join(':');
  const live = useRef({ language, hashes, uri: uriProp, onPlaying: opts?.onPlaying });
  live.current = { language, hashes, uri: uriProp, onPlaying: opts?.onPlaying };
  const setPlaying = (on: boolean) => { setPlayingState(on); live.current.onPlaying?.(on); };
  const halt = () => {
    generation.current++;
    wants.current = false;
    player.current?.pause();
    setPlaying(false);
  };
  useEffect(() => language.blobs.store?.onChange(() => refresh((n) => n + 1)), [language.blobs.store]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => registerPlayback(halt), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (opts?.disabled) halt(); }, [opts?.disabled]);
  useEffect(() => {
    setPlayingState(false);
    setError('');
    setIndex(0); indexRef.current = 0;
    setAt(0);
    setClipLength(0);
    return () => {
      generation.current++;
      wants.current = false;
      player.current?.remove();
      player.current = null;
    };
  }, [signature]);

  const count = uriProp ? 1 : hashes.length;
  const lengths = uriProp ? [clipLength] : cardSeconds(language, hashes);
  if (!uriProp && clipLength > 0 && index < lengths.length) lengths[index] = clipLength;
  const total = lengths.reduce((a, b) => a + b, 0);
  const elapsed = lengths.slice(0, index).reduce((a, b) => a + b, 0) + at;
  const state = language.state;
  const here = !!uriProp || (!!state && hashes.length > 0 && hashes.every((hash) => !!language.blobs.uriFor({ hash, format: audioFormat(state, hash) })));
  const available = here || (!!state && hashes.length > 0 && language.online !== false && hashes.every((hash) => isStored(state, hash)));

  async function playFrom(i: number, from: number, run: number) {
    if (!wants.current || generation.current !== run) return;
    player.current?.remove();
    player.current = null;
    if (i >= count) { wants.current = false; setPlaying(false); setIndex(0); indexRef.current = 0; setAt(0); return; }
    setIndex(i); indexRef.current = i;
    const lang = live.current.language;
    let uri = live.current.uri;
    if (!uri) {
      const hash = live.current.hashes[i]!;
      const ref = lang.state ? { hash, format: audioFormat(lang.state, hash) } : null;
      uri = (ref && lang.blobs.uriFor(ref)) || undefined;
      if (!uri && ref && lang.state && isStored(lang.state, hash)) {
        try { uri = await lang.blobs.streamUri(ref); } catch (err) {
          noteExpected('simple clip stream', err);
          if (generation.current === run) { wants.current = false; setPlaying(false); setError(t('common.audioCouldNotLoad')); }
          return;
        }
        if (generation.current !== run || !wants.current) return;
      }
    }
    if (!uri) { wants.current = false; setPlaying(false); setError(t('recording.player.notOnDeviceYet')); return; }
    try {
      const p = createAudioPlayer({ uri });
      player.current = p;
      p.addListener('playbackStatusUpdate', (status) => {
        if (player.current !== p) return;
        if (status.error) {
          wants.current = false; p.remove(); player.current = null; setPlaying(false);
          setError(t('common.audioCouldNotLoad'));
          return;
        }
        if (status.duration > 0) setClipLength(status.duration);
        setAt(status.currentTime);
        if (status.didJustFinish && player.current === p) void playFrom(i + 1, 0, run);
      });
      if (from > 0) await p.seekTo(from);
      if (generation.current === run && wants.current) p.play();
    } catch (err) {
      wants.current = false; player.current?.remove(); player.current = null; setPlaying(false);
      setError(t('common.audioCouldNotPlay', { code: reportError('simple clip create', err) }));
    }
  }

  async function toggle() {
    if (opts?.disabled || !available) return;
    if (wants.current) { halt(); return; }
    stopAudioPlayback();
    const run = ++generation.current;
    wants.current = true;
    setPlaying(true);
    setError('');
    try {
      await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true });
      if (generation.current !== run) return;
      const p = player.current;
      if (p && p.duration > 0 && p.currentTime < p.duration - 0.1) { p.play(); return; }
      await playFrom(p ? indexRef.current : 0, 0, run);
    } catch (err) {
      if (generation.current === run) { halt(); setError(t('common.audioCouldNotPlay', { code: reportError('simple clip play', err) })); }
    }
  }

  async function seekTo(seconds: number) {
    if (opts?.disabled || !available) return;
    const target = Math.max(0, Math.min(total > 0 ? total - 0.05 : seconds, seconds));
    let i = 0;
    let start = 0;
    while (i < lengths.length - 1 && start + (lengths[i] ?? 0) <= target) { start += lengths[i] ?? 0; i++; }
    const within = target - start;
    const p = player.current;
    if (p && i === indexRef.current) {
      try { await p.seekTo(within); setAt(within); } catch (err) { setError(t('recording.player.couldNotSeek', { code: reportError('simple clip seek', err) })); }
      return;
    }
    const was = wants.current;
    const run = ++generation.current;
    wants.current = true;
    if (!was) {
      await playFrom(i, within, run);
      halt();
      setIndex(i); indexRef.current = i; setAt(within);
      return;
    }
    await playFrom(i, within, run);
  }

  return {
    playing, available, error, elapsed, total,
    toggle: () => void toggle(), stop: halt, seekTo: (s) => void seekTo(s), back10: () => void seekTo(elapsed - 10)
  };
}
