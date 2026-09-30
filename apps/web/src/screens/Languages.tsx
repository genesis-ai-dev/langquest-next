import { portfolioOf, recencyOf, type Portfolio } from '@langquest-next/core';
import { useState } from 'react';
import { attentionCount, lanesCsv, portfolioCounts, sortLanes, timeAgo, watchList, weeklyCards, type LaneSortKey, type SortDir } from '../aggregate';
import { RECENCY_ADVICE, RECENCY_LABEL, RECENCY_TONE, RecencyStrip, shortDate, Sparkline } from '../charts';
import { countryName } from '../countries';
import { Link, navigate } from '../router';
import { orgRoute } from '../routes';
import type { LaneRow } from '../types';
import { Badge, Card, Chips, download, fileName, num } from '../ui';
import { CoverageMini, RecencyBadge, ShareCell } from './common';
import { OrgPage, useOrgCtx } from './shell';

/** Every language: who is uploading, who to contact, and a table to sort (Every Language "Languages"). */
export function Languages(props: { query: Record<string, string> }) {
  const ctx = useOrgCtx();
  const status = (props.query['status'] ?? 'all') as Portfolio | 'all';
  return (
    <OrgPage title="Languages" section="languages" query={props.query} filterCountry
      actions={(rows) => <button type="button" className="button" onClick={() => download(fileName(`${ctx.orgName} languages`), lanesCsv(rows, ctx.now))}>Download CSV</button>}>
      {(rows) => {
        const counts = portfolioCounts(rows, ctx.now);
        const watch = watchList(rows, ctx.now);
        const shown = status === 'all' ? rows : rows.filter((r) => portfolioOf(recencyOf(r.report, ctx.now).band) === status);
        return (
          <>
            <Card eyebrow="Upload activity" title={`${num(counts.active)} of ${num(rows.length)} languages uploaded in the last 14 days`}
              sub="Days since each language's last recording reached the server.">
              <RecencyStrip items={rows.map((r) => ({ name: r.report.name, ...recencyOf(r.report, ctx.now) }))} />
            </Card>
            <Card eyebrow="Watch list" title={watch.length ? `${watch.length} to contact` : 'Nobody to chase'}
              sub={watch.length ? 'Quiet for two to six weeks, the longest first. After 45 days a language reads as inactive.' : 'Every language with uploads sent one in the last two weeks, or has been inactive for longer than six.'}>
              {watch.length ? (
                <ul className="list">
                  {watch.map((w) => (
                    <li key={w.row.laneId}>
                      <span className="grow">
                        <Link to={{ name: 'language', orgId: ctx.orgId, projectId: w.row.projectId, laneId: w.row.laneId }}><strong>{w.row.report.name}</strong></Link>
                        <span className="muted small"> · {w.days} days since the last upload{w.row.report.country ? ` · ${countryName(w.row.report.country)}` : ''}</span>
                        <div className="small">{RECENCY_ADVICE[w.band]}</div>
                      </span>
                      <Badge tone={RECENCY_TONE[w.band]}>{RECENCY_LABEL[w.band]}</Badge>
                      <span className="muted xs">inactive in {w.untilInactive}d</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
            <Card title="All languages" right={
              <Chips label="Upload status" value={status} onChange={(v) => navigate(orgRoute(ctx.orgId, 'languages', { ...props.query, status: v === 'all' ? '' : v }), { replace: true })}
                options={[
                  { value: 'all', label: `All ${rows.length}` },
                  { value: 'active', label: `Active ${counts.active}` },
                  { value: 'quiet', label: `Quiet ${counts.quiet}` },
                  { value: 'inactive', label: `Inactive ${counts.inactive}` },
                  { value: 'not_started', label: `No uploads ${counts.not_started}` }
                ]} />
            }>
              <LanguageTable rows={shown} />
            </Card>
          </>
        );
      }}
    </OrgPage>
  );
}

const COLUMNS: { key: LaneSortKey | null; label: string; firstDir: SortDir; num?: boolean }[] = [
  { key: 'name', label: 'Language', firstDir: 'asc' },
  { key: 'upload', label: 'Upload status', firstDir: 'asc' },
  { key: 'coverage', label: 'Scripture recorded', firstDir: 'desc' },
  { key: 'recorded', label: 'Passages', firstDir: 'desc' },
  { key: 'cards', label: 'Recordings', firstDir: 'desc', num: true },
  { key: null, label: 'Last 8 weeks', firstDir: 'desc' },
  { key: 'attention', label: 'To act on', firstDir: 'desc' }
];

function LanguageTable(props: { rows: LaneRow[] }) {
  const ctx = useOrgCtx();
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: LaneSortKey; dir: SortDir }>({ key: 'name', dir: 'asc' });
  const q = search.trim().toLowerCase();
  const filtered = q ? props.rows.filter(({ report: r }) =>
    r.name.toLowerCase().includes(q) || r.languoidId.toLowerCase().includes(q) || countryName(r.country).toLowerCase().includes(q)) : props.rows;
  // "Upload status" sorts by most recent upload first when ascending.
  const rows = sort.key === 'upload' ? sortLanes(filtered, 'upload', sort.dir === 'asc' ? 'desc' : 'asc') : sortLanes(filtered, sort.key, sort.dir);
  return (
    <>
      <div className="filters no-print" style={{ marginBottom: 8 }}>
        <label style={{ flex: 1, minWidth: 220 }}>
          <span className="sr-only">Search languages</span>
          <input type="search" placeholder="Search language, code or country" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: '100%' }} />
        </label>
        <span className="muted small">{num(rows.length)} of {num(props.rows.length)} shown</span>
      </div>
      <div className="table-scroll">
        <table className="table">
          <thead>
            <tr>
              {COLUMNS.map((c) => {
                if (!c.key) return <th key={c.label} scope="col">{c.label}</th>;
                const active = sort.key === c.key;
                return (
                  <th key={c.label} scope="col" className={c.num ? 'num' : undefined} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                    <button type="button" onClick={() => setSort(active ? { key: c.key!, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key!, dir: c.firstDir })}>
                      {c.label}{active ? <span aria-hidden="true">{sort.dir === 'asc' ? ' ▲' : ' ▼'}</span> : null}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const r = row.report;
              const weeks = weeklyCards(r);
              const attention = attentionCount(r);
              return (
                <tr key={`${row.projectId}/${row.laneId}`}>
                  <td>
                    <Link to={{ name: 'language', orgId: ctx.orgId, projectId: row.projectId, laneId: row.laneId }}><strong>{r.name}</strong></Link>
                    <div className="muted xs">{r.languoidId.toUpperCase()} · {r.country ? countryName(r.country) : 'No country'}</div>
                  </td>
                  <td>
                    <RecencyBadge report={r} now={ctx.now} />
                    <div className="muted xs">{r.uploads.lastAt ? `${shortDate(r.uploads.lastAt.slice(0, 10))} · ${timeAgo(r.uploads.lastAt, ctx.now)}` : 'Never'}</div>
                  </td>
                  <td><CoverageMini coverage={r.coverage.recorded} name={r.name} /></td>
                  <td><ShareCell n={r.progress.recorded} total={r.progress.total} tone="brand" label={`${r.name} passages recorded`} /></td>
                  <td className="num"><strong>{num(r.uploads.cards)}</strong></td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Sparkline values={weeks} label={`${r.name} recordings per week`} />
                      <span className="num small"><strong>{num(weeks.at(-1) ?? 0)}</strong><span className="muted">/wk</span></span>
                    </div>
                  </td>
                  <td>{attention > 0 ? <Badge tone="amber">{attention}</Badge> : <span className="muted">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
