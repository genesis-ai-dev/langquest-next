// The big player on Ryder's screens (demo simple/kit.tsx Player): a card with
// what is playing, a timeline to tap or drag, Back 10 seconds, a big play
// button, and Note when the screen can take a note at a moment. It plays a
// passage's cards one after another as one recording, like AudioClip, and
// shows where in the whole recording it is. A file on this device plays at
// even loudness (levelStore.ts, decision 182), and on the web through the
// one element a tap unlocked (recordingPlayer.web.ts). It says which part
// plays and how far into it (nowPlaying.ts), for the parts' rows under it.
import { isStored, recordedDurationMs } from '@langquest-next/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PanResponder, Platform, Pressable, StyleSheet, View, type AccessibilityActionEvent, type LayoutChangeEvent } from 'react-native';
import { Text } from '../ui/text';
import { audioFormat } from './audioFormat';
import { clipsAvailable } from './clipsAvailable';
import { restartIndex } from './clipPosition';
import { LISTEN_PLAYER, registerPlayback, setSessionAudioMode, stopAudioPlayback } from './audioSession';
import type { ListenHooks } from '../recording/useListenLoop';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { Ico } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { noteExpected, reportError } from '../diagnostics/report';
import { countAudio } from './audioTally';
import { C, radius, space, TINT, type as T } from '../ui/theme';
import type { LanguageHandle } from '../sync/useLanguage';

/** The timeline's press while help is on: it explains itself; it is moved by tapping and dragging when help is off. */
const SEEK_ONLY = () => undefined;
import { clock } from './clipTime';
import { playable, prepare } from './levelStore';
import { createRecordingPlayer, unlockRecordingPlayer, type RecordingPlayer } from './recordingPlayer';
import { clearNowPlaying, pauseNowPlaying, tellNowPlaying } from './nowPlaying';

/** Each card's length in seconds, from the recording that holds it (0 when unknown). */
function cardSeconds(language: LanguageHandle, hashes: string[]): number[] {
  const state = language.state;
  return hashes.map((hash) => (state ? recordedDurationMs(state, hash) / 1000 : 0));
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
  /** Who says what plays (nowPlaying.ts): this player, the same object while it is on screen. */
  const [owner] = useState(() => ({}));
  const player = useRef<RecordingPlayer | null>(null);
  const generation = useRef(0);
  const wants = useRef(false);
  /** A seek is loading a clip it will leave paused: `wants` is true, but nothing is meant to be playing. */
  const loadingPaused = useRef(false);
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
    pauseNowPlaying(owner);
    setPlaying(false);
  };
  useEffect(() => props.language.blobs.store?.onChange(() => refresh((n) => n + 1)), [props.language.blobs.store]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- halt reads only refs, so the first draw's copy stops whatever plays
  useEffect(() => registerPlayback(halt), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- halt reads only refs; this runs when the player is turned off, not on every draw
  useEffect(() => { if (props.disabled) halt(); }, [props.disabled]);
  useEffect(() => {
    setPlayingState(false);
    setError('');
    setIndex(0); indexRef.current = 0;
    setAt(0);
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter, not a node: bumping it on cleanup is what stops the old play
      generation.current++;
      wants.current = false;
      player.current?.remove();
      player.current = null;
      clearNowPlaying(owner);
    };
  }, [signature, owner]);

  const count = props.uri ? 1 : props.hashes.length;
  const lengths = props.uri ? [clipLength] : cardSeconds(props.language, props.hashes);
  // The clip playing knows its own length once loaded; the others come from the record.
  if (!props.uri && clipLength > 0 && index < lengths.length) lengths[index] = clipLength;
  const total = lengths.reduce((a, b) => a + b, 0);
  const before = lengths.slice(0, index).reduce((a, b) => a + b, 0);
  const elapsed = before + at;
  const available = !!props.uri || clipsAvailable(props.language, props.hashes);

  /** Load clip `i` and play it from `from` seconds; on its end, the next one. */
  async function playFrom(i: number, from: number, run: number) {
    if (!wants.current || generation.current !== run) return;
    player.current?.remove();
    player.current = null;
    if (i >= count) { wants.current = false; setPlaying(false); setIndex(0); indexRef.current = 0; setAt(0); clearNowPlaying(owner); return; }
    setIndex(i); indexRef.current = i;
    const language = languageRef.current;
    let uri = props.uri;
    const hash = uri ? null : props.hashes[i]!;
    if (hash) {
      const ref = language.state ? { hash, format: audioFormat(language.state, hash) } : null;
      uri = (ref && language.blobs.uriFor(ref)) || undefined;
      if (!uri && ref && language.state && isStored(language.state, hash)) {
        try { uri = await language.blobs.streamUri(ref); } catch (err) {
          noteExpected('clip player stream', err);
          countAudio(language, 'streamFail');
          if (generation.current === run) { wants.current = false; setPlaying(false); setError(t('common.audioCouldNotLoad')); }
          return;
        }
        if (generation.current !== run || !wants.current) return;
      }
    }
    if (!uri) { wants.current = false; setPlaying(false); setError(t('recording.player.notOnDeviceYet')); countAudio(language, 'playNotHere'); return; }
    uri = await playable(hash, uri);
    if (generation.current !== run || !wants.current) return;
    prepare(language, props.hashes[i + 1]);
    try {
      const p = createRecordingPlayer(uri, LISTEN_PLAYER);
      player.current = p;
      p.addListener('playbackStatusUpdate', (status) => {
        if (player.current !== p) return;
        if (status.error) {
          wants.current = false; p.remove(); player.current = null; setPlaying(false); clearNowPlaying(owner);
          setError(t('common.audioCouldNotLoad'));
          countAudio(language, 'playFail');
          return;
        }
        // The browser would not start it without a tap: it waits there, for Play to go on from it.
        if (status.refused) { wants.current = false; setPlaying(false); tellNowPlaying(owner, hash, { ...status, playing: false }); countAudio(language, 'playFail'); return; }
        if (status.duration > 0) setClipLength(status.duration);
        setAt(status.currentTime);
        tellNowPlaying(owner, hash, status);
        // On with the run playing now: Play after a pause started a run of its own, and the next part is part of it.
        if (status.didJustFinish && player.current === p) void playFrom(i + 1, 0, generation.current);
      });
      if (from > 0) await p.seekTo(from);
      if (generation.current === run && wants.current) p.play();
    } catch (err) {
      wants.current = false; player.current?.remove(); player.current = null; setPlaying(false); clearNowPlaying(owner);
      countAudio(language, 'playFail');
      setError(t('common.audioCouldNotPlay', { code: reportError('clip player create', err) }));
    }
  }

  async function toggle() {
    if (props.disabled || !available) return;
    if (wants.current && !loadingPaused.current) { halt(); return; }
    stopAudioPlayback();
    unlockRecordingPlayer();
    const run = ++generation.current;
    wants.current = true;
    setPlaying(true);
    setError('');
    props.onPlay?.();
    countAudio(props.language, 'plays');
    try {
      // The microphone first: nothing of this may land in a take.
      await listenRef.current?.beforePlay();
      if (generation.current !== run) return;
      await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true });
      if (generation.current !== run) return;
      const p = player.current;
      if (p && p.duration > 0 && p.currentTime < p.duration - 0.1) { p.play(); return; }
      // At the very end (a seek there, or a listener who let it finish and pressed Play) it starts again from the top.
      const atEnd = !!p && p.duration > 0 && p.currentTime >= p.duration - 0.1;
      await playFrom(restartIndex(p ? { index: indexRef.current, atEnd } : null, count), 0, run);
    } catch (err) {
      if (generation.current === run) {
        halt();
        countAudio(props.language, 'playFail');
        setError(t('common.audioCouldNotPlay', { code: reportError('clip player play', err) }));
      }
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
      // Load paused: play then pause once it is ready. Play pressed meanwhile starts a run of its own
      // (toggle) and this one must not stop it (A11Y-015: a key press right after a seek).
      loadingPaused.current = true;
      try { await playFrom(i, within, run); } finally { loadingPaused.current = false; }
      if (generation.current !== run) return;
      halt();
      setIndex(i); indexRef.current = i; setAt(within);
      return;
    }
    await playFrom(i, within, run);
  }

  const back10 = useHelpSpot(t('common.backTenSeconds'), t('recording.player.back10Help'), () => void seekTo(elapsed - 10));
  const note = useHelpSpot(t('recording.player.note'), t('recording.player.noteHelp'), props.onNote ? () => { halt(); props.onNote?.(elapsed); } : undefined);
  // Enter and Space both activate (A11Y-015). The web press system also calls
  // onPress on keyup for a role=button view; ignore that second call.
  const keyedAt = useRef(0);
  const onPlay = () => {
    if (Date.now() - keyedAt.current < 400) return;
    void toggle();
  };
  const onPlayKey = (e: { key?: string; nativeEvent?: { key?: string }; preventDefault(): void }) => {
    const key = e.key || e.nativeEvent?.key;
    if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar') return;
    if (!available || props.disabled) return;
    e.preventDefault();
    keyedAt.current = Date.now();
    void toggle();
  };
  const play = useHelpSpot(playing ? t('common.pause') : t('recording.player.playTitle', { title: props.title }), t('recording.player.playHelp'), onPlay);
  // While help is on, a tap on the timeline explains it (and the times beside it) instead of moving.
  const timeline = useHelpSpot(t('recording.player.whereYouAre', { title: props.title }), t('recording.player.timelineHelp'), SEEK_ONLY);

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
  // A screen reader's swipe up or down, or the arrow keys on the web, move by ten seconds; Home and End go to the ends.
  const stepBy = (seconds: number) => void seekRef.current(Math.max(0, Math.min(totalRef.current, elapsed + seconds)));
  const onAction = (e: AccessibilityActionEvent) => stepBy(e.nativeEvent.actionName === 'increment' ? 10 : -10);
  const keys = Platform.OS === 'web' ? {
    onKeyDown: (e: { key: string; preventDefault(): void }) => {
      const to = { ArrowRight: 10, ArrowUp: 10, ArrowLeft: -10, ArrowDown: -10 }[e.key];
      if (to !== undefined) { e.preventDefault(); stepBy(to); }
      else if (e.key === 'Home') { e.preventDefault(); void seekRef.current(0); }
      else if (e.key === 'End') { e.preventDefault(); void seekRef.current(totalRef.current); }
    }
  } : {};
  const share = total > 0 ? Math.min(1, elapsed / total) : 0;
  const tone = props.tone === 'amber' ? TINT.amberText : C.primary;
  const size = props.big ? 72 : 56;

  return (
    <View style={[!props.bare && styles.card]}>
      <View style={styles.head}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.body, { fontWeight: '800' }]}>{props.title}</Text>
          {props.sub ? <Text style={txt.xs}>{props.sub}</Text> : null}
        </View>
        {props.right}
      </View>
      <View style={styles.track} onLayout={(e: LayoutChangeEvent) => { width.current = Math.max(1, e.nativeEvent.layout.width); }}
        accessibilityRole="adjustable" accessibilityLabel={t('recording.player.whereYouAre', { title: props.title })} accessibilityValue={{ text: t('recording.player.position', { at: clock(elapsed), total: clock(total) }) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]} onAccessibilityAction={onAction}
        aria-valuemin={0} aria-valuemax={Math.round(total)} aria-valuenow={Math.round(elapsed)}
        aria-valuetext={t('recording.player.position', { at: clock(elapsed), total: clock(total) })}
        focusable {...keys}
        {...(timeline.id ? {} : pan.panHandlers)}>
        <View style={styles.rail} />
        <View style={[styles.fill, { width: `${share * 100}%`, backgroundColor: tone }]} />
        <View style={[styles.thumb, { left: `${share * 100}%`, borderColor: tone }]} />
        {timeline.id ? (
          <Pressable onPress={timeline.onPress} accessibilityRole="button" accessibilityLabel={t('recording.player.whereYouAre', { title: props.title })} style={StyleSheet.absoluteFill}>
            <HelpBadge spot={timeline} />
          </Pressable>
        ) : null}
      </View>
      {/* The times under the bar's two ends, so the buttons between have room for their words in every language. */}
      <View style={styles.times}>
        <Text style={txt.xs}>{clock(elapsed)}</Text>
        <Text style={txt.xs}>{clock(total)}</Text>
      </View>
      <View style={styles.controls}>
        <Pressable onPress={back10.onPress} disabled={!available || props.disabled} accessibilityRole="button" accessibilityLabel={t('common.backTenSeconds')}
          style={({ pressed }) => [styles.side, pressed && styles.pressed, (!available || props.disabled) && styles.off]}>
          <Ico name="restart" size={20} color={C.dark} />
          <Text style={styles.sideLabel}>{formatNumber(10)}</Text>
          <HelpBadge spot={back10} />
        </Pressable>
        <Pressable onPress={play.onPress} {...(Platform.OS === 'web' ? { onKeyDown: onPlayKey } : {})} disabled={!available || props.disabled} accessibilityRole="button"
          accessibilityLabel={available ? playing ? t('common.pause') : t('recording.player.playTitle', { title: props.title }) : t('recording.player.notOnDevice')}
          style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: available ? tone : C.faint, alignItems: 'center', justifyContent: 'center' }, pressed && styles.pressed]}>
          <Ico name={available ? playing ? 'pause' : 'play' : 'download'} size={Math.round(size * 0.4)} color={C.white} />
          <HelpBadge spot={play} />
        </Pressable>
        {props.onNote ? (
          <Pressable onPress={note.onPress} accessibilityRole="button" accessibilityLabel={t('recording.player.addNoteAtMoment')}
            style={({ pressed }) => [styles.side, pressed && styles.pressed]}>
            <Ico name="note" size={18} color={TINT.amberText} />
            <Text style={[styles.sideLabel, { color: TINT.amberText }]}>{t('recording.player.note')}</Text>
            <HelpBadge spot={note} />
          </Pressable>
        ) : <View style={{ width: 52 }} />}
      </View>
      {error ? <Text accessibilityRole="alert" style={txt.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, padding: space.md, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // 48 high to touch (the field's minimum target); the rail drawn within stays thin.
  track: { height: 48, justifyContent: 'center' },
  rail: { position: 'absolute', left: 0, right: 0, height: 6, borderRadius: 3, backgroundColor: C.light },
  fill: { position: 'absolute', left: 0, height: 6, borderRadius: 3 },
  thumb: { position: 'absolute', width: 22, height: 22, marginLeft: -11, borderRadius: 11, backgroundColor: C.white, borderWidth: 3 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg },
  times: { flexDirection: 'row', justifyContent: 'space-between', marginTop: -space.xs },
  side: { minWidth: 52, height: 52, paddingHorizontal: 6, borderRadius: 26, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  sideLabel: { fontSize: T.xs, fontWeight: '800', color: C.dark },
  pressed: { opacity: 0.7 },
  off: { opacity: 0.4 }
});
