// Recordings in transit, drawn as little packages (decisions.md 166): the Sync
// screen's phone and cloud with packages going up and coming down, and
// bouncing back off the no-signal line while the device is offline; the arrow
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

/** The scene is drawn in these units and scaled to the card. */
const W = 320;
const H = 250;
const UP_X = 174;
const DOWN_X = 146;
const PHONE_TOP = 172;
const CLOUD_BOTTOM = 70;
const BARRIER = 132;
const BELT_Y = 221;
/** Packages shown on the belt at most: more pile up closer together. */
const BELT_MAX = 6;
const slotX = (i: number, n: number) => 210 + i * Math.min(22, 92 / Math.max(1, n - 1));

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
function Package(props: { color: string; k: number }) {
  const k = props.k;
  return (
    <View style={[styles.pkg, { width: 20 * k, height: 16 * k, borderRadius: 4 * k, backgroundColor: props.color, gap: 2.5 * k }]}>
      {[6, 10, 4].map((h, i) => <View key={i} style={{ width: 2 * k, height: h * k, borderRadius: k, backgroundColor: C.white }} />)}
    </View>
  );
}

type Flight = { x: Animated.Value; y: Animated.Value; s: Animated.Value; o: Animated.Value };
const flight = (x: number, y: number): Flight => ({ x: new Animated.Value(x), y: new Animated.Value(y), s: new Animated.Value(1), o: new Animated.Value(0) });
const to = (v: Animated.Value, value: number, duration: number, easing = Easing.inOut(Easing.quad)) =>
  Animated.timing(v, { toValue: value, duration, easing, useNativeDriver: true });
const set = (f: Flight, x: number, y: number, s: number, o: number) =>
  Animated.parallel([to(f.x, x, 0), to(f.y, y, 0), to(f.s, s, 0), to(f.o, o, 0)]);

/**
 * The phone and the cloud, with how many recordings wait to go up (bottom)
 * and to come down (top). Online, packages leave the phone's belt for the
 * cloud one at a time and arrive from it; offline, the front one rises to
 * the no-signal line and drops back.
 */
export function TransitScene(props: { up: number; down: number; offline: boolean; movingUp: boolean; movingDown: boolean }) {
  const { up, down, offline } = props;
  const reduce = useReduceMotion();
  const [width, setWidth] = useState(0);
  const k = width / W;
  const upF = useMemo(() => flight(slotX(0, 1), BELT_Y), []);
  const downF = useMemo(() => flight(DOWN_X, CLOUD_BOTTOM), []);
  // Packages move only while files really do (decisions.md 166): offline the front one tries
  // and drops back; online they wait on the belt until an upload is under way.
  const goingUp = up > 0 && !reduce && (offline || props.movingUp);
  const comingDown = props.movingDown && !offline && !reduce;

  useEffect(() => {
    if (!goingUp) { upF.o.setValue(0); return undefined; }
    const start = set(upF, slotX(0, Math.min(up, BELT_MAX)), BELT_Y, 1, 1);
    const toPhone = Animated.parallel([to(upF.x, UP_X, 380), to(upF.y, PHONE_TOP, 380), to(upF.s, 0.9, 380)]);
    const loop = offline
      ? Animated.loop(Animated.sequence([
          start, toPhone,
          to(upF.y, BARRIER, 420, Easing.out(Easing.cubic)),
          to(upF.y, PHONE_TOP, 760, Easing.bounce),
          Animated.parallel([to(upF.x, slotX(0, Math.min(up, BELT_MAX)), 420), to(upF.y, BELT_Y, 420), to(upF.s, 1, 420)]),
          Animated.delay(500)
        ]))
      : Animated.loop(Animated.sequence([
          start, toPhone,
          to(upF.y, CLOUD_BOTTOM, 1100),
          Animated.parallel([to(upF.y, CLOUD_BOTTOM - 22, 260, Easing.out(Easing.cubic)), to(upF.s, 0.4, 260), to(upF.o, 0, 260)]),
          Animated.delay(450)
        ]));
    loop.start();
    return () => loop.stop();
    // A new count does not restart the flight; the belt redraws on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `up` only sets where the flight starts
  }, [goingUp, offline, upF]);

  useEffect(() => {
    if (!comingDown) { downF.o.setValue(0); return undefined; }
    const loop = Animated.loop(Animated.sequence([
      set(downF, DOWN_X, CLOUD_BOTTOM - 10, 0.4, 0),
      Animated.parallel([to(downF.y, CLOUD_BOTTOM + 6, 260, Easing.out(Easing.cubic)), to(downF.s, 0.9, 260), to(downF.o, 1, 260)]),
      to(downF.y, PHONE_TOP - 2, 1100),
      Animated.parallel([to(downF.x, 160, 260), to(downF.y, 200, 260), to(downF.s, 0.3, 260), to(downF.o, 0, 260)]),
      Animated.delay(450)
    ]));
    loop.start();
    return () => loop.stop();
  }, [comingDown, downF]);

  // On the belt: the recordings waiting, less the one in the air.
  const onBelt = Math.min(up, BELT_MAX);
  const belt = Array.from({ length: onBelt }, (_, i) => i).filter((i) => !(goingUp && i === 0));
  const moving = (f: Flight, color: string) => (
    <Animated.View pointerEvents="none" style={[styles.abs, {
      left: -10 * k, top: -8 * k, opacity: f.o,
      transform: [{ translateX: Animated.multiply(f.x, k) }, { translateY: Animated.multiply(f.y, k) }, { scale: f.s }]
    }]}>
      <Package color={color} k={k} />
    </Animated.View>
  );
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: '100%', aspectRatio: W / H }}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {width > 0 ? (
        <>
          <Svg width={width} height={width * (H / W)} viewBox={`0 0 ${W} ${H}`}>
            <Line x1={DOWN_X} y1={80} x2={DOWN_X} y2={166} stroke={C.border} strokeWidth={2} strokeDasharray="3 5" />
            <Line x1={UP_X} y1={80} x2={UP_X} y2={166} stroke={C.border} strokeWidth={2} strokeDasharray="3 5" />
            <G x={160} y={44}>
              <Path d="M-46 22 a18 18 0 0 1 2 -35.8 a26 26 0 0 1 48 -6 a20 20 0 0 1 36 12 a16 16 0 0 1 4 29.8 z" fill={C.light} stroke={C.primary} strokeWidth={2.5} />
            </G>
            {offline ? (
              <G>
                <Line x1={118} y1={122} x2={202} y2={122} stroke={C.amber} strokeWidth={2.5} strokeDasharray="5 4" />
                <G x={222} y={122}>
                  <Circle r={15} fill={TINT.amber} />
                  <Path d="M-8 -2 a12 12 0 0 1 16 0 M-4.5 2 a7 7 0 0 1 9 0" stroke={TINT.amberText} strokeWidth={2.2} fill="none" strokeLinecap="round" />
                  <Circle cx={0} cy={6} r={1.8} fill={TINT.amberText} />
                  <Line x1={-9} y1={-9} x2={9} y2={9} stroke={TINT.amberText} strokeWidth={2.4} strokeLinecap="round" />
                </G>
              </G>
            ) : null}
            <G opacity={up ? 1 : 0.35}>
              <Line x1={196} y1={232} x2={306} y2={232} stroke={C.faint} strokeWidth={3} strokeLinecap="round" />
              {[204, 232, 260, 288].map((cx) => <Circle key={cx} cx={cx} cy={236} r={3} fill={C.faint} />)}
            </G>
            <G x={160} y={205}>
              <Rect x={-24} y={-38} width={48} height={76} rx={10} fill={C.white} stroke={C.primary} strokeWidth={2.5} />
              <Rect x={-8} y={-33} width={16} height={3} rx={1.5} fill={C.faint} />
            </G>
          </Svg>
          {belt.map((i) => (
            <View key={i} pointerEvents="none" style={[styles.abs, { left: slotX(i, onBelt) * k - 10 * k, top: BELT_Y * k - 8 * k }]}>
              <Package color={C.primary} k={k} />
            </View>
          ))}
          {moving(upF, C.primary)}
          {moving(downF, onColor.green)}
          {/* Offline the device cannot know what is new on the server: no count unless one is known to be waiting. */}
          {offline && down === 0 ? null : <Count k={k} x={240} y={30} n={down} arrow="arrowDown" fg={onColor.green} bg={TINT.green} />}
          <Count k={k} x={80} y={205} n={up} arrow="arrowUp" fg={C.primary} bg={C.light} />
        </>
      ) : null}
    </View>
  );
}

/** How many wait to come down (by the cloud) or to go up (by the phone), in the app's own type. */
function Count(props: { k: number; x: number; y: number; n: number; arrow: 'arrowUp' | 'arrowDown'; fg: string; bg: string }) {
  const { k } = props;
  return (
    <View pointerEvents="none" style={[styles.abs, styles.count, { left: (props.x - 26) * k, top: (props.y - 13) * k, width: 52 * k, height: 26 * k, borderRadius: 13 * k, backgroundColor: props.bg }]}>
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
