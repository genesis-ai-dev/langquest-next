import { StyleSheet } from './theme';
import Svg, { Circle } from 'react-native-svg';
import type { LucideIcon } from 'lucide-react-native';
import { CheckCircle2, ChevronLeft, Clock, ListChecks, MessageSquare, Mic, PencilLine, Reply } from 'lucide-react-native';
import type { TakeOutcome } from '@langquest-next/core';
import type { ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, space, tint } from './theme';
import { translateUi } from './uiLanguage';

export function Card(props: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, props.style]}>{props.children}</View>;
}

/**
 * The one primary action on a screen is `action` (yellow); everything else is
 * outline. User (oral-first) screens pass an icon and no label: the icon is
 * the meaning and `accessibilityLabel` carries the words. PM screens may add
 * a label.
 */
export function ActionButton(props: {
  icon?: LucideIcon;
  label?: string;
  accessibilityLabel: string;
  onPress: () => void;
  onLongPress?: () => void;
  variant?: 'action' | 'outline';
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
}) {
  const outline = props.variant === 'outline';
  const fg = outline ? colors.foreground : colors.actionForeground;
  const Icon = props.icon;
  const iconOnly = Icon !== undefined && props.label === undefined;
  return (
    <Pressable
      onPress={props.onPress}
      onLongPress={props.onLongPress}
      disabled={props.disabled}
      accessibilityRole="button"
      accessibilityLabel={translateUi(props.accessibilityLabel)}
      accessibilityState={{ disabled: !!props.disabled }}
      style={({ pressed }) => [
        styles.button,
        iconOnly && styles.buttonIconOnly,
        outline ? styles.buttonOutline : styles.buttonAction,
        pressed && { opacity: 0.85 },
        props.disabled && { backgroundColor: colors.muted, borderColor: colors.border, borderWidth: 1, borderStyle: 'dashed' },
        props.style
      ]}
    >
      {Icon ? <Icon size={iconOnly ? 30 : 20} color={fg} strokeWidth={iconOnly ? 2.25 : 2} /> : null}
      {props.label ? <Text style={[styles.buttonLabel, { color: fg }]}>{translateUi(props.label)}</Text> : null}
    </Pressable>
  );
}

/** Cross-session progress with a semantic value and a non-colour signal. */
export function ProgressRing(props: {
  completed: number;
  total: number;
  size?: number;
  color?: string;
}) {
  const size = props.size ?? 64;
  const r = (size - 10) / 2;
  const circumference = 2 * Math.PI * r;
  const fraction = props.total ? Math.min(1, Math.max(0, props.completed / props.total)) : 0;
  return (
    <View accessible accessibilityRole="progressbar"
      accessibilityLabel={`${props.completed} of ${props.total} recorded`}
      accessibilityValue={{ min: 0, max: Math.max(1, props.total), now: props.completed }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={colors.border} strokeWidth={6} />
        <Circle cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={props.color ?? colors.done} strokeWidth={6}
          strokeLinecap="round" strokeDasharray={`${circumference * fraction} ${circumference}`}
          rotation={-90} origin={`${size / 2}, ${size / 2}`} />
      </Svg>
    </View>
  );
}

/** Take outcome as an icon, so status reads without words. */
export function StatusIcon(props: { outcome: TakeOutcome; size?: number }) {
  const size = props.size ?? 18;
  switch (props.outcome) {
    case 'approved':
      return <CheckCircle2 size={size} color={colors.done} />;
    case 'changes_requested':
      return <MessageSquare size={size} color={colors.review} />;
    case 'draft':
      return <PencilLine size={size} color={colors.mutedForeground} />;
    default:
      return <Clock size={size} color={colors.mutedForeground} />;
  }
}

export function IconCircleButton(props: {
  icon: LucideIcon;
  onPress: () => void;
  size?: number;
  accessibilityLabel: string;
}) {
  const size = props.size ?? 44;
  const Icon = props.icon;
  return (
    <Pressable
      onPress={props.onPress}
      accessibilityLabel={translateUi(props.accessibilityLabel)}
      style={({ pressed }) => [
        styles.circle,
        { width: size, height: size, backgroundColor: colors.action },
        pressed && { opacity: 0.85 }
      ]}
    >
      <Icon size={size * 0.5} color={colors.actionForeground} />
    </Pressable>
  );
}

/** Icon + colour per task type, so "what am I here to do" reads without a label. */
export const TASK_META = {
  translate: { icon: Mic, color: colors.translate, tint: tint.translate, badge: tint.translateBadge, bar: tint.translateBar },
  respond: { icon: Reply, color: colors.translate, tint: tint.translate, badge: tint.translateBadge, bar: tint.translateBar },
  review: { icon: ListChecks, color: colors.review, tint: tint.review, badge: tint.reviewBadge, bar: tint.reviewBar }
} as const;

export function RoleBadge(props: { type: 'translate' | 'review'; accessibilityLabel: string }) {
  const meta = TASK_META[props.type];
  const Icon = meta.icon;
  return (
    <View
      accessibilityLabel={translateUi(props.accessibilityLabel)}
      style={[styles.circle, { width: 36, height: 36, backgroundColor: meta.badge }]}
    >
      <Icon size={17} color={meta.color} />
    </View>
  );
}

/**
 * Translation and review on one track: a wide translated fill with a thinner
 * approved fill chasing it from the same edge, since approved is always a
 * subset of translated.
 */
export function DualProgressBar(props: { translatedPct: number; approvedPct: number; type: 'translate' | 'review' }) {
  const meta = TASK_META[props.type];
  const clamp = (v: number) => Math.max(0, Math.min(100, v));
  return (
    <View style={styles.track}>
      <View style={[styles.fillBase, { width: `${clamp(props.translatedPct)}%`, backgroundColor: meta.bar }]} />
      <View style={[styles.fillAccent, { width: `${clamp(props.approvedPct)}%`, backgroundColor: meta.color }]} />
    </View>
  );
}

export function BackButton(props: { onPress: () => void }) {
  return (
    <Pressable onPress={props.onPress} hitSlop={8} accessibilityLabel="Back" style={styles.back}>
      <ChevronLeft size={20} color={colors.foreground} />
    </Pressable>
  );
}

export const text = StyleSheet.create({
  h3: { fontSize: 22, fontWeight: '600', color: colors.foreground },
  h4: { fontSize: 17, fontWeight: '600', color: colors.foreground },
  body: { fontSize: 16, color: colors.foreground },
  muted: { fontSize: 14, color: colors.mutedForeground },
  small: { fontSize: 12, color: colors.mutedForeground }
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    height: 52,
    paddingHorizontal: space.xl,
    borderRadius: radius.md
  },
  buttonIconOnly: { height: 64, paddingHorizontal: space.lg },
  buttonAction: { backgroundColor: colors.action },
  buttonOutline: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  buttonLabel: { fontSize: 16, fontWeight: '600' },
  circle: { borderRadius: radius.full, alignItems: 'center', justifyContent: 'center' },
  track: {
    height: 12,
    width: '100%',
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    justifyContent: 'center',
    overflow: 'hidden'
  },
  fillBase: { position: 'absolute', height: 12, borderRadius: radius.full },
  fillAccent: { position: 'absolute', height: 6, borderRadius: radius.full },
  back: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start'
  }
});
