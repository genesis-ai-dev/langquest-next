import { PASSAGE_WORK, percent, RECENCY_DAYS, type ActivityWeek, type PaceBand, type PassageWork, type RecencyBand } from '@langquest-next/core';
import { useState, type ReactNode } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';
import { Text } from '../text';
import Svg, { Circle, G, Line, Path, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import { t } from '../i18n';
import { txt } from '../kit';
import { C, space } from '../theme';
import { PACE_TONE, recencyDaysLabel, recencyLabel, RECENCY_TONE, workLabel, WORK_TONE } from './labels';
import { Legend, num, pctText, shortDate, signed, TONE_FILL, weekday, type Tone } from './ui';

/**
 * Small SVG charts, ported from the web dashboard. Each one says its numbers
 * in words beside the marks (a legend with counts, the numbers on request,
 * an accessibility label), so colour is never the only way to read it.
 */

const AXIS = { fontSize: 13, fill: C.muted };
const PRIOR = C.border;

/** Draw at the width the chart is given, so its text stays at 13pt instead of scaling. */
function Measured(props: { height: number; label: string; children: (width: number) => ReactNode }) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.max(240, Math.round(e.nativeEvent.layout.width)));
  return (
    <View onLayout={onLayout} style={{ width: '100%', height: props.height }} accessible accessibilityRole="image" accessibilityLabel={props.label}>
      {width > 0 ? <Svg width={width} height={props.height}>{props.children(width)}</Svg> : null}
    </View>
  );
}

// ---- where passages stand ------------------------------------------------------------

/** Parts of a whole as one stacked bar and a legend with counts. */
export function StackBar<K extends string>(props: { parts: { key: K; label: string; value: number; tone: Tone; soft?: boolean }[]; empty?: string }) {
  const total = props.parts.reduce((n, p) => n + p.value, 0);
  if (total === 0) return <Text style={txt.smMuted}>{props.empty ?? t('reports.charts.nothingYet')}</Text>;
  const color = (p: { tone: Tone; soft?: boolean }) => (p.soft ? C.soft : TONE_FILL[p.tone]);
  return (
    <View style={{ gap: space.sm }}>
      <View style={{ flexDirection: 'row', height: 14, borderRadius: 7, overflow: 'hidden', backgroundColor: C.border }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {props.parts.filter((p) => p.value > 0).map((p) => (
          <View key={p.key} style={{ width: `${(100 * p.value) / total}%`, backgroundColor: color(p) }} />
        ))}
      </View>
      <Legend items={props.parts.map((p) => ({ label: p.label, color: color(p), value: t('reports.charts.valueShare', { value: num(p.value), share: pctText(percent(p.value, total)) }) }))} />
    </View>
  );
}

export function WorkBar(props: { work: Record<PassageWork, number> }) {
  return (
    <StackBar empty={t('reports.charts.noPassages')} parts={PASSAGE_WORK.map((w) => ({
      key: w, label: workLabel(w), value: props.work[w], tone: WORK_TONE[w], soft: w === 'drafting'
    }))} />
  );
}

// ---- bars over time --------------------------------------------------------------------

interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
}

/** Grouped bars, one group per label; one date label per ~64pt, the newest always labelled. */
export function GroupedBars(props: { labels: string[]; series: Series[]; format: (label: string) => string; title: (label: string) => string; empty: string; table?: boolean }) {
  const { labels, series } = props;
  const [open, setOpen] = useState(false);
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const totals = series.map((s) => s.values.reduce((n, v) => n + v, 0));
  if (totals.every((t) => t === 0)) return <Text style={txt.smMuted}>{props.empty}</Text>;
  const H = 200, left = 36, bottom = 24, top = 8;
  return (
    <View style={{ gap: space.sm }}>
      <Measured height={H} label={series.map((s, i) => t('reports.charts.seriesTotal', { label: s.label, value: num(totals[i]!) })).join(', ')}>
        {(W) => {
          const plotW = W - left, plotH = H - bottom - top;
          const group = plotW / Math.max(1, labels.length);
          const barW = Math.max(1.5, (group - Math.min(6, group * 0.25)) / series.length);
          const y = (v: number) => top + plotH - (plotH * v) / max;
          const every = Math.max(1, Math.ceil(64 / group));
          return (
            <>
              {[0, 0.5, 1].map((f) => (
                <G key={f}>
                  <Line x1={left} x2={W} y1={y(max * f)} y2={y(max * f)} stroke={C.border} strokeWidth={1} />
                  <SvgText x={left - 6} y={y(max * f) + 4} textAnchor="end" {...AXIS}>{num(Math.round(max * f))}</SvgText>
                </G>
              ))}
              {labels.map((label, i) => (
                <G key={label}>
                  {series.map((s, j) => (
                    <Rect key={s.key} x={left + i * group + Math.min(3, group * 0.12) + j * barW} y={y(s.values[i] ?? 0)} width={Math.max(1, barW - 1)}
                      height={Math.max(0, top + plotH - y(s.values[i] ?? 0))} fill={s.color} rx={1} />
                  ))}
                  {(labels.length - 1 - i) % every === 0 ? (
                    i === labels.length - 1
                      ? <SvgText x={W - 2} y={H - 6} textAnchor="end" {...AXIS}>{props.format(label)}</SvgText>
                      : <SvgText x={left + i * group + group / 2} y={H - 6} textAnchor="middle" {...AXIS}>{props.format(label)}</SvgText>
                  ) : null}
                </G>
              ))}
            </>
          );
        }}
      </Measured>
      <Legend items={series.map((s, i) => ({ label: s.label, color: s.color, value: num(totals[i]!) }))} />
      {props.table !== false ? (
        <View>
          <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={8}
            style={({ pressed }) => [{ minHeight: 48, justifyContent: 'center' }, pressed && { opacity: 0.6 }]}>
            <Text style={txt.link}>{open ? t('reports.charts.hideNumbers') : t('reports.charts.showNumbers')}</Text>
          </Pressable>
          {open ? (
            <View>
              <View style={{ flexDirection: 'row', paddingVertical: 4 }}>
                <Text style={[txt.xsStrong, { flex: 2 }]}> </Text>
                {series.map((s) => <Text key={s.key} style={[txt.xsStrong, { flex: 1, textAlign: 'right' }]}>{s.label}</Text>)}
              </View>
              {labels.map((l, i) => (
                <View key={l} style={{ flexDirection: 'row', paddingVertical: 4, borderTopWidth: 1, borderColor: C.border }}>
                  <Text style={[txt.sm, { flex: 2 }]}>{props.title(l)}</Text>
                  {series.map((s) => <Text key={s.key} style={[txt.sm, { flex: 1, textAlign: 'right' }]}>{num(s.values[i] ?? 0)}</Text>)}
                </View>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Weekly activity: recordings, versions, reviews and requests. */
export function ActivityChart(props: { weeks: ActivityWeek[]; withCards?: boolean }) {
  const { weeks } = props;
  const series: Series[] = [
    ...(props.withCards ? [{ key: 'cards', label: t('reports.charts.recordingsUploaded'), color: C.soft, values: weeks.map((w) => w.cards) }] : []),
    { key: 'versions', label: t('reports.charts.versionsPublished'), color: C.primary, values: weeks.map((w) => w.versions) },
    { key: 'reviews', label: t('reports.charts.reviews'), color: C.green, values: weeks.map((w) => w.reviews) },
    { key: 'requests', label: t('reports.charts.requestsMade'), color: C.amber, values: weeks.map((w) => w.requests) }
  ];
  return (
    <GroupedBars labels={weeks.map((w) => w.weekStart)} series={series} format={shortDate} title={(d) => t('reports.charts.weekOf', { date: shortDate(d) })}
      empty={t('reports.charts.noActivity', { count: weeks.length })} />
  );
}

/** One series of days, the recent part highlighted against what came before. */
export function DayBars(props: { days: { day: string; value: number }[]; highlightFrom: string; label: string; unit: 'uploads' | 'recordings' }) {
  const { days } = props;
  return (
    <GroupedBars labels={days.map((d) => d.day)} format={shortDate} title={(d) => shortDate(d)} table={false}
      empty={props.unit === 'uploads' ? t('reports.charts.noUploadsInPeriod') : t('reports.charts.noRecordingsInPeriod')}
      series={[
        { key: 'before', label: t('reports.charts.before', { date: shortDate(props.highlightFrom) }), color: PRIOR, values: days.map((d) => (d.day < props.highlightFrom ? d.value : 0)) },
        { key: 'recent', label: props.label, color: C.primary, values: days.map((d) => (d.day >= props.highlightFrom ? d.value : 0)) }
      ]} />
  );
}

/** This period's days beside the same days of the period before. */
export function CompareBars(props: { current: { day: string; value: number }[]; previous: { day: string; value: number }[] }) {
  const labels = props.current.map((d) => d.day);
  return (
    <GroupedBars labels={labels} format={weekday} title={(d) => shortDate(d)} empty={t('reports.charts.noRecordingsEitherPeriod')}
      series={[
        { key: 'prev', label: t('reports.charts.periodBefore'), color: PRIOR, values: labels.map((_, i) => props.previous[i]?.value ?? 0) },
        { key: 'now', label: t('reports.charts.thisPeriod'), color: C.primary, values: props.current.map((d) => d.value) }
      ]} />
  );
}

/** A small line of recent values; the number beside it carries the meaning. */
export function Sparkline(props: { values: number[]; label: string }) {
  const W = 88, H = 24;
  const max = Math.max(1, ...props.values);
  const pts = props.values.map((v, i) => `${((W - 2) * i) / Math.max(1, props.values.length - 1) + 1},${H - 2 - ((H - 4) * v) / max}`).join(' ');
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={t('reports.charts.sparkline', { label: props.label, values: props.values.map(num).join(', ') })}>
      <Svg width={W} height={H}><Polyline points={pts} fill="none" stroke={C.primary} strokeWidth={1.5} /></Svg>
    </View>
  );
}

/** Recorded and done, as a share of passages, one point per day the server reported. */
export function ProgressLine(props: { points: { day: string; recorded: number; done: number }[] }) {
  const { points } = props;
  if (points.length < 2) return <Text style={txt.smMuted}>{t('reports.charts.lineStarts')}</Text>;
  const H = 200, left = 40, bottom = 24, top = 8;
  const first = points[0]!, last = points.at(-1)!;
  return (
    <View style={{ gap: space.sm }}>
      <Measured height={H} label={t('reports.charts.progressSpoken', {
        from: shortDate(first.day), to: shortDate(last.day),
        recordedFrom: pctText(first.recorded), recordedTo: pctText(last.recorded), doneFrom: pctText(first.done), doneTo: pctText(last.done)
      })}>
        {(W) => {
          const plotW = W - left - 8, plotH = H - bottom - top;
          const x = (i: number) => left + (plotW * i) / (points.length - 1);
          const y = (v: number) => top + plotH - (plotH * v) / 100;
          const path = (key: 'recorded' | 'done') => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
          return (
            <>
              {[0, 50, 100].map((v) => (
                <G key={v}>
                  <Line x1={left} x2={W - 8} y1={y(v)} y2={y(v)} stroke={C.border} strokeWidth={1} />
                  <SvgText x={left - 6} y={y(v) + 4} textAnchor="end" {...AXIS}>{pctText(v)}</SvgText>
                </G>
              ))}
              <Path d={path('recorded')} fill="none" stroke={C.primary} strokeWidth={2.5} />
              <Path d={path('done')} fill="none" stroke={C.green} strokeWidth={2.5} />
              <SvgText x={left} y={H - 6} {...AXIS}>{shortDate(first.day)}</SvgText>
              <SvgText x={W - 8} y={H - 6} textAnchor="end" {...AXIS}>{shortDate(last.day)}</SvgText>
            </>
          );
        }}
      </Measured>
      <Legend items={[
        { label: t('reports.progress.recorded'), color: C.primary, value: pctText(last.recorded) },
        { label: t('reports.progress.done'), color: C.green, value: pctText(last.done) }
      ]} />
    </View>
  );
}

// ---- recency ------------------------------------------------------------------------

/** Days since each language's last upload on one axis, the bands shaded, quiet languages named. */
export function RecencyStrip(props: { items: { name: string; days: number | null; band: RecencyBand }[] }) {
  const items = props.items.filter((i) => i.days !== null) as { name: string; days: number; band: RecencyBand }[];
  if (items.length === 0) return <Text style={txt.smMuted}>{t('reports.charts.noUploadsYet')}</Text>;
  const MAX = 60, left = 8, right = 8, top = 28;
  // Stack dots that land on the same day.
  const seen = new Map<number, number>();
  const placed = [...items].sort((a, b) => a.days - b.days).map((i) => {
    const k = Math.min(i.days, MAX);
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return { ...i, row: n };
  });
  const rows = Math.max(1, ...placed.map((p) => p.row + 1));
  const H = top + rows * 14 + 60;
  const labelled = placed.filter((p) => p.band !== 'active').slice(0, 12);
  const bands = Object.entries(RECENCY_DAYS) as [Exclude<RecencyBand, 'not_started'>, [number, number]][];
  return (
    <View style={{ gap: space.sm }}>
      <Measured height={H} label={t('reports.charts.recencySpoken', {
        count: items.filter((i) => i.band === 'active').length,
        quiet: items.filter((i) => i.band !== 'active').map((i) => t('reports.charts.nameDays', { name: i.name, count: i.days })).join(', ')
      })}>
        {(W) => {
          const x = (d: number) => left + ((W - left - right) * Math.min(d, MAX)) / MAX;
          return (
            <>
              {bands.map(([band, [lo, hi]]) => (
                <G key={band}>
                  <Rect x={x(lo)} y={top - 6} width={Math.max(0, x(Math.min(hi + 1, MAX)) - x(lo))} height={rows * 14 + 12} fill={TONE_FILL[RECENCY_TONE[band]]} opacity={0.15} />
                  <SvgText x={x(lo) + 3} y={14} {...AXIS}>{t('reports.daysShort', { count: lo })}</SvgText>
                </G>
              ))}
              {placed.map((p) => (
                <Circle key={`${p.name}-${p.days}-${p.row}`} cx={x(p.days)} cy={top + 4 + p.row * 14} r={5} fill={TONE_FILL[RECENCY_TONE[p.band]]} />
              ))}
              {labelled.map((p, i) => (
                <SvgText key={`l-${p.name}`} x={Math.min(x(p.days), W - 4)} y={top + rows * 14 + 22 + (i % 3) * 14} fontSize={13} fill={C.dark}
                  textAnchor={x(p.days) > W - 120 ? 'end' : 'start'}>{t('reports.charts.nameDaysShort', { name: p.name, count: p.days })}</SvgText>
              ))}
            </>
          );
        }}
      </Measured>
      <Legend items={(['active', 'check_in', 'reminder', 'four_weeks', 'five_weeks', 'inactive'] as const).map((b) => ({
        label: t('reports.charts.bandDays', { label: recencyLabel(b), days: recencyDaysLabel(b) }), color: TONE_FILL[RECENCY_TONE[b]]
      }))} />
    </View>
  );
}

// ---- pace ---------------------------------------------------------------------------

/** Every language's gap to its plan on one axis, the on-pace band shaded. */
export function PaceStrip(props: { items: { name: string; gap: number; band: PaceBand }[] }) {
  if (props.items.length === 0) return <Text style={txt.smMuted}>{t('reports.charts.noTargetYet')}</Text>;
  const MIN = -50, MAX = 50, left = 12, right = 12, top = 12;
  const seen = new Map<number, number>();
  const placed = props.items.map((i) => {
    const k = Math.round(Math.max(MIN, Math.min(MAX, i.gap)));
    const n = seen.get(k) ?? 0;
    seen.set(k, n + 1);
    return { ...i, row: n };
  });
  const rows = Math.max(1, ...placed.map((p) => p.row + 1));
  const H = top + rows * 14 + 36;
  return (
    <Measured height={H} label={props.items.map((i) => t('reports.charts.namePoints', { name: i.name, gap: signed(i.gap), count: Math.abs(i.gap) })).join(', ')}>
      {(W) => {
        const x = (g: number) => left + ((W - left - right) * (Math.max(MIN, Math.min(MAX, g)) - MIN)) / (MAX - MIN);
        return (
          <>
            <Rect x={x(-5)} y={top - 6} width={x(10) - x(-5)} height={rows * 14 + 12} fill={C.primary} opacity={0.12} />
            <Line x1={x(0)} x2={x(0)} y1={top - 8} y2={top + rows * 14 + 8} stroke={C.muted} strokeWidth={2} />
            {placed.map((p) => (
              <Circle key={`${p.name}-${p.row}`} cx={x(p.gap)} cy={top + 4 + p.row * 14} r={5} fill={TONE_FILL[PACE_TONE[p.band]]} />
            ))}
            {[-50, -25, 0, 25, 50].map((g) => (
              <SvgText key={g} x={x(g)} y={H - 6} textAnchor={g === -50 ? 'start' : g === 50 ? 'end' : 'middle'} {...AXIS}>
                {g === 0 ? t('reports.charts.onPlan') : `${g > 0 ? '+' : '−'}${num(Math.abs(g))}`}
              </SvgText>
            ))}
          </>
        );
      }}
    </Measured>
  );
}
