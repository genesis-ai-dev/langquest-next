/** The dashboard's pages, parsed from and printed to the URL. */

export type Section = 'overview' | 'activity' | 'languages' | 'geography' | 'reports' | 'ledger' | 'pace' | 'alerts';
export const SECTIONS: readonly Section[] = ['overview', 'activity', 'languages', 'geography', 'reports', 'ledger', 'pace', 'alerts'];

export type Route =
  | { name: 'orgs' }
  | { name: 'org'; orgId: string; section: Section; query: Record<string, string> }
  | { name: 'language'; orgId: string; projectId: string; laneId: string }
  | { name: 'not_found' };

export function parseRoute(path: string, search = ''): Route {
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  const query = Object.fromEntries(new URLSearchParams(search));
  if (parts.length === 0) return { name: 'orgs' };
  if (parts[0] !== 'orgs' || !parts[1]) return { name: 'not_found' };
  if (parts.length === 2) return { name: 'org', orgId: parts[1], section: 'overview', query };
  if (parts.length === 3 && (SECTIONS as readonly string[]).includes(parts[2]!)) {
    return { name: 'org', orgId: parts[1], section: parts[2] as Section, query };
  }
  if (parts.length === 5 && parts[2] === 'languages' && parts[3] && parts[4]) {
    return { name: 'language', orgId: parts[1], projectId: parts[3], laneId: parts[4] };
  }
  return { name: 'not_found' };
}

export function hrefFor(route: Route): string {
  const e = encodeURIComponent;
  switch (route.name) {
    case 'orgs':
    case 'not_found':
      return '/';
    case 'org': {
      const base = route.section === 'overview' ? `/orgs/${e(route.orgId)}` : `/orgs/${e(route.orgId)}/${route.section}`;
      const q = new URLSearchParams(Object.entries(route.query).filter(([, v]) => v !== '')).toString();
      return q ? `${base}?${q}` : base;
    }
    case 'language':
      return `/orgs/${e(route.orgId)}/languages/${e(route.projectId)}/${e(route.laneId)}`;
  }
}

export const orgRoute = (orgId: string, section: Section = 'overview', query: Record<string, string> = {}): Route =>
  ({ name: 'org', orgId, section, query });
