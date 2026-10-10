// Building blocks of the simple recording and study screens (decision 71;
// demo simple/translator.tsx Chips, StepBar, MiniAudio, Callout, Dock,
// SegCard, RecordButton). Every pressable goes through the kit or
// `useHelpPress`, so help mode explains it instead of pressing it.
import { useEffect, useRef, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import { useHelpPress } from '../helpContext';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { Ico, Sheet, txt, type IconName } from '../kit';
import { lift } from '../shadow';
import { C, radius, space, target, TINT, type as T, withAlpha } from '../theme';
import { mmss } from './model';

// ---- the chips of what is attached ---------------------------------------------------

export interface ChipItem<T extends string> {
  id: T;
  label: string;
  icon: IconName;
  count?: number;
  hint?: string;
}

/** One row of chips, scrolling sideways, the open one filled; it keeps the open one in view. */
export function RefChips<T extends string>(props: { items: ChipItem<T>[]; value: T; onChange: (id: T) => void }) {
  const scroll = useRef<ScrollView>(null);
  const xs = useRef<Partial<Record<T, number>>>({});
  useEffect(() => {
    const x = xs.current[props.value];
    if (x !== undefined) scroll.current?.scrollTo({ x: Math.max(0, x - space.lg), animated: true });
  }, [props.value]);
  if (props.items.length < 2) return null;
  return (
    <ScrollView ref={scroll} horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chips} accessibilityRole="tablist">
      {props.items.map((it) => (
        <View key={it.id} onLayout={(e) => {
          const x = e.nativeEvent.layout.x;
          xs.current[it.id] = x;
          if (it.id === props.value && x > space.lg) scroll.current?.scrollTo({ x: x - space.lg, animated: false });
        }}>
          <RefChip item={it} on={it.id === props.value} onPress={() => props.onChange(it.id)} />
        </View>
      ))}
    </ScrollView>
  );
}

function RefChip<T extends string>(props: { item: ChipItem<T>; on: boolean; onPress: () => void }) {
  const it = props.item;
  const label = it.count ? t('recording.parts.chipCount', { label: it.label, n: formatNumber(it.count) }) : it.label;
  const onPress = useHelpPress(label, it.hint, props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: props.on }} accessibilityLabel={label}
      style={({ pressed }) => [styles.chip, props.on && styles.chipOn, pressed && styles.pressed]}>
      <Ico name={it.icon} size={18} color={props.on ? C.white : C.dark} />
      <Text style={[styles.chipLabel, props.on && { color: C.white }]}>{label}</Text>
    </Pressable>
  );
}

// ---- round buttons ----------------------------------------------------------------------

/** A round button with an icon (and a word under it when given), 48pt. */
export function RoundBtn(props: {
  icon: IconName; label: string; hint?: string; onPress: () => void; disabled?: boolean; word?: string;
  tone?: 'plain' | 'brand' | 'amber' | 'white'; size?: number;
}) {
  const size = props.size ?? target.min;
  const onPress = useHelpPress(props.label, props.hint, props.onPress);
  const brand = props.tone === 'brand';
  const fg = brand ? C.white : props.tone === 'amber' ? TINT.amberText : C.dark;
  return (
    <Pressable onPress={onPress} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!props.disabled }}
      style={({ pressed }) => [styles.round, { width: size, height: size, borderRadius: size / 2 },
        brand ? { backgroundColor: C.primary, borderColor: C.primary } : props.tone === 'white' ? { borderColor: C.card } : null,
        props.disabled && styles.off, pressed && styles.pressed]}>
      <Ico name={props.icon} size={props.word ? 16 : 20} color={fg} strokeWidth={2.4} />
      {props.word ? <Text style={[styles.roundWord, { color: fg }]}>{props.word}</Text> : null}
    </Pressable>
  );
}

/** Back 10 seconds: the circular arrow with "10" under it. */
export function Back10(props: { onPress: () => void; disabled?: boolean; tone?: 'plain' | 'white' }) {
  return <RoundBtn icon="restart" word={formatNumber(10)} label={t('common.backTenSeconds')} hint={t('recording.player.back10Help')} onPress={props.onPress} disabled={props.disabled} tone={props.tone ?? 'plain'} />;
}

/** The big round play button of a small player. */
export function PlayBtn(props: { playing: boolean; available: boolean; label: string; onPress: () => void; size?: number; disabled?: boolean; none?: boolean }) {
  const size = props.size ?? target.min;
  const onPress = useHelpPress(props.playing ? t('common.pause') : props.label, t('recording.player.playHelp'), props.onPress);
  const off = !props.available || props.disabled;
  return (
    <Pressable onPress={onPress} disabled={off} accessibilityRole="button"
      accessibilityLabel={props.none ? t('recording.player.noAudio') : !props.available ? t('recording.player.notOnDevice') : props.playing ? t('common.pause') : props.label}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: off ? C.faint : C.primary, alignItems: 'center', justifyContent: 'center' },
        pressed && styles.pressed]}>
      <Ico name={props.none ? 'play' : !props.available ? 'download' : props.playing ? 'pause' : 'play'} size={Math.round(size * 0.38)} color={C.white} strokeWidth={2.4} fill={props.available || props.none ? C.white : undefined} />
    </Pressable>
  );
}

/**
 * The small player (demo MiniAudio): play, a title and a line under it,
 * Back 10 seconds, and Note when a note can be left at this moment.
 */
export function MiniPlayer(props: {
  title: string; sub?: string; playing: boolean; available: boolean; onToggle: () => void; onBack10: () => void; backDisabled?: boolean;
  onNote?: () => void; right?: ReactNode; style?: object; bare?: boolean; error?: string; none?: boolean;
  /** In place of the line under the title: a picker beside the time, when there is a choice to make. */
  under?: ReactNode;
}) {
  return (
    <View style={[!props.bare && styles.mini, props.style]}>
      <View style={styles.miniRow}>
        <PlayBtn playing={props.playing} available={props.available} label={t('recording.player.playTitle', { title: props.title })} onPress={props.onToggle} {...(props.none ? { none: true } : {})} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.miniTitle} numberOfLines={1}>{props.title}</Text>
          {props.under ?? (props.sub ? <Text style={txt.smMuted} numberOfLines={2}>{props.sub}</Text> : null)}
        </View>
        {props.right}
        <Back10 onPress={props.onBack10} disabled={props.backDisabled ?? !props.available} />
        {props.onNote ? <RoundBtn icon="chat" label={t('recording.player.addNoteHere')} hint={t('recording.player.noteHelp')} tone="amber" onPress={props.onNote} /> : null}
      </View>
      {props.error ? <Text accessibilityRole="alert" style={txt.error}>{props.error}</Text> : null}
    </View>
  );
}

/** The passage docked at the bottom of the study (demo Dock). */
export function Dock(props: { title: string; sub: string; playing: boolean; available: boolean; onToggle: () => void; onBack10: () => void; backDisabled?: boolean; none?: boolean }) {
  return (
    <View style={styles.dock}>
      <PlayBtn playing={props.playing} available={props.available} label={t('recording.player.playTitle', { title: props.title })} onPress={props.onToggle} {...(props.none ? { none: true } : {})} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.miniTitle} numberOfLines={1}>{props.title}</Text>
        <Text style={txt.smMuted} numberOfLines={1}>{props.sub}</Text>
      </View>
      <Back10 onPress={props.onBack10} disabled={props.backDisabled} tone="white" />
    </View>
  );
}

// ---- rows and buttons --------------------------------------------------------------------

/** A row in a card with a pale play tile at the left (Earlier): the tile plays, the row says what it is. */
export function PlayRow(props: { title: string; sub: string; playing: boolean; available: boolean; onToggle: () => void; last?: boolean; error?: string }) {
  const onPress = useHelpPress(props.playing ? t('common.pause') : t('recording.player.playTitle', { title: props.title }), props.sub, props.onToggle);
  return (
    <Pressable onPress={onPress} disabled={!props.available} accessibilityRole="button"
      accessibilityLabel={props.available
        ? t(props.playing ? 'recording.player.pauseRow' : 'recording.player.playRow', { title: props.title, sub: props.sub })
        : t('recording.player.rowNotOnDevice', { title: props.title })}
      style={({ pressed }) => [styles.playRow, !props.last && styles.rowBorder, pressed && styles.pressed]}>
      <View style={styles.playTile}>
        <Ico name={!props.available ? 'download' : props.playing ? 'pause' : 'play'} size={22} color={props.available ? C.primary : C.faint} strokeWidth={2.4} fill={props.available ? C.primary : undefined} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.rowTitle} numberOfLines={2}>{props.title}</Text>
        <Text style={txt.smMuted} numberOfLines={2}>{props.sub}</Text>
        {props.error ? <Text style={txt.error}>{props.error}</Text> : null}
      </View>
    </Pressable>
  );
}

/** A dashed button for adding something ("+ Add a note"). */
export function DashedBtn(props: { label: string; icon?: IconName; onPress: () => void; hint?: string; disabled?: boolean; style?: object }) {
  const onPress = useHelpPress(props.label, props.hint, props.onPress);
  return (
    <Pressable onPress={onPress} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={props.label}
      style={({ pressed }) => [styles.dashed, props.disabled && styles.off, props.style, pressed && styles.pressed]}>
      <Ico name={props.icon ?? 'plus'} size={20} color={C.primary} />
      <Text style={[styles.dashedLabel]}>{props.label}</Text>
    </Pressable>
  );
}

/** A quiet link with an icon, centred, 48pt. */
export function QuietLink(props: { label: string; icon?: IconName; onPress: () => void; hint?: string }) {
  const onPress = useHelpPress(props.label, props.hint, props.onPress);
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.quiet, pressed && styles.pressed]}>
      {props.icon ? <Ico name={props.icon} size={18} color={C.muted} /> : null}
      <Text style={[txt.sm, { color: C.muted, fontWeight: '700', textAlign: 'center', flexShrink: 1 }]}>{props.label}</Text>
    </Pressable>
  );
}

// ---- callouts ----------------------------------------------------------------------------

type CalloutTone = 'amber' | 'brand' | 'green' | 'gray';
const CALLOUT_TONE: Record<CalloutTone, { bg: string; ink: string }> = {
  amber: { bg: TINT.amber, ink: TINT.amberText },
  brand: { bg: C.light, ink: C.primary },
  green: { bg: TINT.green, ink: TINT.greenText },
  gray: { bg: TINT.gray, ink: TINT.grayText }
};

/** A box in the step's text ("Stop here." on amber): an icon, the word in bold, then the text. */
export function Callout(props: { icon: IconName; label: string; tone: CalloutTone; children: ReactNode }) {
  const tone = CALLOUT_TONE[props.tone];
  return (
    <View style={[styles.callout, { backgroundColor: tone.bg }]}>
      <Ico name={props.icon} size={22} color={tone.ink} />
      <Text style={[styles.reading, { flex: 1 }]}>
        <Text style={{ fontWeight: '800' }}>{t('recording.parts.calloutLabel', { label: props.label })} </Text>{props.children}
      </Text>
    </View>
  );
}

// ---- steps ---------------------------------------------------------------------------------

/** ‹ "2/6 Setting the stage ▾" ›: the step bar of a guide with steps (demo StepBar). */
export function StepNav(props: { index: number; count: number; title: string; onPrev: () => void; onNext: () => void; onList: () => void }) {
  const list = useHelpPress(t('recording.steps.all'), t('recording.steps.allHelp'), props.onList);
  const first = props.index <= 0;
  const last = props.index >= props.count - 1;
  return (
    <View style={styles.stepNav}>
      <RoundBtn icon="arrowL" label={t('recording.steps.previous')} onPress={props.onPrev} disabled={first} />
      <Pressable onPress={list} accessibilityRole="button" accessibilityLabel={t('recording.steps.navLabel', { n: formatNumber(props.index + 1), total: formatNumber(props.count), title: props.title })}
        style={({ pressed }) => [styles.stepBox, pressed && styles.pressed]}>
        <Text style={styles.stepCount}>{t('recording.steps.count', { n: formatNumber(props.index + 1), total: formatNumber(props.count) })}</Text>
        <Text style={styles.stepTitle} numberOfLines={1}>{props.title}</Text>
        <Ico name="down" size={20} color={C.muted} />
      </Pressable>
      <RoundBtn icon="right" label={t('recording.steps.next')} onPress={props.onNext} disabled={last} tone="brand" />
    </View>
  );
}

export interface StepListItem { title: string; phase?: string; done: boolean }

/** Every step, grouped by its part of the method, with done marks; a tap opens one (demo StudySteps). */
export function StepsSheet(props: { title: string; sub?: string; steps: StepListItem[]; current: number; onPick: (i: number) => void; onClose: () => void; children?: ReactNode }) {
  const groups: { phase: string; items: { s: StepListItem; i: number }[] }[] = [];
  props.steps.forEach((s, i) => {
    const phase = s.phase ?? '';
    const last = groups[groups.length - 1];
    if (last && last.phase === phase) last.items.push({ s, i });
    else groups.push({ phase, items: [{ s, i }] });
  });
  return (
    <Sheet visible title={props.title} {...(props.sub ? { sub: props.sub } : {})} onClose={props.onClose}>
      {groups.map((g, gi) => (
        <View key={`${g.phase}-${gi}`} style={{ gap: 2 }}>
          {g.phase ? <Text style={[txt.label, { paddingHorizontal: space.xs, paddingBottom: space.xs }]}>{g.phase}</Text> : null}
          {g.items.map(({ s, i }) => <StepRow key={i} n={i + 1} title={s.title} state={s.done ? 'done' : i === props.current ? 'now' : 'later'} onPress={() => props.onPick(i)} />)}
        </View>
      ))}
      {props.children}
    </Sheet>
  );
}

function StepRow(props: { n: number; title: string; state: 'done' | 'now' | 'later'; onPress: () => void }) {
  const onPress = useHelpPress(props.title, t('recording.steps.openHelp'), props.onPress);
  const now = props.state === 'now';
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: now }}
      accessibilityLabel={t(props.state === 'done' ? 'recording.steps.rowDone' : now ? 'recording.steps.rowNow' : 'recording.steps.row', { n: formatNumber(props.n), title: props.title })}
      style={({ pressed }) => [styles.stepRow, now && { backgroundColor: C.light }, pressed && styles.pressed]}>
      <View style={[styles.stepMark, props.state === 'done' ? { backgroundColor: C.green, borderColor: C.green } : now ? { backgroundColor: C.primary, borderColor: C.primary } : null]}>
        {props.state === 'done' ? <Ico name="check" size={16} color={C.white} strokeWidth={3} />
          : <Text style={[txt.xsStrong, { color: now ? C.white : C.muted, fontWeight: '800' }]}>{formatNumber(props.n)}</Text>}
      </View>
      <Text style={[txt.body, { flex: 1, fontWeight: now ? '800' : '600' }]}>{props.title}</Text>
    </Pressable>
  );
}

// ---- the recorder ---------------------------------------------------------------------------

/** The big red record button with its pale halo (ADR-028): a stop square while recording. */
export function RecordBtn(props: { size?: number; recording: boolean; onPress: () => void; disabled?: boolean }) {
  const size = props.size ?? 72;
  const halo = Math.round(size * 0.14);
  const onPress = useHelpPress(props.recording ? t('common.stopRecording') : t('common.record'),
    props.recording ? t('recording.recordButton.stopHelp') : t('recording.recordButton.recordHelp'), props.onPress);
  const off = props.disabled && !props.recording;
  return (
    <View style={{ padding: halo, borderRadius: (size + halo * 2) / 2, backgroundColor: withAlpha(C.red, off ? 0.06 : 0.14) }}>
      <Pressable onPress={onPress} disabled={off} accessibilityRole="button" accessibilityLabel={props.recording ? t('common.stopRecording') : t('common.record')}
        accessibilityState={{ disabled: !!off }}
        style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
          off && { opacity: 0.45 }, !off && lift({ color: C.red, opacity: 0.3, radius: 10, y: 4, elevation: 3 }), pressed && { transform: [{ scale: 0.95 }] }]}>
        {props.recording
          ? <View style={{ width: size * 0.3, height: size * 0.3, borderRadius: size * 0.06, backgroundColor: C.white }} />
          : <Ico name="mic" size={Math.round(size * 0.42)} color={C.white} />}
      </Pressable>
    </View>
  );
}

/** A part card's round mark: a green check when recorded, the brand mic when next, red while recording. */
export function PartMark(props: { state: 'done' | 'next' | 'recording' }) {
  const bg = props.state === 'done' ? C.green : props.state === 'recording' ? C.red : C.primary;
  return (
    <View style={[styles.partMark, { backgroundColor: bg }]}>
      {props.state === 'done' ? <Ico name="check" size={18} color={C.white} strokeWidth={3} /> : <Ico name="mic" size={16} color={C.white} />}
    </View>
  );
}

export { mmss };

export const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  off: { opacity: 0.4 },
  chipScroll: { flexGrow: 0, flexShrink: 0 },
  chips: { gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.xs, paddingBottom: space.sm + 2 },
  chip: { minHeight: target.min, borderRadius: radius.full, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg },
  chipOn: { backgroundColor: C.primary, borderColor: C.primary },
  chipLabel: { fontSize: T.base, fontWeight: '700', color: C.dark },
  round: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  roundWord: { fontSize: 11, fontWeight: '800', marginTop: -1 },
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
