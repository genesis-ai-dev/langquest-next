// The voice-detected recording session, inside the recorder's pane (LAN-23:
// the source above stays readable and playable while you record). Ported
// from the full-screen takeover (docs/ux/README.md, one-next-action mock;
// ADR-028's red record button): the pane stays red from start to stop, the
// 60-bar energy history shows what is heard, capturing is a subtle lift
// (brighter ground, pulsing dot, solid bars), and the cutoff is a line
// dragged across the bars. The pause length chips and the stop button sit in
// the footer (VadControls), where the record button was.
//
// While the source plays, the microphone is paused (useListenLoop): the pane
// turns pale and says so, with Resume now.
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, PanResponder, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { Ico } from '../kit';
import { C, onColor, radius, space, target, TINT, type as T, withAlpha } from '../theme';
import { useEnergyHistory, type useRecorder } from '../useRecorder';
import { RecordButton } from './parts';
import { loopStatus, type LoopNoun, type LoopPhase } from './splitModel';
import { mmss } from './workspaceModel';

type Recorder = ReturnType<typeof useRecorder>;

const IDLE = TINT.redText;
const LIVE = C.red;

/** The only thing that re-renders with the microphone. */
function EnergyBars(props: { captured: boolean }) {
  const history = useEnergyHistory(props.captured);
  return <>{history.map((bar, index) => <View key={index}
    style={[styles.bar, { opacity: bar.captured ? 1 : 0.35,
      height: `${Math.max(1, Math.pow(Math.min(1, Math.max(0, bar.energy)), bar.captured ? 0.6 : 2.5) * 100)}%` }]} />)}</>;
}

/** The reduce-motion setting, kept current (A11Y-8). */
function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => { if (live) setReduce(on); }, () => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => { live = false; sub.remove(); };
  }, []);
  return reduce;
}

/** Pulses while capturing; with reduce motion on, it is simply bright. */
function PulsingDot(props: { on: boolean }) {
  const pulse = useRef(new Animated.Value(1)).current;
  const still = useReduceMotion();
  useEffect(() => {
    if (!props.on) { pulse.setValue(0.4); return; }
    if (still) { pulse.setValue(1); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.35, duration: 500, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [props.on, pulse, still]);
  return <Animated.View style={[styles.dot, { opacity: pulse }]} />;
}

/** Time spent recording this session, not counting time paused for the source. Ticks on its own. */
function Elapsed(props: { running: boolean; color: string }) {
  const total = useRef(0);
  const since = useRef<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!props.running) return;
    since.current = Date.now();
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => {
      clearInterval(id);
      if (since.current !== null) total.current += Date.now() - since.current;
      since.current = null;
    };
  }, [props.running]);
  const ms = total.current + (since.current !== null ? Date.now() - since.current : 0);
  return <Text style={[styles.time, { color: props.color }]} accessibilityLabel={t('recording.vad.recordedFor', { time: mmss(ms) })}>{mmss(ms)}</Text>;
}

/** The three pause lengths, named in the language showing. */
function pauseChoices(): { ms: number; label: string }[] {
  return [
    { ms: 500, label: t('recording.pauses.short') },
    { ms: 1000, label: t('recording.pauses.normal') },
    { ms: 2000, label: t('recording.pauses.long') }
  ];
}

/**
 * The recorder pane's body while a session is on (`phase` not off). `count`
 * is how many takes are on the list so far, so each finished part visibly
 * lands. Fills the pane.
 */
export function VadPanel(props: { rec: Recorder; phase: LoopPhase; count: number; noun: LoopNoun; onResume: () => void }) {
  const { rec } = props;
  const listening = props.phase === 'listening';
  const [height, setHeight] = useState(1);
  const [cutoff, setCutoff] = useState(rec.cutoff);
  const latest = useRef({ height, cutoff, rec });
  latest.current = { height, cutoff, rec };
  const dragStart = useRef(0);
  const commit = (value: number) => void latest.current.rec.setCutoff(value);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { dragStart.current = latest.current.cutoff; },
    onPanResponderMove: (_, gesture) => {
      setCutoff(Math.max(0.04, Math.min(0.92, dragStart.current - gesture.dy / latest.current.height)));
    },
    // One native configuration per drag avoids flooding the audio thread.
    onPanResponderRelease: () => commit(latest.current.cutoff),
    onPanResponderTerminate: () => setCutoff(latest.current.rec.cutoff)
  })).current;
  const status = loopStatus(props.phase, rec.vadCapturing, props.count, props.noun);
  const fg = listening ? IDLE : C.white;
  return (
    <View style={[styles.panel, { backgroundColor: listening ? TINT.red : rec.vadCapturing ? LIVE : IDLE }]}>
      <View style={styles.status} accessible accessibilityLiveRegion="polite" accessibilityLabel={status}>
        {listening ? <Ico name="pause" size={22} color={fg} /> : <PulsingDot on={rec.vadCapturing} />}
        <Ico name="mic" size={22} color={fg} />
        <Text style={[styles.count, { color: fg }]}>{formatNumber(props.count)}</Text>
        <View style={{ flex: 1 }} />
        <Elapsed running={props.phase === 'recording'} color={fg} />
      </View>
      {listening ? (
        <View style={styles.paused}>
          <Text style={[styles.pausedTitle, { color: IDLE }]}>{t('recording.vad.pausedForSource')}</Text>
          <Text style={[styles.pausedSub, { color: IDLE }]}>{t('recording.vad.startsAgain')}</Text>
          <Pressable onPress={props.onResume} accessibilityRole="button" accessibilityLabel={t('recording.resumeRecordingNow')}
            style={({ pressed }) => [styles.resume, pressed && { opacity: 0.8 }]}>
            <Ico name="mic" size={18} color={C.white} />
            <Text style={styles.resumeLabel}>{t('recording.resumeNow')}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.wave} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
          {...pan.panHandlers} accessible accessibilityRole="adjustable"
          accessibilityLabel={t('recording.vad.cutoff')} accessibilityValue={{ min: 4, max: 92, now: Math.round(cutoff * 100) }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(event) => {
            const next = Math.max(0.04, Math.min(0.92, cutoff + (event.nativeEvent.actionName === 'increment' ? 0.02 : -0.02)));
            setCutoff(next); commit(next);
          }}>
          <EnergyBars captured={rec.vadCapturing} />
          <View style={[{ pointerEvents: 'none' }, styles.cutoff, { top: `${(1 - cutoff) * 100}%` }]} />
        </View>
      )}
      {rec.error ? <Text style={styles.error} accessibilityRole="alert">{rec.error}</Text> : null}
    </View>
  );
}

/**
 * The footer while a session is on: the stop button where the record button
 * was, and the pause length as three dot chips.
 */
export function VadControls(props: { rec: Recorder; onStop: () => void }) {
  const { rec } = props;
  return (
    <View style={styles.controls}>
      <RecordButton recording onPress={props.onStop} />
      <View style={styles.pauses} accessibilityLabel={t('recording.vad.pauseBetween')}>
        {pauseChoices().map((p, index) => {
          const on = p.ms === rec.pauseDuration;
          return (
            <Pressable key={p.ms} onPress={() => void rec.setPause(p.ms)} accessibilityRole="button"
              accessibilityLabel={p.label} accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.pause, on && { backgroundColor: IDLE, borderColor: IDLE }, pressed && { opacity: 0.8 }]}>
              {Array.from({ length: index + 1 }, (_, i) => <View key={i} style={[styles.pauseDot, { backgroundColor: on ? C.white : IDLE }]} />)}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flex: 1, paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.sm },
  status: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.min },
  count: { fontSize: T.lg, fontWeight: '700' },
  time: { fontSize: T.lg, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dot: { width: 12, height: 12, borderRadius: radius.full, backgroundColor: C.white },
  wave: { flex: 1, minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 2 },
  bar: { flex: 1, backgroundColor: C.white, borderRadius: 2 },
  cutoff: { position: 'absolute', left: 0, right: 0, borderTopWidth: 2, borderStyle: 'dashed', borderColor: C.white },
  paused: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs },
  pausedTitle: { fontSize: T.base, fontWeight: '700', textAlign: 'center' },
  pausedSub: { fontSize: T.xs, textAlign: 'center' },
  resume: { marginTop: space.xs, minHeight: target.min, paddingHorizontal: space.lg, borderRadius: radius.full, backgroundColor: IDLE,
    flexDirection: 'row', alignItems: 'center', gap: space.sm },
  resumeLabel: { color: C.white, fontSize: T.sm, fontWeight: '700' },
  // On a deeper red than the capturing ground, so the words hold 4.5:1 whichever red is behind.
  error: { color: C.white, fontSize: T.sm, textAlign: 'center', backgroundColor: onColor.red, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm, overflow: 'hidden' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  pauses: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: space.sm },
  pause: { minWidth: 56, minHeight: target.min, paddingHorizontal: space.md, borderRadius: radius.full, borderWidth: 1.5, borderColor: withAlpha(IDLE, 0.5),
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  pauseDot: { width: 6, height: 6, borderRadius: 3 }
});
