import { paceOf, percent, recencyOf, TARGET_SCOPES, type LaneReport, type TargetScope } from '@langquest-next/core';
import { useState, type FormEvent } from 'react';
import { dayPercents, laneCsv, milestoneText, SCOPE_LABEL } from '../aggregate';
import { ActivityChart, DayBars, PACE_ADVICE, PACE_LABEL, PACE_TONE, ProgressLine, RECENCY_ADVICE, RECENCY_LABEL, RECENCY_TONE, shortDate, WorkBar } from '../charts';
import { COUNTRY_CODES, countryName } from '../countries';
import { fetchPrivileges, LoadError, saveLaneSetting, useLoad } from '../data';
import { orgRoute } from '../routes';
import type { LaneRow } from '../types';
import { Badge, Bar, Card, download, fileName, LoadFailed, Loading, Notice, num, Page, pctText } from '../ui';
import { AttentionCard, CoverageRows, Freshness, HeadlineStats, NoReports, ProgressPair } from './common';
import { useOrgCtx } from './shell';

/** One language's report: coverage, uploads, pace, its flow, books, and its settings for admins. */
export function LanguageScreen(props: { projectId: string; laneId: string }) {
  const ctx = useOrgCtx();
  const { reports } = ctx;
  const row = reports.status === 'ready' ? reports.data.rows.find((r) => r.projectId === props.projectId && r.laneId === props.laneId) : undefined;
  const title = row?.report.name ?? 'Language';
  return (
    <Page title={title} eyebrow={ctx.orgName}
      crumbs={[{ label: ctx.orgName || 'Organization', to: orgRoute(ctx.orgId) }, { label: 'Languages', to: orgRoute(ctx.orgId, 'languages') }, { label: title }]}
      actions={row ? (
        <>
          <button type="button" className="button" onClick={() => download(fileName(`${row.report.name} books`), laneCsv(row.report))}>Download CSV</button>
          <button type="button" className="button" onClick={() => window.print()}>Print</button>
        </>
      ) : undefined}>
      {reports.status === 'loading' ? <Loading what="the report" /> : null}
      {reports.status === 'error' ? <LoadFailed error={reports.error} retry={reports.reload} /> : null}
      {reports.status === 'ready' && !row ? (
        reports.data.rows.length === 0 ? <NoReports what="report for this language" /> : (
          <Notice tone="gray" title="This language has no report you can see"
            body="Your role may not include this language, or it was added after this page loaded (reload to check)." />
        )
      ) : null}
      {row ? <LanguageBody row={row} /> : null}
    </Page>
  );
}

function LanguageBody(props: { row: LaneRow }) {
  const ctx = useOrgCtx();
  const { report: r, orgId, projectId, laneId } = { ...props.row, orgId: ctx.orgId };
  const privileges = useLoad(() => fetchPrivileges(orgId, projectId, laneId), `${orgId}/${projectId}/${laneId}/privileges`);
  const recency = recencyOf(r, ctx.now);
  const pace = paceOf(r, ctx.now);
  const sevenAgo = new Date(ctx.now - 6 * 86_400_000).toISOString().slice(0, 10);
  return (
    <>
      <p className="muted" style={{ margin: 0, display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <Badge tone="brand">{r.languoidId.toUpperCase()}</Badge>
        <span>{r.country ? countryName(r.country) : 'No country set'}</span>
        <span>· Review flow: <strong>{r.flowName}</strong></span>
        {r.bottleneck ? <span>· Bottleneck: <strong>{r.bottleneck}</strong></span> : null}
        <Badge tone={RECENCY_TONE[recency.band]}>{RECENCY_LABEL[recency.band]}</Badge>
        {pace ? <Badge tone={PACE_TONE[pace.band]}>{PACE_LABEL[pace.band]}</Badge> : null}
      </p>
      <Freshness updatedAt={props.row.updatedAt} now={ctx.now} />
      <HeadlineStats total={r.progress.total} recorded={r.progress.recorded} done={r.progress.done} />
      <div className="grid-2">
        <Card title="Scripture coverage">
          <CoverageRows recorded={r.coverage.recorded} done={r.coverage.done} />
          {r.milestones.length ? (
            <>
              <h3 style={{ marginTop: 16 }}>Milestones</h3>
              <ul className="list">
                {[...r.milestones].reverse().map((m) => (
                  <li key={`${m.scope}-${m.threshold}`}><span>{milestoneText({ ...m, row: props.row })}</span><span className="muted small">{shortDate(m.at.slice(0, 10))} {m.at.slice(0, 4)}</span></li>
                ))}
              </ul>
            </>
          ) : null}
        </Card>
        <Card title="Uploads" sub={RECENCY_ADVICE[recency.band]}>
          <div className="stats">
            <div className="stat"><div className="stat-value">{num(r.uploads.cards)}</div><div className="stat-label">Recordings on the server</div></div>
            <div className="stat"><div className="stat-value">{num(r.uploads.chapters)}</div><div className="stat-label">Chapters with audio</div></div>
            <div className="stat">
              <div className="stat-value">{recency.days === null ? '—' : `${recency.days}d`}</div>
              <div className="stat-label">Since the last upload</div>
              {r.uploads.lastAt ? <div className="muted small">{shortDate(r.uploads.lastAt.slice(0, 10))} {r.uploads.lastAt.slice(0, 4)}</div> : null}
            </div>
          </div>
          {r.alerts.stuckCards > 0 ? (
            <Notice tone="red" title={`${num(r.alerts.stuckCards)} recordings stuck on phones`}
              body={`Recorded more than two weeks ago (the oldest ${r.alerts.stuckSince ? shortDate(r.alerts.stuckSince.slice(0, 10)) : ''}) and not yet on the server. Until they upload, the phone holds the only copy.`} />
          ) : null}
          <DayBars days={r.uploads.daily.map((d) => ({ day: d.day, value: d.cards }))} highlightFrom={sevenAgo} label="The last 7 days" unit="uploads" />
        </Card>
      </div>
      {r.target ? <PaceCard report={r} /> : null}
      <AttentionCard attention={r.attention} />
      <div className="grid-2">
        <FlowCard report={r} />
        <Card title="Where passages stand" sub="Each passage counted once.">
          <WorkBar work={r.work} />
        </Card>
      </div>
      <div className="grid-2">
        <Card title="Activity" sub="By week.">
          <ActivityChart weeks={r.activity.slice(-12)} withCards />
        </Card>
        <Card title="Progress over time" sub="Share of passages recorded and done, one point per day for the last 90 days.">
          <ProgressLine points={dayPercents(r)} />
        </Card>
      </div>
      <BooksCard report={r} />
      {privileges.status === 'ready' && privileges.data.has('manage_structure') ? <SettingsCard row={props.row} /> : null}
    </>
  );
}

function PaceCard(props: { report: LaneReport }) {
  const ctx = useOrgCtx();
  const pace = paceOf(props.report, ctx.now)!;
  const t = props.report.target!;
  return (
    <Card title="Pace" right={<Badge tone={PACE_TONE[pace.band]}>{PACE_LABEL[pace.band]} {pace.gap >= 0 ? '+' : ''}{pace.gap} pts</Badge>}
      sub={`${SCOPE_LABEL[t.scope]} from ${shortDate(t.startDate)} ${t.startDate.slice(0, 4)} to ${shortDate(t.targetDate)} ${t.targetDate.slice(0, 4)}. ${PACE_ADVICE[pace.band]}`}>
      <Bar value={pace.actual} tick={pace.expected} tone={PACE_TONE[pace.band]} label={`${pace.actual}% recorded, plan ${pace.expected}%`} />
      <p className="small">
        <strong>{pctText(pace.actual)}</strong> of the {SCOPE_LABEL[t.scope]} recorded; a straight line to the target puts it at {pctText(pace.expected)} today (the tick).
        {pace.projectedFinish && pace.band !== 'complete' ? ` At the last eight weeks' rate it finishes around ${shortDate(pace.projectedFinish)} ${pace.projectedFinish.slice(0, 4)}.` : ''}
        {!pace.projectedFinish ? ' No progress in the last eight weeks.' : ''}
      </p>
    </Card>
  );
}

function FlowCard(props: { report: LaneReport }) {
  const r = props.report;
  if (r.stages.length === 0) {
    return (
      <Card title="Review flow">
        <p className="muted">This language's flow has no review steps, so a recorded passage is done.</p>
      </Card>
    );
  }
  return (
    <Card title="Review flow" sub="How many recorded passages have cleared each step, and how many wait at it.">
      <ol className="steps">
        {r.stages.map((s, i) => {
          const cleared = r.progress.steps[i]?.cleared ?? 0;
          return (
            <li key={s.stepId}>
              <span><strong>{s.name}</strong> {s.checkpoint ? <Badge tone="amber">Checkpoint</Badge> : null}</span>
              <Bar value={percent(cleared, r.progress.total)} tone="green" label={`${s.name}: ${percent(cleared, r.progress.total)}% cleared`} />
              <span className="small">
                {num(cleared)} cleared
                {s.passages > 0 ? <><br /><strong>{num(s.passages)} waiting</strong></> : null}
              </span>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function BooksCard(props: { report: LaneReport }) {
  const { books } = props.report;
  return (
    <Card title="Books">
      {books.length === 0 ? <p className="muted">No passages yet.</p> : (
        <div className="table-scroll">
          <table className="table">
            <thead><tr><th scope="col">Book</th><th scope="col">Progress</th><th scope="col" className="num">Passages</th></tr></thead>
            <tbody>
              {books.map((b) => (
                <tr key={b.bookId ?? b.label}>
                  <td><strong>{b.label}</strong></td>
                  <td><ProgressPair total={b.total} recorded={b.recorded} done={b.done} /></td>
                  <td className="num">{num(b.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

type Status = { tone: 'green' | 'red' | 'amber'; text: string } | null;

/** Country and target, for people who manage the organization's structure. The server checks again on save. */
function SettingsCard(props: { row: LaneRow }) {
  const ctx = useOrgCtx();
  const r = props.row.report;
  const [country, setCountry] = useState(r.country ?? '');
  const [scope, setScope] = useState<TargetScope>(r.target?.scope ?? 'nt');
  const [start, setStart] = useState(r.target?.startDate ?? new Date(ctx.now).toISOString().slice(0, 10));
  const [end, setEnd] = useState(r.target?.targetDate ?? new Date(ctx.now + 548 * 86_400_000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState<'' | 'country' | 'target'>('');
  const [status, setStatus] = useState<Status>(null);
  const who = { orgId: ctx.orgId, projectId: props.row.projectId, actorId: ctx.actorId };

  async function save(what: 'country' | 'target', e: FormEvent) {
    e.preventDefault();
    setBusy(what);
    setStatus(null);
    try {
      if (what === 'country') await saveLaneSetting(who, 'v1.LaneCountrySet', { laneId: r.laneId, country });
      else await saveLaneSetting(who, 'v1.LaneTargetSet', { laneId: r.laneId, scope, startDate: start, targetDate: end });
      setStatus({ tone: 'green', text: 'Saved.' });
      ctx.reports.refresh();
    } catch (err) {
      setStatus({ tone: err instanceof LoadError && err.offline ? 'amber' : 'red', text: err instanceof Error ? err.message : 'Not saved.' });
    } finally {
      setBusy('');
    }
  }

  return (
    <Card title="Language settings" sub="Where this language's work happens, and what it aims to record by when. Only people who manage the organization's structure see this.">
      <form className="form-row" onSubmit={(e) => void save('country', e)}>
        <label>
          Country
          <select value={country} onChange={(e) => setCountry(e.target.value)} required>
            <option value="" disabled>Choose a country</option>
            {COUNTRY_CODES.map((c) => <option key={c} value={c}>{countryName(c)}</option>)}
          </select>
        </label>
        <button type="submit" className="button" disabled={busy !== '' || !country || country === r.country}>{busy === 'country' ? 'Saving…' : 'Save country'}</button>
      </form>
      <form className="form-row" style={{ marginTop: 16 }} onSubmit={(e) => void save('target', e)}>
        <label>
          Target
          <select value={scope} onChange={(e) => setScope(e.target.value as TargetScope)}>
            {TARGET_SCOPES.map((s) => <option key={s} value={s}>{SCOPE_LABEL[s]}</option>)}
          </select>
        </label>
        <label>
          Start
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
        </label>
        <label>
          Finish by
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
        </label>
        <button type="submit" className="button" disabled={busy !== '' || !(end > start)}>{busy === 'target' ? 'Saving…' : 'Save target'}</button>
      </form>
      {!(end > start) ? <p className="small" role="alert">The finish date must be after the start.</p> : null}
      {status ? <div style={{ marginTop: 12 }}><Notice tone={status.tone} title={status.text} /></div> : null}
    </Card>
  );
}
