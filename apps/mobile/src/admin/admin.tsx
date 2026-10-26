// The admin's simple building blocks (decision 71, demo ADR-039; the
// prototype's simple/admin.tsx and simple/onboarding.tsx): a big title for a
// language's page, the four-question checklist, big radio cards with
// examples under them, numbered steps, radio rows, a checkbox row with a
// play button, a lock toggle, and the invite code. Built from kit
// primitives and theme tokens; every pressable goes through `useHelpSpot`
// so help mode explains it instead of pressing it.
import { FileText, Play, Route } from '../ui/icons';
import { useContext, useEffect, type ReactNode } from 'react';
import { AccessibilityInfo, ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import QRCode from 'react-native-qrcode-svg';
import { useHelpMode, useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge, HelpLit } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { HelpInfo, Ico, type IconName } from '../ui/kit';
import { HeaderExtraContext } from '../ui/headerExtra';
import { useLayout, useOpenDetail } from '../ui/useLayout';
import { txt } from '../ui/textStyles';
import { shadow } from '../ui/shadow';
import { C, measure, radius, space, target, TINT, type as T } from '../ui/theme';
import type { InviteState } from './useGroupInvite';

// ---- icons ----------------------------------------------------------------------------

/** The kit's icons, plus the two the admin pages draw that the kit does not have. */
export type AdminIcon = IconName | 'file' | 'route' | 'playSolid';

export function Glyph(props: { name: AdminIcon; size?: number; color?: string; strokeWidth?: number }) {
  const size = props.size ?? 22;
  const color = props.color ?? C.primary;
  const strokeWidth = props.strokeWidth ?? 2.2;
  if (props.name === 'file') return <FileText size={size} color={color} strokeWidth={strokeWidth} />;
  if (props.name === 'route') return <Route size={size} color={color} strokeWidth={strokeWidth} />;
  if (props.name === 'playSolid') return <Play size={size} color={color} fill={color} strokeWidth={strokeWidth} />;
  return <Ico name={props.name} size={size} color={color} strokeWidth={strokeWidth} />;
}

/** An icon on a soft tile, as rows and cards lead with. */
export function IconTile(props: { icon: AdminIcon; size?: number; bg?: string; color?: string }) {
  const size = props.size ?? 44;
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size >= 44 ? 14 : 12 }, props.bg ? { backgroundColor: props.bg } : null]}>
      <Glyph name={props.icon} size={Math.round(size * 0.5)} color={props.color ?? C.primary} />
    </View>
  );
}

// ---- the top of a language's page --------------------------------------------------------

/** The round ? (help mode), as the kit's header draws it. */
export function HelpButton() {
  const help = useHelpMode();
  if (!help) return <View style={{ width: target.min }} />;
  return (
    <Pressable testID="header-help" onPress={() => help.setOn(!help.on)} accessibilityRole="button" accessibilityLabel={help.on ? t('admin.help.turnOff') : t('admin.help.turnOn')}
      accessibilityState={{ selected: help.on }}
      style={({ pressed }) => [styles.round, help.on && { backgroundColor: C.primary, borderColor: C.primary }, pressed && styles.pressed]}>
      <Ico name="help" size={24} color={help.on ? C.white : C.primary} />
      <HelpLit />
    </Pressable>
  );
}

/**
 * A page led by a big title (a language's page, Get ready): Back and ? as
 * round buttons above it when it was opened from somewhere, only ? at a
 * tab's root. While help is on, the ? is filled and stays lit, as in the
 * kit's header.
 */
export function BigTop(props: {
  onBack?: () => void; over?: string; title: string; status?: string; statusTone?: 'green' | 'amber' | 'muted';
  /** A pencil beside the title that opens its rename: the name is changed where it is shown. */
  rename?: { label: string; help: string; onPress: () => void };
  /** Under the title, before the status: what it belongs to, such as its clusters. */
  below?: ReactNode;
  /** Where Back would be on a tab's root: the page above it (a language lead's language, up to the organization). */
  up?: { label: string; help: string; onPress: () => void };
}) {
  const tone = props.statusTone === 'green' ? TINT.greenText : props.statusTone === 'amber' ? TINT.amberText : C.muted;
  const back = useHelpSpot(t('common.back'), t('help.details.back'), props.onBack);
  const pencil = useHelpSpot(props.rename?.label ?? '', props.rename?.help ?? '', props.rename?.onPress);
  const up = useHelpSpot(props.up?.label ?? '', props.up?.help ?? '', props.up?.onPress);
  // What the app shows in every header, such as a Global Viewer's link (ui/headerExtra.ts).
  const extra = useContext(HeaderExtraContext);
  // In a split, once: beside an open screen, a list pane leaves the ? to that screen's header.
  const layout = useLayout();
  const openBeside = useOpenDetail();
  // On a wide window, the same white bar and centred column as every other header beside it (kit Header).
  const wide = layout.kind !== 'phone';
  return (
    <View style={wide ? styles.bigTopBarWide : null}>
    <View style={[styles.bigTop, wide && styles.bigTopWide]}>
      <View style={styles.bigTopBar}>
        {props.onBack ? (
          <Pressable testID="header-back" onPress={back.onPress} accessibilityRole="button" accessibilityLabel={t('common.back')} style={({ pressed }) => [styles.round, pressed && styles.pressed]}>
            <Ico name="arrowL" size={24} color={C.dark} />
            <HelpBadge spot={back} />
          </Pressable>
        ) : props.up ? (
          <Pressable testID="header-up" onPress={up.onPress} accessibilityRole="button" accessibilityLabel={props.up.label}
            style={({ pressed }) => [styles.upLink, pressed && styles.pressed]}>
            <Ico name="arrowL" size={20} color={C.dark} />
            <Text style={styles.upText} numberOfLines={1}>{props.up.label}</Text>
            <HelpBadge spot={up} />
          </Pressable>
        ) : <View />}
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {extra}
          {layout.role === 'list' && openBeside ? null : <HelpButton />}
        </View>
      </View>
      {props.over ? <Text style={styles.over}>{props.over}</Text> : null}
      <View style={styles.bigTitleLine}>
        <Text style={[styles.bigTitle, { flexShrink: 1 }]} accessibilityRole="header">{props.title}</Text>
        {props.rename ? (
          <Pressable testID="title-rename" onPress={pencil.onPress} accessibilityRole="button" accessibilityLabel={props.rename.label} hitSlop={8}
            style={({ pressed }) => [styles.pencil, pressed && styles.pressed]}>
            <Ico name="edit" size={20} color={C.primary} />
            <HelpBadge spot={pencil} />
          </Pressable>
        ) : null}
      </View>
      {props.below}
      {props.status ? <Text style={[styles.status, { color: tone }]}>{props.status}</Text> : null}
    </View>
    </View>
  );
}

/** The one question a step screen asks, big. */
export function Question(props: { children: ReactNode }) {
  return <Text style={styles.question} accessibilityRole="header">{props.children}</Text>;
}

// ---- the checklist ------------------------------------------------------------------------

/** One of the four questions: done (green tick), now (lit, brand border), or later (muted). */
export function ChecklistRow(props: { state: 'done' | 'now' | 'later'; icon: AdminIcon; label: string; sub?: string; onPress?: () => void }) {
  const { state } = props;
  // The tick, the lit border and the muted look each say where the question stands: help says it in words.
  const detail = state === 'done' ? (props.sub ? t('admin.checklist.doneHelp', { answer: props.sub }) : t('admin.checklist.answered'))
    : state === 'now' ? t('admin.checklist.nowHelp') : t('admin.checklist.laterHelp');
  const spot = useHelpSpot(props.label, detail, props.onPress);
  return (
    <Pressable onPress={spot.onPress} disabled={!props.onPress} accessibilityRole="button"
      accessibilityLabel={state === 'done' ? t('admin.checklist.doneLabel', { label: props.label }) : props.label}
      accessibilityState={{ disabled: !props.onPress, selected: state === 'now' }}
      style={({ pressed }) => [styles.checkRow, state === 'now' && styles.checkRowNow, pressed && styles.pressed]}>
      <View style={[styles.checkCircle, state === 'done' ? { backgroundColor: C.green } : state === 'now' ? { backgroundColor: C.primary } : { backgroundColor: C.light }]}>
        {state === 'done' ? <Ico name="check" size={24} color={C.white} strokeWidth={3} />
          : <Glyph name={props.icon} size={22} color={state === 'now' ? C.white : C.muted} />}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.checkLabel, state === 'later' && { color: C.muted }]}>{props.label}</Text>
        {props.sub && state === 'done' ? <Text style={[txt.sm, { color: C.muted }]} numberOfLines={2}>{props.sub}</Text> : null}
      </View>
      {state !== 'later' ? <Ico name="right" size={22} color={C.muted} /> : null}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A quiet centred link with a small icon ("▶ How this works · 0:40"). */
export function QuietLink(props: { icon: AdminIcon; label: string; onPress: () => void; detail?: string }) {
  const spot = useHelpSpot(props.label, props.detail, props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" style={({ pressed }) => [styles.quietLink, pressed && styles.pressed]}>
      <Glyph name={props.icon} size={16} color={C.muted} />
      <Text style={[txt.sm, { color: C.muted, fontWeight: '700', flexShrink: 1 }]}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/**
 * What a job that takes a while is doing, a line a part: done (a tick), now
 * (turning, in dark type), or still to come (a dot). The part now running is
 * read out as it starts.
 */
export function WorkSteps(props: { items: { key: string; label: string; state: 'done' | 'now' | 'later' }[] }) {
  const now = props.items.find((s) => s.state === 'now')?.label;
  useEffect(() => {
    if (now) AccessibilityInfo.announceForAccessibility(now);
  }, [now]);
  return (
    <HelpInfo label={t('admin.work.label')} detail={t('admin.work.help')} style={styles.work}>
      {props.items.map((s) => (
        <View key={s.key} style={styles.workRow}>
          <View style={styles.workMark}>
            {s.state === 'done' ? <Ico name="check" size={20} color={C.green} strokeWidth={3} />
              : s.state === 'now' ? <ActivityIndicator size="small" color={C.muted} />
                : <View style={styles.workDot} />}
          </View>
          <Text style={[styles.workLabel, s.state === 'now' && styles.workNow]}>{s.label}</Text>
        </View>
      ))}
    </HelpInfo>
  );
}

// ---- choices ------------------------------------------------------------------------------

function Radio(props: { on: boolean; size?: number }) {
  const size = props.size ?? 26;
  return (
    <View style={[styles.radio, { width: size, height: size, borderRadius: size / 2 }, props.on && { borderColor: C.primary }]}>
      {props.on ? <View style={{ width: size * 0.46, height: size * 0.46, borderRadius: size, backgroundColor: C.primary }} /> : null}
    </View>
  );
}

/** A big radio card: icon, title, a line under it, and, when given, examples or steps below. */
/** One choice of several. `own` marks making your own: it comes first and looks set apart from the ready-made ones (design principle 12). */
export function ChoiceCard(props: { on: boolean; icon: AdminIcon; title: string; sub?: string; onPress: () => void; children?: ReactNode; chevron?: boolean; own?: boolean;
  /** What help mode says picking it means, where `sub` (its line otherwise) does not say it. */ help?: string }) {
  const spot = useHelpSpot(props.title, props.help ?? props.sub, props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole={props.chevron ? 'button' : 'radio'} accessibilityState={props.chevron ? undefined : { selected: props.on }}
      accessibilityLabel={`${props.title}${props.sub ? `. ${props.sub}` : ''}`}
      style={({ pressed }) => [styles.choice, props.own && styles.choiceOwn, props.on && styles.choiceOn, pressed && styles.pressed]}>
      <View style={styles.choiceHead}>
        <IconTile icon={props.icon} size={40} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.choiceTitle}>{props.title}</Text>
          {props.sub ? <Text style={[txt.xs, { fontSize: 14, color: C.muted, marginTop: 1 }]}>{props.sub}</Text> : null}
        </View>
        {props.chevron ? <Ico name="right" size={22} color={C.muted} /> : <Radio on={props.on} />}
      </View>
      {props.children}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** What a choice would give, a few lines under its title. */
export function Examples(props: { rows: string[] }) {
  if (props.rows.length === 0) return null;
  return (
    <View style={styles.indent}>
      {props.rows.map((r) => <Text key={r} style={styles.example} numberOfLines={1}>{r}</Text>)}
    </View>
  );
}

/** Numbered steps under a choice; a lock marks one that must pass. */
export function NumberedSteps(props: { items: { label: string; lock?: boolean }[] }) {
  return (
    <View style={[styles.indent, { gap: 2 }]}>
      {props.items.map((s, i) => (
        <View key={`${s.label}-${i}`} style={styles.numbered}>
          <View style={styles.num}><Text style={styles.numText}>{formatNumber(i + 1)}</Text></View>
          <Text style={{ fontSize: 14, fontWeight: '600', color: C.dark, flexShrink: 1 }}>{s.label}</Text>
          {s.lock ? <Ico name="lock" size={15} color={C.muted} /> : null}
        </View>
      ))}
    </View>
  );
}

/** A radio row ("Translate"), with the icon on a tile (inviting) or bare (letting someone in). */
export function RadioRow(props: { icon: AdminIcon; label: string; sub?: string; on: boolean; onPress: () => void; tile?: boolean; subLines?: number;
  /** What help mode says picking it means, where `sub` (its line otherwise) does not say it. */ help?: string;
  /** One of several that can be picked together: a tick instead of a dot. */ many?: boolean }) {
  const spot = useHelpSpot(props.label, props.help ?? props.sub, props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole={props.many ? 'checkbox' : 'radio'} accessibilityState={props.many ? { checked: props.on } : { selected: props.on }} aria-checked={props.on} accessibilityLabel={props.label}
      style={({ pressed }) => [styles.radioRow, props.tile && styles.radioRowTall, props.on && styles.choiceOn, pressed && styles.pressed]}>
      {props.tile ? <IconTile icon={props.icon} size={44} /> : <Glyph name={props.icon} size={24} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.radioLabel, props.tile && { fontWeight: '800' }]}>{props.label}</Text>
        {props.sub ? <Text style={[txt.xs]} numberOfLines={props.subLines ?? 2}>{props.sub}</Text> : null}
      </View>
      {props.many ? (
        <View style={[styles.tickBox, props.on && styles.tickBoxOn]}>{props.on ? <Ico name="check" size={18} color={C.white} strokeWidth={3} /> : null}</View>
      ) : <Radio on={props.on} size={26} />}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/**
 * What a language uses now, above the others it could use (decision 138): a
 * lit radio, its name and facts, what it holds, and links into it (its
 * books, its edit). The others are RadioRows under it, and the last row
 * opens the organization's whole shelf.
 */
export function PickCard(props: { title: string; sub?: string; children?: ReactNode; links?: { label: string; help: string; onPress: () => void }[] }) {
  return (
    <View style={[styles.choice, styles.choiceOn]} accessibilityLabel={`${props.title}${props.sub ? `. ${props.sub}` : ''}`}>
      <View style={styles.choiceHead}>
        <Radio on size={26} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.choiceTitle}>{props.title}</Text>
          {props.sub ? <Text style={[txt.xs, { fontSize: 14, color: C.muted, marginTop: 1 }]}>{props.sub}</Text> : null}
        </View>
      </View>
      {props.children}
      {props.links?.length ? (
        <View style={styles.pickLinks}>
          {/* help-each: each link opens a different part of the pick */}
          {props.links.map((l) => <PickLink key={l.label} {...l} />)}
        </View>
      ) : null}
    </View>
  );
}

function PickLink(props: { label: string; help: string; onPress: () => void }) {
  const spot = useHelpSpot(props.label, props.help, props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={props.label} style={({ pressed }) => [styles.pickLink, pressed && styles.pressed]}>
      <Text style={styles.pickLinkText}>{props.label}</Text>
      <Ico name="right" size={16} color={C.primary} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A dashed action ("Add a step", "Something else: make a new role"). */
export function DashedRow(props: { icon: AdminIcon; label: string; onPress: () => void; detail?: string; centred?: boolean }) {
  const spot = useHelpSpot(props.label, props.detail, props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" style={({ pressed }) => [styles.dashed, props.centred && { justifyContent: 'center' }, pressed && styles.pressed]}>
      <Glyph name={props.icon} size={20} />
      <Text style={[txt.body, { color: C.primary, fontWeight: '700', flexShrink: 1 }]}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** Pills that wrap onto more lines (the testament pills, the invite chips). */
export function Pills(props: { children: ReactNode }) {
  return <View style={styles.pills}>{props.children}</View>;
}

/** A pick-many row with a checkbox, and a play button that opens what it is. */
export function CheckRow(props: { label: string; sub?: string; checked: boolean; onToggle: () => void; onPlay?: () => void; playLabel?: string; last?: boolean; disabled?: boolean; detail?: string;
  /** What help mode says the play button does. */ playHelp?: string }) {
  const onToggle = useHelpSpot(props.label, props.detail ?? (props.checked ? t('admin.checkRow.offered') : t('admin.checkRow.notOffered')), props.onToggle);
  const playLabel = props.playLabel ?? t('admin.checkRow.hear', { name: props.label });
  const onPlay = useHelpSpot(playLabel, props.playHelp, props.onPlay);
  return (
    <View style={[styles.checkLine, !props.last && styles.rowBorder]}>
      <Pressable onPress={onToggle.onPress} disabled={props.disabled} accessibilityRole="checkbox" accessibilityState={{ checked: props.checked, disabled: !!props.disabled }}
        // The web reads its state from aria-* (react-native-web ignores accessibilityState there).
        aria-checked={props.checked} aria-disabled={!!props.disabled}
        accessibilityLabel={props.label} style={({ pressed }) => [styles.checkTap, pressed && styles.pressed]}>
        <View style={[styles.box, props.checked && { backgroundColor: C.primary, borderColor: C.primary }]}>
          {props.checked ? <Ico name="check" size={20} color={C.white} strokeWidth={3} /> : null}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.body, { fontWeight: '700' }]} numberOfLines={2}>{props.label}</Text>
          {props.sub ? <Text style={[txt.sm, { color: C.muted }]}>{props.sub}</Text> : null}
        </View>
        <HelpBadge spot={onToggle} />
      </Pressable>
      {props.onPlay ? (
        <Pressable onPress={onPlay.onPress} accessibilityRole="button" accessibilityLabel={playLabel} hitSlop={4}
          style={({ pressed }) => [styles.play, pressed && styles.pressed]}>
          <Ico name="play" size={22} color={C.primary} />
          <HelpBadge spot={onPlay} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** A switch as the design draws it: a brand pill with a white knob, the same on the web as on a device. */
export function Pill(props: { on: boolean; disabled?: boolean }) {
  return (
    <View style={[styles.pill, props.on ? { backgroundColor: C.primary } : { backgroundColor: C.faint }, props.disabled && { opacity: 0.5 }]}>
      <View style={[styles.knob, props.on ? { right: 3 } : { left: 3 }]} />
    </View>
  );
}

/** A row that is one switch: the whole row takes the tap (a 64pt target) and speaks as the switch. */
export function SwitchRow(props: { label: string; sub?: string; on: boolean; onToggle: () => void; disabled?: boolean; last?: boolean; icon?: AdminIcon;
  /** What help mode says it turns on, where on or off alone does not say it. */ help?: string }) {
  const spot = useHelpSpot(props.label, props.help ?? (props.on ? t('admin.switchRow.on') : t('admin.switchRow.off')), props.onToggle);
  return (
    <Pressable onPress={spot.onPress} disabled={props.disabled} accessibilityRole="switch" accessibilityState={{ checked: props.on, disabled: !!props.disabled }}
      // The web reads its state from aria-* (react-native-web ignores accessibilityState there).
      aria-checked={props.on} aria-disabled={!!props.disabled}
      accessibilityLabel={props.label} style={({ pressed }) => [styles.switchRow, !props.last && styles.rowBorder, pressed && styles.pressed]}>
      {props.icon ? <IconTile icon={props.icon} /> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[txt.body, { fontWeight: '700' }]}>{props.label}</Text>
        {props.sub ? <Text style={[txt.sm, { fontSize: 14, color: C.muted }]}>{props.sub}</Text> : null}
      </View>
      <Pill on={props.on} disabled={props.disabled} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A count on a solid amber disc (join requests waiting). */
export function CountBadge(props: { n: number }) {
  return (
    <View style={styles.count} accessibilityLabel={t('admin.waiting', { count: props.n })}>
      <Text style={[txt.xsStrong, { color: C.white }]}>{formatNumber(props.n)}</Text>
    </View>
  );
}

/** Must this step pass before the next ones? A round lock, dashed when not. */
export function LockToggle(props: { on: boolean; onToggle: () => void; label: string; disabled?: boolean }) {
  const spot = useHelpSpot(props.label, props.on ? t('admin.lock.on') : t('admin.lock.off'), props.onToggle);
  return (
    <Pressable onPress={spot.onPress} disabled={props.disabled} accessibilityRole="switch" accessibilityState={{ checked: props.on, disabled: !!props.disabled }}
      accessibilityLabel={props.label} hitSlop={4}
      style={({ pressed }) => [styles.lock, props.on ? styles.lockOn : null, pressed && styles.pressed]}>
      <Ico name="lock" size={20} color={props.on ? TINT.amberText : C.faint} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A note in amber ("We'll offer the World English Bible …"). */
export function AmberNote(props: { icon: AdminIcon; children: ReactNode }) {
  return (
    <View style={styles.note}>
      <Glyph name={props.icon} size={22} color={TINT.amberText} />
      <Text style={[txt.sm, { flex: 1, color: C.dark }]}>{props.children}</Text>
    </View>
  );
}

// ---- the invite code ------------------------------------------------------------------------

/** The code to scan, with what to tell people. */
export function InviteCode(props: { state: InviteState }) {
  const s = props.state;
  return (
    <View style={{ alignItems: 'center', gap: space.md }}>
      <View style={styles.qr}>
        {s && 'uri' in s ? <QRCode value={s.uri} size={196} backgroundColor={C.white} color={C.dark} />
          : <Text style={[txt.smMuted, { textAlign: 'center' }]}>{s && 'error' in s ? t('admin.inviteCode.notMade') : t('admin.inviteCode.making')}</Text>}
      </View>
      <Text style={[txt.body, { fontWeight: '700' }]}>{t('admin.inviteCode.askToScan')}</Text>
      <Text style={[txt.sm, { color: C.muted, textAlign: 'center' }]}>
        {s && 'error' in s ? s.error : t('admin.inviteCode.noPassword')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tickBox: { width: 26, height: 26, borderRadius: radius.sm, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  tickBoxOn: { backgroundColor: C.primary, borderColor: C.primary },
  pressed: { opacity: 0.7 },
  tile: { backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  round: { width: target.min, height: target.min, borderRadius: target.min / 2, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  bigTop: { paddingHorizontal: space.xl - 4, paddingTop: space.md, paddingBottom: space.xs, backgroundColor: C.bg },
  bigTopBarWide: { backgroundColor: C.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  bigTopWide: { width: '100%', maxWidth: measure.column, alignSelf: 'center', backgroundColor: C.card, paddingHorizontal: space.lg, paddingBottom: space.md },
  bigTopBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  over: { fontSize: 14, fontWeight: '700', color: C.muted },
  bigTitle: { fontSize: 28, fontWeight: '800', color: C.dark, marginTop: 2 },
  bigTitleLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pencil: { width: target.min, height: target.min, alignItems: 'center', justifyContent: 'center' },
  upLink: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: target.min, maxWidth: '75%', paddingHorizontal: space.md, borderRadius: target.min / 2,
    backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
  upText: { flexShrink: 1, fontSize: T.sm, fontWeight: '700', color: C.dark },
  status: { fontSize: T.sm, fontWeight: '700', marginTop: 2 },
  work: { gap: space.md, paddingTop: space.sm, paddingHorizontal: space.xs },
  workRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 32 },
  workMark: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  workDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.faint },
  workLabel: { flex: 1, minWidth: 0, fontSize: T.base, fontWeight: '600', color: C.muted },
  workNow: { color: C.dark, fontWeight: '800' },
  question: { fontSize: 24, fontWeight: '800', color: C.dark, lineHeight: 31, paddingHorizontal: space.xs },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 74, paddingLeft: 14, paddingRight: 10, paddingVertical: 10, borderRadius: radius.xl, borderWidth: 2, borderColor: C.border, backgroundColor: C.card },
  checkRowNow: { borderColor: C.primary },
  checkCircle: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  checkLabel: { fontSize: T.base, fontWeight: '800', color: C.dark },
  quietLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: target.min, alignSelf: 'center', paddingHorizontal: space.md },
  radio: { borderWidth: 2, borderColor: C.faint, alignItems: 'center', justifyContent: 'center' },
  choice: { padding: 14, borderRadius: radius.xl, backgroundColor: C.card, borderWidth: 2, borderColor: C.border, gap: 10 },
  choiceOn: { borderColor: C.primary },
  pickLinks: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pickLink: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: target.min, paddingHorizontal: space.md, borderRadius: radius.full, backgroundColor: C.light },
  pickLinkText: { fontSize: T.sm, fontWeight: '700', color: C.primary },
  choiceOwn: { borderStyle: 'dashed', borderColor: C.primary, backgroundColor: C.light },
  choiceHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  choiceTitle: { fontSize: T.base, fontWeight: '800', color: C.dark, lineHeight: 25 },
  indent: { paddingLeft: 52, gap: 6 },
  example: { fontSize: T.xs, color: C.muted, paddingHorizontal: space.sm, paddingVertical: 5, borderRadius: radius.sm, backgroundColor: C.bg, overflow: 'hidden' },
  numbered: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 30 },
  num: { width: 22, height: 22, borderRadius: 11, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  numText: { fontSize: 12, fontWeight: '800', color: C.primary },
  radioRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingHorizontal: 16, paddingVertical: space.sm, borderRadius: radius.lg, backgroundColor: C.card, borderWidth: 2, borderColor: C.border },
  radioRowTall: { minHeight: 66, borderRadius: radius.xl, paddingHorizontal: 16 },
  radioLabel: { fontSize: T.base, fontWeight: '700', color: C.dark },
  dashed: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.primary, paddingHorizontal: 16, borderRadius: radius.lg, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.faint },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  checkLine: { flexDirection: 'row', alignItems: 'center', minHeight: target.row, paddingRight: space.sm, backgroundColor: C.card },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  checkTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, paddingLeft: space.lg, paddingVertical: space.sm },
  box: { width: 28, height: 28, borderRadius: 8, borderWidth: 2, borderColor: C.faint, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  play: { width: target.min, height: target.min, alignItems: 'center', justifyContent: 'center' },
  pill: { width: 50, height: 30, borderRadius: 15, justifyContent: 'center' },
  knob: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: C.white },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: C.card },
  count: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, backgroundColor: TINT.amberText, alignItems: 'center', justifyContent: 'center' },
  lock: { width: 40, height: 40, borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.faint, alignItems: 'center', justifyContent: 'center' },
  lockOn: { borderWidth: 0, backgroundColor: TINT.amber },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: TINT.amber },
  qr: { width: 232, height: 232, borderRadius: 24, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center', padding: space.lg, ...shadow }
});
