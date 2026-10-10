// The app's Text: React Native's, laid out in the reading direction. On iOS
// an unaligned line follows the phone's own language, so in a right-to-left
// app language on an English phone it would sit at the left; the base
// writing direction puts it where Arabic readers start (decision 80). Every
// screen imports Text from here (apps/mobile/test/i18n.test.ts holds them to it).
import { Platform, Text as NativeText, type TextProps } from 'react-native';
import { isRtl } from './i18n';

export function Text(props: TextProps & { ref?: React.Ref<NativeText> }) {
  if (Platform.OS !== 'ios' || !isRtl()) return <NativeText {...props} />;
  return <NativeText {...props} style={[{ writingDirection: 'rtl' }, props.style]} />;
}
