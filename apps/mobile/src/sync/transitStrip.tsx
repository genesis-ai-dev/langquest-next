// Sync and offline's status picture (decisions.md 166, turned on its side by
// docs/decisions/2026-11-18-sync-and-offline-one-screen.md), in a file of its own so it loads with
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

/**
 * The strip is drawn in these units and scaled to the card: the phone on the
 * left, the server's cloud on the right, recordings going up along the upper
 * track and coming down along the lower one.
 */
const W = 320;
const H = 96;
const PHONE_X = 34;
const CLOUD_X = 284;
const MID_Y = 40;
const UP_Y = 30;
const DOWN_Y = 52;
const TRACK_FROM = 66;
const TRACK_TO = 250;
/** Offline, the no-signal line stands across both tracks halfway. */
const BARRIER = 160;

type Flight = { x: Animated.Value; s: Animated.Value; o: Animated.Value };
const flight = (x: number): Flight => ({ x: new Animated.Value(x), s: new Animated.Value(1), o: new Animated.Value(0) });
const to = (v: Animated.Value, value: number, duration: number, easing = Easing.inOut(Easing.quad)) =>
  Animated.timing(v, { toValue: value, duration, easing, useNativeDriver: true });
const set = (f: Flight, x: number, s: number, o: number) => Animated.parallel([to(f.x, x, 0), to(f.s, s, 0), to(f.o, o, 0)]);

/**
 * The Sync screen's status picture (decisions.md 166, turned on its side by
 * docs/decisions/2026-11-18-sync-and-offline-one-screen.md): this phone and
 * the server, with how many recordings wait to go up (by the phone) and to
 * come down (by the server). Online, a package leaves the phone for the cloud
 * while an upload is under way and arrives from it while a download is;
 * offline, the line breaks halfway and the front package goes to the break
 * and drops back. With nothing waiting either way, a tick on the line.
 * Hidden from screen readers: the status word and its sentence say it.
 */
export function TransitStrip(props: { up: number; down: number; link: StripLink; movingUp: boolean; movingDown: boolean }) {
  const { up, down, link } = props;
  const offline = link === 'offline';
  const reduce = useReduceMotion();
  const [width, setWidth] = useState(0);
  const k = width / W;
  const upF = useMemo(() => flight(TRACK_FROM), []);
  const downF = useMemo(() => flight(TRACK_TO), []);
  // Packages move only while files really do (decisions.md 166): offline the front one tries
  // and drops back; online they wait by the phone until an upload is under way.
  const goingUp = up > 0 && !reduce && (offline || props.movingUp);
  const comingDown = props.movingDown && !offline && !reduce;

  useEffect(() => {
    if (!goingUp) { upF.o.setValue(0); return undefined; }
    const loop = offline
      ? Animated.loop(Animated.sequence([
          set(upF, TRACK_FROM, 0.9, 1),
          to(upF.x, BARRIER - 16, 520, Easing.out(Easing.cubic)),
          to(upF.x, TRACK_FROM, 760, Easing.bounce),
          Animated.delay(500)
        ]))
      : Animated.loop(Animated.sequence([
          set(upF, TRACK_FROM, 0.9, 1),
          to(upF.x, TRACK_TO, 1300),
          Animated.parallel([to(upF.x, TRACK_TO + 14, 260, Easing.out(Easing.cubic)), to(upF.s, 0.4, 260), to(upF.o, 0, 260)]),
          Animated.delay(450)
        ]));
    loop.start();
    return () => loop.stop();
  }, [goingUp, offline, upF]);

  useEffect(() => {
    if (!comingDown) { downF.o.setValue(0); return undefined; }
    const loop = Animated.loop(Animated.sequence([
      set(downF, TRACK_TO + 10, 0.4, 0),
      Animated.parallel([to(downF.x, TRACK_TO, 260, Easing.out(Easing.cubic)), to(downF.s, 0.9, 260), to(downF.o, 1, 260)]),
      to(downF.x, TRACK_FROM, 1300),
      Animated.parallel([to(downF.x, TRACK_FROM - 14, 260), to(downF.s, 0.3, 260), to(downF.o, 0, 260)]),
      Animated.delay(450)
    ]));
    loop.start();
    return () => loop.stop();
  }, [comingDown, downF]);

  const cloud = link === 'live' ? onColor.green : link === 'offline' ? C.amber : link === 'refused' ? onColor.red : C.primary;
  const track = link === 'live' ? onColor.green : C.border;
  const clear = up === 0 && down === 0 && !offline;
  const moving = (f: Flight, y: number, color: string) => (
    <Animated.View style={[touches.none, styles.abs, {
      left: -10 * k, top: (y - 8) * k, opacity: f.o,
      transform: [{ translateX: Animated.multiply(f.x, k) }, { scale: f.s }]
    }]}>
      <Package color={color} k={k} />
    </Animated.View>
  );
  return (
    <View testID="transit-strip" onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ width: '100%', aspectRatio: W / H }}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {width > 0 ? (
        <>
          <Svg width={width} height={width * (H / W)} viewBox={`0 0 ${W} ${H}`}>
            {offline ? (
              <G>
                <Line x1={TRACK_FROM} y1={UP_Y} x2={BARRIER - 8} y2={UP_Y} stroke={C.border} strokeWidth={2} strokeDasharray="3 5" />
                <Line x1={TRACK_FROM} y1={DOWN_Y} x2={BARRIER - 8} y2={DOWN_Y} stroke={C.border} strokeWidth={2} strokeDasharray="3 5" />
                <Line x1={BARRIER} y1={14} x2={BARRIER} y2={66} stroke={C.amber} strokeWidth={2.5} strokeDasharray="5 4" />
                <G x={BARRIER} y={80}>
                  <Circle r={9} fill={TINT.amber} />
                  <Path d="M-5 -1 a7.5 7.5 0 0 1 10 0 M-2.8 1.6 a4.4 4.4 0 0 1 5.6 0" stroke={TINT.amberText} strokeWidth={1.6} fill="none" strokeLinecap="round" />
                  <Line x1={-5.5} y1={-5.5} x2={5.5} y2={5.5} stroke={TINT.amberText} strokeWidth={1.7} strokeLinecap="round" />
                </G>
              </G>
            ) : (
              <G>
                <Line x1={TRACK_FROM} y1={UP_Y} x2={TRACK_TO} y2={UP_Y} stroke={track} strokeWidth={2} strokeDasharray={link === 'live' ? undefined : '3 5'} />
                <Line x1={TRACK_TO} y1={DOWN_Y} x2={TRACK_FROM} y2={DOWN_Y} stroke={track} strokeWidth={2} strokeDasharray={link === 'live' ? undefined : '3 5'} />
              </G>
            )}
            {clear && link !== 'refused' ? (
              <G x={(TRACK_FROM + TRACK_TO) / 2} y={(UP_Y + DOWN_Y) / 2}>
                <Circle r={11} fill={TINT.green} />
                <Path d="M-5 0 l3.5 3.5 l6.5 -7" stroke={TINT.greenText} strokeWidth={2.4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </G>
            ) : null}
            <G x={PHONE_X} y={MID_Y}>
              <Rect x={-16} y={-28} width={32} height={56} rx={8} fill={C.white} stroke={C.primary} strokeWidth={2.5} />
              <Rect x={-6} y={-24} width={12} height={2.5} rx={1.25} fill={C.faint} />
            </G>
            <G x={CLOUD_X} y={MID_Y}>
              <Path d="M-27 13 a11 11 0 0 1 1 -21.5 a15.5 15.5 0 0 1 28.5 -3.6 a12 12 0 0 1 21.5 7.2 a9.6 9.6 0 0 1 2.4 17.9 z" fill={C.light} stroke={cloud} strokeWidth={2.5} />
              {link === 'refused' ? <G y={1}><Circle r={7} fill={onColor.red} /><Line x1={0} y1={-3.5} x2={0} y2={0.8} stroke={C.white} strokeWidth={2} strokeLinecap="round" /><Circle cy={3.4} r={1.1} fill={C.white} /></G> : null}
            </G>
          </Svg>
          {goingUp ? null : up > 0 ? (
            <View style={[touches.none, styles.abs, { left: (TRACK_FROM - 10) * k, top: (UP_Y - 8) * k }]}><Package color={C.primary} k={k} /></View>
          ) : null}
          {moving(upF, UP_Y, offline ? C.amber : C.primary)}
          {moving(downF, DOWN_Y, onColor.green)}
          {/* Offline the device cannot know what is new on the server: no count unless one is known to be waiting. */}
          {up > 0 ? <Count k={k} x={PHONE_X} y={H - 13} n={up} arrow="arrowUp" fg={C.primary} bg={C.light} /> : null}
          {down > 0 ? <Count k={k} x={CLOUD_X} y={H - 13} n={down} arrow="arrowDown" fg={onColor.green} bg={TINT.green} /> : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  abs: { position: 'absolute', left: 0, top: 0 }
});
