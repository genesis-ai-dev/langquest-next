// The voice-detected recording session (docs/ux/README.md, one-next-action
// mock; ADR-028's red record button): the whole screen stays red from start
// to stop, the 60-bar energy history shows what is heard, capturing is a
// subtle lift (brighter ground, pulsing dot, solid bars), the cutoff is a
// line dragged across the bars, the pause length is three dot chips, and one
// white stop button ends it. Ported from the recorder removed on this
// branch (main: screens/recordings.tsx).
import { useEffect, useRef, useState } from 'react';
import { Animated, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ico } from '../kit';
import { C, radius, space, TINT, type as T } from '../theme';
import { useEnergyHistory, type useRecorder } from '../useRecorder';

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

function PulsingDot(props: { on: boolean }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!props.on) { pulse.setValue(0.4); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.35, duration: 500, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true })
    ]));
    loop.start();
    return () => loop.stop();
  }, [props.on, pulse]);
  return <Animated.View style={[styles.dot, { opacity: pulse }]} />;
}

const PAUSES = [
  { ms: 500, label: 'Short pause' },
  { ms: 1000, label: 'Normal pause' },
  { ms: 2000, label: 'Long pause' }
];

/**
 * Full screen while `rec.vadOn`. `count` is how many cards are on the list
 * so far, so each finished part visibly lands.
 */
export function VadTakeover(props: { rec: Recorder; count: number }) {
  const { rec } = props;
  return (
    <Modal visible={rec.vadOn} animationType="fade" onRequestClose={() => void rec.stopVad()} statusBarTranslucent>
      <Takeover rec={rec} count={props.count} />
    </Modal>
  );
}

function Takeover(props: { rec: Recorder; count: number }) {
  const { rec } = props;
  const insets = useSafeAreaInsets();
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
  return (
    <View style={[styles.takeover, { backgroundColor: rec.vadCapturing ? LIVE : IDLE, paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.xl }]}>
      <View style={styles.status} accessible accessibilityLiveRegion="polite"
        accessibilityLabel={rec.vadCapturing ? 'Recording what you say' : `Listening. ${props.count} ${props.count === 1 ? 'take' : 'takes'} so far`}>
        <PulsingDot on={rec.vadCapturing} />
        <Ico name="mic" size={28} color={C.white} />
        <Text style={styles.count}>{props.count}</Text>
      </View>
      <View style={styles.wave} onLayout={(e) => setHeight(e.nativeEvent.layout.height)}
        {...pan.panHandlers} accessible accessibilityRole="adjustable"
        accessibilityLabel="Sound cutoff" accessibilityValue={{ min: 4, max: 92, now: Math.round(cutoff * 100) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(event) => {
          const next = Math.max(0.04, Math.min(0.92, cutoff + (event.nativeEvent.actionName === 'increment' ? 0.02 : -0.02)));
          setCutoff(next); commit(next);
        }}>
        <EnergyBars captured={rec.vadCapturing} />
        <View pointerEvents="none" style={[styles.cutoff, { top: `${(1 - cutoff) * 100}%` }]} />
      </View>
      <View style={styles.pauses}>
        {PAUSES.map((p, index) => {
          const on = p.ms === rec.pauseDuration;
          return (
            <Pressable key={p.ms} onPress={() => void rec.setPause(p.ms)} accessibilityRole="button"
              accessibilityLabel={p.label} accessibilityState={{ selected: on }}
              style={({ pressed }) => [styles.pause, on && { backgroundColor: C.white }, pressed && { opacity: 0.8 }]}>
              {Array.from({ length: index + 1 }, (_, i) => <View key={i} style={[styles.pauseDot, { backgroundColor: on ? IDLE : C.white }]} />)}
            </Pressable>
          );
        })}
      </View>
      {rec.error ? <Text style={styles.error} accessibilityRole="alert">{rec.error}</Text> : null}
      <Pressable style={({ pressed }) => [styles.stop, pressed && { opacity: 0.85 }]} accessibilityRole="button"
        accessibilityLabel="Stop recording" onPress={() => void rec.stopVad()}>
        <View style={styles.stopSquare} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  takeover: { flex: 1, paddingHorizontal: space.xl, gap: space.xl },
  status: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.md, minHeight: 48 },
  count: { color: C.white, fontSize: T.xl, fontWeight: '700' },
  dot: { width: 12, height: 12, borderRadius: radius.full, backgroundColor: C.white },
  wave: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2 },
  bar: { flex: 1, backgroundColor: C.white, borderRadius: 2 },
  cutoff: { position: 'absolute', left: 0, right: 0, borderTopWidth: 2, borderStyle: 'dashed', borderColor: C.white },
  pauses: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.lg },
  pause: { minWidth: 64, minHeight: 48, paddingHorizontal: space.md, borderRadius: radius.full, borderWidth: 1.5, borderColor: `${C.white}99`,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  pauseDot: { width: 6, height: 6, borderRadius: 3 },
  error: { color: C.white, fontSize: T.sm, textAlign: 'center' },
  stop: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: C.white, alignSelf: 'center' },
  stopSquare: { width: 34, height: 34, borderRadius: 6, backgroundColor: IDLE }
});
