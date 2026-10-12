// The simple Map's parts (decision 71; demo Map and MapBook in
// ng-langquest-ux src/simple/translator.tsx): the "Next" card, the testament
// pills, a book as one row with a bar and a count, a chapter tile in three
// states marked as well as coloured, and the quiet "Filter" link that keeps
// the filters and the full key one tap deeper. Every press goes through help
// mode.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import type { ChapterStage } from '../canon';
import { useHelpSpot } from '../helpContext';
import { HelpBadge } from '../helpBadge';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { Ico, type IconName } from '../kit';
import { C, onColor, radius, space, target, TINT, type as T } from '../theme';

/** "Next: Luke 15:1–7": this person's next passage, one tap from the map (demo Map). */
export function NextLink(props: { title: string; icon: IconName; onPress: () => void }) {
  const label = t('map.parts.next', { title: props.title });
  const spot = useHelpSpot(label, t('map.parts.nextHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.next, pressed && styles.pressed]}>
      <View style={styles.nextDisc}><Ico name={props.icon} size={22} color={C.white} /></View>
      <Text style={styles.nextText} numberOfLines={2}>{label}</Text>
      <Ico name="right" size={22} color={C.muted} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** Two (or more) pills sharing the width, one lit: New Testament, Old Testament. */
export function Pills<K extends string>(props: { items: { id: K; label: string }[]; on: K; onPick: (id: K) => void }) {
  return (
    <View style={styles.pills}>
      {props.items.map((it) => <Pill key={it.id} label={it.label} on={it.id === props.on} onPress={() => props.onPick(it.id)} />)}
    </View>
  );
}

function Pill(props: { label: string; on: boolean; onPress: () => void }) {
  const spot = useHelpSpot(props.label, t('map.parts.pillHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityState={{ selected: props.on }}
      style={({ pressed }) => [styles.pill, props.on && styles.pillOn, pressed && styles.pressed]}>
      <Text style={[styles.pillText, props.on && { color: C.white }]} numberOfLines={1}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/**
 * One book: its name, a bar, and "25/97" (demo Map). A book nobody started
 * shows an empty bar and no count. Done passages lead the bar in green.
 */
export function BookBar(props: {
  name: string; total: number; recorded: number; done: number; count?: string;
  last: boolean; current?: boolean; accessibilityLabel: string; onPress: () => void;
  /** Not broken up yet (decision 74): said in place of the bar. */
  waiting?: boolean;
}) {
  const spot = useHelpSpot(props.name, props.waiting ? t('map.parts.waitingHelp') : t('map.parts.bookHelp'), props.onPress);
  if (props.waiting) {
    return (
      <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel}
        style={({ pressed }) => [styles.book, !props.last && styles.bookBorder, pressed && styles.pressed]}>
        <Text style={styles.bookName} numberOfLines={2}>{props.name}</Text>
        <Text style={[styles.waiting]} numberOfLines={1}>{t('map.waiting')}</Text>
        <HelpBadge spot={spot} />
      </Pressable>
    );
  }
  const pct = (n: number) => `${props.total ? Math.min(100, (n / props.total) * 100) : 0}%` as const;
  const count = props.count ?? (props.recorded > 0 ? t('map.parts.bookCount', { recorded: formatNumber(props.recorded), total: formatNumber(props.total) }) : '');
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel}
      accessibilityState={props.current ? { selected: true } : undefined}
      style={({ pressed }) => [styles.book, !props.last && styles.bookBorder, props.current && { backgroundColor: C.light }, pressed && styles.pressed]}>
      <Text style={styles.bookName} numberOfLines={2}>{props.name}</Text>
      <View style={styles.track}>
        <View style={{ width: pct(props.done), backgroundColor: C.green }} />
        <View style={{ width: pct(props.recorded - props.done), backgroundColor: C.primary }} />
      </View>
      <Text style={styles.bookCount} numberOfLines={1}>{count}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** How a chapter tile looks in each of its three states (and "no passage", rare). */
const STAGE: Record<ChapterStage, { bg: string; fg: string; border: string }> = {
  done: { bg: TINT.green, fg: TINT.greenText, border: TINT.green },
  started: { bg: C.light, fg: C.primary, border: C.light },
  new: { bg: C.card, fg: C.muted, border: C.border },
  none: { bg: TINT.gray, fg: C.faint, border: TINT.gray }
};

/** A chapter: done (green, ✓), started (brand, •), not started (white). Marked as well as coloured. */
export function ChapterTileView(props: {
  n: number; stage: ChapterStage; dim: boolean; current: boolean; disabled: boolean; label: string; corner?: ReactNode; onPress: () => void;
}) {
  const look = STAGE[props.stage];
  const spot = useHelpSpot(t('map.parts.chapter', { n: formatNumber(props.n) }), t('map.parts.chapterHelp'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={props.label}
      accessibilityState={{ disabled: props.disabled, selected: props.current }}
      style={({ pressed }) => [styles.tile, { backgroundColor: look.bg, borderColor: look.border, opacity: props.dim ? 0.28 : 1 },
        props.current && { borderColor: C.primary, borderWidth: 3 }, pressed && { transform: [{ scale: 0.95 }] }]}>
      <Text style={[styles.tileNumber, { color: look.fg }]}>{formatNumber(props.n)}</Text>
      {props.stage === 'done' ? <Ico name="check" size={16} color={onColor.green} strokeWidth={3} />
        : props.stage === 'started' ? <View style={styles.tileDot} />
        : <View style={{ height: 16 }} />}
      {props.corner}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** The short key under a book's chapters: "✓ Done • Started", and the offline mark when any chapter shows it. */
export function ShortKey(props: { offline?: boolean }) {
  return (
    <View style={styles.key} accessible accessibilityLabel={props.offline ? t('map.parts.keyLabelOffline') : t('map.parts.keyLabel')}>
      <View style={styles.keyItem}><Ico name="check" size={16} color={onColor.green} strokeWidth={3} /><Text style={styles.keyText}>{t('map.key.done')}</Text></View>
      <View style={styles.keyItem}><View style={styles.tileDot} /><Text style={styles.keyText}>{t('map.key.started')}</Text></View>
      {props.offline ? <View style={styles.keyItem}><Ico name="onPhone" size={16} color={onColor.green} /><Text style={styles.keyText}>{t('map.key.onDevice')}</Text></View> : null}
    </View>
  );
}

/** One line of the full key: a small tile in that state, and what it means. */
function KeyLine(props: { stage: ChapterStage; label: string; sub?: string }) {
  const look = STAGE[props.stage];
  return (
    <View style={styles.keyLine}>
      <View style={[styles.keyTile, { backgroundColor: look.bg, borderColor: look.border }]}>
        {props.stage === 'done' ? <Ico name="check" size={12} color={onColor.green} strokeWidth={3} />
          : props.stage === 'started' ? <View style={[styles.tileDot, { width: 6, height: 6, marginVertical: 0 }]} /> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.keyLabel}>{props.label}</Text>
        {props.sub ? <Text style={styles.keyText}>{props.sub}</Text> : null}
      </View>
    </View>
  );
}

/** The full key, one tap deeper under Filter: the three states, what "started" covers, and the mark for kept chapters. */
export function FullKey(props: { none: boolean }) {
  return (
    <View style={{ gap: space.sm }}>
      <KeyLine stage="done" label={t('map.key.done')} sub={t('map.key.doneSub')} />
      <KeyLine stage="started" label={t('map.key.started')} sub={t('map.key.startedSub')} />
      <KeyLine stage="new" label={t('map.key.notStarted')} sub={t('map.key.notStartedSub')} />
      {props.none ? <KeyLine stage="none" label={t('map.key.noPassage')} sub={t('map.key.noPassageSub')} /> : null}
      <View style={styles.keyLine}>
        <View style={[styles.keyTile, { borderColor: 'transparent' }]}><Ico name="onPhone" size={18} color={onColor.green} /></View>
        <Text style={[styles.keyLabel, { flex: 1 }]}>{t('map.key.kept')}</Text>
      </View>
    </View>
  );
}

/** A quiet link with an icon (Filter, Edit passages): the less likely way on, 48pt. */
export function QuietIconLink(props: { icon: IconName; label: string; onPress: () => void; detail?: string; color?: string }) {
  const spot = useHelpSpot(props.label, props.detail, props.onPress);
  const color = props.color ?? C.muted;
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={props.label}
      style={({ pressed }) => [styles.quiet, pressed && styles.pressed]}>
      <Ico name={props.icon} size={18} color={color} />
      <Text style={[styles.quietText, { color }]} numberOfLines={1}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  waiting: { flex: 1, color: TINT.amberText, fontWeight: '700', fontSize: 14, textAlign: 'right' },
  pressed: { opacity: 0.7 },
  next: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, paddingHorizontal: space.md, paddingVertical: space.md,
    borderRadius: radius.xl, borderWidth: 2, borderColor: C.primary, backgroundColor: C.card },
  nextDisc: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  nextText: { flex: 1, minWidth: 0, fontSize: T.base, fontWeight: '800', color: C.dark },
  pills: { flexDirection: 'row', gap: space.sm },
  pill: { flex: 1, minHeight: target.min, borderRadius: radius.full, borderWidth: 1, borderColor: C.border, backgroundColor: C.card,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  pillOn: { backgroundColor: C.primary, borderColor: C.primary },
  pillText: { fontSize: T.sm, fontWeight: '700', color: C.dark },
  book: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 60, paddingHorizontal: space.lg, paddingVertical: space.sm, backgroundColor: C.card },
  bookBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  bookName: { width: 120, fontSize: T.base, fontWeight: '700', color: C.dark },
  track: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row', backgroundColor: C.light },
  bookCount: { width: 64, textAlign: 'right', fontSize: T.sm, color: C.muted, fontVariant: ['tabular-nums'] },
  tile: { flex: 1, height: 60, borderRadius: radius.lg, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', gap: 2 },
  tileNumber: { fontSize: T.lg, fontWeight: '800' },
  tileDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary, marginVertical: 4 },
  key: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  keyItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  keyText: { fontSize: T.sm, color: C.muted },
  keyLine: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  keyTile: { width: 28, height: 28, borderRadius: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  keyLabel: { fontSize: T.sm, fontWeight: '700', color: C.dark },
  quiet: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: target.min, paddingHorizontal: space.sm },
  quietText: { fontSize: T.sm, fontWeight: '700' }
});
