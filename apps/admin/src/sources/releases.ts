import { withDiag, type Query } from '../db';
import { getJson, ok, type Alert, type Section } from '../section';
import { expoSection } from './expo';

/**
 * Release health (docs/ops-dashboard-plan.md 5.7): one 14-day timeline of
 * merges, Worker deploys and EAS updates with the errors phones reported
 * under it, so "it started after the deploy" shows at a glance; the commit
 * each host serves; and the hosted database's migrations against `main`
 * (the check the watchdog ran by hand, `npm run db:check`). Commit titles,
 * never authors.
 */

export interface TimelineEvent { at: string; kind: 'merge' | 'deploy' | 'update'; text: string }
export interface Releases {
  timeline: TimelineEvent[];
  errorsByDay: { day: string; errors: number; crashes: number; installs: number }[];
  hosts: { url: string; build: string | null; error?: string }[];
  migrations: { applied: string | null; main: string | null; behind: number | null; error?: string };
  notes: string[];
}

type Env = {
  DIAG_DATABASE_URL: string; GITHUB_REPO: string; ADMIN_GITHUB_TOKEN?: string; APP_URL: string; PREVIEW_URL: string;
  ADMIN_CLOUDFLARE_TOKEN?: string; CLOUDFLARE_ACCOUNT_ID: string; CLOUDFLARE_WORKERS: string; ADMIN_EXPO_TOKEN?: string; EXPO_PROJECT_ID: string;
};

export const ERRORS_BY_DAY_SQL = `select coalesce(jsonb_agg(to_jsonb(x) order by x.day), '[]'::jsonb) as v from (
  select to_char(date_trunc('day', received_at), 'YYYY-MM-DD') as day, count(*) as errors,
         count(*) filter (where t->>'fatal' = 'yes') as crashes, count(distinct install_id) as installs
  from diag.records where kind = 'error' and received_at > now() - interval '14 days' group by 1) x`;

/**
 * A change landing on main: a pull request's merge, or a squash that names
 * its pull request. Merges of main into a branch, which reach main with
 * that branch, are not.
 */
export function isMerge(title: string, parents: number): boolean {
  if (/^Merge (remote-tracking branch|branch|origin\/)/.test(title)) return false;
  return /^Merge pull request #\d+/.test(title) || /\(#\d+\)$/.test(title) || (parents > 1 && !/^Merge /.test(title));
}

/** Migration files on main newer than the newest the database has applied. */
export function migrationsBehind(applied: string | null, files: string[]): { main: string | null; behind: number } {
  const versions = files.map((f) => /^(\d{14})_.*\.sql$/.exec(f)?.[1]).filter((v): v is string => !!v).sort();
  return { main: versions.at(-1) ?? null, behind: versions.filter((v) => !applied || v > applied).length };
}

export function releaseAlerts(r: Releases): Alert[] {
  const out: Alert[] = [];
  if (r.migrations.behind && r.migrations.behind > 0) {
    out.push({ level: 'problem', text: `The hosted database is ${r.migrations.behind} migration${r.migrations.behind === 1 ? '' : 's'} behind main (newest applied ${r.migrations.applied ?? 'none'}, main has ${r.migrations.main}): run npm run db:apply.` });
  }
  const days = r.errorsByDay;
  const today = days.at(-1);
  const before = days.slice(-8, -1);
  const mean = before.length ? before.reduce((s, d) => s + d.crashes, 0) / before.length : 0;
  if (today && today.crashes >= 10 && today.crashes > 3 * Math.max(mean, 1)) {
    out.push({ level: 'problem', text: `Crashes jumped to ${today.crashes} on ${today.day}, against ${mean.toFixed(1)} a day the week before. Check the timeline for what shipped.` });
  }
  return out;
}

export async function releasesSection(env: Env, fetcher: typeof fetch = fetch, now = Date.now(), diag: <T>(fn: (q: Query) => Promise<T>) => Promise<T> = (fn) => withDiag(env.DIAG_DATABASE_URL, fn)): Promise<Section<Releases>> {
  const notes: string[] = [];
  const note = (e: unknown) => { notes.push(e instanceof Error ? e.message : String(e)); };
  const since = new Date(now - 14 * 86_400_000).toISOString();
  const gh = {
    accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'langquest-next-admin',
    ...(env.ADMIN_GITHUB_TOKEN ? { authorization: `Bearer ${env.ADMIN_GITHUB_TOKEN}` } : {})
  };
  const api = `https://api.github.com/repos/${env.GITHUB_REPO}`;

  const merges = getJson<{ sha: string; commit: { message: string; committer?: { date?: string } | null }; parents: unknown[] }[]>(fetcher,
    `${api}/commits?sha=main&since=${since}&per_page=100`, { headers: gh }, 'GitHub commits')
    .then((cs) => cs.filter((c) => isMerge(c.commit.message.split('\n')[0]!, c.parents.length))
      .map((c): TimelineEvent => ({ at: c.commit.committer?.date ?? since, kind: 'merge', text: `${c.sha.slice(0, 7)} ${c.commit.message.split('\n')[0]!.slice(0, 100)}` })))
    .catch((e: unknown) => { note(e); return [] as TimelineEvent[]; });
  const deploys = env.ADMIN_CLOUDFLARE_TOKEN
    ? Promise.all(env.CLOUDFLARE_WORKERS.split(',').map((s) => s.trim()).filter(Boolean).map((name) =>
      getJson<{ result?: { deployments?: { created_on: string }[] } }>(fetcher,
        `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${encodeURIComponent(name)}/deployments`,
        { headers: { authorization: `Bearer ${env.ADMIN_CLOUDFLARE_TOKEN}` } }, `${name} deployments`)
        .then((d) => (d.result?.deployments ?? []).filter((x) => x.created_on >= since).map((x): TimelineEvent => ({ at: x.created_on, kind: 'deploy', text: `${name} deployed` })))))
      .then((all) => all.flat()).catch((e: unknown) => { note(e); return [] as TimelineEvent[]; })
    : Promise.resolve([] as TimelineEvent[]);
  const updates = expoSection(env, fetcher)
    .then((s) => s.state === 'ok' && s.data ? s.data.updates.filter((u) => u.at >= since).map((u): TimelineEvent => ({ at: u.at, kind: 'update', text: `EAS update on ${u.branch}${u.runtime ? ` (runtime ${u.runtime})` : ''}` })) : [])
    .catch((e: unknown) => { note(e); return [] as TimelineEvent[]; });
  const host = (url: string) => fetcher(`${url.replace(/\/+$/, '')}/version.json`, { signal: AbortSignal.timeout(8000) })
    .then(async (r) => (r.ok ? { url, build: String(((await r.json()) as { build?: unknown }).build ?? '') || null } : { url, build: null, error: `HTTP ${r.status}` }))
    .catch((e: unknown) => ({ url, build: null, error: e instanceof Error ? e.name : 'no answer' }));
  const files = getJson<{ name: string }[]>(fetcher, `${api}/contents/supabase/migrations?ref=main`, { headers: gh }, 'GitHub migrations')
    .then((list) => list.map((f) => f.name));
  const fromDiag = diag(async (q) => {
    const [errors, applied] = await Promise.all([
      q<Releases['errorsByDay']>(ERRORS_BY_DAY_SQL),
      q<{ count: number; latest: string | null }>(`select diag.migrations_applied() as v`).catch(() => null)
    ]);
    return { errors, applied };
  });

  const [m, d, u, prod, preview, d2, fileNames] = await Promise.all([merges, deploys, updates, host(env.APP_URL), host(env.PREVIEW_URL), fromDiag, files.catch((e: unknown) => { note(e); return null; })]);
  const migrations: Releases['migrations'] = d2.applied && fileNames
    ? { applied: d2.applied.latest, ...migrationsBehind(d2.applied.latest, fileNames) }
    : { applied: d2.applied?.latest ?? null, main: null, behind: null, error: d2.applied ? 'Could not list migrations on main.' : 'Needs migration 20261023100000_ops_dashboard.sql on this database.' };
  const r: Releases = {
    timeline: [...m, ...d, ...u].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)),
    errorsByDay: d2.errors, hosts: [prod, preview], migrations, notes
  };
  return ok(r, releaseAlerts(r));
}
