// Styles the recording blocks share (recording/blocks.tsx).
import { StyleSheet } from 'react-native';
import { C, radius, space, target, type as T } from '../ui/theme';

export const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  off: { opacity: 0.4 },
  chipScroll: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.sm + 2 },
  chip: { minHeight: target.min, borderRadius: radius.full, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipLabel: { fontSize: T.base, fontWeight: '700', color: C.dark },
  round: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  // The field rule's smallest text (13pt, PLAN.md section 12); a tight line keeps it under the icon in 48pt.
  roundWord: { fontSize: T.xs, lineHeight: 14, fontWeight: '800', marginTop: -1 },
  mini: { backgroundColor: C.card, borderRadius: radius.lg, borderWidth: 1, borderColor: C.border, padding: space.sm + 2, gap: space.xs },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2 },
  miniTitle: { fontSize: T.base, fontWeight: '800', color: C.dark },
  dock: { flexDirection: 'row', alignItems: 'center', gap: space.sm + 2, paddingHorizontal: space.lg, paddingVertical: space.sm + 2, backgroundColor: C.light, borderTopWidth: 1, borderColor: C.border },
  playRow: { flexDirection: 'row', alignItems: 'center', gap: space.md + 2, minHeight: target.row, paddingHorizontal: space.md + 2, paddingVertical: space.md },
  rowBorder: { borderBottomWidth: 1, borderColor: C.border },
  playTile: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { fontSize: T.base, fontWeight: '700', color: C.dark },
  dashed: { minHeight: 52, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.faint, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.md },
  dashedLabel: { fontSize: T.base, fontWeight: '700', color: C.primary },
  quiet: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: target.min, paddingHorizontal: space.sm },
  callout: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md + 2 },
  reading: { fontSize: T.base, lineHeight: 25, color: C.dark },
  stepNav: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingBottom: space.sm },
  stepBox: { flex: 1, minWidth: 0, minHeight: target.min, borderRadius: radius.md + 2, borderWidth: 1, borderColor: C.border, backgroundColor: C.card,
    flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.md },
  stepCount: { fontSize: T.xs, fontWeight: '800', color: C.primary },
  stepTitle: { flex: 1, fontSize: T.base, fontWeight: '800', color: C.dark },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.min, paddingHorizontal: space.sm + 2, borderRadius: radius.md },
  stepMark: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  partMark: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }
});
