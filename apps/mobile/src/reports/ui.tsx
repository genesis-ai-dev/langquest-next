import { percent, recencyOf, type Coverage, type LanguageReport } from '@langquest-next/core';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui/text';
import { bookName } from '../i18n/coreText';
import { HelpBadge } from '../helpMode/helpBadge';
import { useHelpSpot } from '../helpMode/helpContext';
import { currentLocale, t, Trans } from '../i18n';
import { formatDay, formatDayYear, formatMonthShort, formatMonthYear, formatNumber, formatPercent } from '../i18n/format';
import { Badge, Card, Ico, txt, type IconName } from '../ui/kit';
import { C, radius, space, TINT } from '../ui/theme';
import { RECENCY_TONE, recencyLabel, scopeLabel, scopeShort } from './labels';
import { type Tone, TONE_FILL, num, pctText, signed, dateTime, ago, partOf, bookOf } from './format';
export { fileName, safeName, exportCsv, canPrint, printPage, languagesCsv, languageCsv, ledgerCsv } from './exportFiles';
export { type Tone, TONE_FILL, num, pctText, signed, shortDate, dayYear, weekday, longDay, monthName, monthShort, utcTime, dateTime, ago, partOf, bookOf } from './format';

/**
 * The Reports section's primitives (ported from the web dashboard, decision
 * 44): status colours never carry meaning alone, so every coloured mark sits
 * beside its words and number.
 */

const TONE_TEXT: Record<Tone, string> = { brand: C.primary, green: TINT.greenText, amber: TINT.amberText, red: TINT.redText, gray: TINT.grayText };
const BADGE_TONE: Record<Tone, 'brand' | 'green' | 'amber' | 'red' | 'default'> = { brand: 'brand', green: 'green', amber: 'amber', red: 'red', gray: 'default' };

export function ToneBadge(props: { tone: Tone; label: string }) {
  return <Badge tone={BADGE_TONE[props.tone]} label={props.label} />;
}

/** A card with a heading: what the web dashboard calls a card. */
export function Panel(props: { title?: string; eyebrow?: string; sub?: string; right?: ReactNode; children?: ReactNode }) {
  return (
    <Card style={{ gap: space.md }}>
      {props.title || props.eyebrow || props.right ? (
        <View style={styles.panelHead}>
          <View style={{ flex: 1, minWidth: 0 }}>
            {props.eyebrow ? <Text style={txt.label}>{props.eyebrow}</Text> : null}
            {props.title ? <Text style={txt.h3} accessibilityRole="header">{props.title}</Text> : null}
          </View>
          {props.right}
        </View>
      ) : null}
      {props.sub ? <Text style={txt.smMuted}>{props.sub}</Text> : null}
      {props.children}
    </Card>
  );
}

/** Children side by side when the window has room, stacked when it does not. */
export function Columns(props: { children: ReactNode; min?: number }) {
  return <View style={styles.columns}>{wrapEach(props.children, props.min ?? 340)}</View>;
}

function wrapEach(children: ReactNode, min: number): ReactNode {
  return (Array.isArray(children) ? children : [children]).filter(Boolean).map((c, i) => (
    <View key={i} style={{ flexGrow: 1, flexBasis: min, minWidth: 0 }}>{c}</View>
  ));
}

/** One figure. With `onOpen`, it opens what it counts (design principle 11), and says so under it; `help` is what help mode says that does. */
export function Stat(props: { label: string; value: string; sub?: string | undefined; tone?: Tone | undefined; onOpen?: { label: string; onPress: () => void; help?: string } }) {
  const spot = useHelpSpot(props.label, props.onOpen?.help ?? props.onOpen?.label, props.onOpen?.onPress);
  const spoken = props.sub ? t('reports.stat.spokenWithSub', { label: props.label, value: props.value, sub: props.sub }) : t('reports.stat.spoken', { label: props.label, value: props.value });
  const body = (
    <>
      <Text style={[styles.statValue, props.tone ? { color: TONE_TEXT[props.tone] } : null]}>{props.value}</Text>
      <Text style={[txt.sm, { fontWeight: '600' }]}>{props.label}</Text>
      {props.sub ? <Text style={txt.xs}>{props.sub}</Text> : null}
    </>
  );
  if (!props.onOpen) return <View style={styles.stat} accessible accessibilityLabel={spoken}>{body}</View>;
  return (
    <Pressable style={({ pressed }) => [styles.stat, pressed && { opacity: 0.7 }]} onPress={spot.onPress}
      accessibilityRole="button" accessibilityLabel={`${spoken}. ${props.onOpen.label}`}>
      {body}
      <Text style={[txt.sm, { color: C.primary, fontWeight: '700', marginTop: space.xs }]}>{props.onOpen.label} ›</Text>
      <HelpBadge spot={spot} />
    </Pressable>
  );
}

export function Stats(props: { children: ReactNode }) {
  return <View style={styles.stats}>{props.children}</View>;
}

/** A share as a bar; `tick` marks a second share on it (done, or where a plan expects it). */
export function Bar(props: { value: number; tone?: Tone; label: string; tick?: number; height?: number }) {
  const v = Math.max(0, Math.min(100, props.value));
  const h = props.height ?? 8;
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={props.label} accessibilityValue={{ min: 0, max: 100, now: Math.round(v) }}
      style={{ height: h, borderRadius: h, backgroundColor: C.border }}>
      <View style={{ height: h, borderRadius: h, width: `${v}%`, backgroundColor: TONE_FILL[props.tone ?? 'brand'] }} />
      {props.tick !== undefined ? (
        <View style={{ position: 'absolute', top: -3, bottom: -3, width: 2, backgroundColor: C.dark, left: `${Math.max(0, Math.min(100, props.tick))}%` }} />
      ) : null}
    </View>
  );
}

export function Notice(props: { tone: Tone; title: string; body?: string; icon?: IconName; children?: ReactNode }) {
  const bg = { brand: C.light, green: TINT.green, amber: TINT.amber, red: TINT.red, gray: TINT.gray }[props.tone];
  return (
    <View style={[styles.notice, { backgroundColor: bg }]} accessibilityRole={props.tone === 'red' ? 'alert' : undefined}>
      <Ico name={props.icon ?? (props.tone === 'green' ? 'check' : props.tone === 'gray' ? 'help' : 'flag')} size={20} color={TONE_TEXT[props.tone]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[txt.sm, { fontWeight: '700', color: TONE_TEXT[props.tone] }]}>{props.title}</Text>
        {props.body ? <Text style={txt.sm}>{props.body}</Text> : null}
        {props.children}
      </View>
    </View>
  );
}

/** A change against the period before: "▲ +12 recordings (+20%) against the period before". */
export function Delta(props: { now: number; before: number; unit?: 'recordings' | 'chapters' }) {
  const d = props.now - props.before;
  if (props.before === 0 && props.now === 0) return <Text style={txt.smMuted}>{t('reports.delta.noChange')}</Text>;
  const change = signed(d);
  const amount = props.unit === 'recordings' ? t('reports.delta.recordings', { count: Math.abs(d), change })
    : props.unit === 'chapters' ? t('reports.delta.chapters', { count: Math.abs(d), change }) : change;
  const rel = props.before > 0 ? `${d >= 0 ? '+' : ''}${formatPercent(Math.round((100 * d) / props.before))}` : null;
  return (
    <Text style={txt.sm}>
      <Text style={{ fontWeight: '700', color: d >= 0 ? TINT.greenText : TINT.redText }}>
        {d >= 0 ? '▲ ' : '▼ '}{amount}
      </Text>
      <Text style={{ color: C.muted }}> {rel ? t('reports.delta.againstWithShare', { share: rel }) : t('reports.delta.against')}</Text>
    </Text>
  );
}

/** A swatch and its words; the count beside it carries the meaning. */
export function Legend(props: { items: { label: string; color: string; value?: string }[] }) {
  return (
    <View style={styles.legend}>
      {props.items.map((i) => (
        <View key={i.label} style={styles.legendItem}>
          <View style={[styles.swatch, { backgroundColor: i.color }]} />
          <Text style={txt.sm}>{i.label}{i.value !== undefined ? <Text style={{ fontWeight: '700' }}> {i.value}</Text> : null}</Text>
        </View>
      ))}
    </View>
  );
}

/** One line of a list: what, then figures on the right. */
export function ListLine(props: { children: ReactNode; right?: ReactNode; onPress?: () => void; label?: string }) {
  return (
    <View style={styles.line} accessible={!!props.label} accessibilityLabel={props.label}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>{props.children}</View>
      {props.right ? <View style={{ alignItems: 'flex-end', gap: 2 }}>{props.right}</View> : null}
    </View>
  );
}

// ---- report blocks -----------------------------------------------------------------

/** Recorded and done as two labelled bars with counts. */
export function ProgressPair(props: { total: number; recorded: number; done: number }) {
  const { total, recorded, done } = props;
  return (
    <View style={{ gap: space.xs }}>
      {([['recorded', t('reports.progress.recorded'), recorded, 'brand'], ['done', t('reports.progress.done'), done, 'green']] as const).map(([key, label, n, tone]) => (
        <View key={key} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[txt.xs, { width: 64 }]}>{label}</Text>
          <View style={{ flex: 1 }}><Bar value={percent(n, total)} tone={tone} label={t('reports.progress.bar', { label, share: formatPercent(percent(n, total)) })} /></View>
          <Text style={[txt.xs, { minWidth: 84, textAlign: 'right' }]}>{partOf(n, total)}</Text>
        </View>
      ))}
    </View>
  );
}

/** Gospels, New Testament and Old Testament recorded, as three small bars. */
export function CoverageMini(props: { coverage: Coverage; name: string }) {
  return (
    <View style={{ gap: 4 }}>
      {([['gospels', 'brand'], ['nt', 'green'], ['ot', 'amber']] as const).map(([s, tone]) => (
        <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <Text style={[txt.xs, { width: 24 }]} accessibilityLabel={scopeLabel(s)}>{scopeShort(s)}</Text>
          <View style={{ flex: 1 }}><Bar value={props.coverage[s]} tone={tone} height={6}
            label={t('reports.coverage.miniBar', { name: props.name, scope: scopeLabel(s), share: formatPercent(props.coverage[s]) })} /></View>
          <Text style={[txt.xs, { width: 48, textAlign: 'right' }]}>{pctText(props.coverage[s])}</Text>
        </View>
      ))}
    </View>
  );
}

/** Coverage recorded and done side by side (decision 41: both). */
export function CoverageRows(props: { recorded: Coverage; done: Coverage }) {
  return (
    <View style={{ gap: space.md }}>
      {(['gospels', 'nt', 'ot'] as const).map((s) => (
        <View key={s} style={{ gap: space.xs }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: space.sm }}>
            <Text style={[txt.sm, { fontWeight: '700' }]}>{scopeLabel(s)}</Text>
            <Text style={txt.sm}>
              <Trans i18nKey="reports.coverage.recordedDone" values={{ recorded: pctText(props.recorded[s]), done: pctText(props.done[s]) }}
                components={{ b: <Text style={{ fontWeight: '700' }} />, muted: <Text style={{ color: C.muted }} /> }} />
            </Text>
          </View>
          <Bar value={props.recorded[s]} tone="brand" tick={props.done[s]}
            label={t('reports.coverage.bar', { scope: scopeLabel(s), recorded: pctText(props.recorded[s]), done: pctText(props.done[s]) })} />
        </View>
      ))}
      <Text style={txt.xs}>{t('reports.coverage.explain')}</Text>
    </View>
  );
}

export function RecencyBadge(props: { report: LanguageReport; now: number }) {
  const { band, days } = recencyOf(props.report, props.now);
  return <ToneBadge tone={RECENCY_TONE[band]} label={days !== null && band !== 'active' ? t('reports.recency.badgeDays', { label: recencyLabel(band), count: days }) : recencyLabel(band)} />;
}

export function HeadlineStats(props: { total: number; recorded: number; done: number; languages?: number }) {
  const { total, recorded, done } = props;
  return (
    <Stats>
      {props.languages !== undefined ? <Stat label={t('reports.headline.languages')} value={num(props.languages)} /> : null}
      <Stat label={t('reports.headline.passages')} value={num(total)} />
      <Stat label={t('reports.progress.recorded')} value={pctText(percent(recorded, total))} sub={partOf(recorded, total)} />
      <Stat label={t('reports.progress.done')} value={pctText(percent(done, total))} sub={partOf(done, total)} tone={done > 0 ? 'green' : undefined} />
    </Stats>
  );
}

/**
 * What a coordinator can move today. With `onShow`, feedback to answer and
 * open requests open the language's map filtered to those passages.
 */
export function AttentionPanel(props: { attention: LanguageReport['attention']; onShow?: (filter: 'feedback' | 'waiting') => void }) {
  const a = props.attention;
  const tone = (n: number, t: Tone): Tone | undefined => (n > 0 ? t : undefined);
  const show = (n: number, filter: 'feedback' | 'waiting') => (props.onShow && n > 0
    ? { label: t('reports.attention.show'), help: t('reports.attention.showHelp'), onPress: () => props.onShow!(filter) } : undefined);
  return (
    <Panel title={t('reports.attention.title')} sub={t('reports.attention.sub')}>
      <Stats>
        <Stat label={t('reports.attention.feedback')} value={num(a.feedback)} tone={tone(a.feedback, 'amber')} sub={t('reports.attention.feedbackSub')} onOpen={show(a.feedback, 'feedback')} />
        <Stat label={t('reports.attention.overdue')} value={num(a.overdueRequests)} tone={tone(a.overdueRequests, 'red')} sub={t('reports.attention.openInAll', { count: a.openRequests })} onOpen={show(a.openRequests, 'waiting')} />
        <Stat label={t('reports.attention.checkpoint')} value={num(a.atCheckpoint)} tone={tone(a.atCheckpoint, 'amber')} sub={t('reports.attention.checkpointSub')} />
      </Stats>
    </Panel>
  );
}

/** Why a section with no numbers has none. */
export function NoReports(props: { what: 'languages' | 'languageReport' }) {
  return (
    <Notice tone="gray" title={props.what === 'languages' ? t('reports.noReports.languages') : t('reports.noReports.languageReport')}
      body={t('reports.noReports.body')} />
  );
}

export function Freshness(props: { updatedAt: string | null; now: number }) {
  if (!props.updatedAt) return null;
  return (
    <Text style={txt.xs}>{t('reports.freshness', { when: dateTime(props.updatedAt), ago: ago(props.updatedAt, props.now) })}</Text>
  );
}

// ---- exports -----------------------------------------------------------------------

// Core's CSVs (`languagesCsv`, `ledgerCsv`, `languageCsv`) with their headers in the
// language showing: a spreadsheet's column names are words people read. Cells keep
// core's values (codes, ISO times, band ids) so a sheet sorts and filters the same.

const styles = StyleSheet.create({
  panelHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  columns: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  stat: { flexGrow: 1, flexBasis: 150, minWidth: 0, backgroundColor: C.card, borderRadius: radius.lg, padding: space.md, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, gap: 2 },
  statValue: { fontSize: 26, fontWeight: '800', color: C.dark },
  notice: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md, alignItems: 'flex-start' },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, rowGap: space.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  swatch: { width: 14, height: 14, borderRadius: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: C.border }
});
