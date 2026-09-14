// Avatar P (project manager) primitives: text is fine here. Header with
// breadcrumbs, sections of rows, one pinned footer action (UX spec phone-ux).
import type { LucideIcon } from 'lucide-react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from './theme';
import { ActionButton, text } from './ui';

export function Screen(props: { children: ReactNode; footer?: ReactNode; tint?: string }) {
  return (
    <View style={[styles.screen, props.tint ? { backgroundColor: props.tint } : null]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {props.children}
      </ScrollView>
      {props.footer ? <View style={styles.footer}>{props.footer}</View> : null}
    </View>
  );
}

export function Header(props: {
  title: string;
  sub?: string;
  crumbs?: { label: string; onPress?: () => void }[];
  onBack?: () => void;
  action?: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        {props.onBack ? (
          <Pressable onPress={props.onBack} hitSlop={8} accessibilityLabel="Back" style={styles.back}>
            <ChevronLeft size={20} color={colors.foreground} />
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }}>
          {props.crumbs && props.crumbs.length > 0 ? (
            <View style={styles.crumbs}>
              {props.crumbs.map((c, i) => (
                <Pressable key={i} onPress={c.onPress} disabled={!c.onPress}>
                  <Text style={[text.small, c.onPress && { color: colors.translate }]}>
                    {c.label}
                    {i < props.crumbs!.length - 1 ? '  ›  ' : ''}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          <Text style={text.h3}>{props.title}</Text>
          {props.sub ? <Text style={text.muted}>{props.sub}</Text> : null}
        </View>
        {props.action}
      </View>
    </View>
  );
}

export function Section(props: { label: string; children?: ReactNode }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.sectionLabel}>{props.label.toUpperCase()}</Text>
      <View style={styles.group}>{props.children}</View>
    </View>
  );
}

export function Row(props: {
  icon?: LucideIcon;
  label: string;
  sub?: string;
  badge?: string;
  right?: ReactNode;
  onPress?: () => void;
  last?: boolean;
}) {
  const Icon = props.icon;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={!props.onPress}
      accessibilityRole={props.onPress ? 'button' : undefined}
      style={[styles.row, !props.last && styles.rowBorder]}
    >
      {Icon ? (
        <View style={styles.rowIcon}>
          <Icon size={18} color={colors.translate} />
        </View>
      ) : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={text.body} numberOfLines={1}>
          {props.label}
        </Text>
        {props.sub ? (
          <Text style={text.small} numberOfLines={2}>
            {props.sub}
          </Text>
        ) : null}
      </View>
      {props.badge ? <Badge label={props.badge} /> : null}
      {props.right ?? (props.onPress ? <ChevronRight size={16} color={colors.mutedForeground} /> : null)}
    </Pressable>
  );
}

export function Badge(props: { label: string; color?: string }) {
  const c = props.color ?? colors.mutedForeground;
  return (
    <View style={[styles.badge, { borderColor: c }]}>
      <Text style={[text.small, { color: c }]}>{props.label}</Text>
    </View>
  );
}

export function Note(props: { children: ReactNode }) {
  return (
    <View style={styles.note}>
      <Text style={text.muted}>{props.children}</Text>
    </View>
  );
}

/** A screen that exists in the flow but whose data is not wired yet. */
export function NotWired(props: { what: string }) {
  return <Note>{props.what} is in the flow but not wired to data yet.</Note>;
}

export function Footer(props: { label: string; onPress: () => void; disabled?: boolean; secondary?: { label: string; onPress: () => void } }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.sm }}>
      {props.secondary ? (
        <ActionButton
          label={props.secondary.label}
          accessibilityLabel={props.secondary.label}
          variant="outline"
          onPress={props.secondary.onPress}
          style={{ flex: 1 }}
        />
      ) : null}
      <ActionButton label={props.label} accessibilityLabel={props.label} onPress={props.onPress} disabled={props.disabled} style={{ flex: 1 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { gap: space.lg, padding: space.lg, paddingBottom: space.xl },
  footer: {
    padding: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.card
  },
  header: { gap: space.sm },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  back: {
    width: 36,
    height: 36,
    borderRadius: radius.full,
    backgroundColor: colors.muted,
    alignItems: 'center',
    justifyContent: 'center'
  },
  crumbs: { flexDirection: 'row', flexWrap: 'wrap' },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: colors.mutedForeground, paddingHorizontal: space.xs },
  group: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden'
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.md },
  rowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: 'rgba(10, 90, 219, 0.10)',
    alignItems: 'center',
    justifyContent: 'center'
  },
  badge: { borderWidth: 1, borderRadius: radius.full, paddingHorizontal: space.sm, paddingVertical: 2 },
  note: { backgroundColor: colors.muted, borderRadius: radius.md, padding: space.md }
});
