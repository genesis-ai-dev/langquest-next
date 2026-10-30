// The silence switch beside the big red button while a recording session is
// open (decision 193), where Done sits once it is left. Its picture is what
// it does: speech bars either side of a flat line in a dashed box, as a
// silence's box looks on the waveform; the switch beside it says on or off.
// The phone keeps it (silenceSetting.ts).
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { a11yState } from '../ui/a11yModel';
import { C, radius, target } from '../ui/theme';
import { styles as ps } from './blockStyles';

export function SilenceSwitch(props: { on: boolean; onToggle: () => void; disabled?: boolean }) {
  const label = t('recording.recorder.silenceSwitch');
  const spot = useHelpSpot(label, t('recording.recorder.silenceSwitchHelp'), props.onToggle);
  const ink = props.on ? C.primary : C.muted;
  return (
    <Pressable testID="silence-switch" onPress={spot.onPress} disabled={props.disabled} accessibilityRole="switch" accessibilityLabel={label}
      {...a11yState({ checked: props.on, disabled: !!props.disabled }, 'switch')}
      style={({ pressed }) => [styles.box, props.disabled && { opacity: 0.45 }, pressed && ps.pressed]}>
      <Svg width={34} height={24} viewBox="0 0 34 24" fill="none" stroke={ink} strokeLinecap="round">
        <Path d="M2 8v8M5 5v14M29 5v14M32 8v8" strokeWidth={2} />
        <Rect x={8.5} y={3} width={17} height={18} rx={4} strokeWidth={1.7} strokeDasharray="3 2.4" />
        <Path d="M12.5 12h9" strokeWidth={2} />
      </Svg>
      <View style={[styles.track, { backgroundColor: props.on ? C.primary : C.faint }]}>
        <View style={[styles.knob, props.on ? { right: 2 } : { left: 2 }]} />
      </View>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: target.min + 4, paddingLeft: 9, paddingRight: 10,
    borderRadius: radius.md + 2, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  track: { width: 44, height: 26, borderRadius: 13, justifyContent: 'center' },
  knob: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: C.white }
});
