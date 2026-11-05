import { Platform, type ViewStyle } from 'react-native';

/**
 * A view laid out left to right in every language, for what follows the
 * screen rather than the reading direction (a time axis, a row that slides).
 * react-native-web calls this `writingDirection` on a view: in a dev build its
 * validator reports and deletes `direction`, so an RTL page would flip it.
 * Native has `writingDirection` only on text.
 */
export const alwaysLtr = (Platform.OS === 'web' ? { writingDirection: 'ltr' } : { direction: 'ltr' }) as ViewStyle;
