// Where the next part goes, chosen by tapping it (LAN-83, Caleb 2026-10-16):
// a gap among the parts (verses left out, or a deleted part's place), a
// part (what is said next replaces it), or the end. The chosen place is
// tinted and carries the purple microphone, as the lit next part does; the
// red button records there. No words explain it: the tint, the microphone
// and the footer's "Part 3" say where it goes. A small mark sits on the
// line between two parts (and above the first): tapping it opens a place
// there, a gap like the others (Caleb, 2026-10-16). Each part has a grip
// to drag it up or down the card.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type PanResponderInstance } from 'react-native';
import { Text } from '../ui/text';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { Ico } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, radius, space, target } from '../ui/theme';
import { partLabel } from './model';
import { styles as ps } from './blockStyles';

/**
 * The rail at the left of every row, where the marks on the lines between
 * parts sit: each mark's 48 pt target is there, clear of the rows' own
 * targets (A11Y-009). A gap's row keeps the same space empty.
 */
export const RAIL = 48; // target.min
/** The grip's width, after the rail (a gap's row keeps the same space empty). */
export const GRIP = 48; // target.min

/** A gap a part can be recorded into, numbered as the part will be. `gutter` holds its verses in a list with verse spaces. */
export function GapSlot(props: { n: number; tile?: ReactNode; gutter: boolean; chosen: boolean; disabled: boolean; first: boolean; onPress: () => void;
  /** The parts beside it have grips: keep their space, so the rows line up. */ grip?: boolean }) {
  const name = partLabel(props.n - 1);
  const spot = useHelpSpot(t('recording.recorder.recordInGap', { part: name }), props.chosen ? t('recording.recorder.nextCardHelp') : t('recording.recorder.gapHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityState={{ selected: props.chosen }}
      // The web reads only the aria prop: react-native-web drops accessibilityState.selected.
      aria-selected={props.chosen}
      accessibilityLabel={t('recording.recorder.recordInGap', { part: name })}
      style={({ pressed }) => [styles.row, !props.first && styles.rowBorder, props.chosen && styles.chosen, pressed && ps.pressed]}>
      {props.grip ? <View style={{ width: RAIL + GRIP }} /> : null}
      {props.gutter ? <View style={styles.gutter}>{props.tile ?? <View style={styles.noTile} />}</View> : null}
      <View style={[styles.body, !props.gutter && !props.grip && { paddingLeft: 0 }]}>
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

/**
 * The mark on the line above a part: tapped, a place opens there for the
 * next part (numbered as it will be). It takes no room of its own: it sits
 * across the line in the rail at the left, where the rows either side have
 * nothing to tap.
 */
export function InsertMark(props: { n: number; before: string; onPress: () => void }) {
  const spot = useHelpSpot(t('recording.recorder.recordBefore', { part: props.before }), t('recording.recorder.recordBeforeHelp'), props.onPress);
  return (
    <View style={styles.markLine} pointerEvents="box-none">
      <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={t('recording.recorder.recordBefore', { part: props.before })}
        style={({ pressed }) => [styles.markTap, pressed && { transform: [{ scale: 1.25 }] }]}>
        <View style={styles.mark}><Ico name="plus" size={12} color={C.muted} strokeWidth={3} /></View>
        <HelpBadge spot={spot} />
      </Pressable>
    </View>
  );
}

const DRAG = () => undefined;

/**
 * A part's grip: drag it up or down the card (Caleb, 2026-10-16). It has
 * nothing to tap: while help is on, a tap on it explains the drag. A screen
 * reader gets Move up and Move down instead.
 */
export function PartGrip(props: { part: string; handlers: PanResponderInstance['panHandlers']; disabled: boolean; canUp: boolean; canDown: boolean; onStep: (by: -1 | 1) => void;
  /** Its place in the list, 1-based, and how many parts there are: the slider's value. */ at: number; of: number }) {
  const spot = useHelpSpot(t('recording.recorder.movePart', { part: props.part }), t('recording.recorder.movePartHelp'), props.disabled ? undefined : DRAG);
  return (
    <View {...(props.disabled || spot.id ? {} : props.handlers)} style={[styles.grip, props.disabled && ps.off]}
      accessible accessibilityRole="adjustable" accessibilityLabel={t('recording.recorder.movePart', { part: props.part })}
      // A slider has a value: its place in the list (the web reads only the aria props).
      accessibilityValue={{ min: 1, max: props.of, now: props.at }} aria-valuemin={1} aria-valuemax={props.of} aria-valuenow={props.at}
      accessibilityActions={props.disabled ? [] : [
        ...(props.canUp ? [{ name: 'decrement', label: t('recording.recorder.moveUp') }] : []),
        ...(props.canDown ? [{ name: 'increment', label: t('recording.recorder.moveDown') }] : [])
      ]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === 'decrement' && props.canUp) props.onStep(-1);
        if (e.nativeEvent.actionName === 'increment' && props.canDown) props.onStep(1);
      }}>
      <Ico name="grip" size={20} color={C.faint} />
      {spot.id ? (
        <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={t('recording.recorder.movePart', { part: props.part })} style={StyleSheet.absoluteFill}>
          <HelpBadge spot={spot} />
        </Pressable>
      ) : null}
    </View>
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
  micOff: { borderWidth: 2, borderStyle: 'dashed', borderColor: C.faint },
  // Across the line between two rows: 48 tall, half over each row, above both.
  markLine: { height: target.min, marginVertical: -target.min / 2, alignItems: 'flex-start', justifyContent: 'center', zIndex: 3 },
  markTap: { width: RAIL, height: target.min, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 20, height: 20, borderRadius: radius.full, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  grip: { width: GRIP, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }
});
