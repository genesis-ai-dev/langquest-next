import { percent, recencyOf, type Coverage, type LaneReport } from '@langquest-next/core';
import { Fragment } from 'react';
import { SCOPE_LABEL, timeAgo } from '../aggregate';
import { RECENCY_LABEL, RECENCY_TONE } from '../charts';
import type { OrgReports } from '../data';
import { Badge, Bar, Card, Notice, Stat, num, pctText, type Tone } from '../ui';

/** Recorded and done as two labelled bars with counts. */
export function ProgressPair(props: { total: number; recorded: number; done: number }) {
  const { total, recorded, done } = props;
  return (
    <div className="pair small">
      {([['Recorded', recorded, 'brand'], ['Done', done, 'green']] as const).map(([label, n, tone]) => (
        <Fragment key={label}>
          <span>{label}</span>
          <Bar value={percent(n, total)} tone={tone} label={`${label} ${percent(n, total)}%`} />
          <span className="figure">{num(n)} of {num(total)}</span>
        </Fragment>
      ))}
    </div>
  );
}

/** One share as a bar and "55% · 6/11", for a table cell. */
export function ShareCell(props: { n: number; total: number; tone: Tone; label: string }) {
  const p = percent(props.n, props.total);
  return (
    <div className="cell-bar small">
      <Bar value={p} tone={props.tone} label={`${props.label} ${p}%`} />
      <span className="figure"><strong>{p}%</strong> · {num(props.n)}/{num(props.total)}</span>
    </div>
  );
}

/** Gospels, New Testament and Old Testament recorded, as three small bars (for tables). */
export function CoverageMini(props: { coverage: Coverage; name: string }) {
  return (
    <div className="cov">
      {([['G', 'gospels'], ['NT', 'nt'], ['OT', 'ot']] as const).map(([short, s]) => (
        <Fragment key={s}>
          <abbr title={SCOPE_LABEL[s]}>{short}</abbr>
          <Bar value={props.coverage[s]} tone={s === 'ot' ? 'amber' : s === 'nt' ? 'green' : 'brand'} label={`${props.name} ${SCOPE_LABEL[s]} ${props.coverage[s]}%`} />
          <span className="num" style={{ textAlign: 'right' }}>{pctText(props.coverage[s])}</span>
        </Fragment>
      ))}
    </div>
  );
}

/** Coverage for one scope set, recorded and done side by side (decision 41: both). */
export function CoverageRows(props: { recorded: Coverage; done: Coverage }) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {(['gospels', 'nt', 'ot'] as const).map((s) => (
        <div key={s}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: '0 8px' }}>
            <strong style={{ whiteSpace: 'nowrap' }}>{SCOPE_LABEL[s]}</strong>
            <span className="num"><strong>{pctText(props.recorded[s])}</strong> recorded · <span className="muted">{pctText(props.done[s])} done</span></span>
          </div>
          <Bar value={props.recorded[s]} tone="brand" label={`${SCOPE_LABEL[s]} recorded ${props.recorded[s]}%`} tick={props.done[s]} />
        </div>
      ))}
      <p className="muted xs" style={{ margin: 0 }}>
        By verses of the whole canon. Recorded: the passage has a published version. Done: it has cleared its review flow (the tick on each bar).
      </p>
    </div>
  );
}

export function RecencyBadge(props: { report: LaneReport; now: number }) {
  const { band, days } = recencyOf(props.report, props.now);
  return <Badge tone={RECENCY_TONE[band]}>{RECENCY_LABEL[band]}{days !== null && band !== 'active' ? ` · ${days}d` : ''}</Badge>;
}

export function HeadlineStats(props: { total: number; recorded: number; done: number; languages?: number }) {
  const { total, recorded, done } = props;
  return (
    <div className="stats">
      {props.languages !== undefined ? <Stat label="Languages" value={num(props.languages)} /> : null}
      <Stat label="Passages" value={num(total)} />
      <Stat label="Recorded" value={`${percent(recorded, total)}%`} sub={`${num(recorded)} of ${num(total)}`} />
      <Stat label="Done" value={`${percent(done, total)}%`} sub={`${num(done)} of ${num(total)}`} tone={done > 0 ? 'green' : undefined} />
    </div>
  );
}

export function AttentionCard(props: { attention: LaneReport['attention'] }) {
  const a = props.attention;
  const tone = (n: number, t: Tone): Tone | undefined => (n > 0 ? t : undefined);
  return (
    <Card title="Needs attention" sub="What a coordinator can move today.">
      <div className="stats">
        <Stat label="Feedback to answer" value={num(a.feedback)} tone={tone(a.feedback, 'amber')} sub="The latest version has feedback nobody answered" />
        <Stat label="Overdue requests" value={num(a.overdueRequests)} tone={tone(a.overdueRequests, 'red')} sub={`${num(a.openRequests)} request${a.openRequests === 1 ? '' : 's'} open in all`} />
        <Stat label="At a checkpoint" value={num(a.atCheckpoint)} tone={tone(a.atCheckpoint, 'amber')} sub="Waiting for a checkpoint review" />
      </div>
    </Card>
  );
}

/** Why a page with no numbers has none. */
export function NoReports(props: { reports: OrgReports; what: string }) {
  if (props.reports.pending > 0) {
    return <Notice tone="gray" title="Reports are being updated" body="The server is refreshing these reports for this version of the dashboard. Check back in a few minutes." />;
  }
  return <Notice tone="gray" title={`No ${props.what} to show yet`}
    body="Reports appear after the server's next pass over new work. If you expected languages here, ask an administrator whether your role includes viewing status." />;
}

export function Freshness(props: { updatedAt: string | null; now: number }) {
  if (!props.updatedAt) return null;
  return (
    <p className="muted small" style={{ margin: 0 }}>
      Figures as of {new Date(props.updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })} ({timeAgo(props.updatedAt, props.now)}).
      Work recorded offline appears after the phone syncs and the server's next pass.
    </p>
  );
}
