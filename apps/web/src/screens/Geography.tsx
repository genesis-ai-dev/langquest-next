import { lazy, Suspense } from 'react';
import { activityWindow, coverageAverage, countryCounts, plural, portfolioCounts } from '../aggregate';
import { countryName } from '../countries';
import { Link, navigate } from '../router';
import { orgRoute } from '../routes';
import type { LaneRow } from '../types';
import { Card, Chips, num, pctText } from '../ui';
import { OrgPage, useOrgCtx } from './shell';

const WorldMap = lazy(() => import('./WorldMap'));

type Measure = 'languages' | 'recent' | 'all';

/** Where the work is: languages per country, on a map and as a table. */
export function Geography(props: { query: Record<string, string> }) {
  const ctx = useOrgCtx();
  const measure = (props.query['show'] ?? 'languages') as Measure;
  return (
    <OrgPage title="Geography" section="geography" query={props.query}
      actions={() => (
        <Chips label="Shade the map by" value={measure} onChange={(v) => navigate(orgRoute(ctx.orgId, 'geography', { show: v === 'languages' ? '' : v }), { replace: true })}
          options={[{ value: 'languages', label: 'Languages' }, { value: 'recent', label: 'Recordings, last 7 days' }, { value: 'all', label: 'Recordings, all time' }]} />
      )}>
      {(rows) => {
        const groups = new Map<string, LaneRow[]>();
        for (const r of rows) {
          const k = r.report.country ?? '';
          groups.set(k, [...(groups.get(k) ?? []), r]);
        }
        const table = [...groups].map(([country, list]) => ({
          country: country || null,
          list,
          recent: activityWindow(list, 7, ctx.now).cards,
          all: list.reduce((n, r) => n + r.report.uploads.cards, 0),
          active: portfolioCounts(list, ctx.now).active,
          nt: coverageAverage(list, 'recorded').nt
        })).sort((a, b) => b.list.length - a.list.length || countryName(a.country).localeCompare(countryName(b.country)));
        const values = table.filter((t) => t.country).map((t) => ({
          country: t.country!, value: measure === 'languages' ? t.list.length : measure === 'recent' ? t.recent : t.all
        })).filter((v) => v.value > 0);
        const unset = groups.get('')?.length ?? 0;
        const max = Math.max(1, ...table.map((t) => t.list.length));
        return (
          <>
            <Card title={`${num(countryCounts(rows).filter((c) => c.country).length)} countries`}
              sub={unset ? `${plural(unset, 'language')} ${unset === 1 ? 'has' : 'have'} no country yet and ${unset === 1 ? 'is' : 'are'} left off the map; set it on each language's page.` : undefined}>
              {values.length === 0 ? <p className="muted">Nothing to shade yet.</p> : (
                <Suspense fallback={<p className="muted">Loading the map…</p>}>
                  <WorldMap values={values} unit={measure === 'languages' ? 'languages' : 'recordings'} />
                </Suspense>
              )}
            </Card>
            <Card title="By country">
              <div className="table-scroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Country</th><th scope="col">Languages</th><th scope="col" className="num">Active</th>
                      <th scope="col" className="num">Recordings, 7 days</th><th scope="col" className="num">Recordings, all time</th><th scope="col" className="num">New Testament recorded</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.map((t) => (
                      <tr key={t.country ?? 'none'}>
                        <td>
                          {t.country ? (
                            <Link to={orgRoute(ctx.orgId, 'languages', { country: t.country })}><strong>{countryName(t.country)}</strong></Link>
                          ) : <span className="muted">No country set</span>}
                          <div className="muted xs">{t.list.map((r) => r.report.name).join(', ')}</div>
                        </td>
                        <td>
                          <div className="cell-bar small">
                            <div className="bar"><div className="bar-fill bar-brand" style={{ width: `${(100 * t.list.length) / max}%` }} /></div>
                            <span className="figure"><strong>{num(t.list.length)}</strong></span>
                          </div>
                        </td>
                        <td className="num">{num(t.active)}</td>
                        <td className="num">{num(t.recent)}</td>
                        <td className="num">{num(t.all)}</td>
                        <td className="num">{pctText(t.nt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        );
      }}
    </OrgPage>
  );
}
