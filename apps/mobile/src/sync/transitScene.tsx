// Sync and offline's status picture: the packages scene of decision 166, back upright
// (docs/decisions/2026-11-27-the-packages-scene-is-back.md). In a file of its own so it loads with
// the screen, not with the upload bar on every screen. Motion is transforms and opacity on the
// native driver, and stops under reduce motion.
import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect } from 'react-native-svg';
import { useReduceMotion } from '../ui/useReduceMotion';
import { C, onColor, TINT } from '../ui/theme';
import { touches } from '../ui/touches';
import type { StripLink } from './syncScreenModel';
import { Count, Package } from './transit';

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

type Flight = { x: Animated.Value; y: Animated.Value; s: Animated.Value; o: Animated.Value };
const flight = (x: number, y: number): Flight => ({ x: new Animated.Value(x), y: new Animated.Value(y), s: new Animated.Value(1), o: new Animated.Value(0) });
const to = (v: Animated.Value, value: number, duration: number, easing = Easing.inOut(Easing.quad)) =>
  Animated.timing(v, { toValue: value, duration, easing, useNativeDriver: true });
const set = (f: Flight, x: number, y: number, s: number, o: number) =>
  Animated.parallel([to(f.x, x, 0), to(f.y, y, 0), to(f.s, s, 0), to(f.o, o, 0)]);

/**
 * The phone and the cloud (decision 166), with how many recordings wait to go
 * up (bottom) and to come down (top). Online, packages leave the phone's belt
 * for the cloud one at a time while an upload is under way and arrive from it
 * while a download is; offline, the front one rises to the no-signal line and
 * drops back. The lines say the link as the side strip did: solid green while
 * live, dashed while checking, an alert on the cloud where the server refuses.
 * Hidden from screen readers: the status word and its sentence say it.
 */
export function TransitScene(props: { up: number; down: number; link: StripLink; movingUp: boolean; movingDown: boolean }) {
  const { up, down, link } = props;
  const offline = link === 'offline';
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

  const live = link === 'live';
  const cloud = live ? onColor.green : C.primary;
  const track = live ? onColor.green : C.border;
  const dash = live ? undefined : '3 5';
  // On the belt: the recordings waiting, less the one in the air.
  const onBelt = Math.min(up, BELT_MAX);
  const belt = Array.from({ length: onBelt }, (_, i) => i).filter((i) => !(goingUp && i === 0));
  const moving = (f: Flight, color: string) => (
    <Animated.View style={[touches.none, styles.abs, {
      left: -10 * k, top: -8 * k, opacity: f.o,
      transform: [{ translateX: Animated.multiply(f.x, k) }, { translateY: Animated.multiply(f.y, k) }, { scale: f.s }]
    }]}>
      <Package color={color} k={k} />
    </Animated.View>
  );
  return (
    <View testID="transit-scene" onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: '100%', aspectRatio: W / H }}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {width > 0 ? (
        <>
          <Svg width={width} height={width * (H / W)} viewBox={`0 0 ${W} ${H}`}>
            <Line x1={DOWN_X} y1={80} x2={DOWN_X} y2={166} stroke={track} strokeWidth={2} strokeDasharray={dash} />
            <Line x1={UP_X} y1={80} x2={UP_X} y2={166} stroke={track} strokeWidth={2} strokeDasharray={dash} />
            <G x={160} y={44}>
              <Path d="M-46 22 a18 18 0 0 1 2 -35.8 a26 26 0 0 1 48 -6 a20 20 0 0 1 36 12 a16 16 0 0 1 4 29.8 z" fill={C.light} stroke={cloud} strokeWidth={2.5} />
              {link === 'refused' ? <G y={4}><Circle r={10} fill={onColor.red} /><Line x1={0} y1={-5} x2={0} y2={1.2} stroke={C.white} strokeWidth={2.6} strokeLinecap="round" /><Circle cy={4.8} r={1.5} fill={C.white} /></G> : null}
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
            <View key={i} style={[touches.none, styles.abs, { left: slotX(i, onBelt) * k - 10 * k, top: BELT_Y * k - 8 * k }]}>
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

const styles = StyleSheet.create({
  abs: { position: 'absolute', left: 0, top: 0 }
});
