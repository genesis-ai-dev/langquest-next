// Styles the study screens share (study/ui.tsx).
import { StyleSheet } from 'react-native';
import { shadow } from '../ui/shadow';
import { C, onColor, radius, space, target, TINT, type as T, withAlpha } from '../ui/theme';

export const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  sticky: { backgroundColor: C.bg, paddingBottom: space.xs, gap: space.sm },
  audioBar: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.border, paddingHorizontal: space.md, paddingVertical: space.md, ...shadow },
  playBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  backBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 1 },
  scrubber: { height: target.min, justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: C.border, overflow: 'hidden' },
  trackFill: { height: 6, borderRadius: 3, backgroundColor: C.primary },
  thumb: { position: 'absolute', top: (target.min - 18) / 2, width: 18, height: 18, borderRadius: 9, backgroundColor: C.primary, borderWidth: 2, borderColor: C.white },
  momentBtn: { minHeight: 48, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border, paddingHorizontal: space.md },
  switchWrap: { paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, backgroundColor: C.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  switch: { flexDirection: 'row', gap: 4, padding: 4, borderRadius: radius.lg, backgroundColor: C.bg },
  switchTab: { flex: 1, minHeight: 48, borderRadius: radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.sm },
  switchOn: { backgroundColor: C.card, ...shadow },
  textCard: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, paddingVertical: space.sm },
  verse: { flexDirection: 'row', gap: space.sm, borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: 6, minHeight: 48 },
  verseRef: { width: 36, textAlign: 'right', paddingTop: 3, fontSize: T.xs, fontWeight: '700', color: C.muted, fontVariant: ['tabular-nums'] },
  readingText: { fontSize: T.base, lineHeight: 28, color: C.dark },
  selected: { backgroundColor: withAlpha(C.primary, 0.07), borderWidth: 1.5, borderColor: withAlpha(C.primary, 0.38) },
  count: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 5, backgroundColor: onColor.amber, alignItems: 'center', justifyContent: 'center', marginTop: 3 },
  countText: { fontSize: T.xs, fontWeight: '800', color: C.white },
  where: { backgroundColor: C.card, borderLeftWidth: 3, borderColor: C.primary, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  imageWrap: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: TINT.gray },
  image: { width: '100%', aspectRatio: 4 / 3, backgroundColor: TINT.gray },
  standIn: { width: '100%', aspectRatio: 4 / 3, alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: TINT.gray, padding: space.lg },
  stepText: { fontSize: T.sm, lineHeight: 26, color: C.dark },
  itemMark: { width: 24, textAlign: 'right', fontWeight: '700', color: C.primary },
  callout: { gap: 2, borderLeftWidth: 4, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
  calloutOutlined: { borderWidth: 1, borderLeftWidth: 4 },
  calloutHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  calloutLabel: { fontSize: T.xs, fontWeight: '800', letterSpacing: 0.4 },
  previewSection: { borderRadius: radius.md, paddingHorizontal: space.sm, paddingVertical: 6, minHeight: 40, justifyContent: 'center' }
});
