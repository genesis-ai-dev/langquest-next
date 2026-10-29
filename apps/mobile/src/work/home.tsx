// The simple My Work's parts (decision 71; demo ADR-032, ADR-039): the bell
// in place of an Inbox tab, one "Next for you" card with one big button, the
// coordinator's "Get ‹language› ready" card, and quiet links that open in
// place. Built on the kit, and every press goes through help mode.
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { useHelpSpot } from '../helpMode/useHelpMode';
import { HelpBadge } from '../helpMode/helpBadge';
import { t } from '../i18n';
import { formatNumber } from '../i18n/format';
import { HelpInfo, Ico, PrimaryBtn, type IconName } from '../ui/kit';
import { txt } from '../ui/textStyles';
import { C, onColor, radius, space, target, type as T } from '../ui/theme';

/**
 * Updates (the demo's bell): a round button with the unread count, in place
 * of the Inbox tab for everyone with a My Work. The count is what the Inbox
 * tab used to show: unread updates, open reports and people asking to join.
 */
export function Bell(props: { count: number; onPress: () => void }) {
  const label = props.count ? t('work.bell.labelNew', { count: props.count }) : t('work.bell.label');
  // The number on it says how many are new (rule 3).
  const spot = useHelpSpot(t('work.bell.label'), props.count > 0 ? `${t('work.bell.help')} ${t('work.bell.countHelp')}` : t('work.bell.help'), props.onPress);
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.bell, pressed && styles.pressed]}>
      <Ico name="notif" size={24} color={C.dark} />
      {props.count > 0 ? (
        <View style={[styles.badge, { pointerEvents: 'none' }]}>
          <Text style={styles.badgeText}>{props.count > 99 ? t('work.bell.overMax', { max: formatNumber(99) }) : formatNumber(props.count)}</Text>
        </View>
      ) : null}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

/**
 * The one thing to do next (demo ADR-032): a small label, the passage big, a
 * line saying what to do, and one big button. Hick's law: the likely choice
 * is the obvious one; everything else waits below it. `help`: what help mode
 * says the button does, where its label ("Start") does not say it.
 */
export function NextCard(props: { label: string; title: string; sub?: string; cta: string; onPress: () => void; children?: ReactNode; below?: ReactNode; help?: string }) {
  return (
    <View style={styles.next}>
      <Text style={styles.nextLabel}>{props.label}</Text>
      {props.children}
      <View style={{ gap: 2 }}>
        <Text style={styles.nextTitle} accessibilityRole="header">{props.title}</Text>
        {props.sub ? <Text style={styles.nextSub}>{props.sub}</Text> : null}
      </View>
      {props.below}
      <PrimaryBtn label={props.cta} icon="right" onPress={props.onPress} {...(props.help ? { help: props.help } : {})} />
    </View>
  );
}

/**
 * A coordinator's Home leads with getting the language ready until it is
 * (demo ADR-039, amended 2026-10-07): how far, as four segments, and the next
 * question with one button.
 */
export function ReadyCard(props: { language: string; done: number; total: number; question: string; onChoose: () => void }) {
  return (
    <NextCard label={t('work.readyCard.label', { language: props.language, done: formatNumber(props.done), total: formatNumber(props.total) })}
      title={props.question} cta={t('work.readyCard.choose')} onPress={props.onChoose} help={t('work.readyCard.chooseHelp')}>
      <HelpInfo label={t('work.readyCard.progress', { done: formatNumber(props.done), count: props.total })} detail={t('work.readyCard.progressHelp')}>
        <View style={styles.segments} accessible accessibilityRole="progressbar"
          accessibilityLabel={t('work.readyCard.progress', { done: formatNumber(props.done), count: props.total })}>
          {Array.from({ length: props.total }, (_, i) => (
            <View key={i} style={[styles.segment, { backgroundColor: i < props.done ? C.green : C.border }]} />
          ))}
        </View>
      </HelpInfo>
    </NextCard>
  );
}

/**
 * A quiet line of text that opens something in place ("Waiting on others ·
 * 2"): less likely than the card above it, one labelled tap away (demo
 * ADR-032). 48pt tall. With `open`, it unfolds in place and shows a chevron
 * either way; without, it leads to another screen and shows `icon` before
 * its words, so the two never look alike (UI audit, finding 84).
 */
export function QuietToggle(props: { label: string; onPress: () => void; open?: boolean; detail?: string; icon?: IconName }) {
  const spot = useHelpSpot(props.label, props.detail, props.onPress);
  const toggle = props.open !== undefined;
  return (
    <Pressable onPress={spot.onPress} accessibilityRole="button" accessibilityLabel={props.label}
      {...(toggle ? { accessibilityState: { expanded: props.open } } : {})}
      style={({ pressed }) => [styles.quiet, pressed && styles.pressed]}>
      {!toggle ? <Ico name={props.icon ?? 'arrowR'} size={18} color={C.muted} /> : null}
      <Text style={styles.quietText}>{props.label}</Text>
      {toggle ? <Ico name={props.open ? 'up' : 'down'} size={18} color={C.muted} /> : null}
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  bell: { width: target.min, height: target.min, borderRadius: target.min / 2, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 22, minHeight: 22, paddingHorizontal: 5, borderRadius: 11, backgroundColor: onColor.amber, borderWidth: 2, borderColor: C.card, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: C.white, fontSize: T.xs, fontWeight: '800' },
  next: { backgroundColor: C.card, borderRadius: radius.xl, borderWidth: 2, borderColor: C.primary, padding: space.lg, gap: space.md },
  nextLabel: { fontSize: T.xs, fontWeight: '800', letterSpacing: 1.4, color: C.primary, textTransform: 'uppercase', marginBottom: space.xs },
  nextTitle: { fontSize: T.xl, fontWeight: '800', color: C.dark },
  nextSub: { ...txt.smMuted, fontSize: T.base, lineHeight: 23 },
  segments: { flexDirection: 'row', gap: space.sm },
  segment: { flex: 1, height: 6, borderRadius: 3 },
  quiet: { minHeight: target.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, alignSelf: 'center', paddingHorizontal: space.md },
  quietText: { fontSize: T.base, fontWeight: '600', color: C.muted }
});
