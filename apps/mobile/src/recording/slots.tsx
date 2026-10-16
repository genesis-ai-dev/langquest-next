// Where the next part goes, chosen by tapping it (LAN-83, Caleb 2026-10-16):
// a gap among the parts (verses left out, or a deleted part's place), a
// part (what is said next replaces it), or the end. The chosen place is
// tinted and carries the purple microphone, as the lit next part does; the
// red button records there. No words explain it: the tint, the microphone
// and the footer's "Part 3" say where it goes.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Ico } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, radius, space, target } from '../ui/theme';
import { partLabel } from './model';
import { styles as ps } from './blockStyles';

/** A gap a part can be recorded into, numbered as the part will be. `gutter` holds its verses in a list with verse spaces. */
export function GapSlot(props: { n: number; tile?: ReactNode; gutter: boolean; chosen: boolean; disabled: boolean; first: boolean; onPress: () => void }) {
  const name = partLabel(props.n - 1);
  const spot = useHelpSpot(t('recording.recorder.recordInGap', { part: name }), props.chosen ? t('recording.recorder.nextCardHelp') : t('recording.recorder.gapHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityState={{ selected: props.chosen }}
      accessibilityLabel={t('recording.recorder.recordInGap', { part: name })}
      style={({ pressed }) => [styles.row, !props.first && styles.rowBorder, props.chosen && styles.chosen, pressed && ps.pressed]}>
      {props.gutter ? <View style={styles.gutter}>{props.tile ?? <View style={styles.noTile} />}</View> : null}
      <View style={[styles.body, !props.gutter && { paddingLeft: 0 }]}>
        <View style={[styles.mic, props.chosen ? styles.micOn : styles.micOff]}>
          <Ico name="mic" size={16} color={props.chosen ? C.white : C.muted} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.body, { fontWeight: '700', color: props.chosen ? C.dark : C.muted }]}>{name}</Text>
          {props.chosen ? <Text style={txt.smMuted}>{t('recording.recorder.recordingNext')}</Text> : null}
        </View>
      </View>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** The microphone a chosen part shows: what is said next replaces it. */
export function ChosenMic() {
  return <View style={[styles.mic, styles.micOn]}><Ico name="mic" size={16} color={C.white} /></View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'stretch', minHeight: target.row },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  chosen: { backgroundColor: C.light },
  gutter: { width: 64, alignItems: 'center', justifyContent: 'center', borderRightWidth: 1, borderColor: C.border },
  noTile: { width: 44, height: 44 },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md },
  mic: { width: 36, height: 36, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  micOn: { backgroundColor: C.primary },
  micOff: { borderWidth: 2, borderStyle: 'dashed', borderColor: C.faint }
});
