import { NavigationContext } from '@react-navigation/native';
import { useContext, useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { t } from './i18n';
import { LinkBtn, SmallBtn } from './kit';
import { addDot, dotAt, MIN_DOTS } from './lockCore';
import { C, space } from './theme';

/**
 * Nine dots to draw a pattern on, as on the Android lock screen (decision
 * 88): no reading, no numbers, the same in every language. Dragging through
 * the dots and lifting the finger finishes it. Tapping the dots one at a time
 * works too, then Done finishes it; that is also how a screen reader enters
 * one. `resetKey` clears it when it changes.
 */
export function PatternPad(props: { onDone: (dots: number[]) => void; disabled?: boolean; error?: boolean; resetKey?: number }) {
  const [size, setSize] = useState(0);
  const [dots, setDots] = useState<number[]>([]);
  const [finger, setFinger] = useState<{ x: number; y: number } | null>(null);
  const [tapping, setTapping] = useState(false);
  const latest = useRef({ dots, size, moved: false, onDone: props.onDone, disabled: props.disabled });
  latest.current = { ...latest.current, dots, size, onDone: props.onDone, disabled: props.disabled };
  useEffect(() => { setDots([]); setTapping(false); }, [props.resetKey]);
  // iOS takes a sideways drag anywhere on the screen as "go back" (fullScreenGestureEnabled in App.tsx).
  const navigation = useContext(NavigationContext);
  useEffect(() => {
    navigation?.setOptions({ gestureEnabled: false });
    return () => navigation?.setOptions({ gestureEnabled: true });
  }, [navigation]);

  const reach = (x: number, y: number) => {
    const dot = dotAt(x, y, latest.current.size);
    if (dot === null) return;
    setDots((now) => {
      const next = addDot(now, dot);
      latest.current.dots = next;
      return next;
    });
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onStartShouldSetPanResponderCapture: () => !latest.current.disabled,
    onMoveShouldSetPanResponder: () => !latest.current.disabled,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      latest.current.moved = false;
      reach(e.nativeEvent.locationX, e.nativeEvent.locationY);
    },
    onPanResponderMove: (e, g) => {
      if (Math.abs(g.dx) + Math.abs(g.dy) > 12) latest.current.moved = true;
      setFinger({ x: e.nativeEvent.locationX, y: e.nativeEvent.locationY });
      reach(e.nativeEvent.locationX, e.nativeEvent.locationY);
    },
    onPanResponderRelease: () => {
      setFinger(null);
      // A drag finishes the pattern; a tap adds one dot and waits for Done.
      if (latest.current.moved) {
        setTapping(false);
        if (latest.current.dots.length > 0) latest.current.onDone(latest.current.dots);
      } else {
        setTapping(true);
      }
    },
    onPanResponderTerminate: () => setFinger(null)
  })).current;

  const cell = size / 3;
  const at = (d: number) => ({ x: ((d % 3) + 0.5) * cell, y: (Math.floor(d / 3) + 0.5) * cell });
  const lineColor = props.error ? C.red : C.primary;
  const last = dots[dots.length - 1];
  return (
    <View style={styles.wrap}>
      <View style={styles.pad} onLayout={(e: LayoutChangeEvent) => setSize(e.nativeEvent.layout.width)} {...pan.panHandlers}
        accessibilityLabel={t('shell.pattern.label', { count: MIN_DOTS })}>
        {size > 0 ? (
          <Svg width={size} height={size} pointerEvents="none">
            {dots.slice(1).map((d, i) => {
              const [a, b] = [at(dots[i]!), at(d)];
              return <Line key={`l${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={lineColor} strokeWidth={6} strokeLinecap="round" />;
            })}
            {finger && last !== undefined ? (
              <Line x1={at(last).x} y1={at(last).y} x2={finger.x} y2={finger.y} stroke={lineColor} strokeWidth={6} strokeLinecap="round" opacity={0.5} />
            ) : null}
            {Array.from({ length: 9 }, (_, d) => {
              const p = at(d);
              const on = dots.includes(d);
              return (
                <Circle key={d} cx={p.x} cy={p.y} r={on ? 16 : 10} fill={on ? lineColor : C.faint} />
              );
            })}
          </Svg>
        ) : null}
        {/* Each dot can also be reached by a screen reader, in reading order. */}
        {size > 0 ? Array.from({ length: 9 }, (_, d) => {
          const p = at(d);
          return (
            <Pressable key={`a${d}`} accessible accessibilityRole="button" accessibilityLabel={t('shell.pattern.dot', { n: d + 1 })}
              accessibilityState={{ selected: dots.includes(d) }} pointerEvents="none"
              onAccessibilityTap={() => { if (!props.disabled) { setTapping(true); setDots((now) => addDot(now, d)); } }}
              style={[styles.hit, { left: p.x - cell / 2, top: p.y - cell / 2, width: cell, height: cell }]} />
          );
        }) : null}
      </View>
      {tapping && dots.length > 0 ? (
        <View style={styles.row}>
          <LinkBtn label={t('shell.pattern.again')} onPress={() => { setDots([]); setTapping(false); }} />
          <SmallBtn label={t('common.done')} tone="primary" disabled={props.disabled || dots.length < MIN_DOTS}
            onPress={() => { setTapping(false); props.onDone(dots); }} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', alignItems: 'center', gap: space.sm },
  pad: { width: '100%', maxWidth: 300, aspectRatio: 1 },
  hit: { position: 'absolute' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', maxWidth: 300, width: '100%' }
});
