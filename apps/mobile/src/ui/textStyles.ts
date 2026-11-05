// The kit's text styles (ui/kit.tsx, ui/theme.ts).
import { StyleSheet } from 'react-native';
import { C, TINT, type as T } from './theme';

export const txt = StyleSheet.create({
  title: { fontSize: T.lg, fontWeight: '700', color: C.dark },
  h2: { fontSize: T.xl, fontWeight: '700', color: C.dark },
  h3: { fontSize: T.base, fontWeight: '700', color: C.dark },
  body: { fontSize: T.base, color: C.dark, lineHeight: 23 },
  bodyMuted: { fontSize: T.base, color: C.muted, lineHeight: 23 },
  sm: { fontSize: T.sm, color: C.dark, lineHeight: 21 },
  smMuted: { fontSize: T.sm, color: C.muted, lineHeight: 21 },
  xs: { fontSize: T.xs, color: C.muted, lineHeight: 18 },
  xsStrong: { fontSize: T.xs, fontWeight: '700', color: C.muted },
  label: { fontSize: T.xs, fontWeight: '800', letterSpacing: 0.8, color: C.muted, textTransform: 'uppercase' },
  link: { fontSize: T.sm, fontWeight: '700', color: C.primary },
  error: { fontSize: T.sm, color: TINT.redText, lineHeight: 21 }
});
