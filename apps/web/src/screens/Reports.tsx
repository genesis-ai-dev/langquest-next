import { lazy, Suspense, useState } from 'react';
import { fieldReport, mergedDaily, combinedActivity, milestoneText, reportText, SCOPE_LABEL, type ReportWindow } from '../aggregate';
import { DayBars, GroupedBars, shortDate, StackBar } from '../charts';
import { countryName } from '../countries';
import { navigate } from '../router';
import { orgRoute } from '../routes';
import { Badge, Card, Chips, Delta, Stat, num, pctText } from '../ui';
import { OrgPage, useOrgCtx } from './shell';

const WorldMap = lazy(() => import('./WorldMap'));

/** A report to send: what happened this week, month or year, in words and a few charts (Every Language "Reports"). */
export function Reports(props: { query: Record<string, string> }) {
  const ctx = useOrgCtx();
  const period = (['week', 'month', 'ytd'].includes(props.query['window'] ?? '') ? props.query['window'] : 'week') as ReportWindow;
  const [copied, setCopied] = useState('');
  return (
    <OrgPage title="Field report" section="reports" query={props.query} filterCountry
      actions={(rows) => (
        <>
          <Chips label="Period" value={period} onChange={(v) => navigate(orgRoute(ctx.orgId, 'reports', { ...props.query, window: v === 'week' ? '' : v }), { replace: true })}
            options={[{ value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' }, { value: 'ytd', label: 'Year to date' }]} />
          <button type="button" className="button" onClick={() => {
            void navigator.clipboard.writeText(reportText(fieldReport(rows, period, ctx.now), ctx.orgName)).then(
              () => setCopied('Copied. Paste it into an email or a message.'), () => setCopied('Could not copy; select the report and copy it instead.'));
          }}>Copy as text</button>
          <button type="button" className="button" onClick={() => window.print()}>Print or save as PDF</button>
          <span role="status" className="muted small">{copied}</span>
        </>
      )}>
      {(rows) => {
        const fr = fieldReport(rows, period, ctx.now);
        const countryCards = new Map<string, number>();
        for (const x of fr.mostRecorded) if (x.row.report.country) countryCards.set(x.row.report.country, (countryCards.get(x.row.report.country) ?? 0) + x.cards);
        const maxCards = Math.max(1, ...fr.mostRecorded.map((x) => x.cards));
        return (
          <article className="card report">
            <p className="eyebrow">{ctx.orgName} · Field report</p>
            <h1 style={{ fontSize: 30 }}>{fr.title}</h1>
            <p className="muted">{shortDate(fr.from)} – {shortDate(fr.to)}, {fr.to.slice(0, 4)} · as of {new Date(ctx.now).toLocaleDateString('en-US', { dateStyle: 'medium' })}</p>
            <p className="lede">
              <strong>{num(fr.cards)} recordings</strong> reached the server from <strong>{num(fr.languagesRecording)} language{fr.languagesRecording === 1 ? '' : 's'}</strong>
              {fr.countries ? <> in {num(fr.countries)} countr{fr.countries === 1 ? 'y' : 'ies'}</> : null}.
              {fr.milestones.length ? <> <strong>{num(fr.milestones.length)} milestone{fr.milestones.length === 1 ? '' : 's'}</strong> crossed the line.</> : null}
            </p>

            <h2>By the numbers</h2>
            <div className="stats">
              <Stat label="Recordings" value={num(fr.cards)} tone="brand"
                sub={fr.previousCards !== null ? undefined : `since ${shortDate(fr.from)}`} />
              <Stat label="Languages that recorded" value={num(fr.languagesRecording)} sub={`of ${num(fr.languages)}`} />
              <Stat label="New Testament recorded" value={pctText(fr.ntRecorded)} sub="across all languages, by verse" />
              <Stat label="Passages done" value={num(fr.passagesDone)} sub="through review, all time" />
            </div>
            {fr.previousCards !== null ? <p className="small"><Delta now={fr.cards} before={fr.previousCards} unit="recordings" /></p> : null}

            {countryCards.size ? (
              <>
                <h2>Where the work happened</h2>
                <Suspense fallback={<p className="muted">Loading the map…</p>}>
                  <WorldMap values={[...countryCards].map(([country, value]) => ({ country, value }))} unit="recordings" compact />
                </Suspense>
              </>
            ) : null}

            <h2>Scripture coverage advanced</h2>
            {fr.advanced.length === 0 ? <p className="muted">No language's coverage moved in this period.</p> : (
              <ul className="list">
                {fr.advanced.map((a) => (
                  <li key={a.row.laneId} style={{ display: 'block' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span><strong>{a.row.report.name}</strong> <span className="muted small">{a.row.report.country ? `${countryName(a.row.report.country)} · ` : ''}{SCOPE_LABEL[a.scope]}</span></span>
                      <strong className="delta-up">+{(Math.round(10 * (a.after - a.before)) / 10).toFixed(1)} points</strong>
                    </div>
                    <div className="stack" style={{ height: 10, marginTop: 4 }} aria-hidden="true">
                      <div className="stack-part bar-brand" style={{ width: `${a.before}%` }} />
                      <div className="stack-part bar-green" style={{ width: `${a.after - a.before}%` }} />
                    </div>
                    <span className="muted xs">{pctText(a.before)} → {pctText(a.after)} of the {SCOPE_LABEL[a.scope]}</span>
                  </li>
                ))}
              </ul>
            )}

            <h2>Day by day</h2>
            {period === 'ytd' ? (
              <GroupedBars labels={combinedActivity(rows).map((w) => w.weekStart)} format={shortDate} title={(d) => `Week of ${shortDate(d)}`} empty="No recordings this year."
                series={[{ key: 'cards', label: 'Recordings per week', className: 'fill-brand', values: combinedActivity(rows).map((w) => (w.weekStart >= fr.from ? w.cards : 0)) }]} />
            ) : (
              <DayBars days={mergedDaily(rows).map((d) => ({ day: d.day, value: d.cards }))} highlightFrom={fr.from}
                label={period === 'week' ? 'The last 7 days' : 'The last 30 days'} unit="recordings" />
            )}

            <h2>Languages that recorded most</h2>
            {fr.mostRecorded.length === 0 ? <p className="muted">No recordings in this period.</p> : (
              <ol className="list" style={{ padding: 0 }}>
                {fr.mostRecorded.slice(0, 10).map((x, i) => (
                  <li key={x.row.laneId}>
                    <span className="rank">{i + 1}</span>
                    <span className="grow">
                      <strong>{x.row.report.name}</strong> <span className="muted small">{x.row.report.country ? countryName(x.row.report.country) : ''}</span>
                      <div className="bar" style={{ marginTop: 4 }}><div className="bar-fill bar-brand" style={{ width: `${(100 * x.cards) / maxCards}%` }} /></div>
                    </span>
                    <Badge tone="green">{pctText(x.row.report.coverage.recorded.nt)} NT</Badge>
                    <span className="num"><strong>+{num(x.cards)}</strong></span>
                  </li>
                ))}
              </ol>
            )}
            {fr.mostRecorded.length > 10 ? <p className="muted small">…and {fr.mostRecorded.length - 10} more languages recorded in this period.</p> : null}

            <h2>Where all {num(fr.languages)} languages stand</h2>
            <p className="small" style={{ fontWeight: 600 }}>How recently each language sent new recordings</p>
            <StackBar parts={[
              { key: 'active', label: 'Active', value: fr.portfolio.active, tone: 'green' },
              { key: 'quiet', label: 'Quiet', value: fr.portfolio.quiet, tone: 'amber' },
              { key: 'inactive', label: 'Inactive', value: fr.portfolio.inactive, tone: 'gray' },
              { key: 'not_started', label: 'No uploads yet', value: fr.portfolio.not_started, tone: 'brand' }
            ]} />
            <p className="small" style={{ fontWeight: 600 }}>What each language is working on</p>
            <StackBar parts={[
              { key: 'gospels', label: 'Gospels', value: fr.workingOn.gospels, tone: 'brand' },
              { key: 'nt', label: 'New Testament', value: fr.workingOn.nt, tone: 'green' },
              { key: 'ot', label: 'Old Testament', value: fr.workingOn.ot, tone: 'amber' },
              { key: 'bible', label: 'Whole Bible', value: fr.workingOn.bible, tone: 'red' },
              { key: 'none', label: 'Not yet recording', value: fr.workingOn.none, tone: 'gray' }
            ]} />

            <h2>Milestones</h2>
            {fr.milestones.length === 0 ? <p className="muted">No coverage milestones in this period.</p> : (
              <ul className="list">
                {fr.milestones.map((m) => (
                  <li key={`${m.row.laneId}-${m.scope}-${m.threshold}`}>
                    <span className="grow">{milestoneText(m)}</span>
                    <span className="muted small">{shortDate(m.at.slice(0, 10))}</span>
                  </li>
                ))}
              </ul>
            )}

            <h2>Where recording paused or resumed</h2>
            {fr.wentQuiet.length === 0 && fr.resumed.length === 0 ? <p className="muted">No language went quiet or came back in this period.</p> : (
              <ul className="list">
                {fr.wentQuiet.map((r) => <li key={`q-${r.laneId}`}><span><strong>{r.report.name}</strong> went quiet: no new recordings in 14+ days.</span><Badge tone="amber">Quiet</Badge></li>)}
                {fr.resumed.map((r) => <li key={`r-${r.laneId}`}><span><strong>{r.report.name}</strong> is recording again after two quiet weeks or more.</span><Badge tone="green">Resumed</Badge></li>)}
              </ul>
            )}
          </article>
        );
      }}
    </OrgPage>
  );
}
