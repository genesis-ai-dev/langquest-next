// The recording screen's split (LAN-23): the source above, your recording
// below, a divider between them that is dragged to give either more room.
// It settles on a snap (35/50/65% for the source) and is remembered for the
// session. Its touch target is 48pt tall, overlapping both panes, with a
// visible grip; a screen reader adjusts it one snap at a time. Both panes
// keep a minimum height, so neither is ever hidden (splitModel.ts).
import { useRef, useState, type ReactNode } from 'react';
import { PanResponder, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { C, radius, target } from '../theme';
import {
  DIVIDER, fractionAfterDrag, MIN_BOTTOM, nearestSnap, paneHeights, rememberedSplit, rememberSplit, splitValueText, stepSnap
} from './splitModel';

export function SplitPane(props: {
  top: ReactNode;
  bottom: ReactNode;
  /** Which screen's split to remember ("workspace", "back_translation"). */
  memoryKey: string;
  minBottom?: number;
  topStyle?: StyleProp<ViewStyle>;
  bottomStyle?: StyleProp<ViewStyle>;
}) {
  const [available, setAvailable] = useState(0);
  const [fraction, setFraction] = useState(() => rememberedSplit(props.memoryKey));
  const [dragging, setDragging] = useState(false);
  const minBottom = props.minBottom ?? MIN_BOTTOM;
  const heights = paneHeights(available, fraction, minBottom);
  const latest = useRef({ available, heights, key: props.memoryKey });
  latest.current = { available, heights, key: props.memoryKey };
  const start = useRef(0);

  const settle = (to: number) => {
    const snap = nearestSnap(to);
    setFraction(snap);
    rememberSplit(latest.current.key, snap);
  };
  // Where the panes actually are (minimums applied), so a drag starts from what is on screen.
  const shown = () => {
    const { available: room, heights: h } = latest.current;
    return room > 0 ? h.top / room : fraction;
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { start.current = shown(); setDragging(true); },
    onPanResponderMove: (_, g) => setFraction(fractionAfterDrag(start.current, g.dy, latest.current.available)),
    onPanResponderRelease: (_, g) => { setDragging(false); settle(fractionAfterDrag(start.current, g.dy, latest.current.available)); },
    onPanResponderTerminate: () => { setDragging(false); settle(start.current); }
  })).current;

  const measured = available > 0;
  return (
    <View style={styles.split} onLayout={(e) => setAvailable(Math.max(0, e.nativeEvent.layout.height - DIVIDER))}>
      <View style={[styles.pane, measured ? { height: heights.top } : { flex: fraction }, props.topStyle]}>{props.top}</View>
      <View style={styles.divider} {...pan.panHandlers}
        accessible accessibilityRole="adjustable"
        accessibilityLabel="Divider between the source and your recording"
        accessibilityHint="Drag up or down to give either one more room"
        accessibilityValue={{ text: splitValueText(heights) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => settle(stepSnap(shown(), e.nativeEvent.actionName === 'increment' ? 1 : -1))}>
        <View style={styles.band}>
          <View style={[styles.grip, dragging && { backgroundColor: C.primary, width: 56 }]} />
        </View>
      </View>
      <View style={[styles.pane, measured ? { height: heights.bottom } : { flex: 1 - fraction }, props.bottomStyle]}>{props.bottom}</View>
    </View>
  );
}

const SLOP = (target.min - DIVIDER) / 2;

const styles = StyleSheet.create({
  split: { flex: 1 },
  pane: { overflow: 'hidden' },
  // 48pt tall, overlapping each pane by 12pt, drawn above both so the whole target answers.
  divider: { height: target.min, marginVertical: -SLOP, zIndex: 2, elevation: 2, justifyContent: 'center' },
  band: { height: DIVIDER, backgroundColor: C.card, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 44, height: 5, borderRadius: radius.full, backgroundColor: C.faint }
});
