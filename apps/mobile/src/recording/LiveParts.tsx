// The live waveform while recording (LAN-82; demo artifact "Live parts
// waveform"): the last few seconds the microphone heard, each kept part boxed
// with the number the parts list will give it, from the moment it starts. The
// box reaches back to where the voice began; the room is a faint band; sound
// heard and kept in no part shows as not kept, so a problem is seen while
// recording, not at playback. It fills its parent and carries no words but
// the part numbers; the pane's status row says what is happening, so the
// waveform is hidden from screen readers. `tone` is the ground it sits on:
// the red recording pane, or a white card. Two fingers pinch it nearer or
// farther (about 2 s to 30 s); the bars only grow or shrink.
import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { Text } from '../ui/text';
import { formatNumber } from '../i18n/format';
import { C, radius, withAlpha } from '../ui/theme';
import { clampFrames, LIVE_BARS, liveBars, liveBoxes, liveHeight, type LiveBar } from './livePartsModel';
import { useLiveParts } from './useLiveParts';
import type { useRecorder } from './useRecorder';

type Tone = 'onRed' | 'onCard';
const LOST_ON_RED = '#7F1D1D';

const TONES: Record<Tone, { bar: Record<LiveBar['kind'], string>; band: string; box: string; boxFill: string; open: string; openFill: string; pill: string; pillOpen: string; pillText: string; pillOpenText: string }> = {
  onRed: {
    bar: { kept: C.white, open: C.white, room: withAlpha(C.white, 0.35), heard: withAlpha(C.white, 0.6), lost: LOST_ON_RED },
    band: withAlpha(C.white, 0.14), box: withAlpha(C.white, 0.8), boxFill: withAlpha(C.white, 0.1), open: C.white, openFill: withAlpha(C.white, 0.18),
    pill: withAlpha(C.white, 0.85), pillOpen: C.white, pillText: C.red, pillOpenText: C.red
  },
  onCard: {
    bar: { kept: C.primary, open: C.primary, room: C.faint, heard: C.muted, lost: C.red },
    band: withAlpha(C.faint, 0.35), box: C.primary, boxFill: withAlpha(C.primary, 0.08), open: C.red, openFill: withAlpha(C.red, 0.06),
    pill: C.primary, pillOpen: C.red, pillText: C.white, pillOpenText: C.white
  }
};

export function LiveParts(props: { rec: ReturnType<typeof useRecorder>; firstPart: number; tone: Tone }) {
  const live = useLiveParts(props.firstPart);
  const [width, setWidth] = useState(0);
  const [frames, setFrames] = useState(LIVE_BARS);
  const pinch = usePinch(frames, setFrames);
  const ink = TONES[props.tone];
  const bars = liveBars(live, frames);
  const boxes = width ? liveBoxes(live, frames) : [];
  return (
    <View style={[styles.fill, props.rec.vadPaused && { opacity: 0.5 }]} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      importantForAccessibility="no-hide-descendants" accessibilityElementsHidden {...pinch.panHandlers}>
      {boxes.map((b) => (
        <View key={b.n} style={[styles.part, {
          left: (b.from / frames) * width, width: Math.max(6, ((b.to - b.from) / frames) * width),
          borderColor: b.open ? ink.open : ink.box, backgroundColor: b.open ? ink.openFill : ink.boxFill, borderWidth: b.open ? 2.5 : 1.5
        }]}>
          <View style={[styles.pill, { backgroundColor: b.open ? ink.pillOpen : ink.pill }]}>
            <Text style={[styles.pillText, { color: b.open ? ink.pillOpenText : ink.pillText }]}>{formatNumber(b.n)}</Text>
          </View>
        </View>
      ))}
      <View style={styles.bars}>
        {bars.map((bar, i) => (
          <View key={i} style={styles.slot}>
            {bar.quiet !== null ? <View style={[styles.band, { height: `${liveHeight(bar.quiet) * 100}%`, backgroundColor: ink.band }]} /> : null}
            <View style={[styles.bar, { height: `${Math.max(2, liveHeight(bar.db) * 100)}%`, backgroundColor: ink.bar[bar.kind] }]} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** Two fingers apart: nearer (fewer frames); together: farther. One finger does nothing here. */
function usePinch(frames: number, setFrames: (n: number) => void) {
  const start = useRef({ d: 0, frames });
  const latest = useRef(frames);
  latest.current = frames;
  const spread = (e: GestureResponderEvent) => {
    const [a, b] = e.nativeEvent.touches;
    return a && b ? Math.max(10, Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY)) : 0;
  };
  return useRef(PanResponder.create({
    onStartShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
    onMoveShouldSetPanResponder: (e) => e.nativeEvent.touches.length === 2,
    onPanResponderGrant: (e) => { start.current = { d: spread(e), frames: latest.current }; },
    onPanResponderMove: (e) => {
      const d = spread(e);
      if (!d) return;
      if (!start.current.d) { start.current = { d, frames: latest.current }; return; }
      setFrames(clampFrames(start.current.frames * start.current.d / d));
    },
    onPanResponderTerminationRequest: () => false
  })).current;
}

const PILL = 18;
const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 56, position: 'relative' },
  part: { position: 'absolute', top: 0, bottom: 0, borderRadius: radius.md, overflow: 'hidden' },
  pill: { position: 'absolute', top: 3, left: 3, minWidth: PILL, height: PILL, borderRadius: 5, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 11, fontWeight: '800', lineHeight: 14 },
  bars: { position: 'absolute', left: 0, right: 0, top: PILL + 6, bottom: 4, flexDirection: 'row', pointerEvents: 'none' },
  slot: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  band: { position: 'absolute', left: 0, right: 0 },
  bar: { width: '70%', borderRadius: 1 }
});
