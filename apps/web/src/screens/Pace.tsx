import { paceGroups, SCOPE_LABEL } from '../aggregate';
import { PACE_ADVICE, PACE_LABEL, PACE_TONE, PaceStrip, shortDate } from '../charts';
import { countryName } from '../countries';
import { Link } from '../router';
import { Badge, Bar, Card, Stat, num, pctText } from '../ui';
import { OrgPage, useOrgCtx } from './shell';

/**
 * Each language against its own target (Every Language "Pace"): recorded
 * coverage of the target's scope against a straight line from its start
 * date to its target date. Targets are set per language (decision 41).
 */
export function Pace(props: { query: Record<string, string> }) {
  const ctx = useOrgCtx();
  return (
    <OrgPage title="Pace" section="pace" query={props.query} filterCountry>
      {(rows) => {
        const groups = paceGroups(rows, ctx.now);
        const withTarget = groups.flatMap((g) => g.items).filter((i) => i.pace);
        return (
          <>
            <Card eyebrow="Against plan today" title={`${num(withTarget.length)} of ${num(rows.length)} languages have a target`}
              sub="Each dot is a language's gap to where a straight line from its start to its target date puts it today. The shaded band is on pace.">
              <PaceStrip items={withTarget.map((i) => ({ name: i.row.report.name, gap: i.pace!.gap, band: i.pace!.band }))} />
            </Card>
            <div className="stats">
              {(['ahead', 'on_pace', 'behind', 'stalled'] as const).map((b) => {
                const count = groups.find((g) => g.band === b)!.items.length;
                return <Stat key={b} label={PACE_LABEL[b]} value={num(count)} sub={PACE_ADVICE[b]}
                  tone={count === 0 ? undefined : b === 'stalled' ? 'red' : b === 'behind' ? 'amber' : b === 'ahead' ? 'green' : 'brand'} />;
              })}
            </div>
            <Card title="By pace" sub="Bars show recorded coverage of each target; the tick is where the plan expects the language today.">
              {groups.filter((g) => g.items.length).map((g) => (
                <section key={g.band} aria-label={PACE_LABEL[g.band]}>
                  <div className="group-head">
                    <Badge tone={PACE_TONE[g.band]}>{PACE_LABEL[g.band]}</Badge>
                    <span className="muted small">{g.items.length}</span>
                  </div>
                  <ul className="list">
                    {g.items.map(({ row, pace }) => (
                      <li key={row.laneId}>
                        <span style={{ minWidth: 200 }}>
                          <Link to={{ name: 'language', orgId: ctx.orgId, projectId: row.projectId, laneId: row.laneId }}><strong>{row.report.name}</strong></Link>
                          <div className="muted xs">
                            {row.report.country ? `${countryName(row.report.country)} · ` : ''}
                            {row.report.target ? `${SCOPE_LABEL[row.report.target.scope]} · ${shortDate(row.report.target.startDate)} ${row.report.target.startDate.slice(0, 4)} – ${shortDate(row.report.target.targetDate)} ${row.report.target.targetDate.slice(0, 4)}` : 'No target set'}
                          </div>
                        </span>
                        {pace ? (
                          <>
                            <span className="grow"><Bar value={pace.actual} tick={pace.expected} tone={PACE_TONE[pace.band]} label={`${row.report.name}: ${pace.actual}% recorded, plan ${pace.expected}%`} /></span>
                            <span className="num small" style={{ minWidth: 150, textAlign: 'right' }}>
                              <strong>{pace.gap >= 0 ? '+' : ''}{pace.gap} pts</strong>
                              <div className="muted xs">{pctText(pace.actual)} of plan's {pctText(pace.expected)}{pace.projectedFinish && pace.band !== 'complete' ? ` · finishes ${shortDate(pace.projectedFinish)} ${pace.projectedFinish.slice(0, 4)}` : ''}</div>
                            </span>
                          </>
                        ) : <span className="muted small">Set a target on the language page.</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </Card>
          </>
        );
      }}
    </OrgPage>
  );
}
