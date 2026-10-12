// The recording screen's split (LAN-23): the source above, your recording
// below, a divider between them that is dragged to give either more room.
// It settles on a snap (one line, 35/50/65%, or the recorder as one line;
// demo ADR-036) and is remembered for the session. Its touch target is 48pt
// tall, overlapping both panes, with a visible grip; a screen reader adjusts
// it one snap at a time. A pane at an end snap shows a one-line version of
// itself, so neither is ever hidden (splitModel.ts).
import { useRef, useState, type ReactNode } from 'react';
import { PanResponder, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '../i18n';
import { C, radius, target } from '../theme';
import {
  DEFAULT_SPLIT, DIVIDER, fractionAfterDrag, MIN_BOTTOM, nearestSnap, paneHeights, rememberedSplit, rememberSplit, splitValueText, stepSnap
} from './splitModel';

/**
 * A pane is one line at an end snap; `open` brings the split back to half.
 * `height` is the pane's own, so it can show more as it gets room.
 */
type PaneContent = ReactNode | ((p: { compact: boolean; open: () => void; height: number }) => ReactNode);

export function SplitPane(props: {
  top: PaneContent;
  bottom: PaneContent;
  /** Which screen's split to remember ("workspace", "back_translation"). */
  memoryKey: string;
  minBottom?: number;
  topStyle?: StyleProp<ViewStyle>;
  bottomStyle?: StyleProp<ViewStyle>;
  /** Told where the split settles (and where it starts), for a screen whose footer depends on it. */
  onFraction?: (fraction: number) => void;
}) {
  const [available, setAvailable] = useState(0);
  const [fraction, setFraction] = useState(() => rememberedSplit(props.memoryKey));
  const [dragging, setDragging] = useState(false);
  const minBottom = props.minBottom ?? MIN_BOTTOM;
  const heights = paneHeights(available, fraction, minBottom);
  const latest = useRef({ available, heights, key: props.memoryKey, onFraction: props.onFraction });
  latest.current = { available, heights, key: props.memoryKey, onFraction: props.onFraction };
  const start = useRef(0);

  const settle = (to: number) => {
    const snap = nearestSnap(to);
    setFraction(snap);
    rememberSplit(latest.current.key, snap);
    latest.current.onFraction?.(snap);
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
  const open = () => settle(DEFAULT_SPLIT);
  const render = (c: PaneContent, compact: boolean, height: number) => (typeof c === 'function' ? c({ compact, open, height }) : c);
  return (
    <View style={styles.split} onLayout={(e) => setAvailable(Math.max(0, e.nativeEvent.layout.height - DIVIDER))}>
      <View style={[styles.pane, measured ? { height: heights.top } : { flex: fraction }, props.topStyle]}>{render(props.top, fraction <= 0, heights.top)}</View>
      <View style={styles.divider} {...pan.panHandlers}
        accessible accessibilityRole="adjustable"
        accessibilityLabel={t('recording.split.divider')}
        accessibilityHint={t('recording.split.dividerHint')}
        accessibilityValue={{ text: splitValueText(heights) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => settle(stepSnap(shown(), e.nativeEvent.actionName === 'increment' ? 1 : -1))}>
        <View style={styles.band}>
          <View style={[styles.grip, dragging && { backgroundColor: C.primary, width: 56 }]} />
        </View>
      </View>
      <View style={[styles.pane, measured ? { height: heights.bottom } : { flex: 1 - fraction }, props.bottomStyle]}>{render(props.bottom, fraction >= 1, heights.bottom)}</View>
    </View>
  );
}

const SLOP = (target.min - DIVIDER) / 2;

const styles = StyleSheet.create({
  split: { flex: 1 },
  pane: { overflow: 'hidden' },
  // 48pt tall, overlapping each pane by 12pt, drawn above both so the whole target answers.
  divider: { height: target.min, marginVertical: -SLOP, zIndex: 2, elevation: 2, justifyContent: 'center' },
  // On the screen's ground, a grip and nothing else (demo Grip).
  band: { height: DIVIDER, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  grip: { width: 48, height: 5, borderRadius: radius.full, backgroundColor: C.faint }
});
