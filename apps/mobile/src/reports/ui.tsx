import { percent, recencyOf, SCOPE_LABEL, timeAgo, type Coverage, type LanguageReport } from '@langquest-next/core';
import type { ReactNode } from 'react';
import { Platform, Share, StyleSheet, Text, View } from 'react-native';
import { Badge, Card, Ico, txt, type IconName } from '../kit';
import { C, radius, space, TINT } from '../theme';
import { RECENCY_LABEL, RECENCY_TONE } from './labels';

/**
 * The Reports section's primitives (ported from the web dashboard, decision
 * 44): status colours never carry meaning alone, so every coloured mark sits
 * beside its words and number.
 */

export type Tone = 'brand' | 'green' | 'amber' | 'red' | 'gray';

export const TONE_FILL: Record<Tone, string> = { brand: C.primary, green: C.green, amber: C.amber, red: C.red, gray: C.faint };
const TONE_TEXT: Record<Tone, string> = { brand: C.primary, green: TINT.greenText, amber: TINT.amberText, red: TINT.redText, gray: TINT.grayText };
const BADGE_TONE: Record<Tone, 'brand' | 'green' | 'amber' | 'red' | 'default'> = { brand: 'brand', green: 'green', amber: 'amber', red: 'red', gray: 'default' };

export const num = (n: number) => n.toLocaleString('en-US');
export const pctText = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}%`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Dates are UTC days (`YYYY-MM-DD`) from the server; written out by hand so phones without full Intl read them the same.
const utc = (day: string) => new Date(`${day}T00:00:00Z`);
export const shortDate = (day: string) => `${MONTHS[utc(day).getUTCMonth()]} ${utc(day).getUTCDate()}`;
export const weekday = (day: string) => WEEKDAYS[utc(day).getUTCDay()]!;
export const longDay = (day: string) => `${WEEKDAYS_LONG[utc(day).getUTCDay()]}, ${shortDate(day)}`;
export const monthName = (m: string) => `${MONTHS_LONG[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const monthShort = (m: string) => MONTHS[Number(m.slice(5, 7)) - 1]!;
/** `Oct 3, 2026, 14:05 UTC` */
export const dateTime = (iso: string) => `${shortDate(iso.slice(0, 10))}, ${iso.slice(0, 4)}, ${iso.slice(11, 16)} UTC`;

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
    <View style={styles.stat} accessible accessibilityLabel={`${props.label}: ${props.value}${props.sub ? `, ${props.sub}` : ''}`}>
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

export function Delta(props: { now: number; before: number; unit?: string }) {
  const d = props.now - props.before;
  if (props.before === 0 && props.now === 0) return <Text style={txt.smMuted}>No change</Text>;
  const rel = props.before > 0 ? ` (${d >= 0 ? '+' : ''}${Math.round((100 * d) / props.before)}%)` : '';
  return (
    <Text style={txt.sm}>
      <Text style={{ fontWeight: '700', color: d >= 0 ? TINT.greenText : TINT.redText }}>
        {d >= 0 ? '▲ +' : '▼ '}{num(d)}{props.unit ? ` ${props.unit}` : ''}
      </Text>
      <Text style={{ color: C.muted }}>{rel} against the period before</Text>
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
      {([['Recorded', recorded, 'brand'], ['Done', done, 'green']] as const).map(([label, n, tone]) => (
        <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <Text style={[txt.xs, { width: 64 }]}>{label}</Text>
          <View style={{ flex: 1 }}><Bar value={percent(n, total)} tone={tone} label={`${label} ${percent(n, total)}%`} /></View>
          <Text style={[txt.xs, { minWidth: 84, textAlign: 'right' }]}>{num(n)} of {num(total)}</Text>
        </View>
      ))}
    </View>
  );
}

/** Gospels, New Testament and Old Testament recorded, as three small bars. */
export function CoverageMini(props: { coverage: Coverage; name: string }) {
  return (
    <View style={{ gap: 4 }}>
      {([['G', 'gospels', 'brand'], ['NT', 'nt', 'green'], ['OT', 'ot', 'amber']] as const).map(([short, s, tone]) => (
        <View key={s} style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
          <Text style={[txt.xs, { width: 24 }]} accessibilityLabel={SCOPE_LABEL[s]}>{short}</Text>
          <View style={{ flex: 1 }}><Bar value={props.coverage[s]} tone={tone} height={6} label={`${props.name} ${SCOPE_LABEL[s]} ${props.coverage[s]}%`} /></View>
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
            <Text style={[txt.sm, { fontWeight: '700' }]}>{SCOPE_LABEL[s]}</Text>
            <Text style={txt.sm}><Text style={{ fontWeight: '700' }}>{pctText(props.recorded[s])}</Text> recorded · <Text style={{ color: C.muted }}>{pctText(props.done[s])} done</Text></Text>
          </View>
          <Bar value={props.recorded[s]} tone="brand" tick={props.done[s]} label={`${SCOPE_LABEL[s]}: ${props.recorded[s]}% recorded, ${props.done[s]}% done`} />
        </View>
      ))}
      <Text style={txt.xs}>
        By verses of the whole canon. Recorded: the passage has a published version. Done: it has cleared its review flow (the tick on each bar).
      </Text>
    </View>
  );
}

export function RecencyBadge(props: { report: LanguageReport; now: number }) {
  const { band, days } = recencyOf(props.report, props.now);
  return <ToneBadge tone={RECENCY_TONE[band]} label={`${RECENCY_LABEL[band]}${days !== null && band !== 'active' ? ` · ${days}d` : ''}`} />;
}

export function HeadlineStats(props: { total: number; recorded: number; done: number; languages?: number }) {
  const { total, recorded, done } = props;
  return (
    <Stats>
      {props.languages !== undefined ? <Stat label="Languages" value={num(props.languages)} /> : null}
      <Stat label="Passages" value={num(total)} />
      <Stat label="Recorded" value={`${percent(recorded, total)}%`} sub={`${num(recorded)} of ${num(total)}`} />
      <Stat label="Done" value={`${percent(done, total)}%`} sub={`${num(done)} of ${num(total)}`} tone={done > 0 ? 'green' : undefined} />
    </Stats>
  );
}

export function AttentionPanel(props: { attention: LanguageReport['attention'] }) {
  const a = props.attention;
  const tone = (n: number, t: Tone): Tone | undefined => (n > 0 ? t : undefined);
  return (
    <Panel title="Needs attention" sub="What a coordinator can move today.">
      <Stats>
        <Stat label="Feedback to answer" value={num(a.feedback)} tone={tone(a.feedback, 'amber')} sub="The latest version has feedback nobody answered" />
        <Stat label="Overdue requests" value={num(a.overdueRequests)} tone={tone(a.overdueRequests, 'red')} sub={`${num(a.openRequests)} request${a.openRequests === 1 ? '' : 's'} open in all`} />
        <Stat label="At a checkpoint" value={num(a.atCheckpoint)} tone={tone(a.atCheckpoint, 'amber')} sub="Waiting for a checkpoint review" />
      </Stats>
    </Panel>
  );
}

/** Why a section with no numbers has none. */
export function NoReports(props: { what: string }) {
  return (
    <Notice tone="gray" title={`No ${props.what} to show yet`}
      body="Languages appear here once the organization has one and your role lets you view its status. If you expected some, ask an administrator which languages your role covers." />
  );
}

export function Freshness(props: { updatedAt: string | null; now: number }) {
  if (!props.updatedAt) return null;
  return (
    <Text style={txt.xs}>
      Figures as of {dateTime(props.updatedAt)} ({timeAgo(props.updatedAt, props.now)}). Work recorded offline appears after the device syncs.
    </Text>
  );
}

// ---- exports -----------------------------------------------------------------------

/** `Dinka report 2026-09-29.csv`, safe on every filesystem. */
export function fileName(title: string, now = new Date()): string {
  return `${title.replace(/[\\/:*?"<>|]+/g, ' ').trim()} ${now.toISOString().slice(0, 10)}.csv`;
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
