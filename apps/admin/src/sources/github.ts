import { getJson, hoursAgo, ok, type Alert, type Section } from '../section';

/**
 * The code and what runs it: which commit the web app serves (its
 * /version.json) against `main` on GitHub, and the latest run of each
 * GitHub Actions workflow on `main`. Merging to `main` deploys, so a web app
 * left behind `main` is a deploy that failed (every Workers Build failed
 * from 2026-10-16 to 10-19; docs/cloudflare.md).
 * No logins or emails are kept from GitHub's answers.
 */

interface Commit { sha: string; commit: { message: string; committer: { date: string } | null } }
interface Compare { status: string; ahead_by: number; behind_by: number }
interface Runs { workflow_runs: { name: string | null; status: string | null; conclusion: string | null; head_sha: string; created_at: string; html_url: string; event: string; run_number: number }[] }

export interface Run { workflow: string; status: string; conclusion: string | null; sha: string; at: string; url: string; event: string; number: number }

export interface Code {
  repo: string;
  main: { sha: string; at: string | null; title: string };
  live: { url: string; build: string | null; error?: string };
  /** Commits on main the web app does not have yet; null when unknown. */
  behind: number | null;
  runs: Run[];
}

/** How long a merge may take to reach the web app before it counts as stuck: the export alone takes a few minutes. */
export const DEPLOY_GRACE_H = 0.75;

export function codeAlerts(code: Code, now = Date.now()): Alert[] {
  const out: Alert[] = [];
  const host = new URL(code.live.url).host;
  if (code.live.build === null) {
    out.push({ level: 'problem', text: `${host}/version.json did not answer${code.live.error ? ` (${code.live.error})` : ''}.` });
  } else if (!code.main.sha.startsWith(code.live.build) && code.behind !== 0) {
    const age = hoursAgo(code.main.at, now);
    if (age === null || age > DEPLOY_GRACE_H) {
      const count = code.behind === null ? 'newer commits' : `${code.behind} newer commit${code.behind === 1 ? '' : 's'}`;
      out.push({ level: 'problem', text: `${host} still serves ${code.live.build.slice(0, 8)}, but main has ${count} (latest ${age === null ? 'at an unknown time' : `${Math.round(age)} h ago`}). The deploy on merge may be failing: check Workers Builds.` });
    }
  }
  for (const r of code.runs) {
    if (r.conclusion === 'failure' || r.conclusion === 'timed_out' || r.conclusion === 'startup_failure') {
      out.push({ level: 'watch', text: `GitHub workflow "${r.workflow}" failed on main (run ${r.number}, ${r.event}).` });
    }
  }
  return out;
}

/** The latest run of each workflow, newest first. Dependabot's and CodeQL's own runs (`dynamic`) are left out: they are not ours. */
export function latestPerWorkflow(runs: Runs['workflow_runs']): Run[] {
  const seen = new Set<string>();
  const out: Run[] = [];
  for (const r of runs) {
    if (r.event === 'dynamic') continue;
    const name = r.name ?? 'workflow';
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ workflow: name, status: r.status ?? 'unknown', conclusion: r.conclusion, sha: r.head_sha.slice(0, 8), at: r.created_at, url: r.html_url, event: r.event, number: r.run_number });
  }
  return out;
}

export async function codeSection(env: { GITHUB_REPO: string; ADMIN_GITHUB_TOKEN?: string; APP_URL: string }, fetcher: typeof fetch = fetch): Promise<Section<Code>> {
  const headers: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'langquest-next-admin',
    ...(env.ADMIN_GITHUB_TOKEN ? { authorization: `Bearer ${env.ADMIN_GITHUB_TOKEN}` } : {})
  };
  const api = `https://api.github.com/repos/${env.GITHUB_REPO}`;
  const anonymous = env.ADMIN_GITHUB_TOKEN ? '' : ' Without ADMIN_GITHUB_TOKEN, GitHub limits anonymous calls per address, which a Worker shares.';
  const gh = <T>(path: string, what: string) => getJson<T>(fetcher, `${api}${path}`, { headers }, what)
    .catch((e: Error) => { throw new Error(`${e.message}${anonymous}`); });

  const liveUrl = `${env.APP_URL.replace(/\/+$/, '')}/version.json`;
  const live = fetcher(liveUrl, { signal: AbortSignal.timeout(8000) })
    .then(async (r) => (r.ok ? { build: String(((await r.json()) as { build?: unknown }).build ?? '') || null } : { build: null, error: `HTTP ${r.status}` }))
    .catch((e: unknown) => ({ build: null, error: e instanceof Error ? e.name : 'no answer' }));
  const [head, runs, liveBuild] = await Promise.all([
    gh<Commit>('/commits/main', 'GitHub main'),
    gh<Runs>('/actions/runs?branch=main&per_page=40', 'GitHub Actions'),
    live
  ]);
  let behind: number | null = null;
  if (liveBuild.build && head.sha.startsWith(liveBuild.build)) behind = 0;
  else if (liveBuild.build) {
    behind = await gh<Compare>(`/compare/${liveBuild.build}...${head.sha}`, 'GitHub compare')
      .then((c) => c.ahead_by)
      .catch(() => null);
  }
  const code: Code = {
    repo: env.GITHUB_REPO,
    main: { sha: head.sha, at: head.commit.committer?.date ?? null, title: head.commit.message.split('\n')[0]!.slice(0, 140) },
    live: { url: env.APP_URL, ...liveBuild },
    behind,
    runs: latestPerWorkflow(runs.workflow_runs)
  };
  return ok(code, codeAlerts(code));
}
