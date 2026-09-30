import { lazy, Suspense } from 'react';
import {
  combinedActivity, coverageAverage, countryCounts, logByDay, milestonesSince, milestoneText, orgTotals, portfolioCounts
} from '../aggregate';
import { shortDate, Sparkline, StackBar, WorkBar } from '../charts';
import { countryName } from '../countries';
import { Link } from '../router';
import { orgRoute } from '../routes';
import { Badge, Card, num } from '../ui';
import { AttentionCard, CoverageRows, Freshness, HeadlineStats } from './common';
import { OrgPage, useOrgCtx } from './shell';

const WorldMap = lazy(() => import('./WorldMap'));

/** The organization at a glance (Every Language "Overview"): totals, coverage, who is uploading, and what just happened. */
export function Overview(props: { query: Record<string, string> }) {
  const ctx = useOrgCtx();
  return (
    <OrgPage title="Overview" section="overview" query={props.query} filterCountry>
      {(rows) => {
        const { now } = ctx;
        const totals = orgTotals(rows);
        const weeks = combinedActivity(rows);
        let running = 0;
        const cumulative = weeks.map((w) => (running += w.cards));
        const totalCards = rows.reduce((n, r) => n + r.report.uploads.cards, 0);
        const recent = weeks.slice(-4).reduce((n, w) => n + w.cards, 0);
        const portfolio = portfolioCounts(rows, now);
        const lastDays = logByDay(rows, 2, now);
        const milestones = milestonesSince(rows, new Date(now - 30 * 86_400_000).toISOString());
        const countries = countryCounts(rows).filter((c) => c.country);
        return (
          <>
            <Freshness updatedAt={totals.oldestUpdate} now={now} />
            <Card>
              <div className="hero">
                <div>
                  <p className="eyebrow">Recordings on the server</p>
                  <div className="hero-num">{num(totalCards)}</div>
                  <p className="muted small" style={{ marginBottom: 0 }}>
                    Across {num(rows.length)} language{rows.length === 1 ? '' : 's'} · {num(recent)} in the last four weeks
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Sparkline values={cumulative} label="Recordings on the server, week by week" />
                  <p className="muted xs" style={{ margin: 0 }}>Cumulative, last {weeks.length} weeks</p>
                </div>
              </div>
            </Card>
            <HeadlineStats languages={totals.languages} total={totals.total} recorded={totals.recorded} done={totals.done} />
            <div className="grid-2">
              <Card title="Scripture coverage" eyebrow="Average across languages">
                <CoverageRows recorded={coverageAverage(rows, 'recorded')} done={coverageAverage(rows, 'done')} />
              </Card>
              <Card title="Who is uploading" eyebrow="Portfolio"
                right={<Link to={orgRoute(ctx.orgId, 'languages', props.query)} className="small">Languages ›</Link>}>
                <StackBar parts={[
                  { key: 'active', label: 'Active (last 14 days)', value: portfolio.active, tone: 'green' },
                  { key: 'quiet', label: 'Quiet (14–44 days)', value: portfolio.quiet, tone: 'amber' },
                  { key: 'inactive', label: 'Inactive (45+ days)', value: portfolio.inactive, tone: 'gray' },
                  { key: 'not_started', label: 'No uploads yet', value: portfolio.not_started, tone: 'brand' }
                ]} />
              </Card>
            </div>
            <AttentionCard attention={totals} />
            <div className="grid-2">
              <Card title="Last 48 hours" eyebrow="Recent activity"
                right={<Link to={orgRoute(ctx.orgId, 'activity', props.query)} className="small">Recent activity ›</Link>}>
                {lastDays.length === 0 ? <p className="muted">No new audio in the last two days.</p> : (
                  <ul className="list">
                    {lastDays.flatMap((d) => d.entries).slice(0, 6).map((e) => (
                      <li key={`${e.row.laneId}-${e.day}-${e.unitId}`}>
                        <span className="grow"><strong>{e.row.report.name}</strong> <span className="muted">/ {e.label}</span></span>
                        <span className="num"><strong>{num(e.cards)}</strong> <span className="muted xs">rec</span></span>
                        <span className="muted xs">{shortDate(e.day)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Milestones" eyebrow="Last 30 days">
                {milestones.length === 0 ? <p className="muted">No coverage milestones in the last 30 days.</p> : (
                  <ul className="list">
                    {milestones.slice(0, 6).map((m) => (
                      <li key={`${m.row.laneId}-${m.scope}-${m.threshold}`}>
                        <span className="grow">{milestoneText(m)}</span>
                        <Badge tone={m.threshold === 100 ? 'green' : 'brand'}>{m.threshold}%</Badge>
                        <span className="muted xs">{shortDate(m.at.slice(0, 10))}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
            <div className="grid-2">
              <Card title="Where passages stand" sub="Every passage in every language, counted once.">
                <WorkBar work={totals.work} />
              </Card>
              <Card title="Languages by country" eyebrow="Geography"
                right={<Link to={orgRoute(ctx.orgId, 'geography')} className="small">Map ›</Link>}>
                {countries.length === 0 ? <p className="muted">No language has a country yet. Set one on each language's page.</p> : (
                  <Suspense fallback={<p className="muted">Loading the map…</p>}>
                    <WorldMap values={countries.map((c) => ({ country: c.country!, value: c.languages }))} unit="languages" compact />
                  </Suspense>
                )}
                {countries.length ? <p className="muted xs">{countries.map((c) => `${countryName(c.country)} ${c.languages}`).join(' · ')}</p> : null}
              </Card>
            </div>
          </>
        );
      }}
    </OrgPage>
  );
}
