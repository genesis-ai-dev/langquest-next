// Styles the check list and the check editor share (checks/LanguageChecks.tsx, screens/checks.tsx).
import { StyleSheet } from 'react-native';
import { C, radius, space } from '../ui/theme';

export const styles = StyleSheet.create({
  start: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.xs },
  mic: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  recordCard: { gap: space.md, paddingLeft: space.md, borderColor: C.soft },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: 68, paddingVertical: space.md, paddingRight: space.md, borderRadius: 18, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border },
  grip: { width: 40, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', minHeight: 48 },
  body: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48 },
  num: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  numText: { fontSize: 15, fontWeight: '800', color: C.primary },
  title: { fontSize: 17, fontWeight: '800', color: C.dark, lineHeight: 23 },
  meta: { flexDirection: 'row', gap: space.md, flexWrap: 'wrap' },
  metaPart: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 13, fontWeight: '700', color: C.muted },
  together: { flexDirection: 'row', gap: space.sm },
  bar: { width: 3, borderRadius: 2, backgroundColor: C.soft, marginVertical: space.lg },
  sameTime: { fontSize: 13, fontWeight: '800', color: C.soft, paddingHorizontal: space.xs },
  quiet: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, minHeight: 48 },
  quietText: { fontSize: 17, fontWeight: '700', color: C.muted },
  tick: { width: 28, height: 28, borderRadius: radius.sm, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  tickOn: { backgroundColor: C.primary, borderColor: C.primary }
});
