import { PASSAGE_WORK, percent, RECENCY_DAYS, type ActivityWeek, type PaceBand, type PassageWork, type RecencyBand } from '@langquest-next/core';
import { useCallback, useRef, useState } from 'react';
import { num, type Tone } from './ui';

/**
 * Small SVG and CSS charts. Each one carries its numbers in words beside
 * the marks (a legend with counts, a table on request, a title per mark),
 * so colour is never the only way to read it.
 */

/**
 * The drawing's width in CSS pixels, so the SVG is drawn 1:1 and its text
 * stays at the 13px minimum instead of shrinking with a scaled viewBox.
 */
function useWidth(fallback: number) {
  const [width, setWidth] = useState(fallback);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const measure = () => setWidth(Math.max(240, Math.round(el.getBoundingClientRect().width)));
    measure();
    observer.current = new ResizeObserver(measure);
    observer.current.observe(el);
  }, []);
  return [ref, width] as const;
}

export const shortDate = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const weekday = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

// ---- where passages stand ------------------------------------------------------------

export const WORK_LABEL: Record<PassageWork, string> = {
  not_started: 'Not started',
  drafting: 'Being recorded',
  in_review: 'In review',
  feedback: 'Feedback to answer',
  done: 'Done'
};

const WORK_TONE: Record<PassageWork, Tone> = {
  not_started: 'gray', drafting: 'brand', in_review: 'brand', feedback: 'amber', done: 'green'
};

/** Parts of a whole as one stacked bar and a legend with counts. */
export function StackBar<K extends string>(props: { parts: { key: K; label: string; value: number; tone: Tone; soft?: boolean }[]; empty?: string }) {
  const total = props.parts.reduce((n, p) => n + p.value, 0);
  if (total === 0) return <p className="muted">{props.empty ?? 'Nothing yet.'}</p>;
  return (
    <div>
      <div className="stack" aria-hidden="true">
        {props.parts.filter((p) => p.value > 0).map((p) => (
          <div key={p.key} className={`stack-part bar-${p.tone} ${p.soft ? 'stack-soft' : ''}`}
            style={{ width: `${(100 * p.value) / total}%` }} title={`${p.label}: ${num(p.value)}`} />
        ))}
      </div>
      <ul className="legend">
        {props.parts.map((p) => (
          <li key={p.key}>
            <span className={`swatch bar-${p.tone} ${p.soft ? 'stack-soft' : ''}`} aria-hidden="true" />
            {p.label} <strong>{num(p.value)}</strong> <span className="muted">({percent(p.value, total)}%)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function WorkBar(props: { work: Record<PassageWork, number> }) {
  return (
    <StackBar empty="No passages yet." parts={PASSAGE_WORK.map((w) => ({
      key: w, label: WORK_LABEL[w], value: props.work[w], tone: WORK_TONE[w], soft: w === 'drafting'
    }))} />
  );
}

// ---- bars over time --------------------------------------------------------------------

export interface Series {
  key: string;
  label: string;
  className: string;
  values: number[];
}

/** Grouped bars, one group per label; one date label per ~64px, the newest always labelled. */
export function GroupedBars(props: { labels: string[]; series: Series[]; format: (label: string) => string; title: (label: string) => string; empty: string; table?: boolean }) {
  const [ref, W] = useWidth(480);
  const { labels, series } = props;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const totals = series.map((s) => s.values.reduce((n, v) => n + v, 0));
  if (totals.every((t) => t === 0)) return <p className="muted">{props.empty}</p>;
  const H = 200, left = 36, bottom = 24, top = 8;
  const plotW = W - left, plotH = H - bottom - top;
  const group = plotW / Math.max(1, labels.length);
  const barW = Math.max(1.5, (group - Math.min(6, group * 0.25)) / series.length);
  const y = (v: number) => top + plotH - (plotH * v) / max;
  const every = Math.max(1, Math.ceil(64 / group));
  return (
    <figure className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
        aria-label={series.map((s, i) => `${num(totals[i]!)} ${s.label.toLowerCase()}`).join(', ')}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={left} x2={W} y1={y(max * f)} y2={y(max * f)} className="grid" />
            <text x={left - 6} y={y(max * f) + 4} className="axis" textAnchor="end">{num(Math.round(max * f))}</text>
          </g>
        ))}
        {labels.map((label, i) => (
          <g key={label}>
            {series.map((s, j) => (
              <rect key={s.key} x={left + i * group + Math.min(3, group * 0.12) + j * barW} y={y(s.values[i] ?? 0)} width={Math.max(1, barW - 1)}
                height={Math.max(0, top + plotH - y(s.values[i] ?? 0))} className={s.className}>
                <title>{`${props.title(label)}: ${num(s.values[i] ?? 0)} ${s.label.toLowerCase()}`}</title>
              </rect>
            ))}
            {(labels.length - 1 - i) % every === 0 ? (
              i === labels.length - 1
                ? <text x={W - 2} y={H - 6} className="axis" textAnchor="end">{props.format(label)}</text>
                : <text x={left + i * group + group / 2} y={H - 6} className="axis" textAnchor="middle">{props.format(label)}</text>
            ) : null}
          </g>
        ))}
      </svg>
      <ul className="legend">
        {series.map((s, i) => (
          <li key={s.key}>
            <svg width="14" height="14" aria-hidden="true"><rect width="14" height="14" rx="3" className={s.className} /></svg>
            {s.label} <strong>{num(totals[i]!)}</strong>
          </li>
        ))}
      </ul>
      {props.table !== false ? (
        <details className="no-print">
          <summary>Show the numbers</summary>
          <div className="table-scroll">
            <table className="table">
              <thead><tr><th scope="col">{''}</th>{series.map((s) => <th key={s.key} scope="col" className="num">{s.label}</th>)}</tr></thead>
              <tbody>
                {labels.map((l, i) => (
                  <tr key={l}><td>{props.title(l)}</td>{series.map((s) => <td key={s.key} className="num">{num(s.values[i] ?? 0)}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </figure>
  );
}

/** Weekly activity: recordings, versions, reviews and requests. */
export function ActivityChart(props: { weeks: ActivityWeek[]; withCards?: boolean }) {
  const { weeks } = props;
  const series: Series[] = [
    ...(props.withCards ? [{ key: 'cards', label: 'Recordings uploaded', className: 'fill-soft', values: weeks.map((w) => w.cards) }] : []),
    { key: 'versions', label: 'Versions published', className: 'fill-brand', values: weeks.map((w) => w.versions) },
    { key: 'reviews', label: 'Reviews', className: 'fill-green', values: weeks.map((w) => w.reviews) },
    { key: 'requests', label: 'Requests made', className: 'fill-amber', values: weeks.map((w) => w.requests) }
  ];
  return (
    <GroupedBars labels={weeks.map((w) => w.weekStart)} series={series} format={shortDate} title={(d) => `Week of ${shortDate(d)}`}
      empty={`No versions, reviews or requests in the last ${weeks.length} weeks.`} />
  );
}

/** One series of days, the recent part highlighted against what came before. */
export function DayBars(props: { days: { day: string; value: number }[]; highlightFrom: string; label: string; unit: string }) {
  const { days } = props;
  return (
    <GroupedBars labels={days.map((d) => d.day)} format={shortDate} title={(d) => shortDate(d)} empty={`No ${props.unit} in this period.`} table={false}
      series={[
        { key: 'before', label: `Before ${shortDate(props.highlightFrom)}`, className: 'fill-prior', values: days.map((d) => (d.day < props.highlightFrom ? d.value : 0)) },
        { key: 'recent', label: props.label, className: 'fill-brand', values: days.map((d) => (d.day >= props.highlightFrom ? d.value : 0)) }
      ]} />
  );
}

/** This period's days beside the same days of the period before. */
export function CompareBars(props: { current: { day: string; value: number }[]; previous: { day: string; value: number }[]; unit: string }) {
  const labels = props.current.map((d) => d.day);
  return (
    <GroupedBars labels={labels} format={weekday} title={(d) => shortDate(d)} empty={`No ${props.unit} in either period.`}
      series={[
        { key: 'prev', label: 'Period before', className: 'fill-prior', values: labels.map((_, i) => props.previous[i]?.value ?? 0) },
        { key: 'now', label: 'This period', className: 'fill-brand', values: props.current.map((d) => d.value) }
      ]} />
  );
}

/** A small line of recent values; the number beside it carries the meaning. */
export function Sparkline(props: { values: number[]; label: string }) {
  const W = 88, H = 24;
  const max = Math.max(1, ...props.values);
  const pts = props.values.map((v, i) => `${((W - 2) * i) / Math.max(1, props.values.length - 1) + 1},${H - 2 - ((H - 4) * v) / max}`).join(' ');
  return (
    <svg width={W} height={H} role="img" aria-label={`${props.label}: ${props.values.join(', ')}`} className="chart">
      <polyline points={pts} className="line line-brand line-thin" />
    </svg>
  );
}

/** Recorded and done, as a share of passages, one point per day the server reported. */
export function ProgressLine(props: { points: { day: string; recorded: number; done: number }[] }) {
  const { points } = props;
  const [ref, W] = useWidth(480);
  if (points.length < 2) {
    return <p className="muted">The line starts once the server has reported on two different days.</p>;
  }
  const H = 200, left = 40, bottom = 24, top = 8;
  const plotW = W - left - 8, plotH = H - bottom - top;
  const x = (i: number) => left + (plotW * i) / (points.length - 1);
  const y = (v: number) => top + plotH - (plotH * v) / 100;
  const path = (key: 'recorded' | 'done') => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const first = points[0]!, last = points.at(-1)!;
  return (
    <figure className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
        aria-label={`From ${shortDate(first.day)} to ${shortDate(last.day)}: recorded ${first.recorded}% to ${last.recorded}%, done ${first.done}% to ${last.done}%.`}>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={left} x2={W - 8} y1={y(v)} y2={y(v)} className="grid" />
            <text x={left - 6} y={y(v) + 4} className="axis" textAnchor="end">{v}%</text>
          </g>
        ))}
        <path d={path('recorded')} className="line line-brand" />
        <path d={path('done')} className="line line-green" />
        <text x={left} y={H - 6} className="axis">{shortDate(first.day)}</text>
        <text x={W - 8} y={H - 6} className="axis" textAnchor="end">{shortDate(last.day)}</text>
      </svg>
      <ul className="legend">
        <li><span className="swatch bar-brand" aria-hidden="true" />Recorded <strong>{last.recorded}%</strong></li>
        <li><span className="swatch bar-green" aria-hidden="true" />Done <strong>{last.done}%</strong></li>
      </ul>
    </figure>
  );
}

// ---- recency ------------------------------------------------------------------------

export const RECENCY_LABEL: Record<RecencyBand, string> = {
  active: 'Active', check_in: 'Check in', reminder: 'Send a reminder', four_weeks: 'Four weeks quiet',
  five_weeks: 'Five weeks quiet', inactive: 'Inactive', not_started: 'No uploads yet'
};
export const RECENCY_ADVICE: Record<RecencyBand, string> = {
  active: 'Uploaded in the last two weeks.',
  check_in: 'Two weeks without an upload. Ask how it is going.',
  reminder: 'Three weeks without an upload. Send a clear reminder that you need an update.',
  four_weeks: 'Four weeks without an upload. Find out what is blocking the team, and whether the phone is syncing.',
  five_weeks: 'Five weeks without an upload. Talk to the team lead this week.',
  inactive: 'No uploads in 45 days or more.',
  not_started: 'Nothing has reached the server yet: still onboarding.'
};
export const RECENCY_TONE: Record<RecencyBand, Tone> = {
  active: 'green', check_in: 'amber', reminder: 'amber', four_weeks: 'red', five_weeks: 'red', inactive: 'gray', not_started: 'brand'
};

/** Days since each language's last upload on one axis, the bands shaded, quiet languages named. */
export function RecencyStrip(props: { items: { name: string; days: number | null; band: RecencyBand }[] }) {
  const [ref, W] = useWidth(640);
  const items = props.items.filter((i) => i.days !== null) as { name: string; days: number; band: RecencyBand }[];
  if (items.length === 0) return <p className="muted">No language has uploaded yet.</p>;
  const MAX = 60, left = 8, right = 8, top = 28;
  const x = (d: number) => left + ((W - left - right) * Math.min(d, MAX)) / MAX;
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
  return (
    <figure className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
        aria-label={`${items.filter((i) => i.band === 'active').length} active; ${items.filter((i) => i.band !== 'active').map((i) => `${i.name} ${i.days} days`).join(', ')}`}>
        {(Object.entries(RECENCY_DAYS) as [Exclude<RecencyBand, 'not_started'>, [number, number]][]).map(([band, [lo, hi]]) => (
          <g key={band}>
            <rect x={x(lo)} y={top - 6} width={Math.max(0, x(Math.min(hi + 1, MAX)) - x(lo))} height={rows * 14 + 12} className={`band-bg fill-${RECENCY_TONE[band]}`} />
            <text x={x(lo) + 3} y={14} className="axis">{lo}d</text>
          </g>
        ))}
        {placed.map((p) => (
          <circle key={`${p.name}-${p.days}-${p.row}`} cx={x(p.days)} cy={top + 4 + p.row * 14} r={5} className={`fill-${RECENCY_TONE[p.band]}`}>
            <title>{`${p.name}: ${p.days} days since the last upload`}</title>
          </circle>
        ))}
        {labelled.map((p, i) => (
          <text key={`l-${p.name}`} x={Math.min(x(p.days), W - 4)} y={top + rows * 14 + 22 + (i % 3) * 14} className="label"
            textAnchor={x(p.days) > W - 120 ? 'end' : 'start'}>{`${p.name} · ${p.days}d`}</text>
        ))}
      </svg>
      <ul className="legend">
        {(['active', 'check_in', 'reminder', 'four_weeks', 'five_weeks', 'inactive'] as const).map((b) => (
          <li key={b}><span className={`swatch bar-${RECENCY_TONE[b]}`} aria-hidden="true" />{RECENCY_LABEL[b]} ({RECENCY_DAYS[b][0]}{Number.isFinite(RECENCY_DAYS[b][1]) ? `–${RECENCY_DAYS[b][1]}` : '+'} days)</li>
        ))}
      </ul>
    </figure>
  );
}

// ---- pace ---------------------------------------------------------------------------

export const PACE_LABEL: Record<PaceBand | 'no_target', string> = {
  ahead: 'Ahead', on_pace: 'On pace', behind: 'Behind', stalled: 'Stalled', complete: 'Complete', no_target: 'No target set'
};
export const PACE_TONE: Record<PaceBand | 'no_target', Tone> = {
  ahead: 'green', on_pace: 'brand', behind: 'amber', stalled: 'red', complete: 'green', no_target: 'gray'
};
export const PACE_ADVICE: Record<PaceBand | 'no_target', string> = {
  ahead: 'More than 10 points ahead of a straight line to the target.',
  on_pace: 'Within 5 points behind to 10 points ahead of plan.',
  behind: 'More than 5 points behind, but the last eight weeks\u2019 rate still finishes by the target date.',
  stalled: 'Behind, and at the last eight weeks\u2019 rate it will not finish by the target date.',
  complete: 'The target is fully recorded.',
  no_target: 'Set a target on the language page to measure pace.'
};

/** Every language's gap to its plan on one axis, the on-pace band shaded. */
export function PaceStrip(props: { items: { name: string; gap: number; band: PaceBand }[] }) {
  const [ref, W] = useWidth(640);
  if (props.items.length === 0) return <p className="muted">No language has a target yet.</p>;
  const MIN = -50, MAX = 50, left = 12, right = 12, top = 12;
  const x = (g: number) => left + ((W - left - right) * (Math.max(MIN, Math.min(MAX, g)) - MIN)) / (MAX - MIN);
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
    <figure className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img"
        aria-label={props.items.map((i) => `${i.name} ${i.gap >= 0 ? '+' : ''}${i.gap} points`).join(', ')}>
        <rect x={x(-5)} y={top - 6} width={x(10) - x(-5)} height={rows * 14 + 12} className="band-bg fill-brand" />
        <line x1={x(0)} x2={x(0)} y1={top - 8} y2={top + rows * 14 + 8} className="grid" style={{ strokeWidth: 2 }} />
        {placed.map((p) => (
          <circle key={`${p.name}-${p.row}`} cx={x(p.gap)} cy={top + 4 + p.row * 14} r={5} className={`fill-${PACE_TONE[p.band]}`}>
            <title>{`${p.name}: ${p.gap >= 0 ? '+' : ''}${p.gap} points against plan`}</title>
          </circle>
        ))}
        {[-50, -25, 0, 25, 50].map((g) => (
          <text key={g} x={x(g)} y={H - 6} className="axis" textAnchor={g === -50 ? 'start' : g === 50 ? 'end' : 'middle'}>
            {g === 0 ? 'on plan' : `${g > 0 ? '+' : '−'}${Math.abs(g)}${g === 50 || g === -50 ? '' : ''}`}
          </text>
        ))}
      </svg>
    </figure>
  );
}
