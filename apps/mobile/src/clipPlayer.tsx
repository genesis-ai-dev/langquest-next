// The big player on Ryder's screens (demo simple/kit.tsx Player): a card with
// what is playing, a timeline to tap or drag, Back 10 seconds, a big play
// button, and Note when the screen can take a note at a moment. It plays a
// passage's cards one after another as one recording, like AudioClip, and
// shows where in the whole recording it is.
import { isStored, type LanguageState } from '@langquest-next/core';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PanResponder, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { Text } from './text';
import { audioFormat } from './audioClip';
import { registerPlayback, setSessionAudioMode, stopAudioPlayback } from './audioSession';
import type { ListenHooks } from './recording/useListenLoop';
import { useHelpPress } from './helpContext';
import { t } from './i18n';
import { formatClock, formatNumber } from './i18n/format';
import { Ico, txt } from './kit';
import { noteExpected, reportError } from './report';
import { C, radius, space, TINT } from './theme';
import type { LanguageHandle } from './useLanguage';

/** "1:05" from seconds. */
export function clock(seconds: number): string {
  return formatClock(seconds * 1000);
}

/** The length of these cards together, in seconds (0 when unknown). */
export function clipSeconds(state: LanguageState | null | undefined, hashes: string[]): number {
  if (!state) return 0;
  let total = 0;
  for (const hash of hashes) {
    for (const r of Object.values(state.recordings)) {
      const card = r.cards.find((c) => c.hash === hash);
      if (card?.durationMs) { total += card.durationMs / 1000; break; }
    }
  }
  return total;
}

/** Each card's length in seconds, from the recording that holds it (0 when unknown). */
function cardSeconds(language: LanguageHandle, hashes: string[]): number[] {
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

export function ClipPlayer(props: {
  language: LanguageHandle;
  hashes: string[];
  /** A file to play instead of the passage's cards (a source Bible, a study step). */
  uri?: string;
  title: string;
  sub?: string;
  /** Beside the title: a Bible picker, a menu. */
  right?: ReactNode;
  tone?: 'brand' | 'amber';
  big?: boolean;
  /** Offer Note: called with the moment (seconds into the whole recording). */
  onNote?: (atSeconds: number) => void;
  /** Called once each time it starts playing (the record of what was used). */
  onPlay?: () => void;
  /** Called with true while it plays, so a recorder can pause (listen, speak, listen). */
  onPlaying?: (on: boolean) => void;
  /** The recorder's listen loop: the microphone pauses before this plays, and resumes when it stops. */
  listen?: ListenHooks;
  disabled?: boolean;
  /** No card around it (it sits inside another card). */
  bare?: boolean;
}) {
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
  const signature = props.uri ?? props.hashes.join(':');
  const languageRef = useRef(props.language);
  languageRef.current = props.language;
  const onPlayingRef = useRef(props.onPlaying);
  onPlayingRef.current = props.onPlaying;
  const listenRef = useRef(props.listen);
  listenRef.current = props.listen;
  // Report only real changes, so a stop that was already stopped never resumes recording twice.
  const reported = useRef(false);
  const setPlaying = (on: boolean) => {
    setPlayingState(on);
    onPlayingRef.current?.(on);
    if (reported.current !== on) { reported.current = on; listenRef.current?.onPlaying(on); }
  };
  const halt = () => {
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
    setIndex(0); indexRef.current = 0;
    setAt(0);
    return () => {
      generation.current++;
      wants.current = false;
      player.current?.remove();
      player.current = null;
    };
  }, [signature]);

  const count = props.uri ? 1 : props.hashes.length;
  const lengths = props.uri ? [clipLength] : cardSeconds(props.language, props.hashes);
  // The clip playing knows its own length once loaded; the others come from the record.
  if (!props.uri && clipLength > 0 && index < lengths.length) lengths[index] = clipLength;
  const total = lengths.reduce((a, b) => a + b, 0);
  const before = lengths.slice(0, index).reduce((a, b) => a + b, 0);
  const elapsed = before + at;
  const state = props.language.state;
  const here = !!props.uri || (!!state && props.hashes.length > 0 && props.hashes.every((hash) =>
    !!props.language.blobs.uriFor({ hash, format: audioFormat(state, hash) })));
  const available = here || (!!state && props.hashes.length > 0 && props.language.online !== false
    && props.hashes.every((hash) => isStored(state, hash)));

  /** Load clip `i` and play it from `from` seconds; on its end, the next one. */
  async function playFrom(i: number, from: number, run: number) {
    if (!wants.current || generation.current !== run) return;
    player.current?.remove();
    player.current = null;
    if (i >= count) { wants.current = false; setPlaying(false); setIndex(0); indexRef.current = 0; setAt(0); return; }
    setIndex(i); indexRef.current = i;
    const language = languageRef.current;
    let uri = props.uri;
    if (!uri) {
      const hash = props.hashes[i]!;
      const ref = language.state ? { hash, format: audioFormat(language.state, hash) } : null;
      uri = (ref && language.blobs.uriFor(ref)) || undefined;
      if (!uri && ref && language.state && isStored(language.state, hash)) {
        try { uri = await language.blobs.streamUri(ref); } catch (err) {
          noteExpected('clip player stream', err);
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
      setError(t('common.audioCouldNotPlay', { code: reportError('clip player create', err) }));
    }
  }

  async function toggle() {
    if (props.disabled || !available) return;
    if (wants.current) { halt(); return; }
    stopAudioPlayback();
    const run = ++generation.current;
    wants.current = true;
    setPlaying(true);
    setError('');
    props.onPlay?.();
    try {
      // The microphone first: nothing of this may land in a take.
      await listenRef.current?.beforePlay();
      if (generation.current !== run) return;
      await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true });
      if (generation.current !== run) return;
      const p = player.current;
      if (p && p.duration > 0 && p.currentTime < p.duration - 0.1) { p.play(); return; }
      await playFrom(p ? indexRef.current : 0, 0, run);
    } catch (err) {
      if (generation.current === run) { halt(); setError(t('common.audioCouldNotPlay', { code: reportError('clip player play', err) })); }
    }
  }

  /** Jump to a moment in the whole recording. */
  async function seekTo(seconds: number) {
    if (props.disabled || !available) return;
    const target = Math.max(0, Math.min(total > 0 ? total - 0.05 : seconds, seconds));
    let i = 0;
    let start = 0;
    while (i < lengths.length - 1 && start + (lengths[i] ?? 0) <= target) { start += lengths[i] ?? 0; i++; }
    const within = target - start;
    const p = player.current;
    if (p && i === indexRef.current) {
      try { await p.seekTo(within); setAt(within); } catch (err) { setError(t('recording.player.couldNotSeek', { code: reportError('clip player seek', err) })); }
      return;
    }
    // Another clip: load it there, playing only if it was playing.
    const was = wants.current;
    const run = ++generation.current;
    wants.current = true;
    if (!was) {
      // Load paused: play then pause once it is ready.
      await playFrom(i, within, run);
      halt();
      setIndex(i); indexRef.current = i; setAt(within);
      return;
    }
    await playFrom(i, within, run);
  }

  const back10 = useHelpPress(t('common.backTenSeconds'), t('recording.player.back10Help'), () => void seekTo(elapsed - 10));
  const note = useHelpPress(t('recording.player.note'), t('recording.player.noteHelp'), props.onNote ? () => { halt(); props.onNote?.(elapsed); } : undefined);
  const play = useHelpPress(playing ? t('common.pause') : t('recording.player.playTitle', { title: props.title }), t('recording.player.playHelp'), () => void toggle());

  // The timeline: tap anywhere, or drag the thumb.
  const width = useRef(1);
  const totalRef = useRef(total);
  totalRef.current = total;
  const seekRef = useRef(seekTo);
  seekRef.current = seekTo;
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => { void seekRef.current((e.nativeEvent.locationX / width.current) * totalRef.current); },
    onPanResponderRelease: (e) => { void seekRef.current((e.nativeEvent.locationX / width.current) * totalRef.current); },
    onPanResponderTerminationRequest: () => false
  })).current;
  const share = total > 0 ? Math.min(1, elapsed / total) : 0;
  const tone = props.tone === 'amber' ? TINT.amberText : C.primary;
  const size = props.big ? 72 : 56;

  return (
    <View style={[!props.bare && styles.card]}>
      <View style={styles.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.body, { fontWeight: '800' }]} numberOfLines={1}>{props.title}</Text>
          {props.sub ? <Text style={txt.xs} numberOfLines={2}>{props.sub}</Text> : null}
        </View>
        {props.right}
      </View>
      <View style={styles.track} onLayout={(e: LayoutChangeEvent) => { width.current = Math.max(1, e.nativeEvent.layout.width); }}
        accessibilityRole="adjustable" accessibilityLabel={t('recording.player.whereYouAre', { title: props.title })} accessibilityValue={{ text: t('recording.player.position', { at: clock(elapsed), total: clock(total) }) }}
        {...pan.panHandlers}>
        <View style={styles.rail} />
        <View style={[styles.fill, { width: `${share * 100}%`, backgroundColor: tone }]} />
        <View style={[styles.thumb, { left: `${share * 100}%`, borderColor: tone }]} />
      </View>
      <View style={styles.controls}>
        <Text style={[txt.xs, styles.time]}>{clock(elapsed)}</Text>
        <Pressable onPress={back10} disabled={!available || props.disabled} accessibilityRole="button" accessibilityLabel={t('common.backTenSeconds')}
          style={({ pressed }) => [styles.side, pressed && styles.pressed, (!available || props.disabled) && styles.off]}>
          <Ico name="restart" size={20} color={C.dark} />
          <Text style={styles.sideLabel}>{formatNumber(10)}</Text>
        </Pressable>
        <Pressable onPress={play} disabled={!available || props.disabled} accessibilityRole="button"
          accessibilityLabel={available ? playing ? t('common.pause') : t('recording.player.playTitle', { title: props.title }) : t('recording.player.notOnDevice')}
          style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: available ? tone : C.faint, alignItems: 'center', justifyContent: 'center' }, pressed && styles.pressed]}>
          <Ico name={available ? playing ? 'pause' : 'play' : 'download'} size={Math.round(size * 0.4)} color={C.white} />
        </Pressable>
        {props.onNote ? (
          <Pressable onPress={note} accessibilityRole="button" accessibilityLabel={t('recording.player.addNoteAtMoment')}
            style={({ pressed }) => [styles.side, pressed && styles.pressed]}>
            <Ico name="chat" size={18} color={TINT.amberText} />
            <Text style={[styles.sideLabel, { color: TINT.amberText }]}>{t('recording.player.note')}</Text>
          </Pressable>
        ) : <View style={{ width: 52 }} />}
        <Text style={[txt.xs, styles.time, { textAlign: 'right' }]}>{clock(total)}</Text>
      </View>
      {error ? <Text accessibilityRole="alert" style={txt.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, padding: space.md, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  track: { height: 32, justifyContent: 'center' },
  rail: { position: 'absolute', left: 0, right: 0, height: 6, borderRadius: 3, backgroundColor: C.light },
  fill: { position: 'absolute', left: 0, height: 6, borderRadius: 3 },
  thumb: { position: 'absolute', width: 22, height: 22, marginLeft: -11, borderRadius: 11, backgroundColor: C.white, borderWidth: 3 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg },
  time: { width: 40 },
  side: { width: 52, height: 52, borderRadius: 26, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  sideLabel: { fontSize: 11, fontWeight: '800', color: C.dark },
  pressed: { opacity: 0.7 },
  off: { opacity: 0.4 }
});
