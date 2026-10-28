// A part's sound as bars beside its length (Caleb, 2026-10-16: the row
// reads as a voice message): as many bars as the row has room for, filled
// from the left as it plays. Until a part's bars are known it shows a low
// even line. In Clean up (decision 178) a bar shows its noise too: amber,
// around the purple of the voice it holds.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { fitBars } from '../audio/barsModel';
import { C, withAlpha } from '../ui/theme';

const WIDE = 3;
const GAP = 2;
const TALL = 26;

export function PartBars(props: { bars: number[] | null; progress: number | null;
  /** Each bar's voice, as tall as `bars` draws it at most: the rest of the bar is noise. */ voice?: number[] }) {
  const [width, setWidth] = useState(0);
  const n = Math.max(0, Math.floor((width + GAP) / (WIDE + GAP)));
  const shown = props.bars ? fitBars(props.bars, n) : Array.from({ length: n }, () => 0.06);
  const voice = props.voice && props.bars ? fitBars(props.voice, n) : null;
  const lit = props.progress === null ? -1 : Math.round(props.progress * n);
  const tall = (v: number) => 3 + v * (TALL - 3);
  return (
    <View style={styles.bars} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {voice ? shown.map((v, k) => (
        <View key={k} style={[styles.noise, { height: tall(v) }, lit >= 0 && k >= lit && styles.unlit]}>
          <View style={[styles.voice, { height: Math.min(tall(v), tall(voice[k] ?? 0)) }]} />
        </View>
      )) : shown.map((v, k) => <View key={k} style={[styles.bar, { height: tall(v) }, k < lit && styles.on]} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { flex: 1, minWidth: 0, height: TALL, flexDirection: 'row', alignItems: 'center', gap: GAP, overflow: 'hidden' },
  bar: { width: WIDE, borderRadius: 2, backgroundColor: withAlpha(C.primary, 0.32) },
  on: { backgroundColor: C.primary },
  noise: { width: WIDE, borderRadius: 2, backgroundColor: C.amber, justifyContent: 'center' },
  voice: { width: WIDE, borderRadius: 2, backgroundColor: C.primary },
  // Ahead of where it is playing.
  unlit: { opacity: 0.45 }
});
