import { StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { txt } from '../ui/textStyles';

/**
 * The one line under the nine dots (checking, a wait, a wrong pattern), in a
 * slot that keeps its height when empty: the dots never move as it comes and
 * goes, so a pattern being drawn does not slip off them.
 */
export function PadMessage(props: { text: string; tone: 'muted' | 'error' }) {
  return (
    <View style={styles.slot}>
      {props.text ? (
        <Text style={[props.tone === 'error' ? txt.error : txt.smMuted, styles.text]}
          {...(props.tone === 'error' ? { accessibilityRole: 'alert' as const } : { accessibilityLiveRegion: 'polite' as const })}>
          {props.text}
        </Text>
      ) : null}
    </View>
  );
}

// Two lines of the error text: a wait says "Too many tries. Try again in 3 minutes." in some languages over two.
const styles = StyleSheet.create({
  slot: { minHeight: 48, alignSelf: 'stretch', justifyContent: 'center' },
  text: { textAlign: 'center' }
});
