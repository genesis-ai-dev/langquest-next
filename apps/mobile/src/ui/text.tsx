// The app's Text: React Native's, laid out in the reading direction. On iOS
// an unaligned line follows the phone's own language, so in a right-to-left
// app language on an English phone it would sit at the left; the base
// writing direction puts it where Arabic readers start (decision 81). Every
// screen imports Text from here (apps/mobile/test/i18n.test.ts holds them to it).
import { Platform, StyleSheet, Text as NativeText, type TextProps, type TextStyle } from 'react-native';
import { isRtl } from '../i18n';

export function Text(props: TextProps & { ref?: React.Ref<NativeText> }) {
  if (Platform.OS === 'android') return <NativeText {...props} style={androidWeight(props.style)} />;
  if (Platform.OS !== 'ios' || !isRtl()) return <NativeText {...props} />;
  return <NativeText {...props} style={[{ writingDirection: 'rtl' }, props.style]} />;
}

/**
 * Android draws a line in weight 700 that has a line height set wider than
 * React Native measured it, so a label as wide as its words loses its last
 * word ("Versions and" under Continue recording on a Pixel, 2026-10-16). At
 * 600 Android measures and draws alike, and its system font draws 600 and
 * 700 near enough the same, so there 700 is drawn at 600 (decision 139).
 */
function androidWeight(style: TextProps['style']): TextProps['style'] {
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  if (!flat || flat.lineHeight === undefined) return style;
  return flat.fontWeight === '700' || flat.fontWeight === 'bold' || flat.fontWeight === 700 ? [style, { fontWeight: '600' }] : style;
}
