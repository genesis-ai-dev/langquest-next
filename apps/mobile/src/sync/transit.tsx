// Recordings in transit, drawn as little packages (decisions.md 166): the
// package itself, which Sync's scene (transitScene.tsx) moves between phone and
// cloud; the arrow
// wave that says something is moving; and a passage's recordings as boxes
// that turn green as they go up. Motion is transforms and opacity on the
// native driver, and stops under reduce motion.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';
import { Ico } from '../ui/kit';
import { Text } from '../ui/text';
import { useReduceMotion } from '../ui/useReduceMotion';
import { C, onColor, TINT } from '../ui/theme';
import { touches } from '../ui/touches';

/**
 * Three chevrons lit one after another in the direction of travel: in the
 * upload bar while recordings go up, and in a download button while a
 * passage comes down.
 */
export function WaveArrow(props: { direction: 'up' | 'down'; color: string; size?: number }) {
  const size = props.size ?? 12;
  const reduce = useReduceMotion();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return undefined;
    const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [reduce, t]);
  // Top to bottom; the one nearest where it starts lights first.
  const peaks = props.direction === 'up' ? [0.7, 0.5, 0.3] : [0.3, 0.5, 0.7];
  return (
    <View style={{ alignItems: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {peaks.map((p, i) => (
        <Animated.View key={i} style={{ marginVertical: -size * 0.28, opacity: reduce ? 0.9 : t.interpolate({ inputRange: [0, p - 0.3, p, p + 0.3, 1], outputRange: [0.25, 0.25, 1, 0.25, 0.25] }) }}>
          <Ico name={props.direction} size={size} color={props.color} strokeWidth={3} />
        </Animated.View>
      ))}
    </View>
  );
}

/** One package: a recording, as a little box with a waveform on it. */
export function Package(props: { color: string; k: number }) {
  const k = props.k;
  return (
    <View style={[styles.pkg, { width: 20 * k, height: 16 * k, borderRadius: 4 * k, backgroundColor: props.color, gap: 2.5 * k }]}>
      {[6, 10, 4].map((h, i) => <View key={i} style={{ width: 2 * k, height: h * k, borderRadius: k, backgroundColor: C.white }} />)}
    </View>
  );
}

/** How many wait to come down (by the cloud) or to go up (by the phone), in the app's own type. */
export function Count(props: { k: number; x: number; y: number; n: number; arrow: 'arrowUp' | 'arrowDown'; fg: string; bg: string }) {
  const { k } = props;
  return (
    <View style={[touches.none, styles.abs, styles.count, { left: (props.x - 26) * k, top: (props.y - 13) * k, width: 52 * k, height: 26 * k, borderRadius: 13 * k, backgroundColor: props.bg }]}>
      <Ico name={props.arrow} size={Math.round(13 * k)} color={props.fg} strokeWidth={2.75} />
      <Text style={{ fontSize: 14 * k, fontWeight: '800', color: props.fg, fontVariant: ['tabular-nums'] }}>{String(props.n)}</Text>
    </View>
  );
}

/** A passage's recordings as boxes: green once up, outlined while waiting (amber while offline). A long run is a bar instead. */
export function PackageBoxes(props: { uploaded: number; total: number; offline: boolean }) {
  const { uploaded, total } = props;
  if (total > 24) {
    return (
      <View style={styles.track}>
        <View style={{ width: `${(uploaded / Math.max(1, total)) * 100}%`, height: '100%', borderRadius: 3, backgroundColor: onColor.green }} />
      </View>
    );
  }
  return (
    <View style={styles.boxes} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {Array.from({ length: total }, (_, i) => (
        <View key={i} style={[styles.box, i < uploaded ? styles.boxUp : { borderColor: props.offline ? C.amber : C.primary }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute', left: 0, top: 0 },
  pkg: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  count: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  boxes: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  box: { width: 14, height: 11, borderRadius: 3, borderWidth: 1.5 },
  boxUp: { backgroundColor: onColor.green, borderColor: onColor.green },
  track: { height: 8, borderRadius: 4, backgroundColor: C.border, overflow: 'hidden' }
});
