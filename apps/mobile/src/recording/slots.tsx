// Where the next part goes, chosen by tapping it (LAN-83, Caleb 2026-10-16):
// a gap among the parts (verses left out, or a deleted part's place), a
// part (what is said next replaces it), or the end. The chosen place is
// tinted and carries the purple microphone, as the lit next part does; the
// red button records there. No words explain it: the tint, the microphone
// and the footer's "Part 3" say where it goes. A small + sits on the
// card's right edge at each line between two parts (and above the first),
// half off the card: tapping it opens a place there, a pill with space all
// around it, so it never looks like a part (Caleb, 2026-10-16). Each part
// has a grip at its right end to drag it up or down the card.
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
import { lift } from '../ui/shadow';
import { a11yState } from '../ui/a11yModel';

/**
 * Half a + mark's 48 pt target, centred on the card's right edge: every row
 * ends this far inside the edge with nothing to tap there, and the card's
 * box reaches as far outside it, so the target covers no row's (A11Y-009)
 * and a phone delivers its taps (it does not past a view's own bounds).
 */
export const EDGE = 24; // target.min / 2
/** The grip's width, at a part's right end. */
export const GRIP = 48; // target.min

/**
 * A gap a part can be recorded into, numbered as the part will be: a pill
 * with space all around it, so it reads as a place, not a part (Caleb,
 * 2026-10-16). `tile` is the verses it will take, in a list with verse spaces.
 */
export function GapSlot(props: { n: number; tile?: ReactNode; chosen: boolean; disabled: boolean; first: boolean; onPress: () => void }) {
  const name = partLabel(props.n - 1);
  const spot = useHelpSpot(t('recording.recorder.recordInGap', { part: name }), props.chosen ? t('recording.recorder.nextCardHelp') : t('recording.recorder.gapHelp'), props.onPress);
  return (
    <View style={[styles.place, !props.first && styles.rowBorder]}>
      <Pressable onPress={spot.onPress} disabled={props.disabled} accessibilityRole="button" {...a11yState({ selected: props.chosen }, 'button')}
        // The web reads only the aria prop: react-native-web drops accessibilityState.selected.
        aria-selected={props.chosen}
        accessibilityLabel={t('recording.recorder.recordInGap', { part: name })}
        style={({ pressed }) => [styles.pill, props.chosen && styles.pillOn, pressed && ps.pressed]}>
        <View style={[styles.mic, props.chosen ? styles.micOn : styles.micOff]}>
          <Ico name="mic" size={16} color={props.chosen ? C.white : C.muted} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.body, { fontWeight: '700', color: props.chosen ? C.dark : C.muted }]}>{name}</Text>
          {props.chosen ? <Text style={txt.smMuted}>{t('recording.recorder.recordingNext')}</Text> : null}
        </View>
        {props.tile ?? null}
        <HelpBadge spot={spot} />
      </Pressable>
    </View>
  );
}

/**
 * The + on the line above a part: tapped, a place opens there for the next
 * part (numbered as it will be). It takes no room of its own: it sits across
 * the line, half off the card's right edge, its target over the `EDGE` the
 * rows either side leave empty.
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
    <View {...(props.disabled || spot.id ? {} : props.handlers)} style={[styles.grip, props.disabled && ps.off]} testID="part-grip"
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
      <Ico name="handle" size={22} color={C.muted} />
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
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  // The place: space all round, and a pill in it, dashed until it is chosen.
  place: { paddingVertical: space.sm + 2, paddingLeft: space.md, paddingRight: EDGE + space.sm },
  pill: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.min + 8, paddingLeft: space.xs + 2, paddingRight: space.md,
    borderRadius: radius.full, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.faint },
  pillOn: { borderStyle: 'solid', borderColor: C.primary, backgroundColor: C.light },
  mic: { width: 36, height: 36, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  micOn: { backgroundColor: C.primary },
  micOff: { borderWidth: 2, borderStyle: 'dashed', borderColor: C.faint },
  // Across the line between two rows: 48 tall, half over each row, above both; its target straddles the card's right edge.
  markLine: { height: target.min, marginVertical: -target.min / 2, alignItems: 'flex-end', justifyContent: 'center', zIndex: 3 },
  markTap: { width: EDGE * 2, height: target.min, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 20, height: 20, borderRadius: radius.full, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
    ...lift({ opacity: 0.08, radius: 2, y: 1, elevation: 1 }) },
  grip: { width: GRIP, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' }
});
