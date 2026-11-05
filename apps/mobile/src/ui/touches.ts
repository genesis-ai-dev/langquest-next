import { StyleSheet } from 'react-native';

/**
 * Whether a view takes touches. Always through these, not a `pointerEvents`
 * prop (react-native-web has deprecated it) or an inline style: react-native-web
 * compiles the value only in `StyleSheet.create`, and inline `box-none` reaches
 * the browser as CSS it ignores, so the view keeps taking touches.
 */
export const touches = StyleSheet.create({
  none: { pointerEvents: 'none' },
  /** Not this view, but what is inside it. */
  boxNone: { pointerEvents: 'box-none' },
  auto: { pointerEvents: 'auto' }
});
