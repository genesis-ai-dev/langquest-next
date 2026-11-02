// How far a recording has played, as a band that crosses its row or card
// from the left (Caleb, 2026-10-30: "a playback progress bar that moves
// across the card as it plays"; with Play all no one could tell which part
// was playing, or how far into it). Between the player's reports it runs on
// at the speed the recording plays, so a two-second part moves smoothly, and
// each report puts it back where the player is. Paused, it stays where it
// stopped. It draws behind what the row holds and takes no touches.
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { C, withAlpha } from '../ui/theme';

export function PlayingFill(props: {
  /** Seconds played, of `length` (0 while not known), and whether it is playing or paused there. */
  at: number; length: number; playing: boolean;
  /** Where it may draw, when that is not the whole of what holds it: a card's round corners. */
  style?: StyleProp<ViewStyle>;
}) {
  const share = useRef(new Animated.Value(0)).current;
  const { at, length, playing } = props;
  useEffect(() => {
    share.setValue(length > 0 ? Math.min(1, Math.max(0, at / length)) : 0);
    if (!playing || length <= 0 || at >= length) return;
    const run = Animated.timing(share, { toValue: 1, duration: (length - at) * 1000, easing: Easing.linear, useNativeDriver: false });
    run.start();
    return () => run.stop();
  }, [at, length, playing, share]);
  const width = share.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }, props.style]}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.band, { width }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Tinted where it has played, with a line along the bottom for the bar.
  band: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: withAlpha(C.primary, 0.1), borderBottomWidth: 3, borderColor: C.primary }
});
