// The number on a part of the screen while help is on (demo a-helpMode), and
// the amber ring on the part being explained. Drawn only: taps go to the part.
import { StyleSheet, Text, View } from 'react-native';
import { C, radius, TINT } from './theme';

/** The number on a part while help is on; amber while it is being explained (demo a-helpMode). */
export function HelpBadge(props: { n?: number; current: boolean; /** Inside the part (a row in a card that clips). */ inset?: boolean }) {
  if (props.n === undefined) return null;
  return (
    <>
      {props.current ? <View style={[styles.ring, props.inset && { top: 0, left: 0, right: 0, bottom: 0, borderRadius: 0 }]} pointerEvents="none" /> : null}
      <View style={[styles.badge, props.inset && { top: 4, left: 4 }, props.current && { backgroundColor: TINT.amberText }]} pointerEvents="none">
        <Text style={styles.badgeText}>{props.n}</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  badge: { position: 'absolute', top: -8, left: -8, width: 26, height: 26, borderRadius: 13, backgroundColor: C.primary, borderWidth: 2, borderColor: C.white,
    alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  badgeText: { fontSize: 13, fontWeight: '800', color: C.white },
  ring: { position: 'absolute', top: -4, left: -4, right: -4, bottom: -4, borderRadius: radius.lg, borderWidth: 2.5, borderColor: TINT.amberText, zIndex: 4 }
});
