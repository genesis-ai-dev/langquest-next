// Voice-first pieces of the simple review screens (demo SIMPLE-9, SIMPLE-10;
// Ryder's ReviewQuestion and ReviewSayWhy): the big "Tap and speak" button,
// a recorded clip as a playable pill ("Their answer · 0:14"), the dashed
// optional row ("Who is listening? · optional"), and a speaker that reads a
// question aloud where the device can speak. Recording goes through
// useRecorder (the clip lands in the blob store and is named only by the
// review that keeps it, decision 30); playback follows audioSession.ts, so
// starting one stops every other player.
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import { registerPlayback, setSessionAudioMode, stopAudioPlayback } from '../audioSession';
import type { Ctx } from '../ctx';
import { useHelpSpot } from '../helpContext';
import { HelpBadge } from '../helpBadge';
import { t } from '../i18n';
import { formatClock } from '../i18n/format';
import { Ico, txt, type IconName } from '../kit';
import { reportError } from '../report';
import type { VoiceAnswer } from '../reviewing/capture';
import { lift } from '../shadow';
import { C, onColor, radius, space, target, TINT, type as T, withAlpha } from '../theme';
import { useRecorder, type RecordedCard } from '../useRecorder';

// ---- speaking a line aloud ----------------------------------------------------------------

type Synth = { cancel: () => void; speak: (u: unknown) => void };
const synth = (): Synth | undefined => (Platform.OS === 'web' ? (globalThis as { speechSynthesis?: Synth }).speechSynthesis : undefined);
const Utterance = (): (new (t: string) => unknown) | undefined => (globalThis as { SpeechSynthesisUtterance?: new (t: string) => unknown }).SpeechSynthesisUtterance;

/** Whether this device can read a line aloud (the browser's own voice; devices wait for recorded lines). */
export function canSpeak(): boolean {
  return !!synth() && !!Utterance();
}

function speak(text: string) {
  const s = synth();
  const U = Utterance();
  if (!s || !U) return;
  try { stopAudioPlayback(); s.cancel(); s.speak(new U(text)); } catch { /* speaking is a nicety */ }
}

/** A round speaker beside a question: reads it aloud. Not drawn where nothing can speak. */
export function SpeakBtn(props: { text: string; size?: number }) {
  const size = props.size ?? 64;
  const spot = useHelpSpot(t('review.voice.hearIt'), t('review.voice.hearItHelp'), () => speak(props.text));
  if (!canSpeak()) return null;
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={t('review.voice.hearItA11y', { text: props.text })}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' }, pressed && styles.pressed]}>
      <Ico name="sound" size={Math.round(size * 0.42)} color={C.primary} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

// ---- the big microphone ---------------------------------------------------------------------

/**
 * Tap and speak: one big round button. Tap to start, tap to stop; the clip
 * comes back with its length and format.
 */
export function BigMic(props: {
  label: string;
  onClip: (clip: VoiceAnswer) => void;
  tone?: 'red' | 'brand';
  size?: number;
  disabled?: boolean;
}) {
  const latest = useRef(props);
  latest.current = props;
  const persist = (card: RecordedCard) => { latest.current.onClip({ hash: card.ref.hash, durationMs: card.durationMs, format: card.ref.format }); };
  const rec = useRecorder(persist);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!rec.manualOn) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [rec.manualOn]);
  const recording = rec.manualOn;
  const size = props.size ?? 112;
  const fill = props.tone === 'brand' ? C.primary : C.red;
  const spot = useHelpSpot(recording ? t('review.voice.stop') : props.label, t('review.voice.recordHelp'), () => void (recording ? rec.manualUp() : rec.manualDown()));
  return (
    <View style={{ alignItems: 'center', gap: space.md }}>
      <View style={[styles.halo, { width: size + 28, height: size + 28, borderRadius: (size + 28) / 2, backgroundColor: withAlpha(fill, recording ? 0.22 : 0.1) }]}>
        <Pressable onPress={spot.onPress} disabled={(rec.busy && !recording) || props.disabled} accessibilityRole="button"
          accessibilityLabel={recording ? t('common.stopRecording') : props.label}
          style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: fill, alignItems: 'center', justifyContent: 'center' },
            lift({ color: fill, opacity: 0.35, radius: 18, y: 8, elevation: 4 }), props.disabled && { opacity: 0.45 }, pressed && { transform: [{ scale: 0.96 }] }]}>
          <Ico name={recording ? 'stop' : 'mic'} size={Math.round(size * 0.4)} color={C.white} />
          <HelpBadge spot={spot} />
        </Pressable>
      </View>
      <Text style={styles.bigLabel} accessibilityLiveRegion="polite">
        {recording ? t('review.voice.recordingTime', { time: formatClock(elapsed * 1000) }) : rec.busy ? t('common.saving') : props.label}
      </Text>
      {rec.error ? <Text style={[txt.error, { textAlign: 'center' }]} accessibilityRole="alert">{rec.error}</Text> : null}
    </View>
  );
}

// ---- a recorded clip ------------------------------------------------------------------------

/** "Their answer · 0:14" as a pill that plays: green for something said, amber for feedback. */
export function PlayChip(props: { ctx: Ctx; clip: VoiceAnswer; label: string; tone?: 'green' | 'amber' | 'brand' }) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const player = useRef<AudioPlayer | null>(null);
  const stop = () => { player.current?.remove(); player.current = null; setPlaying(false); };
  useEffect(() => registerPlayback(stop), []);
  useEffect(() => () => { player.current?.remove(); player.current = null; }, [props.clip.hash]);
  const [bg, fill, fg] = props.tone === 'amber' ? [TINT.amber, onColor.amber, TINT.amberText]
    : props.tone === 'brand' ? [C.light, C.primary, C.primary] : [TINT.green, C.green, TINT.greenText];
  async function toggle() {
    if (playing) { stop(); return; }
    stopAudioPlayback();
    setError('');
    const uri = props.ctx.language.blobs.uriFor({ hash: props.clip.hash, format: props.clip.format });
    if (!uri) { setError(t('review.voice.notOnDevice')); return; }
    try {
      await setSessionAudioMode({ allowsRecording: false, playsInSilentMode: true });
      const p = createAudioPlayer({ uri });
      player.current = p;
      p.addListener('playbackStatusUpdate', (st) => {
        if (player.current !== p) return;
        if (st.didJustFinish) stop();
      });
      p.play();
      setPlaying(true);
    } catch (e) {
      stop();
      setError(t('common.audioCouldNotPlay', { code: reportError('review clip play', e) }));
    }
  }
  const spot = useHelpSpot(props.label, t('review.voice.playsRecorded'), () => void toggle());
  const length = formatClock(props.clip.durationMs);
  return (
    <View style={{ alignItems: 'center', gap: space.xs }}>
      <Pressable onPress={spot.onPress} accessibilityRole="button"
        accessibilityLabel={playing ? t('review.voice.pauseClip', { label: props.label, length }) : t('review.voice.playClip', { label: props.label, length })}
        style={({ pressed }) => [styles.chip, { backgroundColor: bg }, pressed && styles.pressed]}>
        <View style={[styles.chipPlay, { backgroundColor: fill }]}>
          <Ico name={playing ? 'pause' : 'play'} size={22} color={C.white} />
        </View>
        <Text style={[styles.chipLabel, { color: fg }]} numberOfLines={1}>{props.label} · {length}</Text>
        <HelpBadge spot={spot} />
      </Pressable>
      {error ? <Text style={txt.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

/** A small outlined button under a clip: "Record again". */
export function AgainBtn(props: { label: string; icon?: IconName; onPress: () => void }) {
  const spot = useHelpSpot(props.label, undefined, props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" style={({ pressed }) => [styles.again, pressed && styles.pressed]}>
      <Ico name={props.icon ?? 'restart'} size={20} color={C.dark} />
      <Text style={[txt.body, { fontWeight: '600' }]}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

// ---- the optional row ---------------------------------------------------------------------------

/**
 * A dashed row for something optional ("Who is listening? · optional"): it
 * reads as a choice, not a step. With `tile` the icon sits in a round tile
 * and the label is dark (Ryder's "Record a listener retelling"). `right` is
 * the word at its end, usually "optional" (review.shared.optional) or "Change".
 */
export function DashedRow(props: { icon: IconName; label: string; sub?: string; right?: string; onPress: () => void; tile?: boolean; done?: boolean; trailing?: ReactNode }) {
  const spot = useHelpSpot(props.label, props.sub ?? (props.right === t('review.shared.optional') ? t('review.voice.optionalHelp') : undefined), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={[props.label, props.sub, props.right].filter(Boolean).join(', ')}
      style={({ pressed }) => [styles.dashed, props.done && styles.dashedDone, pressed && styles.pressed]}>
      {props.tile ? (
        <View style={[styles.tile, props.done && { backgroundColor: TINT.green }]}><Ico name={props.icon} size={22} color={props.done ? TINT.greenText : C.primary} /></View>
      ) : <Ico name={props.icon} size={24} color={props.done ? TINT.greenText : C.muted} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.dashedLabel, props.tile || props.done ? { color: C.dark } : null]} numberOfLines={2}>{props.label}</Text>
        {props.sub ? <Text style={txt.xs} numberOfLines={2}>{props.sub}</Text> : null}
      </View>
      {props.trailing}
      {props.right ? <Text style={[txt.sm, { color: C.muted, fontWeight: '600' }]}>{props.right}</Text> : null}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  halo: { alignItems: 'center', justifyContent: 'center' },
  bigLabel: { fontSize: T.base, fontWeight: '800', color: C.dark, textAlign: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingLeft: space.sm, paddingRight: space.xl, borderRadius: radius.full, maxWidth: '100%' },
  chipPlay: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  chipLabel: { fontSize: T.base, fontWeight: '800', flexShrink: 1 },
  again: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.min, paddingHorizontal: space.lg, borderRadius: radius.lg,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.card, alignSelf: 'center' },
  dashed: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.primary, paddingHorizontal: space.lg, paddingVertical: space.md,
    borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.faint },
  dashedDone: { borderStyle: 'solid', borderColor: C.border, backgroundColor: C.card },
  dashedLabel: { fontSize: T.base, fontWeight: '700', color: C.muted },
  tile: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' }
});
