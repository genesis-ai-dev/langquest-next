import { View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { C, space } from '../ui/theme';

/** Let someone in's QR code on an Android phone: dark on white, large enough to scan from arm's length (14.1, 3). */
export function LetInCode(props: { value: string; label: string }) {
  return (
    <View style={{ alignItems: 'center', padding: space.md, backgroundColor: C.white }} accessible accessibilityLabel={props.label}>
      <QRCode value={props.value} size={220} backgroundColor={C.white} color={C.dark} />
    </View>
  );
}
