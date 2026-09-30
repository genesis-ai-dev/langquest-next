import { activityWindow, logByDay, topLanguages } from '../aggregate';
import { CompareBars, shortDate } from '../charts';
import { countryName } from '../countries';
import { navigate, Link } from '../router';
import { orgRoute } from '../routes';
import { Card, Chips, Delta, Stat, num } from '../ui';
import { OrgPage, useOrgCtx } from './shell';

/** Uploads across languages over the last one or two weeks (Every Language "Recent Activity"). */
export function Activity(props: { query: Record<string, string> }) {
  const ctx = useOrgCtx();
  const days = props.query['days'] === '14' ? 14 : 7;
  return (
    <OrgPage title="Recent activity" section="activity" query={props.query} filterCountry
      actions={() => (
        <Chips label="Window" value={String(days)} onChange={(v) => navigate(orgRoute(ctx.orgId, 'activity', { ...props.query, days: v }), { replace: true })}
          options={[{ value: '7', label: 'Last 7 days' }, { value: '14', label: 'Last 14 days' }]} />
      )}>
      {(rows) => {
        const w = activityWindow(rows, days, ctx.now);
        const log = logByDay(rows, days, ctx.now);
        const top = topLanguages(rows, days, ctx.now).slice(0, 8);
        const maxTop = Math.max(1, ...top.map((t) => t.cards));
        return (
          <>
            <Card>
              <div className="hero">
                <div>
                  <p className="eyebrow">Recordings uploaded · last {days} days</p>
                  <div className="hero-num">{num(w.cards)}</div>
                  <p className="small" style={{ marginBottom: 0 }}><Delta now={w.cards} before={w.previousCards} /></p>
                </div>
              </div>
            </Card>
            <div className="stats">
              <Stat label="Passages with new audio" value={num(w.passages)} />
              <Stat label="Languages uploading" value={num(w.languages)} sub={`of ${num(rows.length)}`} />
              <Stat label="Books touched" value={num(w.books)} />
              <Stat label="Recordings on the server" value={num(rows.reduce((n, r) => n + r.report.uploads.cards, 0))} sub="all time" />
            </div>
            <Card title="Recordings per day" sub={`Each day of the last ${days} beside the same day of the ${days} before.`}>
              <CompareBars unit="recordings"
                current={w.daily.map((d) => ({ day: d.day, value: d.cards }))}
                previous={w.previousDaily.map((d) => ({ day: d.day, value: d.cards }))} />
            </Card>
            <div className="grid-3-1">
              <div style={{ display: 'grid', gap: 16, alignContent: 'start' }}>
                {log.length === 0 ? <Card><p className="muted">No new audio reached the server in the last {days} days.</p></Card> : log.map((d) => (
                  <Card key={d.day} eyebrow={d.day === new Date(ctx.now).toISOString().slice(0, 10) ? 'Today' : undefined}
                    title={new Date(`${d.day}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })}
                    right={<span className="small muted">{num(d.passages)} passages · {num(d.languages)} languages · <strong>{num(d.cards)}</strong> recordings</span>}>
                    <div className="table-scroll">
                      <table className="table">
                        <thead><tr><th scope="col">Time (UTC)</th><th scope="col">Language / passage</th><th scope="col">Country</th><th scope="col" className="num">Recordings</th><th scope="col" className="num">Verses</th></tr></thead>
                        <tbody>
                          {d.entries.map((e) => (
                            <tr key={`${e.row.laneId}-${e.unitId}`}>
                              <td className="num">{e.at.slice(11, 16)}</td>
                              <td>
                                <Link to={{ name: 'language', orgId: ctx.orgId, projectId: e.row.projectId, laneId: e.row.laneId }}><strong>{e.row.report.name}</strong></Link>
                                <span className="muted"> / {e.label}</span>
                              </td>
                              <td className="small">{e.row.report.country ? countryName(e.row.report.country) : <span className="muted">—</span>}</td>
                              <td className="num"><strong>{num(e.cards)}</strong></td>
                              <td className="num">{e.verses ? num(e.verses) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                ))}
              </div>
              <Card title="Most active" eyebrow={`Last ${days} days`} sub="By recordings uploaded.">
                {top.length === 0 ? <p className="muted">Nobody uploaded in this window.</p> : (
                  <ol className="list" style={{ padding: 0 }}>
                    {top.map((t, i) => (
                      <li key={t.row.laneId}>
                        <span className="rank">{i + 1}</span>
                        <span className="grow">
                          <Link to={{ name: 'language', orgId: ctx.orgId, projectId: t.row.projectId, laneId: t.row.laneId }}><strong>{t.row.report.name}</strong></Link>
                          <div className="bar" style={{ marginTop: 4 }}><div className="bar-fill bar-brand" style={{ width: `${(100 * t.cards) / maxTop}%` }} /></div>
                          <span className="muted xs">{t.row.report.country ? countryName(t.row.report.country) : 'No country'}{t.row.report.uploads.lastAt ? ` · last ${shortDate(t.row.report.uploads.lastAt.slice(0, 10))}` : ''}</span>
                        </span>
                        <span className="num"><strong>{num(t.cards)}</strong></span>
                      </li>
                    ))}
                  </ol>
                )}
              </Card>
            </div>
          </>
        );
      }}
    </OrgPage>
  );
}
