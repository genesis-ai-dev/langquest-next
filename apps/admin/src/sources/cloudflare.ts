import { list } from '../env';
import { getJson, ok, off, type Alert, type Section } from '../section';

/**
 * The Workers: requests and errors over the last day (GraphQL Analytics),
 * the latest deploy of each, and the latest Workers Build, which is how
 * merging to `main` deploys (docs/cloudflare.md). Deploy and build authors
 * are left out.
 */

export interface WorkerStats {
  name: string;
  requests: number;
  errors: number;
  errorRate: number | null;
  /** Microseconds, the dataset's unit; the highest p99 of its status groups. */
  cpuP99: number | null;
  statuses: Record<string, number>;
  lastDeploy: { at: string; source: string | null } | null;
  lastBuild: { at: string; status: string | null; outcome: string | null; branch: string | null; commit: string | null } | null;
}

export interface Cloudflare { workers: WorkerStats[]; notes: string[] }

interface Invocation { sum: { requests: number; errors: number }; quantiles: { cpuTimeP99: number | null } | null; dimensions: { scriptName: string; status: string } }
interface GraphQl { data?: { viewer?: { accounts?: { workersInvocationsAdaptive?: Invocation[] }[] } }; errors?: { message: string }[] | null }
interface Deployments { result?: { deployments?: { created_on: string; source?: string | null }[] } }
interface Scripts { result?: { id: string; tag: string }[] }
interface Build {
  created_on: string; status?: string | null; build_outcome?: string | null;
  build_trigger_metadata?: { branch?: string | null; commit_hash?: string | null } | null;
  trigger?: { external_script_id?: string | null } | null;
}
interface LatestBuilds { result?: { builds?: Record<string, Build> | Build[] } }

export const INVOCATIONS_QUERY = `query ($account: string!, $since: string!, $until: string!) {
  viewer { accounts(filter: { accountTag: $account }) {
    workersInvocationsAdaptive(limit: 10000, filter: { datetime_geq: $since, datetime_leq: $until }) {
      sum { requests errors }
      quantiles { cpuTimeP99 }
      dimensions { scriptName status }
    }
  } }
}`;

/** Sums the invocation groups by Worker, for the Workers asked about. */
export function byWorker(groups: Invocation[], names: string[]): Map<string, Pick<WorkerStats, 'requests' | 'errors' | 'cpuP99' | 'statuses'>> {
  const out = new Map(names.map((n) => [n, { requests: 0, errors: 0, cpuP99: null as number | null, statuses: {} as Record<string, number> }]));
  for (const g of groups) {
    const w = out.get(g.dimensions.scriptName);
    if (!w) continue;
    w.requests += g.sum.requests;
    w.errors += g.sum.errors;
    w.statuses[g.dimensions.status] = (w.statuses[g.dimensions.status] ?? 0) + g.sum.requests;
    const p99 = g.quantiles?.cpuTimeP99 ?? null;
    if (p99 !== null && (w.cpuP99 === null || p99 > w.cpuP99)) w.cpuP99 = p99;
  }
  return out;
}

export function cloudflareAlerts(cf: Cloudflare): Alert[] {
  const out: Alert[] = [];
  for (const w of cf.workers) {
    if (w.lastBuild?.outcome === 'fail') {
      out.push({ level: 'problem', text: `The latest Workers Build of ${w.name} failed${w.lastBuild.commit ? ` (commit ${w.lastBuild.commit.slice(0, 8)})` : ''}, so main is not deployed there.` });
    }
    if (w.requests >= 100 && w.errorRate !== null && w.errorRate >= 0.01) {
      out.push({ level: w.errorRate >= 0.05 ? 'problem' : 'watch', text: `${w.name}: ${(w.errorRate * 100).toFixed(1)}% of ${w.requests.toLocaleString('en')} requests failed in the last day (${Object.entries(w.statuses).filter(([s]) => s !== 'success' && s !== 'clientDisconnected').map(([s, n]) => `${s} ${n}`).join(', ')}).` });
    }
  }
  return out;
}

export async function cloudflareSection(env: { ADMIN_CLOUDFLARE_TOKEN?: string; CLOUDFLARE_ACCOUNT_ID: string; CLOUDFLARE_WORKERS: string }, fetcher: typeof fetch = fetch, now = Date.now()): Promise<Section<Cloudflare>> {
  if (!env.ADMIN_CLOUDFLARE_TOKEN) {
    return off('Add ADMIN_CLOUDFLARE_TOKEN: a user API token with Account Analytics Read, Workers Scripts Read and Workers CI Read on this account (docs/admin.md).') as Section<Cloudflare>;
  }
  const headers = { authorization: `Bearer ${env.ADMIN_CLOUDFLARE_TOKEN}`, 'content-type': 'application/json' };
  const api = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}`;
  const names = list(env.CLOUDFLARE_WORKERS);
  const notes: string[] = [];

  const graphql = await getJson<GraphQl>(fetcher, 'https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST', headers,
    body: JSON.stringify({ query: INVOCATIONS_QUERY, variables: { account: env.CLOUDFLARE_ACCOUNT_ID, since: new Date(now - 86_400_000).toISOString(), until: new Date(now).toISOString() } })
  }, 'Cloudflare analytics');
  if (graphql.errors?.length) throw new Error(`Cloudflare analytics: ${graphql.errors[0]!.message}`);
  const stats = byWorker(graphql.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive ?? [], names);

  const deploys = await Promise.all(names.map((name) =>
    getJson<Deployments>(fetcher, `${api}/workers/scripts/${encodeURIComponent(name)}/deployments`, { headers }, `${name} deployments`)
      .then((d) => {
        const latest = [...(d.result?.deployments ?? [])].sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
        return latest ? { at: latest.created_on, source: latest.source ?? null } : null;
      })
      .catch((e: Error) => { notes.push(e.message); return null; })));

  // Builds are matched by each script's tag; the Builds API takes only a user's token, not an account's.
  const builds = new Map<string, WorkerStats['lastBuild']>();
  try {
    const scripts = await getJson<Scripts>(fetcher, `${api}/workers/scripts`, { headers }, 'Worker list');
    const tags = new Map((scripts.result ?? []).filter((s) => names.includes(s.id)).map((s) => [s.tag, s.id]));
    if (tags.size) {
      const latest = await getJson<LatestBuilds>(fetcher, `${api}/builds/builds/latest?external_script_ids=${[...tags.keys()].join(',')}`, { headers }, 'Workers Builds');
      const all = latest.result?.builds ?? {};
      for (const [key, b] of Array.isArray(all) ? all.map((b) => [b.trigger?.external_script_id ?? '', b] as const) : Object.entries(all)) {
        const name = tags.get(b.trigger?.external_script_id ?? key);
        if (name) builds.set(name, { at: b.created_on, status: b.status ?? null, outcome: b.build_outcome ?? null, branch: b.build_trigger_metadata?.branch ?? null, commit: b.build_trigger_metadata?.commit_hash ?? null });
      }
    }
  } catch (e) {
    notes.push(`${e instanceof Error ? e.message : String(e)}. Builds need a user API token with Workers CI Read.`);
  }

  const workers: WorkerStats[] = names.map((name, i) => {
    const s = stats.get(name)!;
    return { name, ...s, errorRate: s.requests ? s.errors / s.requests : null, lastDeploy: deploys[i] ?? null, lastBuild: builds.get(name) ?? null };
  });
  const cf = { workers, notes };
  return ok(cf, cloudflareAlerts(cf));
}
