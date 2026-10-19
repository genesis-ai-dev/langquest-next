import { getJson, ok, off, type Alert, type Section } from '../section';

/**
 * The FrontierRND team's Vercel projects (the LangQuest website, the v2 web
 * app, the dev docs, the partner demo): each one's latest production
 * deploy and its last failed one. Creators are left out.
 */

interface Deployment { uid: string; state?: string; readyState?: string; createdAt?: number; created?: number; target?: string | null }

export interface VercelProject {
  name: string;
  latest: { state: string; at: string } | null;
  lastError: { at: string } | null;
}

export interface Vercel { projects: VercelProject[] }

const at = (d: Deployment) => new Date(d.createdAt ?? d.created ?? 0).toISOString();
const stateOf = (d: Deployment) => d.readyState ?? d.state ?? 'UNKNOWN';

export function summarizeProject(name: string, deployments: Deployment[]): VercelProject {
  const sorted = [...deployments].sort((a, b) => (b.createdAt ?? b.created ?? 0) - (a.createdAt ?? a.created ?? 0));
  const latest = sorted[0];
  const failed = sorted.find((d) => stateOf(d) === 'ERROR');
  return { name, latest: latest ? { state: stateOf(latest), at: at(latest) } : null, lastError: failed ? { at: at(failed) } : null };
}

export function vercelAlerts(v: Vercel): Alert[] {
  return v.projects
    .filter((p) => p.latest?.state === 'ERROR')
    .map((p) => ({ level: 'problem' as const, text: `Vercel: the latest production deploy of ${p.name} failed.` }));
}

export async function vercelSection(env: { ADMIN_VERCEL_TOKEN?: string; VERCEL_TEAM_ID: string }, fetcher: typeof fetch = fetch): Promise<Section<Vercel>> {
  if (!env.ADMIN_VERCEL_TOKEN) {
    return off('Add ADMIN_VERCEL_TOKEN: a token scoped to the FrontierRND team, with an expiry (docs/admin.md).') as Section<Vercel>;
  }
  const headers = { authorization: `Bearer ${env.ADMIN_VERCEL_TOKEN}` };
  const team = `teamId=${encodeURIComponent(env.VERCEL_TEAM_ID)}`;
  const { projects } = await getJson<{ projects: { id: string; name: string }[] }>(fetcher, `https://api.vercel.com/v9/projects?${team}&limit=20`, { headers }, 'Vercel projects');
  const rows = await Promise.all(projects.map((p) =>
    getJson<{ deployments: Deployment[] }>(fetcher, `https://api.vercel.com/v7/deployments?${team}&projectId=${encodeURIComponent(p.id)}&target=production&limit=10`, { headers }, `Vercel ${p.name}`)
      .then((d) => summarizeProject(p.name, d.deployments))));
  const v = { projects: rows.sort((a, b) => a.name.localeCompare(b.name)) };
  return ok(v, vercelAlerts(v));
}
