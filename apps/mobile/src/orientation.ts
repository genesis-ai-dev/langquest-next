import { Dimensions, Platform } from 'react-native';
import { reportError } from './report';

/**
 * Phones stay portrait; tablets turn (decisions.md 55). iOS says so in
 * app.json (portrait on iPhone, every way on iPad). Android has one setting
 * for every device, left free there, so a phone is held to portrait here:
 * a device whose short side is under 600dp, Android's own phone/tablet line.
 *
 * The native module is loaded only here, on Android, and inside the try: a
 * binary built without it reports the miss and runs on, rather than failing
 * at startup.
 */
export function lockPhonesToPortrait(): void {
  if (Platform.OS !== 'android') return;
  const { width, height } = Dimensions.get('screen');
  if (Math.min(width, height) >= 600) return;
  try {
    const ScreenOrientation = require('expo-screen-orientation') as typeof import('expo-screen-orientation');
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
      .catch((e: unknown) => { reportError('lock phone to portrait', e); });
  } catch (e) {
    reportError('lock phone to portrait', e);
  }
}
