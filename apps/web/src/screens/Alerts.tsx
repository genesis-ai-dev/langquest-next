import { alertsFor, type AlertLevel } from '../aggregate';
import { shortDate } from '../charts';
import { Link } from '../router';
import { Badge, Card, Notice, num, type Tone } from '../ui';
import { OrgPage, useOrgCtx } from './shell';

const LEVEL: Record<AlertLevel, { label: string; tone: Tone }> = {
  attention: { label: 'Needs attention', tone: 'red' },
  look: { label: 'Worth a look', tone: 'amber' },
  fyi: { label: 'For your information', tone: 'brand' }
};

/** Checks on the data itself, in plain language (Every Language "Alerts"). */
export function Alerts(props: { query: Record<string, string> }) {
  const ctx = useOrgCtx();
  return (
    <OrgPage title="Alerts" section="alerts" query={props.query}>
      {(rows) => {
        const pending = ctx.reports.status === 'ready' ? ctx.reports.data.pending : 0;
        const alerts = alertsFor(rows, pending, ctx.now);
        const count = (l: AlertLevel) => alerts.filter((a) => a.level === l).length;
        return (
          <>
            <div className="chips" aria-label="Alert counts">
              {(['attention', 'look', 'fyi'] as const).map((l) => <Badge key={l} tone={LEVEL[l].tone}>{count(l)} {LEVEL[l].label.toLowerCase()}</Badge>)}
            </div>
            {alerts.length === 0 ? <Notice tone="green" title="All clear" body="No stuck audio, integrity problems or stale figures." /> : null}
            {alerts.map((a) => (
              <Card key={a.id} className={`alert alert-${a.level}`} title={a.title} right={<Badge tone={LEVEL[a.level].tone}>{LEVEL[a.level].label}</Badge>}>
                <p style={{ marginTop: 0 }}>{a.body}</p>
                <p><strong>What to do:</strong> {a.action}</p>
                {a.rows.length ? (
                  <details open={a.level === 'attention'}>
                    <summary>{a.rows.length} language{a.rows.length === 1 ? '' : 's'}</summary>
                    <ul className="list">
                      {a.rows.map((r) => (
                        <li key={r.laneId}>
                          <Link to={{ name: 'language', orgId: ctx.orgId, projectId: r.projectId, laneId: r.laneId }}>{r.report.name}</Link>
                          <span className="muted small">
                            {a.id === 'stuck' ? `${num(r.report.alerts.stuckCards)} recordings in ${num(r.report.alerts.stuckPassages)} passages, oldest from ${r.report.alerts.stuckSince ? shortDate(r.report.alerts.stuckSince.slice(0, 10)) : '?'}` : null}
                            {a.id === 'invalid' ? `${num(r.report.alerts.invalidCards)} recordings` : null}
                            {a.id === 'stale' ? `refreshed ${new Date(r.updatedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </Card>
            ))}
          </>
        );
      }}
    </OrgPage>
  );
}
