// The UX demo's UI primitives (ng-langquest-ux src/ui.tsx and the shared
// widgets in screens/shared.tsx), in React Native. Every screen builds on
// these so the app reads as one product: a white header with the passage
// named above the title, cards on a lavender ground, one main button per
// screen, details behind one-line summaries (ADR-013), status in fixed
// colours with an icon (ADR-010), and field-sized targets (ADR-008).
import type { LucideIcon } from 'lucide-react-native';
import {
  ArrowLeftRight, ArrowRight, BookOpen, Briefcase, Building2, Camera, ChartColumn, Check, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp, CircleHelp, ClipboardList, Clock, Cloud, Download, Filter, Flag, Folder, Globe, History,
  House, Image, Inbox, LayoutTemplate, Link, Lock, Map as MapIcon, MapPin, MessageCircle, MessageSquareText, Mic, Pause, Pencil,
  Play, Plus, QrCode, RotateCcw, Scissors, Search, Settings, Share2, SkipForward, Sparkles, Square, Star, StickyNote,
  ThumbsUp, Trash2, Undo2, User, Users, Video, Volume2, Workflow, X, Bell, Headphones, Layers
} from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
  type StyleProp, type TextStyle, type ViewStyle
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { KindState } from '@langquest-next/core';
import { C, onColor, radius, shadow, space, target, TINT, type as T } from './theme';

// ---- icons -------------------------------------------------------------------------

/** The demo's icon names, drawn with lucide. */
export const ICONS = {
  arrowR: ArrowRight, assign: ClipboardList, book: BookOpen, building: Building2, camera: Camera, chat: MessageCircle,
  chatDots: MessageSquareText, check: Check, clock: Clock, close: X, cloud: Cloud, cut: Scissors, down: ChevronDown,
  download: Download, edit: Pencil, filter: Filter, flag: Flag, flow: Workflow, folder: Folder, globe: Globe,
  help: CircleHelp, history: History, home: House, left: ChevronLeft, link: Link, lock: Lock, map: MapIcon, media: Image,
  mic: Mic, note: StickyNote, notif: Bell, pause: Pause, people: Users, place: MapPin, play: Play, plus: Plus,
  progress: ChartColumn, qr: QrCode, restart: RotateCcw, right: ChevronRight, search: Search, settings: Settings,
  share: Share2, skip: SkipForward, sound: Volume2, sparkle: Sparkles, star: Star, stop: Square, swap: ArrowLeftRight,
  template: LayoutTemplate, thumbUp: ThumbsUp, trash: Trash2, undo: Undo2, up: ChevronUp, user: User, video: Video,
  work: Briefcase, inbox: Inbox, listen: Headphones, layers: Layers
} satisfies Record<string, LucideIcon>;
export type IconName = keyof typeof ICONS;

export function Ico(props: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const Icon = ICONS[props.name];
  return <Icon size={props.size ?? 20} color={props.color ?? C.dark} strokeWidth={props.strokeWidth ?? 2.2} />;
}

/** The icon each shipped review kind reads by (the demo's REVIEW_KINDS icons). */
export function kindIcon(kindId: string): IconName {
  return ({ peer: 'people', bt: 'swap', community: 'globe', consultant: 'check', final: 'star', retell: 'chat', local: 'place' } as Record<string, IconName>)[kindId] ?? 'chat';
}

// ---- text ----------------------------------------------------------------------------

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

// ---- layout ----------------------------------------------------------------------------

/**
 * A phone screen: header, a scrolling body on the lavender ground, and an
 * optional footer pinned above the keyboard (one main button, ADR-012).
 */
export function Screen(props: {
  header?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Body without its own scroll view (a list that virtualizes). */
  fixed?: boolean;
  bodyStyle?: StyleProp<ViewStyle>;
}) {
  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {props.header}
      {props.fixed ? (
        <View style={[{ flex: 1 }, props.bodyStyle]}>{props.children}</View>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.body, props.bodyStyle]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {props.children}
        </ScrollView>
      )}
      {props.footer ? <View style={[styles.footer, { paddingBottom: space.md }]}>{props.footer}</View> : null}
    </KeyboardAvoidingView>
  );
}

/**
 * The header. `crumbs` puts tappable parents above the title: every screen
 * under a passage names it there, so the record is one tap away however deep
 * you are (ADR-021). `close` makes a task screen leave with ✕, not Back.
 */
export function Header(props: {
  title: string;
  sub?: string;
  crumbs?: { label: string; onPress?: () => void }[];
  onBack?: () => void;
  close?: boolean;
  action?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      {props.onBack ? (
        <Pressable onPress={props.onBack} accessibilityRole="button" accessibilityLabel={props.close ? 'Close' : 'Back'}
          style={({ pressed }) => [styles.headerBack, pressed && styles.pressed]}>
          <Ico name={props.close ? 'close' : 'left'} size={props.close ? 24 : 28} color={C.dark} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, paddingLeft: props.onBack ? 0 : space.xs }}>
        {props.crumbs && props.crumbs.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbs}>
            {props.crumbs.map((c, i) => (
              <View key={`${c.label}-${i}`} style={styles.crumb}>
                {i > 0 ? <Ico name="right" size={14} color={C.muted} /> : null}
                {c.onPress ? (
                  <Pressable onPress={c.onPress} hitSlop={10} accessibilityRole="link" style={({ pressed }) => [styles.crumbTap, pressed && styles.pressed]}>
                    <Text style={styles.crumbLink} numberOfLines={1}>{c.label}</Text>
                  </Pressable>
                ) : (
                  <Text style={txt.xs} numberOfLines={1}>{c.label}</Text>
                )}
              </View>
            ))}
          </ScrollView>
        ) : null}
        <Text style={txt.title} numberOfLines={2} accessibilityRole="header">{props.title}</Text>
        {props.sub ? <Text style={[txt.xs, { marginTop: 2 }]} numberOfLines={2}>{props.sub}</Text> : null}
      </View>
      {props.action}
    </View>
  );
}

export function Card(props: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  if (props.onPress) {
    return (
      <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel}
        style={({ pressed }) => [styles.card, props.style, pressed && styles.pressed]}>
        {props.children}
      </Pressable>
    );
  }
  return <View style={[styles.card, props.style]}>{props.children}</View>;
}

/** A group of rows on one white card. */
export function Group(props: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.group, props.style]}>{props.children}</View>;
}

export function SectionLabel(props: { label: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={txt.label}>{props.label}</Text>
      {props.action}
    </View>
  );
}

/** A tappable row: icon tile, label, sub, and a chevron (or `right`). 64pt tall. */
export function Row(props: {
  icon?: IconName;
  iconColor?: string;
  iconBg?: string;
  leading?: ReactNode;
  label: string;
  sub?: string;
  badge?: string;
  badgeTone?: 'default' | 'green' | 'amber' | 'red' | 'brand';
  /** Content under the label and sub, such as a progress bar. */
  below?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
  muted?: boolean;
  /** How a screen reader should treat it: a choice among several is a radio, a pick-many a checkbox. */
  role?: 'button' | 'radio' | 'checkbox' | 'link';
  selected?: boolean;
  checked?: boolean;
  expanded?: boolean;
  accessibilityLabel?: string;
}) {
  const state = {
    ...(props.selected !== undefined ? { selected: props.selected } : {}),
    ...(props.checked !== undefined ? { checked: props.checked } : {}),
    ...(props.expanded !== undefined ? { expanded: props.expanded } : {})
  };
  const body = (
    <>
      {props.leading ?? (props.icon ? (
        <View style={[styles.iconTile, props.iconBg ? { backgroundColor: props.iconBg } : null]}>
          <Ico name={props.icon} size={22} color={props.iconColor ?? C.primary} />
        </View>
      ) : null)}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[txt.body, { fontWeight: '600' }, props.muted && { color: C.muted }]} numberOfLines={2}>{props.label}</Text>
        {props.sub ? <Text style={[txt.smMuted, { marginTop: 1 }]} numberOfLines={2}>{props.sub}</Text> : null}
        {props.below ? <View style={{ marginTop: space.sm }}>{props.below}</View> : null}
      </View>
      {props.badge ? <Badge label={props.badge} {...(props.badgeTone ? { tone: props.badgeTone } : {})} /> : null}
      {props.right ?? (props.onPress ? <Ico name="right" size={22} color={C.muted} /> : null)}
    </>
  );
  const style = [styles.row, !props.last && styles.rowBorder];
  if (!props.onPress) return <View style={style}>{body}</View>;
  return (
    <Pressable onPress={props.onPress} accessibilityRole={props.role ?? 'button'} accessibilityState={state} accessibilityLabel={props.accessibilityLabel}
      style={({ pressed }) => [...style, pressed && styles.pressed]}>
      {body}
    </Pressable>
  );
}

/**
 * Details on request (ADR-013): a card with a title and a one-line summary
 * that opens in place. Pass `open`/`onToggle` from `ctx.details(key)` so a
 * card someone opened stays open when they come Back.
 */
export function Disclosure(props: { icon: IconName; title: string; summary: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <View style={styles.disclosure}>
      <Pressable onPress={props.onToggle} accessibilityRole="button" accessibilityState={{ expanded: props.open }}
        accessibilityLabel={`${props.title}. ${props.summary}`} accessibilityHint={props.open ? 'Hides the details' : 'Shows the details'}
        style={({ pressed }) => [styles.disclosureHead, pressed && styles.pressed]}>
        <View style={styles.iconTile}><Ico name={props.icon} size={20} color={C.primary} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.body, { fontWeight: '600' }]}>{props.title}</Text>
          <Text style={[txt.xs, { marginTop: 2 }]} numberOfLines={1}>{props.summary}</Text>
        </View>
        <Text style={txt.link}>{props.open ? 'Hide' : 'Show'}</Text>
        <Ico name={props.open ? 'up' : 'down'} size={20} color={C.primary} />
      </Pressable>
      {props.open ? <View style={styles.disclosureBody}>{props.children}</View> : null}
    </View>
  );
}

// ---- buttons ---------------------------------------------------------------------------

export type Tone = 'primary' | 'dark' | 'amber' | 'red' | 'green';
const TONES: Record<Tone, string> = { primary: C.primary, dark: C.dark, amber: onColor.amber, red: onColor.red, green: onColor.green };

/** The one main button: 56pt, filled, full width by default. */
export function PrimaryBtn(props: { label: string; onPress: () => void; disabled?: boolean; icon?: IconName; tone?: Tone; full?: boolean; busy?: boolean }) {
  const bg = TONES[props.tone ?? 'primary'];
  const off = props.disabled || props.busy;
  return (
    <Pressable onPress={props.onPress} disabled={off} accessibilityRole="button" accessibilityLabel={props.label} accessibilityState={{ disabled: !!off, busy: !!props.busy }}
      style={({ pressed }) => [styles.primary, { backgroundColor: off ? C.faint : bg }, props.full === false && { alignSelf: 'flex-start', paddingHorizontal: space.xl },
        !off && { shadowColor: bg, shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 3 }, pressed && styles.pressed]}>
      {props.icon ? <Ico name={props.icon} size={22} color={C.white} /> : null}
      <Text style={styles.primaryLabel}>{props.busy ? 'Saving…' : props.label}</Text>
    </Pressable>
  );
}

/** A secondary action: tinted, same size as the main button. */
export function GhostBtn(props: { label: string; onPress: () => void; disabled?: boolean; icon?: IconName; full?: boolean; tone?: 'primary' | 'red' | 'amber' }) {
  const fg = props.tone === 'red' ? TINT.redText : props.tone === 'amber' ? TINT.amberText : C.primary;
  const bg = props.tone === 'red' ? TINT.red : props.tone === 'amber' ? TINT.amber : C.light;
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!props.disabled }}
      style={({ pressed }) => [styles.ghost, { backgroundColor: bg }, props.full === false && { alignSelf: 'flex-start', paddingHorizontal: space.xl },
        props.disabled && { opacity: 0.5 }, pressed && styles.pressed]}>
      {props.icon ? <Ico name={props.icon} size={22} color={fg} /> : null}
      <Text style={[styles.ghostLabel, { color: fg }]}>{props.label}</Text>
    </Pressable>
  );
}

/** A 48pt outlined button for actions inside a card. */
export function SmallBtn(props: { label: string; onPress: () => void; icon?: IconName; tone?: 'primary' | 'plain' | 'dark'; disabled?: boolean }) {
  const filled = props.tone === 'primary' || props.tone === 'dark';
  const bg = props.tone === 'dark' ? C.dark : C.primary;
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!props.disabled }}
      style={({ pressed }) => [styles.small, filled ? { backgroundColor: bg, borderColor: bg } : null, props.disabled && { opacity: 0.45 }, pressed && styles.pressed]}>
      {props.icon ? <Ico name={props.icon} size={18} color={filled ? C.white : C.primary} /> : null}
      <Text style={[styles.smallLabel, { color: filled ? C.white : C.primary }]} numberOfLines={1}>{props.label}</Text>
    </Pressable>
  );
}

/** A plain text action (Show all, Undo). Still 48pt tall. */
export function LinkBtn(props: { label: string; onPress: () => void; color?: string; style?: StyleProp<ViewStyle>; accessibilityLabel?: string; expanded?: boolean }) {
  return (
    <Pressable onPress={props.onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel}
      accessibilityState={props.expanded !== undefined ? { expanded: props.expanded } : undefined}
      style={({ pressed }) => [styles.linkBtn, props.style, pressed && styles.pressed]}>
      <Text style={[txt.link, props.color ? { color: props.color } : null]}>{props.label}</Text>
    </Pressable>
  );
}

export function IconBtn(props: { name: IconName; onPress: () => void; label: string; color?: string; bg?: string; size?: number; disabled?: boolean }) {
  const size = props.size ?? 48;
  return (
    <Pressable onPress={props.onPress} disabled={props.disabled} accessibilityRole="button" accessibilityLabel={props.label}
      accessibilityState={{ disabled: !!props.disabled }} hitSlop={Math.max(0, (target.min - size) / 2)}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: props.bg ?? C.bg },
        props.disabled && { opacity: 0.4 }, pressed && styles.pressed]}>
      <Ico name={props.name} size={Math.round(size * 0.46)} color={props.color ?? C.dark} />
    </Pressable>
  );
}

/** A selectable pill. */
export function Chip(props: { label: string; on: boolean; onPress: () => void; icon?: IconName; count?: number; accessibilityLabel?: string }) {
  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" accessibilityState={{ selected: props.on }} accessibilityLabel={props.accessibilityLabel}
      style={({ pressed }) => [styles.chip, props.on ? { backgroundColor: C.primary, borderColor: C.primary } : null, pressed && styles.pressed]}>
      {props.icon ? <Ico name={props.icon} size={18} color={props.on ? C.white : C.primary} /> : null}
      <Text style={[styles.chipLabel, { color: props.on ? C.white : C.dark }]}>{props.label}{props.count !== undefined ? ` · ${props.count.toLocaleString('en-US')}` : ''}</Text>
    </Pressable>
  );
}

/** Pills in a row that scrolls sideways (filters, tabs within a screen). */
export function ChipRow(props: { children: ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: 2 }}>{props.children}</ScrollView>;
}

export function Toggle(props: { on: boolean; onToggle: () => void; label: string; disabled?: boolean }) {
  return (
    <Switch value={props.on} onValueChange={props.onToggle} disabled={props.disabled} accessibilityLabel={props.label}
      trackColor={{ true: C.primary, false: C.border }} thumbColor={C.white} ios_backgroundColor={C.border} />
  );
}

// ---- fields ----------------------------------------------------------------------------

export function Field(props: {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  secure?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'number-pad';
  autoCapitalize?: 'none' | 'sentences' | 'words';
  style?: StyleProp<TextStyle>;
}) {
  return (
    <View style={{ gap: space.xs }}>
      {props.label ? <Text style={txt.xsStrong}>{props.label}</Text> : null}
      <TextInput value={props.value} onChangeText={props.onChangeText} placeholder={props.placeholder} placeholderTextColor={C.faint}
        accessibilityLabel={props.label ?? props.placeholder}
        multiline={props.multiline} secureTextEntry={props.secure} keyboardType={props.keyboardType} autoCapitalize={props.autoCapitalize}
        style={[styles.field, props.multiline && { minHeight: 88, textAlignVertical: 'top', paddingTop: 14 }, props.style]} />
    </View>
  );
}

export function SearchField(props: { value: string; onChangeText: (v: string) => void; placeholder: string }) {
  return (
    <View style={styles.search}>
      <Ico name="search" size={24} color={C.muted} />
      <TextInput value={props.value} onChangeText={props.onChangeText} placeholder={props.placeholder} placeholderTextColor={C.faint}
        autoCapitalize="none" autoCorrect={false} returnKeyType="search" accessibilityLabel={props.placeholder} style={styles.searchInput} />
      {props.value ? <IconBtn name="close" label="Clear search" onPress={() => props.onChangeText('')} bg="transparent" color={C.muted} /> : null}
    </View>
  );
}

/** "Show 25 more · 1,164 left": long lists grow on request (ADR-009). */
export function ShowMore(props: { remaining: number; step: number; onMore: () => void }) {
  if (props.remaining <= 0) return null;
  return (
    <Pressable onPress={props.onMore} accessibilityRole="button" style={({ pressed }) => [styles.showMore, pressed && styles.pressed]}>
      <Text style={[txt.body, { color: C.primary, fontWeight: '600' }]}>Show {Math.min(props.step, props.remaining)} more · {props.remaining.toLocaleString('en-US')} left</Text>
    </Pressable>
  );
}

// ---- marks -------------------------------------------------------------------------------

export function Badge(props: { label: string; tone?: 'default' | 'green' | 'amber' | 'red' | 'brand' }) {
  const [bg, fg] = {
    default: [TINT.gray, TINT.grayText], green: [TINT.green, TINT.greenText], amber: [TINT.amber, TINT.amberText],
    red: [TINT.red, TINT.redText], brand: [C.light, C.primary]
  }[props.tone ?? 'default'];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text style={[txt.xsStrong, { color: fg }]} numberOfLines={1}>{props.label}</Text>
    </View>
  );
}

export function ProgressBar(props: { value: number; color?: string; height?: number }) {
  const h = props.height ?? 6;
  return (
    <View style={{ height: h, borderRadius: h, backgroundColor: C.border, overflow: 'hidden' }}>
      <View style={{ height: h, borderRadius: h, width: `${Math.max(0, Math.min(100, props.value))}%`, backgroundColor: props.color ?? C.primary }} />
    </View>
  );
}

/** "Step 3 of 6": a segmented bar. */
export function Segments(props: { total: number; done: (i: number) => boolean; current?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {Array.from({ length: props.total }, (_, i) => (
        <View key={i} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: props.done(i) ? C.green : i === props.current ? C.primary : C.border }} />
      ))}
    </View>
  );
}

export function EmptyState(props: { icon?: IconName; title: string; sub?: string; children?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <View style={[styles.iconTile, { width: 64, height: 64, borderRadius: 20 }]}><Ico name={props.icon ?? 'sparkle'} size={30} color={C.primary} /></View>
      <Text style={[txt.h3, { textAlign: 'center' }]}>{props.title}</Text>
      {props.sub ? <Text style={[txt.smMuted, { textAlign: 'center' }]}>{props.sub}</Text> : null}
      {props.children}
    </View>
  );
}

function stateStyle(state: KindState): { icon?: IconName; fg: string; bg: string; ring?: string } {
  switch (state) {
    case 'approved': return { icon: 'check', fg: C.white, bg: C.green };
    case 'addressed': return { icon: 'check', fg: TINT.greenText, bg: TINT.green, ring: C.green };
    case 'suggestions': return { icon: 'chat', fg: C.white, bg: C.amber };
    case 'asked': return { icon: 'clock', fg: C.primary, bg: C.light, ring: C.primary };
    case 'skipped': return { icon: 'skip', fg: TINT.grayText, bg: TINT.gray };
    case 'locked': return { icon: 'lock', fg: C.faint, bg: TINT.gray };
    case 'todo': return { fg: C.muted, bg: C.card, ring: C.border };
  }
}

/** One kind's state as a small round mark: colour and icon, never colour alone. */
export function StateMark(props: { state: KindState; size?: number }) {
  const s = stateStyle(props.state);
  const size = props.size ?? 18;
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: s.bg, alignItems: 'center', justifyContent: 'center',
      borderWidth: s.ring ? 1.5 : 0, borderColor: s.ring }}>
      {s.icon ? <Ico name={s.icon} size={Math.round(size * 0.6)} color={s.fg} strokeWidth={3} /> : null}
    </View>
  );
}

/** A row of marks, one per kind, grouped by step; a checkpoint step is outlined. */
export function StepMarks(props: { steps: { kinds: { kindId: string; state: KindState }[]; checkpoint?: boolean }[]; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
      {props.steps.map((st, i) => (
        <View key={i} style={[{ flexDirection: 'row', gap: 3 }, st.checkpoint ? { padding: 2, borderRadius: 99, borderWidth: 1, borderColor: C.border } : null]}>
          {st.kinds.map((k) => <StateMark key={k.kindId} state={k.state} size={props.size ?? 16} />)}
        </View>
      ))}
    </View>
  );
}

export function KindIcon(props: { kindId: string; size?: number }) {
  const size = props.size ?? 44;
  return (
    <View style={[styles.iconTile, { width: size, height: size }]}>
      <Ico name={kindIcon(props.kindId)} size={Math.round(size * 0.5)} color={C.primary} />
    </View>
  );
}

/** A note shown where it is relevant; notes on older versions stay, marked (design principles 9). */
export function NoteCard(props: { anchor: string; text?: string; by: string; when: string; olderVersion?: string; audio?: ReactNode; icon?: IconName }) {
  return (
    <View style={styles.note}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Ico name={props.icon ?? 'note'} size={14} color={TINT.amberText} />
        <Text style={[txt.xsStrong, { color: TINT.amberText }]}>{props.anchor}</Text>
        {props.olderVersion ? <View style={styles.noteTag}><Text style={[txt.xsStrong, { color: TINT.amberText }]}>on {props.olderVersion}</Text></View> : null}
      </View>
      {props.text ? <Text style={[txt.sm, { marginTop: 6 }]}>{props.text}</Text> : null}
      {props.audio ? <View style={{ marginTop: 6 }}>{props.audio}</View> : null}
      <Text style={[txt.xs, { marginTop: 6 }]}>{props.by} · {props.when}</Text>
    </View>
  );
}

/** A banner of context above a task ("Revising after Peer Review feedback"). */
export function Banner(props: { icon: IconName; title: string; body?: string; tone?: 'brand' | 'amber' | 'green' }) {
  const [bg, fg] = props.tone === 'amber' ? [TINT.amber, TINT.amberText] : props.tone === 'green' ? [TINT.green, TINT.greenText] : [C.light, C.primary];
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <Ico name={props.icon} size={20} color={fg} />
      <View style={{ flex: 1 }}>
        <Text style={[txt.sm, { fontWeight: '700', color: fg }]}>{props.title}</Text>
        {props.body ? <Text style={[txt.sm, { marginTop: 2 }]}>{props.body}</Text> : null}
      </View>
    </View>
  );
}

// ---- sheets ------------------------------------------------------------------------------

/** A bottom sheet: darkened backdrop, rounded top, ✕ to close. Never a flow node. */
export function Sheet(props: { visible: boolean; title: string; sub?: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={styles.sheetBackdrop} onPress={props.onClose} accessibilityLabel="Close" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
          <View style={styles.sheetGrip} />
          <View style={styles.sheetHead}>
            <View style={{ flex: 1 }}>
              <Text style={txt.title}>{props.title}</Text>
              {props.sub ? <Text style={[txt.smMuted, { marginTop: 4 }]}>{props.sub}</Text> : null}
            </View>
            <IconBtn name="close" label="Close" onPress={props.onClose} bg={C.card} color={C.muted} />
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space.md, paddingHorizontal: space.xl, paddingBottom: space.lg }} keyboardShouldPersistTaps="handled">
            {props.children}
          </ScrollView>
          {props.footer ? <View style={{ paddingHorizontal: space.xl, gap: space.sm }}>{props.footer}</View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/**
 * Comply or explain, made cheap (design principles, "The cost of
 * explaining"): tap a common reason, say it, or type it. `voice` is the
 * voice-note control from voiceNote.tsx, so this file stays free of I/O.
 */
export function ReasonSheet(props: {
  visible: boolean;
  title: string;
  sub?: string;
  quickReasons: string[];
  confirmLabel: string;
  tone?: Tone;
  footnote?: string;
  voice?: (args: { hash: string | null; onChange: (hash: string | null) => void }) => ReactNode;
  onClose: () => void;
  onConfirm: (r: { reason: string; blobHash?: string }) => void;
}) {
  const [reason, setReason] = useState('');
  const [hash, setHash] = useState<string | null>(null);
  const ready = reason.trim().length > 0 || !!hash;
  return (
    <Sheet visible={props.visible} title={props.title} sub={props.sub} onClose={props.onClose}
      footer={<PrimaryBtn label={props.confirmLabel} tone={props.tone ?? 'dark'} disabled={!ready}
        onPress={() => { props.onConfirm({ reason: reason.trim() || 'Explained in a voice note.', ...(hash ? { blobHash: hash } : {}) }); setReason(''); setHash(null); }} />}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {props.quickReasons.map((q) => (
          <Pressable key={q} onPress={() => setReason(q)} accessibilityRole="button" accessibilityState={{ selected: reason === q }}
            style={({ pressed }) => [styles.quickReason, reason === q ? { backgroundColor: C.dark, borderColor: C.dark } : null, pressed && styles.pressed]}>
            <Text style={[txt.sm, { fontWeight: '600', color: reason === q ? C.white : C.dark }]}>{q}</Text>
          </Pressable>
        ))}
      </View>
      {props.voice ? props.voice({ hash, onChange: setHash }) : null}
      <Field value={reason} onChangeText={setReason} placeholder="Or type the reason" multiline />
      <Text style={txt.xs}>{props.footnote ?? "This goes in the passage's record with your name. It can be undone later; the record keeps both."}</Text>
    </Sheet>
  );
}

// ---- toasts ----------------------------------------------------------------------------------

export interface ToastSpec {
  id: number;
  message: string;
  /** Offered for about 7 s (CORE-5). */
  undo?: () => void | Promise<void>;
}

/**
 * What changed, and Undo when it can be (CORE-5). The message and Undo are
 * separate elements so a screen reader can reach Undo, and the message is
 * announced as it appears. Tapping the message dismisses it.
 */
export function ToastView(props: { toast: ToastSpec | null; onDismiss: () => void; bottom: number }) {
  const t = props.toast;
  useEffect(() => {
    if (t) AccessibilityInfo.announceForAccessibility(t.undo ? `${t.message} Undo available.` : t.message);
  }, [t?.id]);
  if (!t) return null;
  return (
    <View pointerEvents="box-none" style={[styles.toastWrap, { bottom: props.bottom }]}>
      <View style={styles.toast}>
        <Pressable onPress={props.onDismiss} accessibilityRole="button" accessibilityLabel={`${t.message} Dismiss`}
          accessibilityLiveRegion="polite" style={styles.toastMessage}>
          <Ico name="check" size={20} color={C.green} />
          <Text style={[txt.sm, { color: C.white, flex: 1, fontWeight: '600' }]}>{t.message}</Text>
        </Pressable>
        {t.undo ? (
          <Pressable onPress={() => { void Promise.resolve(t.undo?.()).catch(() => undefined); props.onDismiss(); }} hitSlop={10}
            accessibilityRole="button" accessibilityLabel="Undo" style={styles.toastUndo}>
            <Text style={[txt.sm, { color: C.light, fontWeight: '800' }]}>Undo</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm, backgroundColor: C.card, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  pressed: { opacity: 0.7 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: C.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  headerBack: { width: target.min, height: target.min, borderRadius: target.min / 2, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', marginLeft: -space.xs },
  crumbs: { alignItems: 'center', gap: 2 },
  crumb: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  crumbTap: { minHeight: 32, justifyContent: 'center' },
  crumbLink: { fontSize: T.sm, fontWeight: '700', color: C.primary, maxWidth: 200 },
  card: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, padding: space.lg, gap: space.md, ...shadow },
  group: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, overflow: 'hidden', ...shadow },
  sectionLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.xs, paddingTop: space.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: C.card },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  iconTile: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  disclosure: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, overflow: 'hidden', ...shadow },
  disclosureHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, paddingHorizontal: space.lg, paddingVertical: space.md },
  disclosureBody: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  primary: { minHeight: target.primary, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg },
  primaryLabel: { color: C.white, fontSize: T.base, fontWeight: '700' },
  ghost: { minHeight: target.primary, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg },
  ghostLabel: { fontSize: T.base, fontWeight: '700' },
  small: { minHeight: target.min, borderRadius: radius.md, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: space.md },
  smallLabel: { fontSize: T.sm, fontWeight: '700' },
  linkBtn: { minHeight: target.min, justifyContent: 'center' },
  chip: { minHeight: target.min, borderRadius: radius.full, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg },
  chipLabel: { fontSize: T.sm, fontWeight: '700' },
  field: { minHeight: target.primary, borderRadius: radius.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, paddingHorizontal: space.lg, fontSize: T.base, color: C.dark },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.primary, borderRadius: radius.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, paddingLeft: space.lg, paddingRight: space.xs },
  searchInput: { flex: 1, fontSize: T.base, color: C.dark, paddingVertical: space.md },
  showMore: { minHeight: target.primary, borderRadius: radius.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  badge: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'center' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.xl },
  note: { backgroundColor: TINT.note, borderWidth: 1, borderColor: TINT.noteBorder, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md },
  noteTag: { backgroundColor: TINT.noteBorder, borderRadius: radius.full, paddingHorizontal: 6, paddingVertical: 1 },
  banner: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: space.lg, borderRadius: radius.lg },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,18,28,0.45)' },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, maxHeight: '88%', paddingTop: space.sm, gap: space.sm },
  sheetGrip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.border },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.xl, paddingTop: space.sm },
  quickReason: { borderRadius: radius.md, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: target.min, justifyContent: 'center' },
  toastWrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: C.dark, borderRadius: radius.lg, paddingLeft: space.lg, paddingRight: space.sm, minHeight: 56, width: '100%', ...shadow, shadowOpacity: 0.25 },
  toastMessage: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56 },
  toastUndo: { minHeight: 48, minWidth: 64, alignItems: 'center', justifyContent: 'center' }
});
