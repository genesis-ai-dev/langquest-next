import { ledgerFor, percent, recencyOf, toCsv, type Coverage, type LanguageReport, type LanguageRow } from '@langquest-next/core';
import type { ReactNode } from 'react';
import { Platform, Share, StyleSheet, View } from 'react-native';
import { Text } from '../text';
import { bookName } from '../coreText';
import { currentLocale, t, Trans } from '../i18n';
import { formatDay, formatDayYear, formatMonthShort, formatMonthYear, formatNumber, formatPercent } from '../i18n/format';
import { Badge, Card, Ico, txt, type IconName } from '../kit';
import { C, radius, space, TINT } from '../theme';
import { countryName } from './countries';
import { bottleneckText, RECENCY_TONE, recencyLabel, scopeLabel, scopeShort } from './labels';

/**
 * The Reports section's primitives (ported from the web dashboard, decision
 * 44): status colours never carry meaning alone, so every coloured mark sits
 * beside its words and number.
 */

export type Tone = 'brand' | 'green' | 'amber' | 'red' | 'gray';

export const TONE_FILL: Record<Tone, string> = { brand: C.primary, green: C.green, amber: C.amber, red: C.red, gray: C.faint };
const TONE_TEXT: Record<Tone, string> = { brand: C.primary, green: TINT.greenText, amber: TINT.amberText, red: TINT.redText, gray: TINT.grayText };
const BADGE_TONE: Record<Tone, 'brand' | 'green' | 'amber' | 'red' | 'default'> = { brand: 'brand', green: 'green', amber: 'amber', red: 'red', gray: 'default' };

/** 1234 → "1,234", in the language showing. */
export const num = (n: number) => formatNumber(n);
/** 42.5 (a percentage already) → "42.5%". */
export const pctText = (n: number) => formatPercent(n);
/** +12, -3: a change, with its sign. */
export const signed = (n: number) => `${n >= 0 ? '+' : ''}${formatNumber(n)}`;

// Dates are UTC days (`YYYY-MM-DD`) or ISO times from the server, said in the language showing.
const utc = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00Z`);
const intlFormats = new Map<string, Intl.DateTimeFormat>();
function intl(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${currentLocale()}|${JSON.stringify(options)}`;
  let f = intlFormats.get(key);
  if (!f) { f = new Intl.DateTimeFormat(currentLocale(), { ...options, timeZone: 'UTC' }); intlFormats.set(key, f); }
  return f;
}
/** "Oct 3" */
export const shortDate = (day: string) => formatDay(utc(day), { utc: true });
/** "Oct 3, 2026" */
export const dayYear = (day: string) => formatDayYear(utc(day), { utc: true });
/** "Sat" */
export const weekday = (day: string) => intl({ weekday: 'short' }).format(utc(day));
/** "Saturday, Oct 3" */
export const longDay = (day: string) => intl({ weekday: 'long', month: 'short', day: 'numeric' }).format(utc(day));
/** A month ("2026-10") as "October 2026". */
export const monthName = (m: string) => formatMonthYear(m);
/** A month ("2026-10") as "Oct". */
export const monthShort = (m: string) => formatMonthShort(m);
/** `14:05 UTC` */
export const utcTime = (iso: string) => t('reports.timeUtc', { time: intl({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) });
/** `Oct 3, 2026, 14:05 UTC` */
export const dateTime = (iso: string) => t('reports.dateTimeUtc', {
  date: dayYear(iso), time: intl({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
});
/** Core's `timeAgo`: "just now", "5 minutes ago", "3 days ago". */
export function ago(iso: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return t('reports.ago.justNow');
  if (s < 3600) return t('reports.ago.minutes', { count: Math.floor(s / 60) });
  if (s < 86_400) return t('reports.ago.hours', { count: Math.floor(s / 3600) });
  return t('reports.ago.days', { count: Math.floor(s / 86_400) });
}
/** "12 of 40" */
export const partOf = (part: number, total: number) => t('reports.partOf', { part: num(part), total: num(total) });

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

export function Stat(props: { label: string; value: string; sub?: string | undefined; tone?: Tone | undefined }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={props.sub ? t('reports.stat.spokenWithSub', { label: props.label, value: props.value, sub: props.sub }) : t('reports.stat.spoken', { label: props.label, value: props.value })}>
      <Text style={[styles.statValue, props.tone ? { color: TONE_TEXT[props.tone] } : null]}>{props.value}</Text>
      <Text style={[txt.sm, { fontWeight: '600' }]}>{props.label}</Text>
      {props.sub ? <Text style={txt.xs}>{props.sub}</Text> : null}
    </View>
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

export function AttentionPanel(props: { attention: LanguageReport['attention'] }) {
  const a = props.attention;
  const tone = (n: number, t: Tone): Tone | undefined => (n > 0 ? t : undefined);
  return (
    <Panel title={t('reports.attention.title')} sub={t('reports.attention.sub')}>
      <Stats>
        <Stat label={t('reports.attention.feedback')} value={num(a.feedback)} tone={tone(a.feedback, 'amber')} sub={t('reports.attention.feedbackSub')} />
        <Stat label={t('reports.attention.overdue')} value={num(a.overdueRequests)} tone={tone(a.overdueRequests, 'red')} sub={t('reports.attention.openInAll', { count: a.openRequests })} />
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

/** `Dinka books 2026-09-29.csv`, safe on every filesystem. */
export function fileName(title: string, now = new Date()): string {
  return `${safeName(title)} ${now.toISOString().slice(0, 10)}.csv`;
}

/** A file name without the characters some filesystems refuse. */
export function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, ' ').trim();
}

/** A CSV to keep: downloaded in a browser, handed to the share sheet on a phone or tablet. */
export function exportCsv(name: string, text: string): void {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return;
  }
  void Share.share({ title: name, message: text }).catch(() => undefined);
}

/** Printing (and saving as PDF) is the browser's; elsewhere there is nothing to print with. */
export const canPrint = Platform.OS === 'web';
export function printPage(): void {
  if (canPrint) window.print();
}

// Core's CSVs (`languagesCsv`, `ledgerCsv`, `languageCsv`) with their headers in the
// language showing: a spreadsheet's column names are words people read. Cells keep
// core's values (codes, ISO times, band ids) so a sheet sorts and filters the same.

/** A book of the report by name: a Bible book in the language showing, else the label the organization gave it. */
export const bookOf = (b:{ bookId: string | null; label: string }) => (b.bookId ? bookName(b.bookId) : b.label);

export function languagesCsv(rows: LanguageRow[], now = Date.now()): string {
  return toCsv([
    [t('reports.csv.language'), t('reports.csv.code'), t('reports.csv.country'), t('reports.csv.reviewFlow'), t('reports.csv.passages'),
      t('reports.csv.recorded'), t('reports.csv.done'), t('reports.csv.recordedShare'), t('reports.csv.doneShare'),
      t('reports.csv.gospelsRecorded'), t('reports.csv.ntRecorded'), t('reports.csv.otRecorded'), t('reports.csv.recordingsOnServer'),
      t('reports.csv.lastUpload'), t('reports.csv.uploadStatus'), t('reports.csv.feedbackToAnswer'), t('reports.csv.openRequests'),
      t('reports.csv.overdueRequests'), t('reports.csv.atCheckpoint'), t('reports.csv.bottleneck'), t('reports.csv.lastActivity'), t('reports.csv.reportUpdated')],
    ...rows.map(({ report: r, updatedAt }) => [
      r.name, r.code, r.country, r.flowName, r.progress.total, r.progress.recorded, r.progress.done,
      percent(r.progress.recorded, r.progress.total), percent(r.progress.done, r.progress.total),
      r.coverage.recorded.gospels, r.coverage.recorded.nt, r.coverage.recorded.ot, r.uploads.cards, r.uploads.lastAt,
      recencyOf(r, now).band,
      r.attention.feedback, r.attention.openRequests, r.attention.overdueRequests, r.attention.atCheckpoint,
      bottleneckText(r), r.lastActivity, updatedAt
    ])
  ]);
}

export function languageCsv(r: LanguageReport): string {
  return toCsv([
    [t('reports.csv.book'), t('reports.csv.passages'), t('reports.csv.recorded'), t('reports.csv.done'), t('reports.csv.recordedShare'), t('reports.csv.doneShare')],
    ...r.books.map((b) => [bookOf(b), b.total, b.recorded, b.done, percent(b.recorded, b.total), percent(b.done, b.total)])
  ]);
}

export function ledgerCsv(rows: LanguageRow[], month: string): string {
  const l = ledgerFor(rows, month);
  return toCsv([
    [t('reports.csv.month'), t('reports.csv.language'), t('reports.csv.code'), t('reports.csv.country'), t('reports.csv.newChapters'), t('reports.csv.books'), t('reports.csv.chaptersByBook')],
    ...l.lines.map((x) => [month, x.row.report.name, x.row.report.code, countryName(x.row.report.country), x.chapters, x.books.length,
      x.books.map((b) => `${bookOf(b)} ${b.chapters}`).join('; ')]),
    [month, t('reports.csv.total'), null, null, l.chapters, l.books, null]
  ]);
}

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
