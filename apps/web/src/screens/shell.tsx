import { createContext, useContext, type ReactNode } from 'react';
import { alertsFor } from '../aggregate';
import { signOut } from '../auth';
import { countryName } from '../countries';
import { fetchOrgReports, useLoad, type Loaded, type OrgReports } from '../data';
import { Link, navigate } from '../router';
import { orgRoute, type Section } from '../routes';
import { setTheme, useTheme } from '../theme';
import type { LaneRow, Organization } from '../types';
import { Badge, LoadFailed, Loading, Page } from '../ui';
import { NoReports } from './common';

export interface OrgCtx {
  orgId: string;
  orgName: string;
  actorId: string;
  email: string;
  reports: Loaded<OrgReports> & { reload: () => void };
  now: number;
}

const OrgContext = createContext<OrgCtx | null>(null);

export function useOrgCtx(): OrgCtx {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error('useOrgCtx outside OrgShell');
  return ctx;
}

const NAV: { section: Section; label: string }[] = [
  { section: 'overview', label: 'Overview' },
  { section: 'activity', label: 'Recent activity' },
  { section: 'languages', label: 'Languages' },
  { section: 'geography', label: 'Geography' },
  { section: 'reports', label: 'Field report' },
  { section: 'ledger', label: 'Monthly ledger' },
  { section: 'pace', label: 'Pace' },
  { section: 'alerts', label: 'Alerts' }
];

/** One organization's pages: the sidebar, and its reports loaded once for every page. */
export function OrgShell(props: { orgId: string; active: Section | null; actorId: string; email: string; orgs: Loaded<Organization[]>; children: ReactNode }) {
  const { orgId } = props;
  const reports = useLoad(() => fetchOrgReports(orgId), orgId);
  const orgName = props.orgs.status === 'ready' ? props.orgs.data.find((o) => o.orgId === orgId)?.name ?? orgId : '';
  const now = Date.now();
  const ctx: OrgCtx = { orgId, orgName, actorId: props.actorId, email: props.email, reports, now };
  const open = reports.status === 'ready'
    ? alertsFor(reports.data.rows, reports.data.pending, now).filter((a) => a.level !== 'fyi').length : 0;
  const theme = useTheme();
  return (
    <div className="shell">
      <aside className="sidebar" aria-label="Dashboard">
        <Link to={orgRoute(orgId)} className="brand">
          LangQuest
          <span className="org">{orgName || 'Organization'}</span>
        </Link>
        <nav className="nav" aria-label="Sections">
          {NAV.map((n) => (
            <Link key={n.section} to={orgRoute(orgId, n.section)} aria-current={props.active === n.section ? 'page' : undefined}>
              {n.label}
              {n.section === 'alerts' && open > 0 ? <span className="count"><Badge tone="amber">{open}</Badge></span> : null}
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <Link to={{ name: 'orgs' }} className="small">All organizations</Link>
          <button type="button" className="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-pressed={theme === 'dark'}>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <span className="who">{props.email}</span>
          <button type="button" className="button button-ghost" onClick={() => void signOut()}>Sign out</button>
        </div>
      </aside>
      <OrgContext.Provider value={ctx}>{props.children}</OrgContext.Provider>
    </div>
  );
}

/**
 * The page frame every section uses: loading, failure and "no reports"
 * handled once, then `children` with the rows (all, and after the country
 * filter when the page has one).
 */
export function OrgPage(props: {
  title: string; eyebrow?: string; section: Section; query: Record<string, string>; filterCountry?: boolean;
  actions?: (rows: LaneRow[]) => ReactNode; children: (rows: LaneRow[], all: LaneRow[]) => ReactNode;
}) {
  const ctx = useOrgCtx();
  const { reports } = ctx;
  const all = reports.status === 'ready' ? reports.data.rows : [];
  const country = props.filterCountry ? props.query['country'] ?? '' : '';
  const rows = country ? all.filter((r) => (r.report.country ?? '') === country) : all;
  const countries = [...new Set(all.map((r) => r.report.country ?? ''))].sort((a, b) => countryName(a || null).localeCompare(countryName(b || null)));
  return (
    <Page title={props.title} eyebrow={props.eyebrow ?? ctx.orgName}
      actions={all.length ? (
        <>
          {props.filterCountry && countries.length > 1 ? (
            <label>
              <span className="sr-only">Country</span>
              <select value={country} onChange={(e) => navigate(orgRoute(ctx.orgId, props.section, { ...props.query, country: e.target.value }), { replace: true })}>
                <option value="">All countries</option>
                {countries.map((c) => <option key={c || 'none'} value={c}>{countryName(c || null)}</option>)}
              </select>
            </label>
          ) : null}
          {props.actions?.(rows)}
        </>
      ) : undefined}>
      {reports.status === 'loading' ? <Loading what="reports" /> : null}
      {reports.status === 'error' ? <LoadFailed error={reports.error} retry={reports.reload} /> : null}
      {reports.status === 'ready' && all.length === 0 ? <NoReports reports={reports.data} what="languages" /> : null}
      {all.length ? props.children(rows, all) : null}
    </Page>
  );
}
