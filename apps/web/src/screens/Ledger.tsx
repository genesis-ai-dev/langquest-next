import { paceOf, recencyOf } from '@langquest-next/core';
import { defaultLedgerMonth, isSettled, ledgerCsv, ledgerFor, ledgerMonths, paceGroups, plural, SETTLE_DAYS } from '../aggregate';
import { GroupedBars, PACE_LABEL, PACE_TONE, StackBar, shortDate } from '../charts';
import { countryName } from '../countries';
import { Link, navigate } from '../router';
import { orgRoute } from '../routes';
import type { LaneRow } from '../types';
import { Badge, Card, Delta, Notice, Stat, download, num } from '../ui';
import { OrgPage, useOrgCtx } from './shell';

const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthShort = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });

/**
 * Chapters that got their first audio, month by month (Every Language
 * "Monthly Ledger"). A chapter counts once, in the month its first
 * recording reached the server; a month's figures settle SETTLE_DAYS after
 * it ends, when late uploads from phones that were offline have arrived.
 */
export function Ledger(props: { query: Record<string, string> }) {
  const ctx = useOrgCtx();
  return (
    <OrgPage title="Monthly ledger" section="ledger" query={props.query} filterCountry
      actions={(rows) => {
        const months = ledgerMonths(rows);
        const month = months.includes(props.query['month'] ?? '') ? props.query['month']! : defaultLedgerMonth(months, ctx.now);
        return month ? (
          <button type="button" className="button" onClick={() => download(`${ctx.orgName} ledger ${month}.csv`.replace(/[\\/:*?"<>|]+/g, ' '), ledgerCsv(rows, month, countryName))}>
            Export {monthShort(month)} ledger (CSV)
          </button>
        ) : null;
      }}>
      {(rows) => {
        const months = ledgerMonths(rows);
        const month = months.includes(props.query['month'] ?? '') ? props.query['month']! : defaultLedgerMonth(months, ctx.now);
        if (!month) return <Notice tone="gray" title="No months yet" body="The ledger fills in once audio reaches the server." />;
        const i = months.indexOf(month);
        const go = (m: string | undefined) => m && navigate(orgRoute(ctx.orgId, 'ledger', { ...props.query, month: m }), { replace: true });
        const l = ledgerFor(rows, month);
        const prev = i > 0 ? ledgerFor(rows, months[i - 1]!) : null;
        const settled = isSettled(month, ctx.now);
        const byMonth = months.map((m) => ledgerFor(rows, m).chapters);
        const pace = paceGroups(rows, ctx.now).filter((g) => g.band !== 'no_target');
        const noTarget = paceGroups(rows, ctx.now).find((g) => g.band === 'no_target')!.items.length;
        const idle = rows.filter((r) => !l.lines.some((x) => x.row.laneId === r.laneId && x.row.projectId === r.projectId));
        const countries = new Map<string, typeof l.lines>();
        for (const line of l.lines) {
          const k = line.row.report.country ?? '';
          countries.set(k, [...(countries.get(k) ?? []), line]);
        }
        return (
          <>
            <div className="filters no-print">
              <div className="actions">
                <button type="button" className="button" disabled={i <= 0} onClick={() => go(months[i - 1])} aria-label="Previous month">‹</button>
                <label>
                  <span className="sr-only">Month</span>
                  <select value={month} onChange={(e) => go(e.target.value)}>
                    {[...months].reverse().map((m) => <option key={m} value={m}>{monthName(m)}{isSettled(m, ctx.now) ? '' : ' (still moving)'}</option>)}
                  </select>
                </label>
                <button type="button" className="button" disabled={i >= months.length - 1} onClick={() => go(months[i + 1])} aria-label="Next month">›</button>
              </div>
            </div>
            {!settled ? (
              <Notice tone="amber" title={`${monthName(month)} is still moving`}
                body={`Phones that were offline keep delivering this month's work for a few days after it ends, so these figures settle ${SETTLE_DAYS} days into the next month. Use a settled month for invoices.`} />
            ) : null}
            <Card eyebrow="Monthly ledger" title={monthName(month)}>
              <div className="grid-2" style={{ alignItems: 'center' }}>
                <div className="stats">
                  <Stat label="New chapters with audio" value={num(l.chapters)} tone="brand" />
                  <Stat label="Books with new audio" value={num(l.books)} />
                  <Stat label="Languages" value={num(l.languages)} sub={`of ${num(rows.length)}`} />
                </div>
                <div>
                  <GroupedBars labels={months} format={monthShort} title={monthName} empty="No chapters yet." table={false}
                    series={[
                      { key: 'other', label: 'Other months', className: 'fill-prior', values: byMonth.map((v, k) => (k === i ? 0 : v)) },
                      { key: 'this', label: monthName(month), className: 'fill-brand', values: byMonth.map((v, k) => (k === i ? v : 0)) }
                    ]} />
                </div>
              </div>
              {prev ? <p className="small"><Delta now={l.chapters} before={prev.chapters} unit="chapters" /></p> : null}
              <p className="muted xs">A chapter counts once, in the month its first recording reached the server.</p>
            </Card>
            <Card title="Pace today" sub={noTarget ? `${plural(noTarget, 'language')} ${noTarget === 1 ? 'has' : 'have'} no target and ${noTarget === 1 ? 'is' : 'are'} left out.` : undefined}
              right={<Link to={orgRoute(ctx.orgId, 'pace', props.query)} className="small">Pace ›</Link>}>
              <StackBar empty="No language has a target yet." parts={pace.map((g) => ({ key: g.band, label: PACE_LABEL[g.band], value: g.items.length, tone: PACE_TONE[g.band] }))} />
            </Card>
            <Card title="Where the work happened" sub={l.lines.length ? `${plural(l.languages, 'language')} got new chapters in ${monthName(month)}.` : `No new chapters in ${monthName(month)}.`}>
              {[...countries].sort((a, b) => b[1].reduce((n, x) => n + x.chapters, 0) - a[1].reduce((n, x) => n + x.chapters, 0)).map(([country, lines]) => (
                <section key={country || 'none'} aria-label={countryName(country || null)}>
                  <div className="group-head">
                    <span>{countryName(country || null)}</span>
                    <span className="muted small">{lines.length} language{lines.length === 1 ? '' : 's'} · <strong>{num(lines.reduce((n, x) => n + x.chapters, 0))}</strong> chapters</span>
                  </div>
                  <ul className="list">
                    {lines.map((line) => <LedgerLineRow key={line.row.laneId} row={line.row} chapters={line.chapters} books={line.books} max={l.lines[0]!.chapters} />)}
                  </ul>
                </section>
              ))}
            </Card>
            {idle.length ? (
              <Card title="No new chapters this month" sub="Languages with nothing counted in this month, and when they last sent audio.">
                <ul className="list">
                  {idle.map((r) => {
                    const { days } = recencyOf(r.report, ctx.now);
                    return (
                      <li key={r.laneId}>
                        <Link to={{ name: 'language', orgId: ctx.orgId, projectId: r.projectId, laneId: r.laneId }}>{r.report.name}</Link>
                        <span className="muted small">
                          {r.report.uploads.lastAt ? `Last upload ${shortDate(r.report.uploads.lastAt.slice(0, 10))}, ${days}d ago` : 'No uploads yet'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ) : null}
          </>
        );
      }}
    </OrgPage>
  );
}

function LedgerLineRow(props: { row: LaneRow; chapters: number; books: { label: string; chapters: number }[]; max: number }) {
  const ctx = useOrgCtx();
  const pace = paceOf(props.row.report, ctx.now);
  const top = [...props.books].sort((a, b) => b.chapters - a.chapters);
  const summary = top.slice(0, 3).map((b) => `${b.label} ${b.chapters}`).join(' · ') + (top.length > 3 ? ` +${top.length - 3}` : '');
  return (
    <li>
      <span className="grow">
        <Link to={{ name: 'language', orgId: ctx.orgId, projectId: props.row.projectId, laneId: props.row.laneId }}><strong>{props.row.report.name}</strong></Link>
        <div className="muted xs">{summary}</div>
        <div className="bar" style={{ marginTop: 4 }}><div className="bar-fill bar-brand" style={{ width: `${(100 * props.chapters) / Math.max(1, props.max)}%` }} /></div>
      </span>
      {pace ? <Badge tone={PACE_TONE[pace.band]}>{PACE_LABEL[pace.band]} {pace.gap >= 0 ? '+' : ''}{pace.gap} pts</Badge> : null}
      <span className="num" style={{ minWidth: 90, textAlign: 'right' }}><strong>{num(props.chapters)}</strong> <span className="muted xs">chapters</span></span>
      <span className="num muted small" style={{ minWidth: 60, textAlign: 'right' }}>{props.books.length} book{props.books.length === 1 ? '' : 's'}</span>
    </li>
  );
}
