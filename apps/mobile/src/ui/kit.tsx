// The UX demo's UI primitives (ng-langquest-ux src/ui.tsx and the shared
// widgets in screens/shared.tsx), in React Native. Every screen builds on
// these so the app reads as one product: a white header with the passage
// named above the title, cards on a lavender ground, one main button per
// screen, details behind one-line summaries (ADR-013), status in fixed
// colours with an icon (ADR-010), and field-sized targets (ADR-008).
import type { LucideIcon } from './icons';
import {
  ArrowLeftRight, ArrowRight, Ban, BookOpen, Briefcase, Building2, Camera, ChartColumn, Check, ChevronDown, ChevronLeft,
  ChevronRight, ChevronUp, CircleHelp, ClipboardList, Clock, Cloud, CloudCheck, CloudOff, Download, Filter, Flag, Folder, Globe, History,
  House, Image, Inbox, LayoutTemplate, Link, Lock, LockOpen, Printer, Copy, MapIcon, MapPin, MessageCircle, MessageSquareText, Mic, Pause, Pencil,
  Play, Plus, QrCode, RotateCcw, Scissors, Search, Settings, Share2, SkipForward, Sparkles, Square, Star, StickyNote,
  ThumbsUp, Trash2, Undo2, Redo2, Upload, User, Users, Video, Volume2, Workflow, X, Bell, Headphones, Layers, Info,
  ArrowLeft, ArrowUp, ArrowDown, Send, KeyRound, List, Smartphone, GripVertical, SlidersHorizontal, CircleCheck, TriangleAlert,
  ChevronsUpDown, CloudAlert, CloudDownload, FileText, Eye, EyeOff, Menu, Bug, Lightbulb, Ellipsis, MessageCirclePlus, Reply, Ear
} from './icons';
import { Fragment, isValidElement, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, Easing, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Switch, TextInput, View,
  type StyleProp, type TextStyle, type ViewStyle
} from 'react-native';
import { Text } from './text';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { KindState } from '@langquest-next/core';
import type { HelpSpot } from '../helpMode/helpContext';
import { useHelpInfo, useHelpMode, useHelpOn, useHelpSpot } from '../helpMode/useHelpMode';
import { isRtl, t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { HelpBadge, HelpClip, HelpHost, HelpLit, HelpRow } from '../helpMode/helpBadge';
import { lift, shadow } from './shadow';
import { markedParts } from './textMatch';
import { C, measure, onColor, radius, space, target, TINT, type as T } from './theme';
import { useLayout, useOpenDetail } from './useLayout';
import { useReduceMotion } from './useReduceMotion';
import { kindIcon } from './kindIcon';
import { txt } from './textStyles';
import { FooterHeightContext } from './useLayout';
import { useHelpHost } from '../helpMode/useHelpMode';
import { HeaderExtraContext } from './headerExtra';
import { ModalCover } from './ModalCover';
import { ScrollHoldContext } from './scrollHoldContext';
import { toastLook, type ToastSpec } from './toastModel';
import { useSheetOnTop, useShownToast } from './useToastLayer';
import { a11yState } from './a11yModel';

// ---- icons -------------------------------------------------------------------------

/** The demo's icon names, drawn with lucide. */
const ICONS = {
  arrowR: ArrowRight, assign: ClipboardList, block: Ban, book: BookOpen, building: Building2, camera: Camera, chat: MessageCircle,
  chatDots: MessageSquareText, check: Check, clock: Clock, close: X, cloud: Cloud, cut: Scissors, down: ChevronDown,
  download: Download, edit: Pencil, filter: Filter, flag: Flag, flow: Workflow, folder: Folder, globe: Globe,
  help: CircleHelp, history: History, home: House, left: ChevronLeft, link: Link, lock: Lock, unlocked: LockOpen, print: Printer, copy: Copy, map: MapIcon, media: Image,
  mic: Mic, note: StickyNote, notif: Bell, pause: Pause, people: Users, place: MapPin, play: Play, plus: Plus,
  progress: ChartColumn, qr: QrCode, restart: RotateCcw, right: ChevronRight, search: Search, settings: Settings,
  share: Share2, skip: SkipForward, sound: Volume2, sparkle: Sparkles, star: Star, stop: Square, swap: ArrowLeftRight,
  template: LayoutTemplate, thumbUp: ThumbsUp, trash: Trash2, undo: Undo2, redo: Redo2, up: ChevronUp, arrowUp: ArrowUp, arrowDown: ArrowDown, upload: Upload, user: User, video: Video,
  work: Briefcase, inbox: Inbox, listen: Headphones, layers: Layers, info: Info, onPhone: CloudCheck, notOnPhone: CloudOff, cloudAlert: CloudAlert, cloudDown: CloudDownload,
  arrowL: ArrowLeft, send: Send, key: KeyRound, list: List, phone: Smartphone, grip: GripVertical, handle: Menu, sliders: SlidersHorizontal, done: CircleCheck,
  warning: TriangleAlert, join: ChevronsUpDown, file: FileText, more: Ellipsis,
  // Show here / Hide here on a passage's helps (demo ADR-042).
  eye: Eye, eyeOff: EyeOff,
  // Feedback from help mode: a problem, an idea (decisions.md 145).
  bug: Bug, idea: Lightbulb,
  // A note on what a check shows, and an answer to one (decisions.md 149).
  noteOn: MessageCirclePlus, reply: Reply,
  // A part tried in Clean up and kept as recorded (decision 179).
  ear: Ear
} satisfies Record<string, LucideIcon>;
export type IconName = keyof typeof ICONS;

/**
 * A text field starts where the line of reading starts. iOS aligns an empty
 * field (its placeholder) by the text's own direction, not the app's, so in
 * right to left it is told; the web follows the page's `dir`.
 */
function inputDirection(): TextStyle | null {
  return isRtl() && Platform.OS === 'ios' ? { textAlign: 'right' } : null;
}

/** Icons that point along the line of reading, so right to left mirrors them (media controls stay as they are). */
const MIRRORED = new Set<IconName>(['arrowR', 'arrowL', 'left', 'right', 'send', 'undo', 'redo']);

export function Ico(props: { name: IconName; size?: number; color?: string; strokeWidth?: number; fill?: string }) {
  const Icon = ICONS[props.name];
  const icon = <Icon size={props.size ?? 20} color={props.color ?? C.dark} strokeWidth={props.strokeWidth ?? 2.2} {...(props.fill ? { fill: props.fill } : {})} />;
  return isRtl() && MIRRORED.has(props.name) ? <View style={{ transform: [{ scaleX: -1 }] }}>{icon}</View> : icon;
}

// ---- text ----------------------------------------------------------------------------

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
  /** On a wide window, a column wider than the reading width (reports' tables and charts side by side). */
  columnWidth?: number;
  /** Show the scroll bar, where what is below the fold is a way on (Sign In on a short phone). */
  scrollBar?: boolean;
}) {
  // A wide window keeps the phone's reading width: the body sits in a
  // centred column and the footer's actions stop stretching (decisions.md 55).
  // The scroll view itself stays full width, so it scrolls from anywhere.
  const wide = useLayout().kind !== 'phone';
  const column = wide ? [styles.column, props.columnWidth ? { maxWidth: props.columnWidth } : null] : null;
  const reportFooter = useContext(FooterHeightContext);
  const hasFooter = !!props.footer;
  useEffect(() => { if (reportFooter && !hasFooter) reportFooter(0); }, [reportFooter, hasFooter]);
  // In help mode, Send feedback waits in a strip of its own at the foot of the screen
  // (decisions.md 145): the screen, its footer too, ends above it, so it covers nothing.
  const helpOn = useHelpOn();
  // Something drawn on with a finger stops the body scrolling meanwhile (scrollHoldContext.ts).
  const [held, setHeld] = useState(false);
  return (
    <KeyboardSafe style={[styles.screen, helpOn && { paddingBottom: HELP_FOOT_ROOM }]}>
      {props.header}
      <HelpClip style={{ flex: 1 }}>
        {props.fixed ? (
          <View style={[{ flex: 1 }, column, props.bodyStyle]}>{props.children}</View>
        ) : (
          <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.body, column, props.bodyStyle]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={!!props.scrollBar}
            persistentScrollbar={!!props.scrollBar} scrollEnabled={!held}>
            <ScrollHoldContext.Provider value={setHeld}>{props.children}</ScrollHoldContext.Provider>
          </ScrollView>
        )}
      </HelpClip>
      {props.footer ? (
        <View style={[styles.footer, { paddingBottom: space.md }]}
          onLayout={reportFooter ? (e) => reportFooter(e.nativeEvent.layout.height) : undefined}>
          {wide ? <View style={column}><View style={styles.footerActions}>{props.footer}</View></View> : props.footer}
        </View>
      ) : null}
    </KeyboardSafe>
  );
}

/**
 * Keeps its contents above the on-screen keyboard. iOS keeps the
 * KeyboardAvoidingView it always had. Android draws edge to edge (Expo
 * 54 on), so the window no longer shrinks for the keyboard and the
 * footer and lower fields sat under it: here the view measures where it
 * is on screen when the keyboard opens and pads its bottom by the part
 * the keyboard covers. Re-measured on layout, so a window that does
 * shrink is not padded twice.
 */
function KeyboardSafe(props: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  if (Platform.OS !== 'android') {
    return <KeyboardAvoidingView style={props.style} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>{props.children}</KeyboardAvoidingView>;
  }
  return <AndroidKeyboardSafe {...props} />;
}

function AndroidKeyboardSafe(props: { style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const view = useRef<View>(null);
  const keyboardTop = useRef<number | null>(null);
  const [covered, setCovered] = useState(0);
  const remeasure = () => {
    const top = keyboardTop.current;
    if (top === null) { setCovered(0); return; }
    view.current?.measureInWindow((_x, y, _w, h) => setCovered(Math.max(0, Math.round(y + h - top))));
  };
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => { keyboardTop.current = e.endCoordinates.screenY; remeasure(); });
    const hide = Keyboard.addListener('keyboardDidHide', () => { keyboardTop.current = null; setCovered(0); });
    return () => { show.remove(); hide.remove(); };
  }, []);
  return (
    <View ref={view} style={[props.style, covered ? { paddingBottom: covered } : null]} onLayout={remeasure}>
      {props.children}
    </View>
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
  /** The sub as drawn text of its own (a line with an organization's blue check, decisions.md 173), in place of `sub`. */
  subNode?: ReactNode;
  crumbs?: { label: string; onPress?: () => void }[];
  onBack?: () => void;
  close?: boolean;
  action?: ReactNode;
  /** Match a Screen given the same `columnWidth`. */
  columnWidth?: number;
  /** What help mode says Back does, where it is not the screen before (a card before, in a walk-through). */
  backHelp?: string;
}) {
  const layout = useLayout();
  const wide = layout.kind !== 'phone';
  // Ryder's header on a phone (demo ADR-032): a task screen centres its title between two round
  // buttons, Back (or ✕) and ?, on the screen's own ground; a tab's home keeps its big title at the left.
  const centred = !wide && !!props.onBack;
  // In a split, once: beside an open screen, a list pane leaves the ? (help for the whole window) to that screen's header.
  const openBeside = useOpenDetail();
  const helpBtn = useHelpMode() && !(layout.role === 'list' && openBeside) ? <HelpToggle testID="header-help" /> : null;
  // What the app shows in every header, such as a Global Viewer's link (headerExtra.ts).
  const extra = useContext(HeaderExtraContext);
  // While help is on, Back explains itself like every other part; the ? is the way out.
  const back = useHelpSpot(props.close ? t('common.close') : t('common.back'), props.backHelp ?? (props.close ? t('help.details.close') : t('help.details.back')), props.onBack);
  const crumbs = props.crumbs && props.crumbs.length > 0 && wide ? (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbs}>
      {/* help-each: each crumb goes back to a different place */}
      {props.crumbs.map((c, i) => (
        <View key={`${c.label}-${i}`} style={styles.crumb}>
          {i > 0 ? <Ico name="right" size={14} color={C.muted} /> : null}
          {c.onPress ? <Crumb label={c.label} onPress={c.onPress} /> : <Text style={txt.xs} numberOfLines={1}>{c.label}</Text>}
        </View>
      ))}
    </ScrollView>
  ) : null;
  const [actionWidth, setActionWidth] = useState(0);
  const action = props.action ? <View onLayout={(e) => setActionWidth(e.nativeEvent.layout.width)}>{props.action}</View> : null;
  const backBtn = (
    <Pressable testID={props.close ? 'header-close' : 'header-back'} onPress={back.onPress} accessibilityRole="button" accessibilityLabel={props.close ? t('common.close') : t('common.back')}
      style={({ pressed }) => [styles.roundBtn, pressed && styles.pressed]}>
      <Ico name={props.close ? 'close' : 'arrowL'} size={24} color={C.dark} />
      <HelpBadge spot={back} />
    </Pressable>
  );
  // Title and sub show in full, however long the language makes them (decisions.md 139).
  const centredTitle = (
    <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
      <Text style={styles.centredTitle} accessibilityRole="header">{props.title}</Text>
      {props.subNode ? <View style={{ marginTop: 2, alignItems: 'center' }}>{props.subNode}</View>
        : props.sub ? <Text style={[txt.xs, { marginTop: 2, textAlign: 'center' }]}>{props.sub}</Text> : null}
    </View>
  );
  // A worded button, or several buttons, beside the title would leave the title a sliver:
  // the title takes its own line under the buttons (decisions.md 139).
  if (centred && (worded(props.action) || actionWidth > WIDE_ACTION)) {
    return (
      <View style={styles.headerCentredTall}>
        <View style={styles.headerTop}>
          {backBtn}
          <View style={{ flex: 1 }} />
          {action}
          {extra}
          {helpBtn}
        </View>
        <View style={styles.headerUnder}>{centredTitle}</View>
      </View>
    );
  }
  const content = centred ? (
    <>
      {backBtn}
      {centredTitle}
      {action}
      {extra}
      {helpBtn ?? <View style={{ width: 48 }} />}
    </>
  ) : (
    <>
      {props.onBack ? (
        <Pressable testID={props.close ? 'header-close' : 'header-back'} onPress={back.onPress} accessibilityRole="button" accessibilityLabel={props.close ? t('common.close') : t('common.back')}
          style={({ pressed }) => [styles.headerBack, pressed && styles.pressed]}>
          <Ico name={props.close ? 'close' : 'left'} size={props.close ? 24 : 28} color={C.dark} />
          <HelpBadge spot={back} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, paddingLeft: props.onBack ? 0 : space.xs }}>
        {crumbs}
        <Text style={wide || props.onBack ? txt.title : styles.homeTitle} accessibilityRole="header">{props.title}</Text>
        {props.subNode ? <View style={{ marginTop: 2 }}>{props.subNode}</View>
          : props.sub ? <Text style={[txt.xs, { marginTop: 2 }]}>{props.sub}</Text> : null}
      </View>
      {props.action}
      {extra}
      {helpBtn}
    </>
  );
  // Wide: the white bar spans the window, its contents line up with the body's column.
  if (wide) return <View style={styles.headerBar}><View style={[styles.headerRow, styles.column, props.columnWidth ? { maxWidth: props.columnWidth } : null]}>{content}</View></View>;
  return <View style={centred ? styles.headerCentred : styles.headerHome}>{content}</View>;
}

/** The strip a screen leaves at its foot while help is on, for Send feedback (52 pt) and a little air (feedback/FeedbackSheet.tsx). */
export const HELP_FOOT_ROOM = 52 + space.sm * 2;

/** Wider than one round button and its gap: two buttons, or a mark and a button. */
const WIDE_ACTION = 64;

/** Whether a header's action carries words (a worded button or a badge), alone or among others. */
function worded(node: ReactNode): boolean {
  if (Array.isArray(node)) return node.some(worded);
  if (!isValidElement(node)) return false;
  if (node.type === SmallBtn || node.type === Badge) return true;
  return node.type === Fragment && worded((node.props as { children?: ReactNode }).children);
}

/**
 * The round ? that turns help mode on and off (demo ADR-038), in every
 * header and sheet. While help is on it is filled and stays lit over the
 * dimmed screen: it is the way out.
 */
export function HelpToggle(props: { testID: string }) {
  const help = useHelpMode();
  if (!help) return null;
  return (
    <Pressable testID={props.testID} onPress={() => help.setOn(!help.on)} accessibilityRole="button" accessibilityLabel={help.on ? t('help.turnOff') : t('help.explainScreen')}
      {...a11yState({ selected: help.on }, 'button')}
      style={({ pressed }) => [styles.helpBtn, help.on && { backgroundColor: C.primary, borderColor: C.primary }, pressed && styles.pressed]}>
      <Ico name="help" size={24} color={help.on ? C.white : C.primary} />
      <HelpLit />
    </Pressable>
  );
}

/**
 * A screen with no header (Sign in, Welcome, Sign out?) still has its ?, at
 * the top on the reading end. `start` shares its line, at the other end (Sign
 * In's language), so the screen keeps its height for the ways in.
 */
export function HelpTop(props: { start?: ReactNode }) {
  const help = useHelpMode();
  if (!help && !props.start) return null;
  return (
    <View style={[styles.helpTop, props.start ? styles.helpTopShared : null]}>
      {props.start}
      {help ? <HelpToggle testID="header-help" /> : null}
    </View>
  );
}

/** A parent above a wide window's title, one tap away. */
function Crumb(props: { label: string; onPress: () => void }) {
  const spot = useHelpSpot(props.label, t('help.details.crumb'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} hitSlop={10} accessibilityRole="link" style={({ pressed }) => [styles.crumbTap, pressed && styles.pressed]}>
      <Text style={styles.crumbLink} numberOfLines={1}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/**
 * `current`: what this card opened is showing beside the list (a split on a
 * wide window, panes.ts), and a screen reader says so. `lead`: the usual
 * choice among several, drawn the same way but said as nothing, since nothing
 * has been chosen yet. A card that opens something says so in help mode: its
 * `accessibilityLabel` names it and `help` says what tapping does.
 */
export function Card(props: { children: ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; accessibilityLabel?: string; current?: boolean;
  lead?: boolean;
  /** What help mode says tapping it does. */ help?: string }) {
  const spot = useHelpSpot(props.accessibilityLabel ?? '', props.help, props.onPress);
  const marked = (props.current || props.lead) && styles.cardCurrent;
  if (props.onPress) {
    return (
      <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel}
        // aria-selected is not allowed on a button: a current card says aria-current, which a screen reader says as "current".
        {...a11yState(props.current ? { selected: true } : undefined, 'button', 'current')}
        style={({ pressed }) => [styles.card, props.style, marked, pressed && styles.pressed]}>
        {props.children}
        <HelpBadge spot={spot} />
      </Pressable>
    );
  }
  return <View style={[styles.card, props.style, marked]}>{props.children}</View>;
}

/** A group of rows on one white card. */
export function Group(props: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.group, props.style]}>{props.children}</View>;
}

export function SectionLabel(props: { label: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionLabel}>
      <Text style={[txt.label, { flexShrink: 1 }]}>{props.label}</Text>
      {props.action}
    </View>
  );
}

/**
 * "──── or ────" between two ways to do one thing that never combine, such as
 * typing an email or scanning a code (the demo's ADR-031): nothing above it
 * carries below.
 */
export function OrDivider() {
  return (
    <View style={styles.orDivider} accessibilityRole="text" accessibilityLabel={t('shell.kit.or')}>
      <View style={styles.orRule} />
      <Text style={[txt.smMuted, { fontWeight: '600' }]}>{t('shell.kit.or')}</Text>
      <View style={styles.orRule} />
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
  /** Taken back, kept to be seen: the label crossed out and muted. */
  struck?: boolean;
  /**
   * How a screen reader should treat it: a choice among several is a radio, a pick-many a checkbox.
   * A switch is the whole row (a 48pt target, not just the thumb) showing `checked` as a switch.
   */
  role?: 'button' | 'radio' | 'checkbox' | 'link' | 'switch';
  selected?: boolean;
  checked?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  /** What this row opened is showing beside the list (a split on a wide window, panes.ts). */
  current?: boolean;
  accessibilityLabel?: string;
  /** Text someone searched for: where it appears in the label and sub, it is bold (textMatch.ts). */
  highlight?: string;
  /** For the UI tests: a stable handle for the row (`person-<id>`). */
  testID?: string;
  /** What help mode says tapping it does, where `sub` (its line otherwise) is data rather than that. */
  help?: string;
  /** Drawn right after the label, in its line: an organization's blue check (decisions.md 173). */
  afterLabel?: ReactNode;
}) {
  const state = {
    ...(props.selected !== undefined ? { selected: props.selected } : props.current ? { selected: true } : {}),
    ...(props.checked !== undefined ? { checked: props.checked } : {}),
    ...(props.expanded !== undefined ? { expanded: props.expanded } : {}),
    ...(props.disabled ? { disabled: true } : {})
  };
  const spot = useHelpSpot(props.label, props.help ?? props.sub, props.onPress);
  const onPress = spot.onPress;
  const right = props.right ?? (props.role === 'switch' ? (
    // Drawn only: the row takes the tap and speaks as the switch.
    <View style={{ pointerEvents: 'none' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Toggle on={props.checked === true} disabled={props.disabled} label={props.label} onToggle={() => {}} drawnOnly />
    </View>
  ) : props.onPress ? <Ico name="right" size={22} color={C.muted} /> : null);
  const body = (
    <>
      {props.leading ?? (props.icon ? (
        <View style={[styles.iconTile, props.iconBg ? { backgroundColor: props.iconBg } : null]}>
          <Ico name={props.icon} size={22} color={props.iconColor ?? C.primary} />
        </View>
      ) : null)}
      <View style={{ flex: 1, minWidth: 0 }}>
        {/* Label and sub show in full, however long the language makes them (decisions.md 139). */}
        <Text style={[txt.body, { fontWeight: '600' }, (props.muted || props.struck) && { color: C.muted }, props.struck && { textDecorationLine: 'line-through' }]}>{marked(props.label, props.highlight)}{props.afterLabel}</Text>
        {props.sub ? <Text style={[txt.smMuted, { marginTop: 1 }]}>{marked(props.sub, props.highlight)}</Text> : null}
        {props.below ? <View style={{ marginTop: space.sm }}>{props.below}</View> : null}
      </View>
      {/* A long badge wraps rather than squeezing the label to nothing. */}
      {props.badge ? <View style={styles.rowBadge}><Badge label={props.badge} {...(props.badgeTone ? { tone: props.badgeTone } : {})} /></View> : null}
      {right ? <View style={styles.rowRight}>{right}</View> : null}
    </>
  );
  const style = [styles.row, !props.last && styles.rowBorder, props.current && styles.rowCurrent];
  const id = props.testID ? { testID: props.testID } : {};
  if (!props.onPress) return <View {...id} style={style}>{body}</View>;
  return (
    <Pressable {...id} onPress={onPress} disabled={props.disabled && !spot.id} accessibilityRole={props.role ?? 'button'} {...a11yState(state, props.role ?? 'button', 'current')} accessibilityLabel={props.accessibilityLabel}
      // react-native-web drops accessibilityState.selected, and aria-selected is not allowed on a button: a current row says aria-current.
      aria-current={props.current ? true : undefined}
      // The web reads only aria-*: a radio, checkbox or switch says whether it is on.
      aria-checked={props.role === 'radio' ? !!(props.selected ?? props.current) : props.role === 'switch' || props.role === 'checkbox' ? props.checked === true : undefined}
      style={({ pressed }) => [...style, pressed && styles.pressed]}>
      {body}
      <HelpBadge spot={spot} inset />
    </Pressable>
  );
}

/** `text` with what matches `query` in bold dark type, or `text` as it is. */
function marked(text: string, query: string | undefined): ReactNode {
  if (!query?.trim()) return text;
  return markedParts(text, query).map((p, i) => (p.match ? <Text key={i} style={{ fontWeight: '800', color: C.dark }}>{p.text}</Text> : p.text));
}

/**
 * Details on request (ADR-013): a card with a title and a one-line summary
 * that opens in place. Pass `open`/`onToggle` from `ctx.details(key)` so a
 * card someone opened stays open when they come Back.
 */
export function Disclosure(props: { icon: IconName; title: string; summary: string; open: boolean; onToggle: () => void; children: ReactNode; testID?: string;
  /** What help mode says is inside, where the title alone does not. */ help?: string }) {
  const spot = useHelpSpot(props.title, props.help ?? (props.open ? t('help.details.disclosureOpen') : t('help.details.disclosure')), props.onToggle);
  return (
    <View style={styles.disclosure}>
      <Pressable {...(props.testID ? { testID: props.testID } : {})} onPress={spot.onPress} accessibilityRole="button" {...a11yState({ expanded: props.open }, 'button')}
        accessibilityLabel={t('shell.a11y.labelDetail', { label: props.title, detail: props.summary })} accessibilityHint={props.open ? t('shell.kit.hidesDetails') : t('shell.kit.showsDetails')}
        style={({ pressed }) => [styles.disclosureHead, pressed && styles.pressed]}>
        <View style={styles.iconTile}><Ico name={props.icon} size={20} color={C.primary} /></View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[txt.body, { fontWeight: '600' }]}>{props.title}</Text>
          <Text style={[txt.xs, { marginTop: 2 }]}>{props.summary}</Text>
        </View>
        <Text style={txt.link}>{props.open ? t('shell.kit.hide') : t('shell.kit.show')}</Text>
        <Ico name={props.open ? 'up' : 'down'} size={20} color={C.primary} />
        <HelpBadge spot={spot} inset />
      </Pressable>
      {props.open ? <View style={styles.disclosureBody}>{props.children}</View> : null}
    </View>
  );
}

// ---- buttons ---------------------------------------------------------------------------

type Tone = 'primary' | 'dark' | 'amber' | 'red' | 'green';
const TONES: Record<Tone, string> = { primary: C.primary, dark: C.dark, amber: onColor.amber, red: onColor.red, green: onColor.green };

/** The one main button: 56pt, filled, full width by default. */
export function PrimaryBtn(props: { label: string; onPress: () => void; disabled?: boolean; icon?: IconName; tone?: Tone; full?: boolean; busy?: boolean;
  /** What help mode says happens, where the label does not say it ("Continue", "Done"); else it is the screen's main thing to do. */ help?: string }) {
  const bg = TONES[props.tone ?? 'primary'];
  const off = props.disabled || props.busy;
  const spot = useHelpSpot(props.label, props.help ?? t('help.details.primary'), props.onPress);
  const onPress = spot.onPress;
  return (
    <Pressable testID="primary-action" onPress={onPress} disabled={off && !spot.id} accessibilityRole="button" accessibilityLabel={props.label} {...a11yState({ disabled: !!off, busy: !!props.busy }, 'button')}
      style={({ pressed }) => [styles.primary, { backgroundColor: off ? C.faint : bg }, props.full === false && { alignSelf: 'flex-start', paddingHorizontal: space.xl },
        !off && lift({ color: bg, opacity: 0.25, y: 5, elevation: 3 }), pressed && styles.pressed]}>
      {props.icon ? <Ico name={props.icon} size={22} color={C.white} /> : null}
      <Text style={styles.primaryLabel}>{props.busy ? t('common.saving') : props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A secondary action: tinted, same size as the main button. */
export function GhostBtn(props: { label: string; onPress: () => void; disabled?: boolean; icon?: IconName; full?: boolean; tone?: 'primary' | 'red' | 'amber';
  /** What help mode says it does. */ help?: string }) {
  const fg = props.tone === 'red' ? TINT.redText : props.tone === 'amber' ? TINT.amberText : C.primary;
  const bg = props.tone === 'red' ? TINT.red : props.tone === 'amber' ? TINT.amber : C.light;
  const spot = useHelpSpot(props.label, props.help, props.onPress);
  const onPress = spot.onPress;
  return (
    <Pressable onPress={onPress} disabled={props.disabled && !spot.id} accessibilityRole="button" accessibilityLabel={props.label}
      {...a11yState({ disabled: !!props.disabled }, 'button')}
      style={({ pressed }) => [styles.ghost, { backgroundColor: bg }, props.full === false && { alignSelf: 'flex-start', paddingHorizontal: space.xl },
        props.disabled && { opacity: 0.5 }, pressed && styles.pressed]}>
      {props.icon ? <Ico name={props.icon} size={22} color={fg} /> : null}
      <Text style={[styles.ghostLabel, { color: fg }]}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A 48pt outlined button for actions inside a card. */
export function SmallBtn(props: { label: string; onPress: () => void; icon?: IconName; tone?: 'primary' | 'plain' | 'dark'; disabled?: boolean;
  /** What help mode says it does. */ help?: string; testID?: string }) {
  const filled = props.tone === 'primary' || props.tone === 'dark';
  const bg = props.tone === 'dark' ? C.dark : C.primary;
  const spot = useHelpSpot(props.label, props.help, props.onPress);
  const onPress = spot.onPress;
  return (
    <Pressable testID={props.testID} onPress={onPress} disabled={props.disabled && !spot.id} accessibilityRole="button" accessibilityLabel={props.label}
      {...a11yState({ disabled: !!props.disabled }, 'button')}
      style={({ pressed }) => [styles.small, filled ? { backgroundColor: bg, borderColor: bg } : null, props.disabled && { opacity: 0.45 }, pressed && styles.pressed]}>
      {props.icon ? <Ico name={props.icon} size={18} color={filled ? C.white : C.primary} /> : null}
      <Text style={[styles.smallLabel, { color: filled ? C.white : C.primary }]}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A plain text action (Show all, Undo). Still 48pt tall. */
export function LinkBtn(props: { label: string; onPress: () => void; color?: string; style?: StyleProp<ViewStyle>; accessibilityLabel?: string; expanded?: boolean;
  /** What help mode says it does. */ help?: string }) {
  const spot = useHelpSpot(props.label, props.help, props.onPress);
  return (
    <Pressable onPress={spot.onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={props.accessibilityLabel}
      {...a11yState(props.expanded !== undefined ? { expanded: props.expanded } : undefined, 'button')}
      style={({ pressed }) => [styles.linkBtn, props.style, pressed && styles.pressed]}>
      <Text style={[txt.link, props.color ? { color: props.color } : null]}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

// While help is on, a greyed-out control still explains itself: why it is
// there is most worth asking when it cannot be used yet. So `disabled` only
// holds while help is off.

/**
 * The quiet links under a screen's one main button (demo ADR-032, ADR-033):
 * the less likely ways forward, one labelled tap away, never competing with
 * the main action.
 */
export function QuietLinks(props: { items: { label: string; icon: IconName; onPress: () => void;
  /** What help mode says it does; else "Another way forward, less often needed." */ help?: string }[] }) {
  return (
    <View style={styles.quietRow}>
      {/* help-each: each link does something different */}
      {props.items.map((it) => <QuietLink key={it.label} {...it} />)}
    </View>
  );
}

function QuietLink(props: { label: string; icon: IconName; onPress: () => void; help?: string }) {
  const spot = useHelpSpot(props.label, props.help ?? t('help.details.quiet'), props.onPress);
  const onPress = spot.onPress;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={4} style={({ pressed }) => [styles.quiet, pressed && styles.pressed]}>
      <Ico name={props.icon} size={18} color={C.muted} />
      <Text style={[txt.sm, styles.quietLabel]}>{props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

export function IconBtn(props: { name: IconName; onPress: () => void; label: string; color?: string; bg?: string; size?: number; disabled?: boolean; testID?: string;
  /** What help mode says it does. */ help?: string }) {
  const size = props.size ?? 48;
  const spot = useHelpSpot(props.label, props.help, props.onPress);
  // On the web an icon names itself on hover, as a button with words would (UI audit, findings 75 and 76).
  const ref = useRef<View>(null);
  useEffect(() => {
    if (Platform.OS === 'web') (ref.current as unknown as { setAttribute?: (k: string, v: string) => void } | null)?.setAttribute?.('title', props.label);
  }, [props.label]);
  return (
    <Pressable ref={ref} {...(props.testID ? { testID: props.testID } : {})} onPress={spot.onPress} disabled={props.disabled && !spot.id} accessibilityRole="button" accessibilityLabel={props.label}
      {...a11yState({ disabled: !!props.disabled }, 'button')} hitSlop={Math.max(0, (target.min - size) / 2)}
      style={({ pressed }) => [{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center', backgroundColor: props.bg ?? C.bg },
        props.disabled && { opacity: 0.4 }, pressed && styles.pressed]}>
      <Ico name={props.name} size={Math.round(size * 0.46)} color={props.color ?? C.dark} />
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** A selectable pill. */
export function Chip(props: { label: string; on: boolean; onPress: () => void; icon?: IconName; count?: number; accessibilityLabel?: string;
  /** What help mode says picking it does. */ help?: string }) {
  const spot = useHelpSpot(props.label, props.help, props.onPress);
  const onPress = spot.onPress;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" {...a11yState({ selected: props.on }, 'button')} accessibilityLabel={props.accessibilityLabel}
      // A chip is a toggle: on the web, a pressed button ("Mark, pressed"). react-native-web drops accessibilityState.selected.
      aria-pressed={props.on}
      style={({ pressed }) => [styles.chip, props.on ? { backgroundColor: C.primary, borderColor: C.primary } : null, pressed && styles.pressed]}>
      {props.icon ? <Ico name={props.icon} size={18} color={props.on ? C.white : C.primary} /> : null}
      <Text style={[styles.chipLabel, { color: props.on ? C.white : C.dark }]}>{props.count !== undefined ? t('shell.kit.chipCount', { label: props.label, number: formatNumber(props.count) }) : props.label}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/** Pills in a row that scrolls sideways (filters, a long list of places); a few tabs within a screen wrap instead (ChipWrap). */
export function ChipRow(props: { children: ReactNode }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm, paddingVertical: 2 }}>{props.children}</ScrollView>;
}

/**
 * A choice among a few: pills that wrap onto more lines, so every choice is
 * in sight in every language rather than one sitting past the edge (decisions.md 139).
 */
export function ChipWrap(props: { children: ReactNode }) {
  return <View style={styles.chipWrap}>{props.children}</View>;
}

/**
 * On the web a Switch is an input, a focus stop. Drawn inside a Row that is the
 * switch it would be a focusable element within a switch (axe nested-interactive,
 * the language page's "Show on the public list"): the row alone is the stop.
 * The web's Switch hands its ref to that input. Only a disabled input stops being
 * focusable (axe counts tabindex -1 as focusable), and the `disabled` prop would
 * grey the drawing, so the input itself is disabled, again after each render,
 * since React sets it back whenever the prop changes.
 */
function unfocusable(el: unknown): void {
  const input = el as { disabled?: boolean; setAttribute?: (name: string, value: string) => void } | null;
  if (!input?.setAttribute) return;
  input.disabled = true;
  input.setAttribute('tabindex', '-1');
}

export function Toggle(props: { on: boolean; onToggle: () => void; label: string; disabled?: boolean; testID?: string;
  /** What help mode says it turns on. */ help?: string;
  /** Drawn inside a row that is the switch (Row's `role="switch"`): the row explains it. */ drawnOnly?: boolean }) {
  const spot = useHelpSpot(props.label, props.help ?? (props.on ? t('help.details.switchOn') : t('help.details.switchOff')), props.drawnOnly ? undefined : props.onToggle);
  const input = useRef<Switch>(null);
  const drawnOnWeb = !!props.drawnOnly && Platform.OS === 'web';
  useEffect(() => { if (drawnOnWeb) unfocusable(input.current); });
  return (
    <View>
      <Switch {...(props.testID ? { testID: props.testID } : {})} {...(drawnOnWeb ? { ref: input } : {})} value={props.on} onValueChange={props.onToggle} disabled={props.disabled || !!spot.id} accessibilityLabel={props.label}
        trackColor={{ true: C.primary, false: C.border }} thumbColor={C.white} ios_backgroundColor={C.border}
        // On the web an on switch's thumb is react-native-web's teal unless it is given its own colour.
        {...(Platform.OS === 'web' ? ({ activeThumbColor: C.white } as object) : {})} />
      <HelpCover spot={spot} label={props.label} />
    </View>
  );
}

/**
 * While help is on, over a control that is not a button (a field, a
 * switch): takes its tap so it explains itself instead of opening the
 * keyboard or switching, and lights and numbers it.
 */
function HelpCover(props: { spot: HelpSpot<(() => void) | undefined>; label: string; inset?: boolean }) {
  if (!props.spot.id) return null;
  return (
    <Pressable onPress={props.spot.onPress} accessibilityRole="button" accessibilityLabel={props.label} style={StyleSheet.absoluteFill}>
      <HelpBadge spot={props.spot} {...(props.inset ? { inset: true } : {})} />
    </Pressable>
  );
}

/**
 * Something that needs explaining but does nothing when tapped: a mark in
 * colour or shape, a bar, a number without its unit. While help is on it
 * lights, numbers and explains like a button; otherwise taps pass through
 * to whatever holds it. Where it sits inside a part that explains itself,
 * say what it means in that part's help instead.
 */
export function HelpInfo(props: { label: string; detail: string; children: ReactNode; style?: StyleProp<ViewStyle>; inset?: boolean }) {
  const spot = useHelpInfo(props.label, props.detail);
  return (
    <Pressable onPress={spot.id ? spot.onPress : undefined} disabled={!spot.id} accessible={!!spot.id} accessibilityLabel={spot.id ? props.label : undefined}
      style={props.style}>
      {props.children}
      <HelpBadge spot={spot} {...(props.inset ? { inset: true } : {})} />
    </Pressable>
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
  /** What Enter (or the keyboard's Go) does in a one-line field: the screen's main action, where there is one. */
  onSubmit?: () => void;
  /** For the UI tests: iOS does not expose a multi-line field's placeholder. */
  testID?: string;
  /** What a screen reader calls a field with no label, when its placeholder does not say it. */
  accessibilityLabel?: string;
  /** What help mode says to type here and what it is for, where the label does not say it. */
  help?: string;
}) {
  const name = props.label ?? props.accessibilityLabel ?? props.placeholder ?? '';
  const spot = useHelpSpot(name, props.help ?? t('help.details.field'), TYPE_HERE);
  return (
    <View style={{ gap: space.xs }}>
      {props.label ? <Text style={txt.xsStrong}>{props.label}</Text> : null}
      <View>
      <TextInput value={props.value} onChangeText={props.onChangeText} placeholder={props.placeholder} placeholderTextColor={C.faint} editable={!spot.id}
        accessibilityLabel={props.label ?? props.accessibilityLabel ?? props.placeholder}
        {...(props.onSubmit && !props.multiline ? { onSubmitEditing: props.onSubmit, returnKeyType: 'go' as const } : {})}
        {...(props.testID ? { testID: props.testID } : {})}
        multiline={props.multiline} secureTextEntry={props.secure} keyboardType={props.keyboardType} autoCapitalize={props.autoCapitalize}
        style={[styles.field, inputDirection(), props.multiline && { minHeight: 88, textAlignVertical: 'top', paddingTop: 14 }, props.style]} />
      <HelpCover spot={spot} label={name} />
      </View>
    </View>
  );
}

/** A field's press while help is on: it explains itself; typing waits until help is off. */
const TYPE_HERE = () => undefined;

export function SearchField(props: { value: string; onChangeText: (v: string) => void; placeholder: string; testID?: string;
  /** What help mode says it finds, where the placeholder does not say it. */ help?: string;
  /**
   * A filter set from elsewhere on the screen, held in the bar as a chip
   * with its own ✕ ("Goes with FIA study guides"); words typed narrow it.
   */
  filter?: { label: string; clearLabel: string; clearHelp: string; onClear: () => void } }) {
  const spot = useHelpSpot(props.placeholder, props.help ?? t('help.details.search'), TYPE_HERE);
  return (
    <View style={[styles.search, props.filter && styles.searchFiltered, (!!props.value || !!props.filter) && { borderColor: C.primary }]}>
      <Ico name="search" size={24} color={C.muted} />
      {props.filter ? (
        <View style={styles.searchChip}>
          {/* The chip's words show in full, wrapping before they are cut off (decisions.md 139). */}
          <Text style={styles.searchChipLabel}>{props.filter.label}</Text>
          <IconBtn name="close" size={28} bg={C.card} color={C.primary} label={props.filter.clearLabel} help={props.filter.clearHelp} onPress={props.filter.onClear} />
        </View>
      ) : null}
      <TextInput {...(props.testID ? { testID: props.testID } : {})} value={props.value} onChangeText={props.onChangeText} placeholder={props.filter ? undefined : props.placeholder} placeholderTextColor={C.faint}
        editable={!spot.id} autoCapitalize="none" autoCorrect={false} returnKeyType="search" accessibilityLabel={props.placeholder}
        style={[styles.searchInput, props.filter && styles.searchInputBeside, inputDirection()]} />
      {props.value ? <IconBtn name="close" label={t('shell.kit.clearSearch')} help={t('help.details.clearSearch')} onPress={() => props.onChangeText('')} bg="transparent" color={C.muted} /> : null}
      <HelpCover spot={spot} label={props.placeholder} />
    </View>
  );
}

/** "Show 25 more · 1,164 left": long lists grow on request (ADR-009). */
export function ShowMore(props: { remaining: number; step: number; onMore: () => void }) {
  const label = t('shell.kit.showMore', { count: Math.min(props.step, Math.max(props.remaining, 0)), left: formatNumber(props.remaining) });
  const spot = useHelpSpot(label, t('help.details.showMore'), props.remaining > 0 ? props.onMore : undefined);
  if (props.remaining <= 0) return null;
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" style={({ pressed }) => [styles.showMore, pressed && styles.pressed]}>
      <Text style={[txt.body, { color: C.primary, fontWeight: '600' }]}>{label}</Text>
      <HelpBadge spot={spot} />
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
      <Text style={[txt.xsStrong, { color: fg, textAlign: 'center' }]}>{props.label}</Text>
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

/**
 * A bar that keeps moving while something runs whose length is not known, so
 * a long wait never looks frozen. On a phone it moves on the native side, so
 * it keeps going while JavaScript is busy.
 */
export function MovingBar(props: { color?: string; height?: number }) {
  const h = props.height ?? 6;
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(x, { toValue: 1, duration: 1300, easing: Easing.inOut(Easing.quad), useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [x]);
  const run = width * 0.4;
  const ends = isRtl() ? [width, -run] : [-run, width];
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} accessibilityRole="progressbar" {...a11yState({ busy: true }, 'progressbar')}
      style={{ height: h, borderRadius: h, backgroundColor: C.border, overflow: 'hidden' }}>
      {width ? (
        <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: run, height: h, borderRadius: h, backgroundColor: props.color ?? C.muted,
          transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: ends }) }] }} />
      ) : null}
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

/** A screen's empty or waiting state; `busy` turns the icon into a spinner, so work under way does not read as an answer. */
export function EmptyState(props: { icon?: IconName; title: string; sub?: string; busy?: boolean; children?: ReactNode }) {
  return (
    <View style={styles.empty} {...(props.busy ? { accessibilityLiveRegion: 'polite' as const } : {})}>
      <View style={[styles.iconTile, { width: 64, height: 64, borderRadius: 20 }]}>
        {props.busy ? <ActivityIndicator color={C.primary} /> : <Ico name={props.icon ?? 'sparkle'} size={30} color={C.primary} />}
      </View>
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
/** A note; `action` sits at the end of its by-line (report or block someone else's: reportSheet.tsx). */
export function NoteCard(props: { anchor: string; text?: string; by: string; when: string; olderVersion?: string; audio?: ReactNode; icon?: IconName; action?: ReactNode }) {
  return (
    <View style={styles.note}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <Ico name={props.icon ?? 'note'} size={14} color={TINT.amberText} />
        <Text style={[txt.xsStrong, { color: TINT.amberText }]}>{props.anchor}</Text>
        {props.olderVersion ? <View style={styles.noteTag}><Text style={[txt.xsStrong, { color: TINT.amberText }]}>{t('shell.kit.onOlderVersion', { version: props.olderVersion })}</Text></View> : null}
      </View>
      {props.text ? <Text style={[txt.sm, { marginTop: 6 }]}>{props.text}</Text> : null}
      {props.audio ? <View style={{ marginTop: 6 }}>{props.audio}</View> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: space.sm }}>
        <Text style={[txt.xs, { flex: 1 }]}>{props.by} · {props.when}</Text>
        {props.action}
      </View>
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

/**
 * A bottom sheet: darkened backdrop, rounded top, ✕ to close. Never a flow
 * node. On a wide window it is a centred dialog instead (decisions.md 55).
 */
export function Sheet(props: { visible: boolean; title: string; sub?: string; onClose: () => void; children: ReactNode; footer?: ReactNode;
  /** Beside the title, before ? and ✕: the saved mark of what the sheet keeps as you go (SavedMark.tsx). */ action?: ReactNode;
  /** A phone's Back in a sheet of several steps: the step before, as its own Back does (decision 137). Else Back closes it. */
  onBack?: () => void }) {
  const insets = useSafeAreaInsets();
  const wide = useLayout().kind !== 'phone';
  const host = useHelpHost(props.visible);
  // The toast shows on the sheet on top, as the screen's would be hidden under it (toastLayer.ts).
  const onTop = useSheetOnTop(props.visible);
  return (
    <Modal visible={props.visible} transparent animationType={wide ? 'fade' : 'slide'} onRequestClose={props.onBack ?? props.onClose}>
      <HelpHost id={host}>
      <KeyboardSafe style={[{ flex: 1 }, wide && styles.dialogFrame]}>
        {/* help-ignore: the darkened backdrop; tapping outside the sheet closes it, as everywhere */}
        <Pressable style={wide ? styles.dialogBackdrop : styles.sheetBackdrop} onPress={props.onClose} accessibilityLabel={t('common.close')} />
        <View testID="sheet" style={wide ? styles.dialog : [styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
          {wide ? null : <View style={styles.sheetGrip} />}
          <View style={styles.sheetHead}>
            <View style={{ flex: 1 }}>
              <Text style={txt.title}>{props.title}</Text>
              {props.sub ? <Text style={[txt.smMuted, { marginTop: 4 }]}>{props.sub}</Text> : null}
            </View>
            {props.action}
            <HelpToggle testID="sheet-help" />
            <IconBtn testID="sheet-close" name="close" label={t('common.close')} help={t('help.details.closeSheet')} onPress={props.onClose} bg={C.card} color={C.muted} />
          </View>
          <HelpClip style={{ flexShrink: 1 }}>
            <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: space.md, paddingHorizontal: space.xl, paddingBottom: space.lg }} keyboardShouldPersistTaps="handled">
              {props.children}
            </ScrollView>
          </HelpClip>
          {props.footer ? <View style={{ paddingHorizontal: space.xl, gap: space.sm }}>{props.footer}</View> : null}
        </View>
      </KeyboardSafe>
      </HelpHost>
      {onTop ? <SheetToast top={insets.top + space.md} /> : null}
      <ModalCover />
    </Modal>
  );
}

/** The toast, drawn on the sheet on top: at its top, clear of the sheet's buttons. */
function SheetToast(props: { top: number }) {
  const shown = useShownToast();
  return <ToastView toast={shown.toast} onDismiss={shown.dismiss} top={props.top} />;
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
        // i18n-ignore: stored in the event log as the reason when only a voice note was given; stays English like the rest of the log
        onPress={() => { props.onConfirm({ reason: reason.trim() || 'Explained in a voice note.', ...(hash ? { blobHash: hash } : {}) }); setReason(''); setHash(null); }} />}>
      {props.quickReasons.length > 0 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {props.quickReasons.map((q) => <HelpRow key={q} of="kit.reason"><QuickReason reason={q} on={reason === q} onPick={() => setReason(q)} /></HelpRow>)}
      </View> : null}
      {props.voice ? props.voice({ hash, onChange: setHash }) : null}
      <Field value={reason} onChangeText={setReason} placeholder={props.quickReasons.length ? t('shell.kit.orTypeReason') : t('common.orTypeIt')} multiline />
      <Text style={txt.xs}>{props.footnote ?? t('shell.kit.reasonFootnote')}</Text>
    </Sheet>
  );
}

/** A common reason, one tap to use (ReasonSheet). */
function QuickReason(props: { reason: string; on: boolean; onPick: () => void }) {
  const spot = useHelpSpot(props.reason, t('help.details.quickReason'), props.onPick);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" {...a11yState({ selected: props.on }, 'button')}
      style={({ pressed }) => [styles.quickReason, props.on ? { backgroundColor: C.dark, borderColor: C.dark } : null, pressed && styles.pressed]}>
      <Text style={[txt.sm, { fontWeight: '600', color: props.on ? C.white : C.dark, flexShrink: 1 }]}>{props.reason}</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

// ---- toasts ----------------------------------------------------------------------------------

export type { ToastSpec } from './toastModel';

/** The toast last announced, by id. */
let announcedToast = 0;

/**
 * What changed (CORE-5), and nothing to do about it: a toast never offers
 * Undo, which would run out with it (Caleb, 2026-10-16; decision 134). The
 * way back stays where the thing is: its own Undo and Redo, its history row,
 * or the same control. The message is announced as it appears. A bar along
 * its foot shrinks until it goes, and a big X (or tapping the message)
 * closes it sooner. The host places it above the screen's buttons, never
 * over them.
 */
export function ToastView(props: { toast: ToastSpec | null; onDismiss: () => void } & ({ bottom: number } | { top: number })) {
  const toast = props.toast;
  const wide = useLayout().kind !== 'phone';
  const left = useRef(new Animated.Value(1)).current;
  // With reduce motion on, no bar runs down (A11Y-8): the toast still goes by itself, and the screen stays still.
  const still = useReduceMotion();
  // A problem stays until closed, with no bar, and never wears the check (toastModel.ts).
  const look = toastLook(toast ?? {});
  const bar = !!toast?.ms && look.goesBy && !still;
  useEffect(() => {
    // Once per toast, though it moves between the screen and a sheet (toastLayer.ts).
    if (!toast || toast.id === announcedToast) return;
    announcedToast = toast.id;
    AccessibilityInfo.announceForAccessibility(toast.message);
  }, [toast?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- announced once per toast: its words do not change for its id
  useEffect(() => {
    if (!bar) return;
    left.setValue(1);
    const run = Animated.timing(left, { toValue: 0, duration: toast.ms, easing: Easing.linear, useNativeDriver: false });
    run.start();
    return () => run.stop();
  }, [toast?.id, toast?.ms, bar, left]);
  if (!toast) return null;
  return (
    <View style={[{ pointerEvents: 'box-none' }, styles.toastWrap, 'top' in props ? { top: props.top } : { bottom: props.bottom }]}>
      <View style={[styles.toast, wide && { maxWidth: measure.toast }]}>
        {/* help-ignore: a toast goes by itself in a few seconds; help explains what stays on the screen */}
        <Pressable testID="toast" onPress={props.onDismiss} accessibilityRole="button" accessibilityLabel={t('shell.toast.dismissLabel', { message: toast.message })}
          accessibilityLiveRegion={look.live} style={styles.toastMessage}>
          <Ico name={look.icon} size={20} color={C[look.color]} />
          <Text style={[txt.sm, { color: C.white, flex: 1, fontWeight: '600' }]}>{toast.message}</Text>
        </Pressable>
        {/* help-ignore: the toast's close, gone in a few seconds with the toast. Named apart from a sheet's ✕, as it now shows on the sheet too. */}
        <IconBtn name="close" label={t('shell.toast.close')} onPress={props.onDismiss} bg="transparent" color={C.white} size={target.min} />
        {bar ? (
          <View style={[styles.toastTrack, { pointerEvents: 'none' }]}>
            <Animated.View style={[styles.toastLeft, { width: left.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.bg },
  body: { padding: space.lg, gap: space.md, paddingBottom: space.xxl },
  footer: { paddingHorizontal: space.lg, paddingTop: space.md, gap: space.sm, backgroundColor: C.card, borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  column: { width: '100%', maxWidth: measure.column, alignSelf: 'center' },
  footerActions: { width: '100%', maxWidth: measure.action, alignSelf: 'center', gap: space.sm },
  pressed: { opacity: 0.7 },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: C.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  headerBar: { backgroundColor: C.card, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  headerCentred: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, backgroundColor: C.bg },
  headerCentredTall: { gap: space.xs, paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, backgroundColor: C.bg },
  headerTop: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  headerUnder: { flexDirection: 'row', paddingHorizontal: space.sm },
  headerHome: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.lg, paddingBottom: space.sm, backgroundColor: C.bg },
  homeTitle: { fontSize: T.xxl, fontWeight: '800', color: C.dark },
  centredTitle: { fontSize: T.lg, fontWeight: '800', color: C.dark, textAlign: 'center' },
  roundBtn: { width: target.min, height: target.min, borderRadius: target.min / 2, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  headerBack: { width: target.min, height: target.min, borderRadius: target.min / 2, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', marginLeft: -space.xs },
  crumbs: { alignItems: 'center', gap: 2 },
  crumb: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  crumbTap: { minHeight: 32, justifyContent: 'center' },
  crumbLink: { fontSize: T.sm, fontWeight: '700', color: C.primary, maxWidth: 200 },
  card: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, padding: space.lg, gap: space.md, ...shadow },
  cardCurrent: { borderColor: C.primary, borderWidth: 2 },
  group: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, overflow: 'hidden', ...shadow },
  sectionLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm, paddingHorizontal: space.xs, paddingTop: space.md },
  orDivider: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  orRule: { flex: 1, height: StyleSheet.hairlineWidth * 2, backgroundColor: C.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, paddingHorizontal: space.lg, paddingVertical: space.md, backgroundColor: C.card },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  rowCurrent: { backgroundColor: C.light },
  iconTile: { width: 44, height: 44, borderRadius: 14, backgroundColor: C.light, alignItems: 'center', justifyContent: 'center' },
  disclosure: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, overflow: 'hidden', ...shadow },
  disclosureHead: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: target.row, paddingHorizontal: space.lg, paddingVertical: space.md },
  disclosureBody: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  primary: { minHeight: target.primary, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs, flexShrink: 1, maxWidth: '100%' },
  // A label longer than its button wraps inside it, never past its edge (decisions.md 139).
  primaryLabel: { color: C.white, fontSize: T.base, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  ghost: { minHeight: target.primary, borderRadius: radius.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingHorizontal: space.lg, paddingVertical: space.xs, flexShrink: 1, maxWidth: '100%' },
  ghostLabel: { fontSize: T.base, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  small: { minHeight: target.min, borderRadius: radius.md, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: space.xs, flexShrink: 1, maxWidth: '100%' },
  smallLabel: { fontSize: T.sm, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  linkBtn: { minHeight: target.min, justifyContent: 'center' },
  helpTop: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.lg, paddingTop: space.sm },
  helpTopShared: { justifyContent: 'space-between', alignItems: 'center' },
  helpBtn: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
  quietRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.xs },
  quiet: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: target.min, paddingHorizontal: space.sm, flexShrink: 1, maxWidth: '100%' },
  quietLabel: { color: C.muted, fontWeight: '700', flexShrink: 1, textAlign: 'center' },
  chip: { minHeight: target.min, borderRadius: radius.full, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.lg, flexShrink: 1 },
  chipLabel: { fontSize: T.sm, fontWeight: '700', flexShrink: 1 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  field: { minHeight: target.primary, borderRadius: radius.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, paddingHorizontal: space.lg, fontSize: T.base, color: C.dark },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: target.primary, borderRadius: radius.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, paddingLeft: space.lg, paddingRight: space.xs },
  searchInput: { flex: 1, fontSize: T.base, color: C.dark, paddingVertical: space.md },
  searchFiltered: { paddingVertical: space.xs },
  searchInputBeside: { minWidth: target.min },
  searchChip: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexShrink: 1, minHeight: 36, borderRadius: radius.md, backgroundColor: C.light, paddingLeft: space.md, paddingRight: space.xs, paddingVertical: 2 },
  searchChipLabel: { fontSize: T.sm, fontWeight: '700', color: C.primary, flexShrink: 1 },
  showMore: { minHeight: target.primary, borderRadius: radius.lg, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, alignItems: 'center', justifyContent: 'center' },
  badge: { borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'center', flexShrink: 1, maxWidth: '100%' },
  rowBadge: { flexShrink: 1, maxWidth: '40%' },
  rowRight: { flexShrink: 1, maxWidth: '45%', alignItems: 'flex-end' },
  empty: { alignItems: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.xl },
  note: { backgroundColor: TINT.note, borderWidth: 1, borderColor: TINT.noteBorder, borderRadius: radius.lg, paddingHorizontal: space.lg, paddingVertical: space.md },
  noteTag: { backgroundColor: TINT.noteBorder, borderRadius: radius.full, paddingHorizontal: 6, paddingVertical: 1 },
  banner: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', padding: space.lg, borderRadius: radius.lg },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(15,18,28,0.45)' },
  sheet: { backgroundColor: C.bg, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, maxHeight: '88%', paddingTop: space.sm, gap: space.sm },
  dialogFrame: { alignItems: 'center', justifyContent: 'center', padding: space.xl },
  dialogBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(15,18,28,0.45)' },
  dialog: { backgroundColor: C.bg, borderRadius: radius.sheet, width: '100%', maxWidth: measure.sheet, maxHeight: '80%', paddingTop: space.md, paddingBottom: space.xl, gap: space.sm, ...lift({ opacity: 0.2 }) },
  sheetGrip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: C.border },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.xl, paddingTop: space.sm },
  quickReason: { borderRadius: radius.md, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, paddingHorizontal: space.md, paddingVertical: space.sm, minHeight: target.min, justifyContent: 'center', maxWidth: '100%' },
  toastWrap: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: C.dark, borderRadius: radius.lg, paddingLeft: space.lg, paddingRight: space.xs, paddingTop: space.xs, paddingBottom: space.xs + 4, minHeight: 56, width: '100%', overflow: 'hidden', ...lift({ opacity: 0.25 }) },
  toastTrack: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: 'rgba(255,255,255,0.15)' },
  toastLeft: { height: 4, backgroundColor: C.light },
  toastMessage: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 48, paddingVertical: space.xs },
});
