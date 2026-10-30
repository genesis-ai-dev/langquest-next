import { ok, type Section } from '../section';
import { githubApi, OWN_EVENTS, type GitHubEnv } from './github';

/**
 * The tutorial videos' filming (docs/tutorial-videos.md, decisions.md 183):
 * the run of .github/workflows/tutorials.yml on main that is filming now, or
 * the latest one, and where each app language's job is: waiting its turn
 * (five film at once), on which step, done or failed, with its log. A run
 * starts at 20:10 UTC and when a merge changes the videos; its failures are
 * already said under Code and deploys, so this part raises no alerts.
 */

export const FILMING_WORKFLOW = 'tutorials.yml';

interface WorkflowRuns { workflow_runs: { id: number; status: string | null; conclusion: string | null; head_sha: string; created_at: string; html_url: string; event: string; run_number: number }[] }
interface Step { name: string; status: string; conclusion: string | null; started_at?: string | null }
interface RunJobs { jobs: { name: string; status: string; conclusion: string | null; started_at: string | null; completed_at: string | null; html_url: string | null; steps?: Step[] }[] }

export type FilmState = 'waiting' | 'running' | 'done' | 'failed' | 'cancelled' | 'skipped';

export interface FilmJob {
  /** The job's name on GitHub: `film (fr)`, `grace`, `languages`. */
  job: string;
  /** The app language a `film (<language>)` job films; null for the jobs before them. */
  language: string | null;
  state: FilmState;
  /** The step running now, and since when; null unless running. */
  step: string | null;
  stepAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  url: string | null;
}

export interface Filming {
  run: { number: number; event: string; status: string; conclusion: string | null; sha: string; at: string; url: string } | null;
  /** Runs started after it that wait for it to finish (the workflow films one run at a time). */
  queued: number;
  jobs: FilmJob[];
}

const WAITING = new Set(['queued', 'waiting', 'pending', 'requested']);
/** A run held back by the workflow's concurrency until the one before it finishes. A run filming says `queued` while some of its languages wait. */
const HELD = new Set(['pending', 'waiting', 'requested']);
/** What needs looking at first: a failed language, then those filming, those waiting, and those done. */
const ORDER: FilmState[] = ['failed', 'running', 'waiting', 'done', 'cancelled', 'skipped'];

function stateOf(status: string, conclusion: string | null): FilmState {
  if (status !== 'completed') return WAITING.has(status) ? 'waiting' : 'running';
  if (conclusion === 'success' || conclusion === 'neutral') return 'done';
  if (conclusion === 'cancelled' || conclusion === 'skipped') return conclusion;
  return 'failed';
}

/** Each job of a run: the jobs before the languages first, then the languages, failed first and done last. */
export function filmJobs(jobs: RunJobs['jobs']): FilmJob[] {
  return jobs.map((j) => {
    const state = stateOf(j.status, j.conclusion);
    const step = state === 'running' ? (j.steps ?? []).find((s) => s.status === 'in_progress') ?? null : null;
    return {
      job: j.name, language: /^film \(([^)]+)\)$/.exec(j.name)?.[1] ?? null, state,
      step: step?.name ?? null, stepAt: step?.started_at ?? null,
      startedAt: state === 'waiting' ? null : j.started_at, finishedAt: j.completed_at, url: j.html_url
    };
  }).sort((a, b) => Number(a.language !== null) - Number(b.language !== null) || ORDER.indexOf(a.state) - ORDER.indexOf(b.state));
}

/** The newest run not held back behind another (the one filming now, or the latest), and how many are held behind it; runs from a pull request are never read. */
export function filmingRun(runs: WorkflowRuns['workflow_runs']): { run: WorkflowRuns['workflow_runs'][number] | null; queued: number } {
  const own = runs.filter((r) => OWN_EVENTS.has(r.event));
  const at = own.findIndex((r) => !HELD.has(r.status ?? ''));
  return at < 0 ? { run: own[0] ?? null, queued: 0 } : { run: own[at]!, queued: at };
}

export async function filmingSection(env: GitHubEnv, fetcher: typeof fetch = fetch): Promise<Section<Filming>> {
  const gh = githubApi(env, fetcher);
  const runs = await gh<WorkflowRuns>(`/actions/workflows/${FILMING_WORKFLOW}/runs?branch=main&per_page=10`, 'GitHub filming runs');
  const { run, queued } = filmingRun(runs.workflow_runs);
  if (!run) return ok({ run: null, queued: 0, jobs: [] });
  const jobs = await gh<RunJobs>(`/actions/runs/${run.id}/jobs?filter=latest&per_page=100`, 'GitHub filming jobs');
  return ok({
    run: { number: run.run_number, event: run.event, status: run.status ?? 'unknown', conclusion: run.conclusion, sha: run.head_sha.slice(0, 8), at: run.created_at, url: run.html_url },
    queued,
    jobs: filmJobs(jobs.jobs)
  });
}
