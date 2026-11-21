import { ok, type Section } from '../section';
import { githubApi, type GitHubEnv } from './githubApi';

/**
 * How much of this week's Frontier Claude plan is used, for the small
 * monitor on the Overview
 * (docs/decisions/2026-11-21-the-overview-shows-the-frontier-claude-plan.md).
 * claude-plan.yml reads it every hour with the agent team's token
 * (scripts/claude-plan.mjs) and leaves it as an annotation titled
 * "Claude plan" on its run; this reads the latest run's. The Worker holds no
 * Claude token. A reading that could not be made says why; nothing is ever
 * shown as zero.
 */
export const PLAN_WORKFLOW = 'claude-plan.yml';
export const PLAN_JOB = 'read';
const TITLE = 'Claude plan';

export interface PlanWindow { used: number; resetsAt: string }
export interface PlanReading { week: PlanWindow | null; fiveHour: PlanWindow | null; readAt: string | null; said: string | null }
export interface ClaudePlan extends PlanReading {
  repo: string;
  run: { url: string; at: string; conclusion: string | null } | null;
}

interface Runs { workflow_runs: { id: number; created_at: string; html_url: string; conclusion: string | null }[] }
interface Jobs { jobs: { id: number; name: string }[] }
interface Annotation { title: string | null; message: string }

const windowOf = (w: unknown): PlanWindow | null => {
  const x = w as { used?: unknown; resetsAt?: unknown } | null;
  return x && typeof x.used === 'number' && Number.isFinite(x.used) && typeof x.resetsAt === 'string' && !Number.isNaN(Date.parse(x.resetsAt))
    ? { used: x.used, resetsAt: x.resetsAt } : null;
};

/** One annotation as scripts/claude-plan.mjs `annotation` writes it, or null when it is not one. */
export function parsePlan(title: string | null, message: string): PlanReading | null {
  if (title !== TITLE) return null;
  const none = /^No reading:\s*(.*)$/s.exec(message.trim());
  if (none) return { week: null, fiveHour: null, readAt: null, said: none[1]!.trim() || 'no reading' };
  try {
    const r = JSON.parse(message) as { week?: unknown; fiveHour?: unknown; readAt?: unknown };
    return { week: windowOf(r.week), fiveHour: windowOf(r.fiveHour), readAt: typeof r.readAt === 'string' ? r.readAt : null, said: null };
  } catch {
    return null;
  }
}

const NONE: PlanReading = { week: null, fiveHour: null, readAt: null, said: null };

export async function claudePlanSection(env: GitHubEnv, fetcher: typeof fetch = fetch): Promise<Section<ClaudePlan>> {
  const gh = githubApi(env, fetcher);
  let latest: Runs['workflow_runs'][number] | undefined;
  try {
    latest = (await gh<Runs>(`/actions/workflows/${PLAN_WORKFLOW}/runs?branch=main&status=completed&per_page=1`, 'GitHub plan runs')).workflow_runs[0];
  } catch (e) {
    // Before the workflow is on main, GitHub does not know it.
    if (!/HTTP 404/.test((e as Error).message)) throw e;
  }
  if (!latest) return ok({ repo: env.GITHUB_REPO, run: null, ...NONE, said: 'The plan has not been read yet.' });
  const run = { url: latest.html_url, at: latest.created_at, conclusion: latest.conclusion };
  const job = (await gh<Jobs>(`/actions/runs/${latest.id}/jobs?filter=latest&per_page=20`, 'GitHub jobs')).jobs.find((j) => j.name === PLAN_JOB);
  const reading = job
    ? (await gh<Annotation[]>(`/check-runs/${job.id}/annotations`, 'GitHub annotations')).map((a) => parsePlan(a.title, a.message)).find((r) => r !== null) ?? null
    : null;
  return ok({ repo: env.GITHUB_REPO, run, ...(reading ?? { ...NONE, said: `The latest run left no reading (it ended ${latest.conclusion ?? 'without a result'}).` }) });
}
