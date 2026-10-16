import { Platform, type ViewStyle } from 'react-native';
import { withAlpha } from './theme';

/**
 * A drop shadow. The web takes it as `boxShadow` (react-native-web warns on
 * `shadow*`); phones keep `shadow*` and `elevation`, because Android before
 * 9 does not draw `boxShadow`.
 */
export function lift(s: { color?: string; opacity: number; radius?: number; y?: number; elevation?: number }): ViewStyle {
  const { color = '#111420', opacity, radius = 10, y = 3, elevation = 2 } = s;
  return Platform.OS === 'web'
    ? { boxShadow: `0px ${y}px ${radius}px ${withAlpha(color, opacity)}` }
    : { shadowColor: color, shadowOpacity: opacity, shadowRadius: radius, shadowOffset: { width: 0, height: y }, elevation };
}

export const shadow = lift({ opacity: 0.06 });

/** Takes the shadow off a style that has one. */
export const flat: ViewStyle = Platform.OS === 'web' ? { boxShadow: 'none' } : { shadowOpacity: 0, elevation: 0 };
